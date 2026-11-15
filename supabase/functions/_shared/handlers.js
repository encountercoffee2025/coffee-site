// 兩個 Edge Function 的處理邏輯（index.ts 只負責把請求交給這裡，Node 測試也直接呼叫這裡）。
import { placeOrder, newOrderId, newToken, publicOrder, splitCatalog, mergeCatalog, cancelOrders } from './core.js';
import { ecpayConfig, mapConfig, paymentForm, periodicForm, cancelPeriod, verifyMac, paymentTypeLabel, refundCredit, inCloseWindow } from './ecpay.js';
import { newSubscription, periodOrder, publicSubscription, addMonths, taipeiDate } from './subscription.js';
import { notifyOwner, notifyPaid, notifyShipped, notifyOrderList } from './notify.js';
import { db } from './db.js';
import { logisticsConfig, createShipment, printForm, shipmentCode, verifyLogisticsMac, pickupNameProblem, pickupPhoneProblem, SUB_TYPES, SENT_CODES, PICKED_UP_CODES } from './logistics.js';

const site = env => (env.SITE_URL || 'https://encountercoffee2025.com').replace(/\/$/, '');
const ORIGINS = ['https://encountercoffee2025.com', 'https://www.encountercoffee2025.com', 'https://encountercoffee2025.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const ID = /^EC\d{8}[A-Z0-9]{6}$/, SUB_ID = /^SB\d{8}[A-Z0-9]{6}$/, TOKEN = /^[a-f0-9]{32}$/, TRADE = /^[A-Za-z0-9]{1,20}$/;
const newSubId = () => 'SB' + newOrderId().slice(2);
const fnURL = env => env.SUPABASE_URL + '/functions/v1/ecpay';

function paymentURLs(env, id, token) {
  const fn = env.SUPABASE_URL + '/functions/v1/ecpay';
  return { notify: fn + '?type=notify', result: fn + '?type=return', back: `${site(env)}/checkout.html?order=${id}&t=${token}` };
}

async function findSubscription(D, id, token) {
  if (!SUB_ID.test(String(id)) || !TOKEN.test(String(token))) throw Object.assign(new Error('找不到這筆訂閱'), { status: 404 });
  const [row] = await D.get(`subscriptions?id=eq.${id}&select=id,token,trade_no,status,data,version`);
  if (!row || row.token !== token) throw Object.assign(new Error('找不到這筆訂閱'), { status: 404 });
  return row;
}

// 只有後台管理員能取消訂閱：用登入者的權杖向 Supabase 確認身分，再查管理員名單
export async function requireAdmin(req, env, D) {
  const auth = req.headers.get('authorization') || '';
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: auth } });
  const user = res.ok ? await res.json() : null;
  // 權杖已由上面的 /auth/v1/user 驗證過簽章；這裡再確認已完成兩步驟驗證（aal2）
  let aal = '';
  try { aal = JSON.parse(atob(auth.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || '' } catch (_) {}
  if (!user?.id || !/^[0-9a-f-]{36}$/.test(user.id) || aal !== 'aal2' || !(await D.get(`admins?user_id=eq.${user.id}&select=user_id`)).length) throw Object.assign(new Error('沒有後台權限，請重新登入'), { status: 401 });
}

// 未付款訂單保留庫存 30 分鐘，逾時自動取消並回補庫存（排程每 5 分鐘、每次下單與開啟購物車時都會檢查）
export const HOLD_MINUTES = 30;
export async function releaseExpired(D, now = new Date()) {
  const before = new Date(now.getTime() - HOLD_MINUTES * 60000).toISOString();
  // 只處理仍是「新訂單」的未付款訂單；後台已手動確認的訂單不會被自動取消
  const rows = await D.get(`orders?payment=eq.unpaid&status=eq.new&created_at=lt.${before}&select=id,data,version&order=created_at.asc&limit=30`);
  if (!rows.length) return 0;
  // 先把訂單標成取消（版本號不符代表剛收到付款，跳過），再回補這些訂單的庫存
  const reason = `超過 ${HOLD_MINUTES} 分鐘未完成付款，系統自動取消並釋放庫存`;
  const cancelled = [];
  for (const row of rows) {
    const o = structuredClone(row.data);
    o.status = 'cancelled';
    o.history.push({ at: new Date().toISOString(), text: reason });
    const saved = await D.update(`orders?id=eq.${row.id}&version=eq.${row.version}&payment=eq.unpaid`, { data: { ...o, reserved: false }, status: 'cancelled', version: row.version + 1, updated_at: new Date().toISOString() });
    if (saved.length) cancelled.push(row.data);
  }
  const holding = cancelled.filter(o => o.reserved);
  for (let attempt = 0; holding.length && attempt < 4; attempt++) {
    const [[main], [priv]] = await Promise.all([D.get('site_state?id=eq.main&select=data,version'), D.get('site_private?id=eq.main&select=data')]);
    const { catalog } = cancelOrders(mergeCatalog(main.data, priv?.data), holding, reason);
    const { pub, priv: nextPriv } = splitCatalog(catalog);
    if (await D.rpc('save_catalog', { expected: main.version, pub, priv: nextPriv })) break;
  }
  return cancelled.length;
}

// 建立寄件單：已收款、尚未出貨的超商取貨訂單。成功後記下寄件代碼並填入物流單號。
export async function shipOrder(D, env, id, input = {}) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!ID.test(id)) throw fail(404, '找不到這筆訂單');
  const [row] = await D.get(`orders?id=eq.${id}&select=id,data,version`);
  if (!row) throw fail(404, '找不到這筆訂單');
  const o = row.data;
  if (o.shipment) return o;
  if (!SUB_TYPES[o.delivery]) throw fail(409, '只有 7-ELEVEN／全家取貨的訂單可以建立寄件單');
  if (o.payment !== 'paid') throw fail(409, '訂單尚未收款，不能建立寄件單');
  if (!['new', 'confirmed', 'packing'].includes(o.status)) throw fail(409, '已出貨、已完成或已取消的訂單不能建立寄件單');
  // 姓名或手機不符合超商規定時，後台可以填入修正後的收件人資料
  const receiver = { name: String(input.name ?? o.customer.name).trim(), phone: String(input.phone ?? o.customer.phone).trim() };
  const problem = pickupNameProblem(receiver.name) || pickupPhoneProblem(receiver.phone);
  if (problem) throw fail(400, problem);
  const cfg = logisticsConfig(env);
  const result = await createShipment(o, receiver, cfg, fnURL(env) + '?type=logistics');
  if (!result.ok) throw fail(502, '綠界建立寄件單失敗：' + result.message);
  const s = result.shipment, code = shipmentCode(s);
  // 綠界已建單：寫回訂單（版本號不符就重讀再寫，不會重複建單）
  for (let attempt = 0, cur = row; attempt < 4; attempt++) {
    if (attempt) [cur] = await D.get(`orders?id=eq.${id}&select=id,data,version`);
    const next = { ...cur.data, shipment: s, tracking: cur.data.tracking || code, history: [...cur.data.history, { at: s.createdAt, text: `建立${s.label}寄件單，寄件代碼 ${code}${cfg.mode === 'stage' ? '（測試環境）' : ''}` }] };
    if (receiver.name !== cur.data.customer.name || receiver.phone !== cur.data.customer.phone) next.history.push({ at: s.createdAt, text: `寄件收件人：${receiver.name}・${receiver.phone}` });
    const saved = await D.update(`orders?id=eq.${id}&version=eq.${cur.version}`, { data: next, version: cur.version + 1, updated_at: s.createdAt });
    if (saved.length) return next;
  }
  throw fail(500, `綠界已建立寄件單（寄件代碼 ${code}），但訂單更新失敗，請把這組代碼記到訂單的物流單號`);
}

