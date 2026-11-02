// 兩個 Edge Function 的處理邏輯（index.ts 只負責把請求交給這裡，Node 測試也直接呼叫這裡）。
import { placeOrder, newOrderId, newToken, publicOrder, splitCatalog, mergeCatalog } from './core.js';
import { ecpayConfig, mapConfig, paymentForm, periodicForm, cancelPeriod, verifyMac, paymentTypeLabel } from './ecpay.js';
import { newSubscription, periodOrder, publicSubscription, addMonths, taipeiDate } from './subscription.js';
import { notifyPaid } from './notify.js';
import { db } from './db.js';

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
async function requireAdmin(req, env, D) {
  const auth = req.headers.get('authorization') || '';
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: auth } });
  const user = res.ok ? await res.json() : null;
  // 權杖已由上面的 /auth/v1/user 驗證過簽章；這裡再確認已完成兩步驟驗證（aal2）
  let aal = '';
  try { aal = JSON.parse(atob(auth.replace(/^Bearers+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || '' } catch (_) {}
  if (!user?.id || !/^[0-9a-f-]{36}$/.test(user.id) || aal !== 'aal2' || !(await D.get(`admins?user_id=eq.${user.id}&select=user_id`)).length) throw Object.assign(new Error('沒有後台權限，請重新登入'), { status: 401 });
}

async function findOrder(D, id, token) {
  if (!ID.test(String(id)) || !TOKEN.test(String(token))) throw Object.assign(new Error('找不到這筆訂單'), { status: 404 });
  const [row] = await D.get(`orders?id=eq.${id}&select=id,token,trade_nos,data,version`);
  if (!row || row.token !== token) throw Object.assign(new Error('找不到這筆訂單'), { status: 404 });
  return row;
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
      if (url.searchParams.has('config')) {
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

    if (body.action === 'pay') {
      const row = await findOrder(D, body.id, body.token), o = row.data;
      if (o.payment !== 'unpaid' || o.status === 'cancelled') return reply(409, { error: o.payment === 'paid' ? '這筆訂單已完成付款' : '這筆訂單無法付款' });
      const tradeNo = `${row.id}R${row.trade_nos.length}`;
      const updated = await D.update(`orders?id=eq.${row.id}&version=eq.${row.version}`, { trade_nos: [...row.trade_nos, tradeNo], version: row.version + 1, updated_at: new Date().toISOString() });
      if (!updated.length) return reply(409, { error: '訂單剛被更新，請重新整理後再試' });
      return reply(200, { orderId: row.id, token: row.token, mode: cfg.mode, payment: await paymentForm(o, tradeNo, cfg, paymentURLs(env, row.id, row.token)) });
    }

    // 建立訂單：讀取最新商品資料 → 計算並扣庫存 → 寫入訂單 → 以版本號寫回商品資料（被搶先更新就重試）
    for (let attempt = 0; attempt < 4; attempt++) {
      const [[main], [priv]] = await Promise.all([D.get('site_state?id=eq.main&select=data,version'), D.get('site_private?id=eq.main&select=data')]);
      if (!main) throw new Error('商店資料尚未建立');
      const id = newOrderId(), token = newToken();
      const { order, catalog } = placeOrder(mergeCatalog(main.data, priv?.data), body, id);
      if (['Credit', 'ATM', 'CVS'].includes(body.payMethod)) order.payMethod = body.payMethod;
      await D.insert('orders', { id, token, trade_nos: [id], status: order.status, payment: order.payment, data: order });
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
        if (o.status === 'cancelled') { o.payment = 'refund_pending'; o.history.push({ at, text: `訂單已取消但收到綠界付款（${label}），請處理退款` }) }
        else { o.payment = 'paid'; paidNow = true; o.history.push({ at, text: `綠界付款完成（${label}）${params.SimulatePaid === '1' ? '・測試環境模擬付款' : ''}` }) }
      } else return text('1|OK');
    } else o.history.push({ at, text: `綠界付款未完成：${params.RtnMsg || params.RtnCode || '未知原因'}` });
    if (paidNow) (await notifyPaid(o, label, env)).forEach(t => o.history.push({ at: new Date().toISOString(), text: t }));
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
      (await notifyPaid(order, '信用卡定期定額', env)).forEach(t => order.history.push({ at: new Date().toISOString(), text: t }));
      await D.insert('orders', { id: order.id, token: newToken(), trade_nos: [], status: order.status, payment: order.payment, data: order });
    }
    return '1|OK';
  }
  return '0|Retry';
}