// 物流狀態通知：記錄狀態；送達物流中心時「備貨中」改為「已出貨」，顧客取貨後「已出貨」改為「已完成」
async function logisticsNotice(D, env, params) {
  const cfg = logisticsConfig(env);
  if (!verifyLogisticsMac(params, cfg)) return '0|CheckMacValue Error';
  const id = String(params.MerchantTradeNo || ''), code = String(params.RtnCode || '');
  if (!ID.test(id)) return '1|OK';
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await D.get(`orders?id=eq.${id}&select=id,data,version`);
    if (!row?.data?.shipment || row.data.shipment.id !== String(params.AllPayLogisticsID)) return '1|OK';
    const o = structuredClone(row.data), at = new Date().toISOString(), s = o.shipment;
    const text = `物流狀態：${params.RtnMsg || code}（${code}${params.UpdateStatusDate ? '，' + params.UpdateStatusDate : ''}）`;
    if (o.history.some(h => h.text === text)) return '1|OK';
    s.code = code; s.status = params.RtnMsg || code; s.updatedAt = at;
    o.history.push({ at, text });
    const shippedNow = SENT_CODES.includes(code) && o.status === 'packing';
    if (shippedNow) { o.status = 'shipped'; o.history.push({ at, text: '包裹已送達物流中心，狀態自動改為已出貨' }) }
    if (PICKED_UP_CODES.includes(code) && o.status === 'shipped') { o.status = 'completed'; o.history.push({ at, text: '顧客已取貨，狀態自動改為已完成' }) }
    const saved = await D.update(`orders?id=eq.${id}&version=eq.${row.version}`, { data: o, status: o.status, version: row.version + 1, updated_at: at });
    if (saved.length) {
      if (shippedNow) await sendShippedNotice(D, env, id).catch(err => console.error('shipped notice', err));
      return '1|OK';
    }
  }
  return '0|Retry';
}

// 出貨通知信：訂單變成「已出貨」時寄一次（後台手動出貨，或物流中心收件後自動出貨）。寄過就不再寄。
export async function sendShippedNotice(D, env, id) {
  if (!ID.test(String(id))) return [];
  const load = async () => (await D.get(`orders?id=eq.${id}&select=id,token,data,version`))[0];
  const row = await load();
  if (!row || row.data.status !== 'shipped' || row.data.shippedMailAt) return [];
  const results = await notifyShipped(row.data, env, row.token);
  if (!results.length) return results;
  for (let attempt = 0, cur = row; attempt < 4; attempt++) {
    if (attempt) cur = await load();
    const at = new Date().toISOString();
    const next = { ...cur.data, shippedMailAt: at, history: [...cur.data.history, ...results.map(text => ({ at, text }))] };
    const saved = await D.update(`orders?id=eq.${id}&version=eq.${cur.version}`, { data: next, version: cur.version + 1, updated_at: at });
    if (saved.length) return results;
  }
  return results;
}

// 已付款訂單的全額退款。綠界退款不能復原，所以順序是：檢查 → 綠界退款 → 成功才改訂單 → 回補庫存。
export async function refundOrder(D, cfg, id, now = new Date()) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!ID.test(id)) throw fail(404, '找不到這筆訂單');
  const load = async () => (await D.get(`orders?id=eq.${id}&select=id,data,version`))[0];
  const first = await load();
  if (!first) throw fail(404, '找不到這筆訂單');
  const o = first.data;
  if (o.payment === 'refunded') return o;
  const cancellable = o.payment === 'paid' && ['new', 'confirmed', 'packing'].includes(o.status);
  if (!cancellable && !(o.payment === 'refund_pending' && o.status === 'cancelled')) {
    throw fail(409, ['shipped', 'completed'].includes(o.status) ? '已出貨的訂單請先處理退貨，再到綠界後台退款' : '只有已收款、尚未出貨的訂單可以退款');
  }
  if (!o.ecpay?.tradeNo || !o.ecpay?.merchantTradeNo) throw fail(409, '這筆訂單沒有綠界刷卡資料（可能是手動標記收款），請到綠界後台處理退款');
  if (cfg.mode === 'prod' && o.ecpay.simulated) throw fail(409, '這筆是模擬付款，沒有實際刷卡，不需要退款');

  let method;
  if (cfg.mode === 'prod') {
    if (inCloseWindow(now)) throw fail(409, '綠界每天 20:15～20:30 進行關帳，這段時間不能退款，請 20:30 後再試');
    const result = await refundCredit({ merchantTradeNo: o.ecpay.merchantTradeNo, tradeNo: o.ecpay.tradeNo, amount: o.total }, cfg);
    if (!result.ok) throw fail(502, '綠界退款失敗，訂單沒有變更：' + result.message);
    method = result.method;
  } else method = '測試環境：未呼叫綠界退款';

  // 綠界已退款：之後的步驟都要盡力完成，失敗也要清楚告訴管理員
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = attempt ? await load() : first;
    const cur = row.data, at = new Date().toISOString();
    // 退款期間若訂單剛好被改成已出貨，只記錄退款、不改出貨狀態也不回補庫存
    const open = ['new', 'confirmed', 'packing'].includes(cur.status), restock = open && cur.reserved;
    const next = { ...cur, status: open ? 'cancelled' : cur.status, payment: 'refunded', reserved: open ? false : cur.reserved, history: [...cur.history] };
    if (open) next.history.push({ at, text: '後台取消訂單並退款' + (restock ? '，釋放庫存' : '') });
    next.history.push({ at, text: `綠界全額退款 NT$ ${cur.total}：${method}` });
    const saved = await D.update(`orders?id=eq.${id}&version=eq.${row.version}`, { data: next, status: next.status, payment: next.payment, version: row.version + 1, updated_at: at });
    if (!saved.length) continue;
    if (restock) {
      let done = false;
      for (let i = 0; i < 4 && !done; i++) {
        const [[main], [priv]] = await Promise.all([D.get('site_state?id=eq.main&select=data,version'), D.get('site_private?id=eq.main&select=data')]);
        const { catalog } = cancelOrders(mergeCatalog(main.data, priv?.data), [cur], '取消並退款');
        const { pub, priv: nextPriv } = splitCatalog(catalog);
        done = Boolean(await D.rpc('save_catalog', { expected: main.version, pub, priv: nextPriv }));
      }
      if (!done) throw fail(500, '綠界已退款、訂單已取消，但庫存回補失敗，請到庫存頁手動補回');
    }
    return next;
  }
  throw fail(500, '綠界已退款，但訂單狀態更新失敗，請重新整理後把這筆訂單改為已取消、已退款');
}

// 同一個來源 10 分鐘內最多建立 5 筆訂單。只存 IP 的雜湊值，不存 IP 本身。
// 優先用 cf-connecting-ip：Supabase Edge Functions 前面是 Cloudflare，這個值由 Cloudflare 填入、顧客無法偽造；
// x-forwarded-for 的第一段可以由呼叫端自己帶，只在沒有其他來源時才用。
const RATE_WINDOW_MINUTES = 10, RATE_MAX = 5;
async function clientKey(req, env) {
  const ip = (req.headers.get('cf-connecting-ip') || '').trim() || (req.headers.get('x-real-ip') || '').trim() || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '';
  if (!ip) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('encounter|' + ip + '|' + String(env.SUPABASE_SERVICE_ROLE_KEY || '').slice(-16))));
  return Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

// 次數限制（rate_events 表，見 docs/supabase/09-order-lookup.sql）：只存雜湊值與時間
async function tooMany(D, kind, key, max, minutes) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  return (await D.get(`rate_events?kind=eq.${kind}&key=eq.${key}&created_at=gte.${since}&select=id`)).length >= max;
}
const recordEvent = (D, kind, key) => D.insert('rate_events', { kind, key });
async function secretHash(value, env) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('encounter|' + value + '|' + String(env.SUPABASE_SERVICE_ROLE_KEY || '').slice(-16))));
  return Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}
// 手機比對：只看數字，+886 開頭視為 0
const phoneDigits = v => { const d = String(v ?? '').replace(/\D/g, ''); return d.startsWith('886') ? '0' + d.slice(3) : d };
const LOOKUP_MAX = 10, LOOKUP_MINUTES = 10, MAIL_IP_MAX = 5, MAIL_TO_MAX = 3, MAIL_MINUTES = 60;

// 查詢訂單 A：訂單編號＋下單手機 → 回傳進度頁需要的查詢碼
export async function lookupOrder(req, env, D, body) {
  const client = (await clientKey(req, env)) || 'unknown';
  if (await tooMany(D, 'lookup', client, LOOKUP_MAX, LOOKUP_MINUTES)) throw Object.assign(new Error(`查詢次數太多，請 ${LOOKUP_MINUTES} 分鐘後再試；也可以改用 Email 寄送查詢連結`), { status: 429 });
  await recordEvent(D, 'lookup', client);
  const id = String(body.id ?? '').trim().toUpperCase(), phone = phoneDigits(body.phone);
  const notFound = Object.assign(new Error('找不到符合的訂單，請確認訂單編號與下單時填寫的手機'), { status: 404 });
  if (!ID.test(id) || phone.length < 8) throw notFound;
  const [row] = await D.get(`orders?id=eq.${id}&select=id,token,data`);
  if (!row || phoneDigits(row.data.customer?.phone) !== phone) throw notFound;
  return { orderId: row.id, token: row.token };
}

// 查詢訂單 B：輸入 Email → 把這個信箱的訂單進度連結寄過去。不論有沒有訂單都回覆一樣的訊息，避免被用來查誰買過。
export async function emailOrders(req, env, D, body) {
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw Object.assign(new Error('電子信箱格式不正確'), { status: 400 });
  const client = (await clientKey(req, env)) || 'unknown', to = await secretHash('mail|' + email, env);
  if (await tooMany(D, 'mail-ip', client, MAIL_IP_MAX, MAIL_MINUTES)) throw Object.assign(new Error('寄送次數太多，請 1 小時後再試'), { status: 429 });
  if (await tooMany(D, 'mail-to', to, MAIL_TO_MAX, MAIL_MINUTES)) throw Object.assign(new Error('這個信箱剛寄過查詢信，請先查看收件匣與垃圾郵件匣，或 1 小時後再試'), { status: 429 });
  await Promise.all([recordEvent(D, 'mail-ip', client), recordEvent(D, 'mail-to', to)]);
  // ilike 不分大小寫，但 _ 和 * 是萬用字元：取回後再逐筆比對完全相同的信箱
  const rows = (await D.get(`orders?data->customer->>email=ilike.${encodeURIComponent(email)}&select=id,token,data,created_at&order=created_at.desc&limit=30`))
    .filter(r => String(r.data.customer?.email ?? '').trim().toLowerCase() === email && !(r.data.status === 'cancelled' && r.data.payment === 'unpaid'))
    .slice(0, 20);
  if (rows.length) await notifyOrderList(email, rows, env);
  return { ok: true };
}

async function findOrder(D, id, token) {
  if (!ID.test(String(id)) || !TOKEN.test(String(token))) throw Object.assign(new Error('找不到這筆訂單'), { status: 404 });
  const [row] = await D.get(`orders?id=eq.${id}&select=id,token,trade_nos,data,version`);
  if (!row || row.token !== token) throw Object.assign(new Error('找不到這筆訂單'), { status: 404 });
  return row;
}

// 只允許網站自己的網域呼叫（其他 Edge Function 共用）
export function corsHeaders(req, env, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : site(env),
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Allow-Methods': methods,
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

// 顧客下單、重新付款與查詢訂單狀態
export async function handleCheckout(req, env) {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : site(env),
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const cfg = ecpayConfig(env), D = db(env), url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.searchParams.has('sweep')) return reply(200, { released: await releaseExpired(D) });
      if (url.searchParams.has('config')) {
        await releaseExpired(D).catch(err => console.error('releaseExpired', err));
        const [main] = await D.get('site_state?id=eq.main&select=data');
        return reply(200, { mode: cfg.mode, map: mapConfig(env), subscriptionsOpen: main?.data?.settings?.subscriptionsOpen === true });
      }
      if (url.searchParams.has('sub')) return reply(200, { mode: cfg.mode, subscription: publicSubscription((await findSubscription(D, url.searchParams.get('sub'), url.searchParams.get('t'))).data) });
      const row = await findOrder(D, url.searchParams.get('id'), url.searchParams.get('t'));
      return reply(200, { mode: cfg.mode, order: publicOrder(row.data) });
    }
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    const body = await req.json().catch(() => ({}));

    // 月費訂購：建立待授權的訂閱，前往綠界刷卡（定期定額）。需在後台開放，或帶測試預覽碼。
    if (body.action === 'subscribe') {
      const rows = await D.get('site_state?id=in.(main,content)&select=id,data');
      const settings = rows.find(r => r.id === 'main')?.data?.settings || {}, content = rows.find(r => r.id === 'content')?.data || {};
      const preview = env.SUBSCRIPTION_PREVIEW_KEY && body.preview === env.SUBSCRIPTION_PREVIEW_KEY;
      if (settings.subscriptionsOpen !== true && !preview) return reply(403, { error: '月費訂購尚未開放' });
      const id = newSubId(), token = newToken(), sub = newSubscription(body, content, id);
      await D.insert('subscriptions', { id, token, trade_no: id, status: sub.status, data: sub });
      const fn = fnURL(env);
      return reply(200, { subscriptionId: id, token, mode: cfg.mode, payment: await periodicForm(sub, cfg, { notify: fn + '?type=notify', period: fn + '?type=period', result: fn + '?type=return', back: `${site(env)}/subscribe.html?sub=${id}&t=${token}` }) });
    }

    if (body.action === 'cancel-subscription') {
      await requireAdmin(req, env, D);
      if (!SUB_ID.test(String(body.id))) return reply(404, { error: '找不到這筆訂閱' });
      const [row] = await D.get(`subscriptions?id=eq.${body.id}&select=id,trade_no,status,data,version`);
      if (!row) return reply(404, { error: '找不到這筆訂閱' });
      if (row.status === 'cancelled') return reply(200, { subscription: row.data });
      const sub = row.data, at = new Date().toISOString();
      if (row.status === 'active') {
        const result = await cancelPeriod(row.trade_no, cfg);
        if (!result.ok) return reply(502, { error: '綠界取消定期定額失敗：' + result.message + '。請到綠界廠商後台確認後再試。' });
        sub.history.push({ at, text: '已通知綠界停止定期定額扣款，訂閱取消' });
      } else sub.history.push({ at, text: '取消尚未完成授權的訂閱' });
      sub.status = 'cancelled';
      const saved = await D.update(`subscriptions?id=eq.${row.id}&version=eq.${row.version}`, { data: sub, status: sub.status, version: row.version + 1, updated_at: at });
      if (!saved.length) return reply(409, { error: '訂閱剛被更新，請重新整理後再試' });
      return reply(200, { subscription: sub });
    }

    // 後台「取消並退款」：先請綠界全額退款，成功後才把訂單改成已取消／已退款並回補庫存
    if (body.action === 'refund-order') {
      await requireAdmin(req, env, D);
      return reply(200, { order: await refundOrder(D, cfg, String(body.id || '')) });
    }

    // 後台建立 7-ELEVEN／全家寄件單，與列印託運單
    if (body.action === 'create-shipment') {
      await requireAdmin(req, env, D);
      return reply(200, { order: await shipOrder(D, env, String(body.id || ''), body) });
    }
    // 後台把訂單改成「已出貨」後呼叫：寄出貨通知信給顧客（只寄一次）
    if (body.action === 'notify-shipped') {
      await requireAdmin(req, env, D);
      return reply(200, { results: await sendShippedNotice(D, env, String(body.id || '')) });
    }
    if (body.action === 'print-shipment') {
      await requireAdmin(req, env, D);
      if (!ID.test(String(body.id))) return reply(404, { error: '找不到這筆訂單' });
      const [row] = await D.get(`orders?id=eq.${body.id}&select=data`);
      if (!row?.data?.shipment) return reply(404, { error: '這筆訂單還沒有寄件單' });
      return reply(200, { print: printForm(row.data.shipment, logisticsConfig(env), String(body.mode || '1')) });
    }

    // 查詢訂單（顧客用，不需登入；有次數限制）
    if (body.action === 'lookup-order') return reply(200, await lookupOrder(req, env, D, body));
    if (body.action === 'email-orders') return reply(200, await emailOrders(req, env, D, body));

    if (body.action === 'pay') {
      const row = await findOrder(D, body.id, body.token), o = row.data;
      if (o.payment !== 'unpaid' || o.status === 'cancelled') return reply(409, { error: o.payment === 'paid' ? '這筆訂單已完成付款' : '這筆訂單無法付款' });
      const tradeNo = `${row.id}R${row.trade_nos.length}`;
      const updated = await D.update(`orders?id=eq.${row.id}&version=eq.${row.version}`, { trade_nos: [...row.trade_nos, tradeNo], version: row.version + 1, updated_at: new Date().toISOString() });
      if (!updated.length) return reply(409, { error: '訂單剛被更新，請重新整理後再試' });
      return reply(200, { orderId: row.id, token: row.token, mode: cfg.mode, payment: await paymentForm(o, tradeNo, cfg, paymentURLs(env, row.id, row.token)) });
    }

    const client = await clientKey(req, env);
    if (client) {
      const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60000).toISOString();
      const recent = await D.get(`orders?client=eq.${client}&created_at=gte.${since}&select=id`);
      if (recent.length >= RATE_MAX) return reply(429, { error: '短時間內下單次數太多，請 10 分鐘後再試；如需協助請來信聯絡我們' });
    }
    await releaseExpired(D).catch(err => console.error('releaseExpired', err));
    // 建立訂單：讀取最新商品資料 → 計算並扣庫存 → 寫入訂單 → 以版本號寫回商品資料（被搶先更新就重試）
    for (let attempt = 0; attempt < 4; attempt++) {
      const [[main], [priv]] = await Promise.all([D.get('site_state?id=eq.main&select=data,version'), D.get('site_private?id=eq.main&select=data')]);
      if (!main) throw new Error('商店資料尚未建立');
      const id = newOrderId(), token = newToken();
      const { order, catalog } = placeOrder(mergeCatalog(main.data, priv?.data), body, id);
      order.payMethod = 'Credit';
      await D.insert('orders', { id, token, trade_nos: [id], status: order.status, payment: order.payment, data: order, ...(client ? { client } : {}) });
      const { pub, priv: nextPriv } = splitCatalog(catalog);
      const saved = await D.rpc('save_catalog', { expected: main.version, pub, priv: nextPriv });
      if (saved) return reply(200, { orderId: id, token, total: order.total, mode: cfg.mode, payment: await paymentForm(order, id, cfg, paymentURLs(env, id, token)) });
      await D.remove(`orders?id=eq.${id}`);
    }
    return reply(409, { error: '目前下單人數較多，請再按一次' });
  } catch (err) {
    if (err.internal || !err.message) { console.error(err); return reply(500, { error: '系統忙碌，請稍後再試' }); }
    return reply(err.status || 400, { error: err.message });
  }
}

// 綠界回傳：type=notify 為伺服器付款通知（回覆 1|OK），type=return 為顧客付款後導回網站
export async function handleEcpay(req, env) {
  const url = new URL(req.url), type = url.searchParams.get('type') || 'notify';
  const text = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (req.method !== 'POST') return type === 'return' || type === 'store' ? new Response(null, { status: 303, headers: { Location: site(env) + '/checkout.html' } }) : text('Method not allowed', 405);
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  // 超商電子地圖選好門市：帶著門市資料回到購物車（或月費訂購頁）。地圖回傳沒有簽章，只用來預先填入顧客自己的表單。
  if (type === 'store') {
    const page = params.ExtraData === 'subscribe' ? 'subscribe.html' : 'checkout.html';
    const id = String(params.CVSStoreID || ''), kind = String(params.LogisticsSubType || '');
    const ok = /^[A-Za-z0-9]{1,10}$/.test(id) && ['UNIMARTC2C', 'FAMIC2C', 'UNIMART', 'FAMI'].includes(kind);
    const query = ok ? '?' + new URLSearchParams({ store: id, storeName: String(params.CVSStoreName || '').trim().slice(0, 60), storeAddr: String(params.CVSAddress || '').trim().slice(0, 120), storeType: kind }) : '';
    return new Response(null, { status: 303, headers: { Location: `${site(env)}/${page}${query}` } });
  }
  if (type === 'logistics') return text(await logisticsNotice(db(env), env, params));
  const cfg = ecpayConfig(env), D = db(env);
  const valid = await verifyMac(params, cfg), tradeNo = String(params.MerchantTradeNo || '');
  const lookup = async () => TRADE.test(tradeNo) ? (await D.get(`orders?trade_nos=cs.%7B${tradeNo}%7D&select=id,token,data,version`))[0] : undefined;

  if (type === 'return') {
    if (valid && SUB_ID.test(tradeNo)) {
      const [sub] = await D.get(`subscriptions?trade_no=eq.${tradeNo}&select=id,token`).catch(() => []);
      if (sub) return new Response(null, { status: 303, headers: { Location: `${site(env)}/subscribe.html?sub=${sub.id}&t=${sub.token}` } });
    }
    const row = valid ? await lookup().catch(() => undefined) : undefined;
    return new Response(null, { status: 303, headers: { Location: site(env) + '/checkout.html' + (row ? `?order=${row.id}&t=${row.token}` : '') } });
  }
  if (!valid) return text('0|CheckMacValue Error');
  if (type === 'period' || SUB_ID.test(tradeNo)) return text(await subscriptionNotice(D, env, params, type === 'period'));
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await lookup();
    if (!row) return text('0|Order Not Found');
    const o = row.data, at = new Date().toISOString(), label = paymentTypeLabel(params.PaymentType);
    let paidNow = false;
    if (params.RtnCode === '1') {
      if (Number(params.TradeAmt) !== o.total) o.history.push({ at, text: `綠界回傳金額 ${params.TradeAmt} 與訂單金額 ${o.total} 不符，未標記收款，請到綠界後台確認` });
      else if (cfg.mode === 'prod' && params.SimulatePaid === '1') o.history.push({ at, text: '收到綠界「模擬付款」通知（綠界不會實際撥款），未標記收款，請勿出貨' });
      else if (o.payment === 'unpaid') {
        o.ecpay = { tradeNo: params.TradeNo || '', merchantTradeNo: tradeNo, paymentType: params.PaymentType || '', paymentDate: params.PaymentDate || '', simulated: params.SimulatePaid === '1' };
        if (o.status === 'cancelled') {
          o.payment = 'refund_pending'; o.history.push({ at, text: `訂單已取消但收到綠界付款（${label}），請處理退款` });
          (await notifyOwner(`⚠️ 一遇・已取消的訂單收到付款\n訂單 ${o.id}\n金額 NT$ ${o.total}（${label}）\n顧客 ${o.customer.name}・${o.customer.phone}\n這筆訂單因逾時未付款已自動取消、庫存已釋放。請到後台確認：有庫存可聯絡顧客改為出貨，否則到綠界後台退款。`, env)).forEach(t => o.history.push({ at: new Date().toISOString(), text: t }));
        }
        else { o.payment = 'paid'; paidNow = true; o.history.push({ at, text: `綠界付款完成（${label}）${params.SimulatePaid === '1' ? '・測試環境模擬付款' : ''}` }) }
      } else return text('1|OK');
    } else o.history.push({ at, text: `綠界付款未完成：${params.RtnMsg || params.RtnCode || '未知原因'}` });
    if (paidNow) (await notifyPaid(o, label, env, row.token)).forEach(t => o.history.push({ at: new Date().toISOString(), text: t }));
    const saved = await D.update(`orders?id=eq.${row.id}&version=eq.${row.version}`, { data: o, status: o.status, payment: o.payment, version: row.version + 1, updated_at: new Date().toISOString() });
    if (saved.length) return text('1|OK');
  }
  return text('0|Retry');
}

// 月費訂購扣款通知：第一期（ReturnURL）與之後每期（PeriodReturnURL）。依「累計成功次數」判斷是否為新的一期，重複通知不會重複出貨。
async function subscriptionNotice(D, env, params, isPeriod) {
  const tradeNo = String(params.MerchantTradeNo || '');
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = SUB_ID.test(tradeNo) ? await D.get(`subscriptions?trade_no=eq.${tradeNo}&select=id,data,version`) : [];
    if (!row) return '0|Subscription Not Found';
    const sub = row.data, at = new Date().toISOString();
    const n = isPeriod ? Number(params.TotalSuccessTimes) : 1, amount = Number(isPeriod ? params.Amount : params.TradeAmt);
    let order = null;
    if (params.RtnCode === '1') {
      if (ecpayConfig(env).mode === 'prod' && params.SimulatePaid === '1') sub.history.push({ at, text: '收到綠界「模擬付款」通知（綠界不會實際撥款），未建立出貨訂單' });
      else if (amount !== sub.price) sub.history.push({ at, text: `綠界回傳金額 ${amount} 與方案金額 ${sub.price} 不符，未建立出貨訂單，請到綠界後台確認` });
      else if (!Number.isInteger(n) || n <= (sub.periods || 0)) return '1|OK';
      else if (sub.status === 'cancelled') sub.history.push({ at, text: `訂閱已取消但收到第 ${n} 期扣款，請到綠界後台確認並退款` });
      else {
        if (n === 1) sub.ecpay = { tradeNo: params.TradeNo || '', simulated: params.SimulatePaid === '1' };
        order = periodOrder(sub, n, newOrderId());
        sub.status = 'active'; sub.periods = n; sub.nextDate = addMonths(taipeiDate(), Number(sub.cycle));
        sub.orders = [...(sub.orders || []), order.id];
        sub.history.push({ at, text: `第 ${n} 期扣款成功${params.SimulatePaid === '1' ? '（測試環境模擬）' : ''}，建立出貨訂單 ${order.id}` });
      }
    } else {
      sub.history.push({ at, text: `${isPeriod ? `第 ${(sub.periods || 0) + 1} 期` : '首期'}扣款失敗：${params.RtnMsg || params.RtnCode || '未知原因'}` });
      if (!isPeriod && sub.status === 'pending') sub.status = 'failed';
    }
    const saved = await D.update(`subscriptions?id=eq.${row.id}&version=eq.${row.version}`, { data: sub, status: sub.status, version: row.version + 1, updated_at: at });
    if (!saved.length) continue;
    if (order) {
      const orderToken = newToken();
      (await notifyPaid(order, '信用卡定期定額', env, orderToken)).forEach(t => order.history.push({ at: new Date().toISOString(), text: t }));
      await D.insert('orders', { id: order.id, token: orderToken, trade_nos: [],status: order.status, payment: order.payment, data: order });
    }
    return '1|OK';
  }
  return '0|Retry';
}
