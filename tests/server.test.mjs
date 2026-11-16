// 伺服器下單與綠界通知測試：以記憶體假資料庫取代 Supabase，模擬 LINE 與 Email。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { handleCheckout, handleEcpay, refundOrder } = await import('../supabase/functions/_shared/handlers.js');
const { db } = await import('../supabase/functions/_shared/db.js');
const { logisticsMac } = await import('../supabase/functions/_shared/logistics.js');
const { ecpayConfig, inCloseWindow } = await import('../supabase/functions/_shared/ecpay.js');
const { checkMacValue, verifyMac } = await import('../supabase/functions/_shared/ecpay.js');

const results = [];
async function check(name, fn) { await fn(); results.push('PASS ' + name); console.log('PASS ' + name); }

// 種子商品資料 → 雲端 main 資料
const seedContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(base, 'assets/catalog-data.js'), 'utf8'), seedContext);
const seed = seedContext.window.COFFEE_SEED;
const catalog = () => JSON.parse(JSON.stringify({ version: 3, products: seed.products, treats: seed.treats, batches: seed.batches, ledger: seed.ledger, settings: seed.settings }));

const STAGE = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
let tables, sent, failNextCatalogWrite, doAction = {}, logisticsFail = '';
function reset() { tables = { site_state: [{ id: 'main', data: catalog(), version: 1 }], site_private: [], orders: [], subscriptions: [], rate_events: [], admins: [{ user_id: '11111111-2222-3333-4444-555555555555' }] }; sent = []; failNextCatalogWrite = false; }

// 假的 Supabase REST 與外部服務
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET';
  if (u.hostname === 'api.line.me' || u.hostname === 'api.resend.com') { sent.push({ host: u.hostname, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
  if (u.hostname === 'logistics-stage.ecpay.com.tw' || u.hostname === 'logistics.ecpay.com.tw') {
    const body = Object.fromEntries(new URLSearchParams(init.body)); sent.push({ host: 'ecpay-logistics', path: u.pathname, body });
    if (logisticsFail) return new Response(logisticsFail, { status: 200 });
    const seven = body.LogisticsSubType === 'UNIMARTC2C';
    const r = { AllPayLogisticsID: seven ? '3805223' : '3805224', BookingNote: '', CVSPaymentNo: seven ? 'D8858302' : '16000587908', CVSValidationNo: seven ? '6015' : '', GoodsAmount: body.GoodsAmount, LogisticsSubType: body.LogisticsSubType, LogisticsType: 'CVS', MerchantID: body.MerchantID, MerchantTradeNo: body.MerchantTradeNo, ReceiverAddress: '', ReceiverCellPhone: body.ReceiverCellPhone, ReceiverEmail: '', ReceiverName: body.ReceiverName, ReceiverPhone: '', RtnCode: '300', RtnMsg: '訂單處理中(綠界已收到訂單資料)', UpdateStatusDate: '2026/11/15 19:00:00' };
    r.CheckMacValue = logisticsMac(r, 'XBERn1YOvpM9nfZc', 'h1ONHk4P4yqbl5LK');
    return new Response('1|' + new URLSearchParams(r).toString(), { status: 200 });
  }
  if (u.pathname === '/CreditDetail/DoAction') { const body = Object.fromEntries(new URLSearchParams(init.body)); sent.push({ host: 'ecpay-doaction', body }); const ok = doAction[body.Action] === true; return new Response(`MerchantID=${body.MerchantID}&MerchantTradeNo=${body.MerchantTradeNo}&TradeNo=${body.TradeNo}&RtnCode=${ok ? 1 : 0}&RtnMsg=${ok ? '成功' : encodeURIComponent('狀態不符')}`, { status: 200 }); }
  if (u.pathname === '/Cashier/CreditCardPeriodAction') { sent.push({ host: 'ecpay-cancel', body: Object.fromEntries(new URLSearchParams(init.body)) }); return new Response('MerchantID=3002607&RtnCode=1&RtnMsg=成功', { status: 200 }); }
  if (u.pathname === '/auth/v1/user') { const ok = [ADMIN, ADMIN_AAL1].includes(init.headers?.Authorization); return new Response(JSON.stringify(ok ? { id: '11111111-2222-3333-4444-555555555555' } : { msg: 'invalid' }), { status: ok ? 200 : 401 }); }
  const table = u.pathname.split('/').pop(), rows = tables[table];
  const filters = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  // 支援 JSON 路徑（data->customer->>email）與 ilike（不分大小寫，_ 與 * 為萬用字元，跟 PostgREST 一樣）
  const field = (r, k) => k.includes('->') ? k.split(/->>?/).reduce((o, p) => o?.[p], r) : r[k];
  const like = (value, pattern) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.') + '$', 'i').test(String(value ?? ''));
  const match = r => filters.every(([k, v]) => { const x = field(r, k); return v.startsWith('eq.') ? String(x) === v.slice(3) : v.startsWith('neq.') ? String(x) !== v.slice(4) : v.startsWith('lt.') ? String(x) < v.slice(3) : v.startsWith('gte.') ? String(x) >= v.slice(4) : v.startsWith('cs.') ? x.includes(v.slice(4, -1)) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(x)) : v.startsWith('ilike.') ? like(x, v.slice(6)) : false });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (u.pathname === '/rest/v1/rpc/save_catalog') {
    const { expected, pub, priv } = JSON.parse(init.body), m = tables.site_state.find(r => r.id === 'main');
    if (failNextCatalogWrite) { failNextCatalogWrite = false; m.version++; return json(null); }
    if (m.version !== expected) return json(null);
    m.data = pub; m.version++;
    const old = tables.site_private.find(r => r.id === 'main'); if (old) old.data = priv; else tables.site_private.push({ id: 'main', data: priv });
    return json(m.version);
  }
  if (method === 'GET') return json(structuredClone(rows.filter(match)));
  if (method === 'POST') { const row = { version: 1, created_at: new Date().toISOString(), ...JSON.parse(init.body) }; if (row.id === undefined) row.id = rows.length + 1; if (rows.some(r => r.id === row.id)) return json({ message: 'duplicate' }, 409); rows.push(row); return json([row], 201); }
  if (method === 'PATCH') {
    if (table === 'site_state' && failNextCatalogWrite) { failNextCatalogWrite = false; tables.site_state[0].version++; return json([]); }
    const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(init.body))); return json(structuredClone(hit));
  }
  if (method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return json([]); }
  throw new Error('unexpected ' + method + ' ' + url);
};

const jwt = claims => 'Bearer x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';
const ADMIN = jwt({ aal: 'aal2' }), ADMIN_AAL1 = jwt({ aal: 'aal1' });
const ENV = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SITE_URL: 'https://encountercoffee2025.com' };
const NOTIFY_ENV = { ...ENV, LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_OWNER_USER_ID: 'Uowner', RESEND_API_KEY: 'resend' };
const MAIL_ENV = { ...NOTIFY_ENV, OWNER_EMAIL: 'owner@example.com' };
const customer = { name: '林小美', email: 'buyer@example.com', phone: '0912345678', address: '7-ELEVEN 深坑門市' };
const cart = [{ productId: 'guji', sku: 'guji-200', quantity: 2, roast: 'medium', grind: 'pour' }, { kind: 'treat', treatId: 'financier', quantity: 1 }];
const STORE = { id: '131386', name: '深坑門市', address: '新北市深坑區北深路三段 1 號', type: 'UNIMARTC2C' };
// 7-ELEVEN 取貨的測試訂單預設帶入地圖選好的門市（測試「沒選門市」時明確傳 store: null）
const withStore = body => body.delivery === '711' && !('store' in body) ? { ...body, store: STORE } : body;
const post = (body, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { origin: 'https://encountercoffee2025.com', 'content-type': 'application/json' }, body: JSON.stringify(withStore(body)) }), env);
const get = (query, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout' + query, { headers: { origin: 'http://localhost:4173' } }), env);
async function ecpay(params, type = 'notify', env = ENV) {
  const signed = { ...params, CheckMacValue: params.CheckMacValue ?? await checkMacValue(params, STAGE.hashKey, STAGE.hashIV) };
  return handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=' + type, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signed).toString() }), env);
}
const paidNotice = (tradeNo, amount, extra = {}) => ({ MerchantID: '3002607', MerchantTradeNo: tradeNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2510311234567890', TradeAmt: String(amount), PaymentDate: '2026/10/31 12:00:00', PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '10', TradeDate: '2026/10/31 11:59:00', SimulatePaid: '0', CustomField1: '', CustomField2: '', CustomField3: '', CustomField4: '', StoreID: '', ...extra });

await check('server copy of store.js matches the site', () => {
  const { build, buildPlans } = createRequire(import.meta.url)('../scripts/sync-store.cjs');
  assert.equal(fs.readFileSync(path.join(base, 'supabase/functions/_shared/store.js'), 'utf8'), build(), 'run: node scripts/sync-store.cjs');
  assert.equal(fs.readFileSync(path.join(base, 'supabase/functions/_shared/plans.js'), 'utf8'), buildPlans(), 'run: node scripts/sync-store.cjs');
});

await check('create order: server prices, shipping and stock; signed ECPay form', async () => {
  reset();
  const res = await post({ action: 'create', cart: cart.map(l => ({ ...l, price: 1 })), customer, delivery: '711', note: '請下午寄出' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://encountercoffee2025.com');
  const guji = seed.products.find(p => p.id === 'guji').variants[0], fin = seed.treats.find(t => t.id === 'financier');
  // 咖啡與甜點分開算運費：甜點不計入咖啡免運，另收冷凍運費（甜點滿冷凍門檻才免）
  const coffee = guji.price * 2, shipping = (coffee >= seed.settings.freeShipping ? 0 : seed.settings.shippingRates['711']) + (fin.price >= seed.settings.frozenFreeShipping ? 0 : seed.settings.frozenRate);
  assert.equal(body.total, coffee + fin.price + shipping);
  assert.match(body.payment.fields.ItemName, /冷凍運費 x 1/);
  assert.match(body.orderId, /^EC\d{8}[A-Z0-9]{6}$/);
  assert.equal(body.payment.action, 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5');
  assert.equal(body.payment.fields.TotalAmount, String(body.total));
  assert.equal(body.payment.fields.MerchantTradeNo, body.orderId);
  assert.ok(await verifyMac(body.payment.fields, STAGE));
  assert.ok(body.payment.fields.ClientBackURL.endsWith(`/checkout.html?order=${body.orderId}&t=${body.token}`));
  const main = tables.site_state[0];
  assert.equal(main.version, 2);
  assert.equal(main.data.products.find(p => p.id === 'guji').variants[0].stock, guji.stock - 2);
  assert.equal(main.data.treats.find(t => t.id === 'financier').stock, fin.stock - 1);
  const row = tables.orders[0];
  assert.deepEqual(row.trade_nos, [body.orderId]);
  assert.equal(row.data.payment, 'unpaid');
  assert.equal(row.data.customerNote, '請下午寄出');
  assert.equal(row.data.items[0].roast, 'medium');
});

await check('one-time orders are credit card only, whatever the browser asks for', async () => {
  reset();
  for (const [method, expected] of [['ATM', 'Credit'], ['CVS', 'Credit'], ['Credit', 'Credit'], ['Bitcoin', 'Credit'], [undefined, 'Credit']]) {
    const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711', payMethod: method })).json();
    assert.equal(body.payment.fields.ChoosePayment, expected);
    assert.ok(await verifyMac(body.payment.fields, STAGE));
  }
  assert.equal(tables.orders[0].data.payMethod, 'Credit');
  const { id, token } = tables.orders[0];
  const again = await (await post({ action: 'pay', id, token })).json();
  assert.equal(again.payment.fields.ChoosePayment, 'Credit');
});

await check('create order rejects bad input with a readable message', async () => {
  reset();
  for (const [body, pattern] of [
    [{ action: 'create', cart: [], customer, delivery: '711' }, /購物車/],
    [{ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 9999 }], customer, delivery: '711' }, /.+/],
    [{ action: 'create', cart, customer: { ...customer, email: 'nope' }, delivery: '711' }, /電子信箱/],
    [{ action: 'create', cart: [{ productId: 'missing', sku: 'x', quantity: 1 }], customer, delivery: '711' }, /找不到/]
  ]) {
    const res = await post(body), json = await res.json();
    assert.equal(res.status, 400, JSON.stringify(json)); assert.match(json.error, pattern);
  }
  assert.equal(tables.orders.length, 0);
  assert.equal(tables.site_state[0].version, 1);
});

await check('convenience-store pickup needs a store picked on the map; address comes from the store', async () => {
  reset();
  for (const [body, pattern] of [
    [{ action: 'create', cart, customer, delivery: '711', store: null }, /選擇取貨門市/],
    [{ action: 'create', cart, customer, delivery: 'family', store: { id: '<x>', name: 'x' } }, /選擇取貨門市/],
    [{ action: 'create', cart, customer, delivery: 'family', store: STORE }, /不符/]
  ]) { const res = await post(body); assert.equal(res.status, 400); assert.match((await res.json()).error, pattern); }
  assert.equal((await post({ action: 'create', cart, customer: { ...customer, address: '亂填的地址' }, delivery: '711' })).status, 200);
  const o = tables.orders[0].data;
  assert.deepEqual(o.store, { id: '131386', name: '深坑門市', address: '新北市深坑區北深路三段 1 號', type: 'UNIMARTC2C' });
  assert.equal(o.customer.address, '深坑門市（店號 131386）新北市深坑區北深路三段 1 號');
  const home = await post({ action: 'create', cart, customer: { ...customer, address: '新北市深坑區 1 號' }, delivery: 'home' });
  assert.equal(home.status, 200);
  assert.equal(tables.orders[1].data.store, undefined);
  const cfg = await (await get('?config')).json();
  assert.equal(cfg.map.action, 'https://logistics-stage.ecpay.com.tw/Express/map');
  assert.equal(cfg.map.merchantId, '2000933');
  assert.equal(cfg.map.replyURL, 'https://demo.supabase.co/functions/v1/ecpay?type=store');
});

await check('map reply sends the shopper back with the chosen store; bad data is dropped', async () => {
  const reply = (fields, extra = 'checkout') => handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=store', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ MerchantID: '2000933', LogisticsSubType: 'FAMIC2C', CVSStoreID: '006598', CVSStoreName: '全家深坑店', CVSAddress: '新北市深坑區深坑街 1 號', CVSTelephone: '', CVSOutSide: '0', ExtraData: extra, ...fields }).toString() }), ENV);
  const ok = await reply({});
  assert.equal(ok.status, 303);
  const loc = new URL(ok.headers.get('location'));
  assert.equal(loc.pathname, '/checkout.html');
  assert.deepEqual(Object.fromEntries(loc.searchParams), { store: '006598', storeName: '全家深坑店', storeAddr: '新北市深坑區深坑街 1 號', storeType: 'FAMIC2C' });
  assert.equal(new URL((await reply({}, 'subscribe')).headers.get('location')).pathname, '/subscribe.html');
  assert.equal((await reply({ CVSStoreID: '<script>' })).headers.get('location'), 'https://encountercoffee2025.com/checkout.html');
});

await check('stock changed by another order meanwhile: retry with fresh data, no duplicate order', async () => {
  reset(); failNextCatalogWrite = true;
  const res = await post({ action: 'create', cart, customer, delivery: 'home' });
  assert.equal(res.status, 200);
  assert.equal(tables.orders.length, 1);
});

await check('order status needs the private token and hides contact details', async () => {
  reset();
  const { orderId, token } = await (await post({ action: 'create', cart, customer, delivery: '711' })).json();
  assert.equal((await get(`?id=${orderId}&t=${'0'.repeat(32)}`)).status, 404);
  const res = await get(`?id=${orderId}&t=${token}`), json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.order.payment, 'unpaid');
  assert.ok(!JSON.stringify(json).includes('buyer@example.com'));
  assert.equal((await (await get('?config')).json()).mode, 'stage');
});

await check('ECPay notice marks paid once, notifies LINE + email, ignores duplicates', async () => {
  reset();
  const { orderId, token, total } = await (await post({ action: 'create', cart, customer, delivery: '711' })).json();
  assert.equal(await (await ecpay(paidNotice(orderId, total), 'notify', NOTIFY_ENV)).text(), '1|OK');
  const o = tables.orders[0].data;
  assert.equal(o.payment, 'paid'); assert.equal(tables.orders[0].payment, 'paid');
  assert.ok(o.history.some(h => h.text.includes('綠界付款完成（信用卡）')));
  assert.deepEqual(sent.map(s => s.host).sort(), ['api.line.me', 'api.resend.com']);
  assert.ok(sent.find(s => s.host === 'api.line.me').body.messages[0].text.includes(orderId));
  assert.deepEqual(sent.find(s => s.host === 'api.resend.com').body.to, ['buyer@example.com']);
  assert.equal(sent.find(s => s.host === 'api.resend.com').body.reply_to, undefined);
  assert.equal(await (await ecpay(paidNotice(orderId, total), 'notify', NOTIFY_ENV)).text(), '1|OK');
  assert.equal(sent.length, 2);
  const back = await ecpay(paidNotice(orderId, total), 'return');
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), `https://encountercoffee2025.com/checkout.html?order=${orderId}&t=${token}`);
  const repay = await post({ action: 'pay', id: orderId, token });
  assert.equal(repay.status, 409);
});

await check('confirmation email copies the shop and replies go to the shop', async () => {
  reset();
  const { orderId, total } = await (await post({ action: 'create', cart, customer, delivery: '711' })).json();
  await ecpay(paidNotice(orderId, total), 'notify', MAIL_ENV);
  const mail = sent.find(s => s.host === 'api.resend.com').body;
  assert.deepEqual(mail.bcc, ['owner@example.com']);
  assert.equal(mail.reply_to, 'owner@example.com');
  assert.match(mail.subject, new RegExp(orderId));
  assert.ok(mail.html.includes('林小美'));
});

await check('ECPay notice with wrong signature or wrong amount does not mark paid', async () => {
  reset();
  const { orderId, total } = await (await post({ action: 'create', cart, customer, delivery: '711' })).json();
  assert.equal(await (await ecpay({ ...paidNotice(orderId, total), CheckMacValue: 'BAD' })).text(), '0|CheckMacValue Error');
  assert.equal(await (await ecpay(paidNotice(orderId, total + 1))).text(), '1|OK');
  assert.equal(tables.orders[0].data.payment, 'unpaid');
  assert.ok(tables.orders[0].data.history.some(h => h.text.includes('不符')));
  assert.equal(sent.length, 0);
  const forged = await ecpay({ ...paidNotice(orderId, total), CheckMacValue: 'BAD' }, 'return');
  assert.equal(forged.headers.get('location'), 'https://encountercoffee2025.com/checkout.html');
});

await check('failed payment can be retried with a new ECPay trade number', async () => {
  reset();
  const { orderId, token, total } = await (await post({ action: 'create', cart, customer, delivery: '711' })).json();
  await ecpay({ ...paidNotice(orderId, total), RtnCode: '10100058', RtnMsg: '付款失敗' });
  assert.equal(tables.orders[0].data.payment, 'unpaid');
  const res = await post({ action: 'pay', id: orderId, token }), json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.payment.fields.MerchantTradeNo, orderId + 'R1');
  assert.ok(await verifyMac(json.payment.fields, STAGE));
  assert.equal(await (await ecpay(paidNotice(orderId + 'R1', total))).text(), '1|OK');
  assert.equal(tables.orders[0].data.payment, 'paid');
});

await check('production mode refuses to run without real ECPay keys', async () => {
  reset();
  const res = await post({ action: 'create', cart, customer, delivery: '711' }, { ...ENV, ECPAY_MODE: 'prod' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /金流尚未設定/);
});


// ── 月費訂購（定期定額）──
const { loadStore } = await import('../supabase/functions/_shared/store.js');
const memory = new Map();
const SV = loadStore({ addEventListener() {}, dispatchEvent() {}, COFFEE_SEED: null, COFFEE_PLANS: [] }, { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }, class { constructor(t) { this.type = t } });
const validState = () => SV.validate(JSON.parse(JSON.stringify({ ...catalog(), cart: [], orders: tables.orders.map(r => r.data), subscriptions: tables.subscriptions.filter(r => ['active', 'cancelled'].includes(r.status)).map(r => r.data) })));
const subBody = (extra = {}) => ({ action: 'subscribe', planId: 'regular', cycle: '2', roast: 'medium', grind: 'pour', customer, delivery: '711', store: STORE, ...extra });
const periodNotice = (sub, n, amount, extra = {}) => ({ MerchantID: '3002607', MerchantTradeNo: sub, RtnCode: '1', RtnMsg: '成功', PeriodType: 'M', Frequency: '2', ExecTimes: '99', Amount: String(amount), Gwsr: '123', ProcessDate: '2026/12/31 10:00:00', AuthCode: '777777', FirstAuthAmount: String(amount), TotalSuccessTimes: String(n), SimulatePaid: '0', ...extra });
const setOpen = open => { tables.site_state[0].data.settings.subscriptionsOpen = open };

await check('subscriptions stay closed until the admin opens them (or a private preview key is used)', async () => {
  reset();
  assert.equal((await post(subBody())).status, 403);
  assert.equal((await post(subBody({ preview: 'wrong' }), { ...ENV, SUBSCRIPTION_PREVIEW_KEY: 'secret-preview' })).status, 403);
  assert.equal((await post(subBody({ preview: 'secret-preview' }), { ...ENV, SUBSCRIPTION_PREVIEW_KEY: 'secret-preview' })).status, 200);
  setOpen(true);
  assert.equal((await post(subBody())).status, 200);
  assert.equal((await (await get('?config')).json()).subscriptionsOpen, true);
});

await check('subscribe: plan price follows admin edits; ECPay recurring form (credit card, every 2 months, 99 times)', async () => {
  reset(); setOpen(true);
  tables.site_state.push({ id: 'content', data: { texts: {}, images: {}, plans: { regular: { price: 990, name: '常遇方案（新）' } } }, version: 1 });
  const res = await post(subBody()), body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body.subscriptionId, /^SB\d{8}[A-Z0-9]{6}$/);
  const f = body.payment.fields;
  assert.deepEqual([f.TotalAmount, f.PeriodAmount, f.PeriodType, f.Frequency, f.ExecTimes, f.ChoosePayment, f.MerchantTradeNo], ['990', '990', 'M', '2', '99', 'Credit', body.subscriptionId]);
  assert.equal(f.PeriodReturnURL, 'https://demo.supabase.co/functions/v1/ecpay?type=period');
  assert.ok(f.ClientBackURL.endsWith(`/subscribe.html?sub=${body.subscriptionId}&t=${body.token}`));
  assert.ok(await verifyMac(f, STAGE));
  const sub = tables.subscriptions[0];
  assert.equal(sub.status, 'pending'); assert.equal(sub.data.name, '常遇方案（新）'); assert.equal(sub.data.customer.address, '深坑門市（店號 131386）新北市深坑區北深路三段 1 號');
  for (const [bad, pattern] of [[{ planId: 'nope' }, /方案/], [{ cycle: '3' }, /週期/], [{ roast: 'burnt' }, /烘焙度/], [{ store: null }, /門市/], [{ customer: { ...customer, email: 'x' } }, /電子信箱/]]) {
    const r = await post(subBody(bad)); assert.equal(r.status, 400); assert.match((await r.json()).error, pattern);
  }
});

await check('first authorization activates the subscription and creates period 1 shipping order (once)', async () => {
  reset(); setOpen(true);
  const { subscriptionId: id, token } = await (await post(subBody())).json();
  assert.equal(await (await ecpay(paidNotice(id, 880), 'notify', NOTIFY_ENV)).text(), '1|OK');
  const sub = tables.subscriptions[0];
  assert.equal(sub.status, 'active'); assert.equal(sub.data.periods, 1);
  assert.equal(tables.orders.length, 1);
  const o = tables.orders[0].data;
  assert.equal(o.payment, 'paid'); assert.equal(o.total, 880); assert.equal(o.shipping, 0); assert.equal(o.items[0].kind, 'plan');
  assert.match(o.items[0].name, /常遇方案（第 1 期・每兩個月）/); assert.match(o.customerNote, /中焙・研磨：手沖研磨/);
  assert.deepEqual(sent.map(s => s.host).sort(), ['api.line.me', 'api.resend.com']);
  validState();
  assert.equal(await (await ecpay(paidNotice(id, 880), 'notify', NOTIFY_ENV)).text(), '1|OK');
  assert.equal(tables.orders.length, 1);
  const back = await ecpay(paidNotice(id, 880), 'return');
  assert.equal(back.headers.get('location'), `https://encountercoffee2025.com/subscribe.html?sub=${id}&t=${token}`);
  const status = await (await get(`?sub=${id}&t=${token}`)).json();
  assert.equal(status.subscription.status, 'active'); assert.equal(status.subscription.periods, 1);
  assert.ok(!JSON.stringify(status).includes('buyer@example.com'));
});

await check('later periods: new order per successful charge, duplicates ignored, failures logged', async () => {
  reset(); setOpen(true);
  const { subscriptionId: id } = await (await post(subBody())).json();
  await ecpay(paidNotice(id, 880));
  const period = (n, extra) => ecpay(periodNotice(id, n, 880, extra), 'period');
  assert.equal(await (await period(2)).text(), '1|OK');
  assert.equal(await (await period(2)).text(), '1|OK');
  assert.equal(tables.orders.length, 2);
  assert.match(tables.orders.find(r => r.data.items[0].name.includes('第 2 期')).data.items[0].name, /第 2 期/);
  await period(2, { RtnCode: '10100248', RtnMsg: '授權失敗' });
  assert.equal(tables.orders.length, 2);
  assert.ok(tables.subscriptions[0].data.history.some(h => h.text.includes('第 3 期扣款失敗')));
  assert.equal(await (await ecpay({ ...periodNotice(id, 3, 880), CheckMacValue: 'BAD' }, 'period')).text(), '0|CheckMacValue Error');
  assert.equal(tables.orders.length, 2);
  validState();
});

await check('failed first authorization marks the subscription failed, no order', async () => {
  reset(); setOpen(true);
  const { subscriptionId: id } = await (await post(subBody())).json();
  await ecpay({ ...paidNotice(id, 880), RtnCode: '10100058', RtnMsg: '付款失敗' });
  assert.equal(tables.subscriptions[0].status, 'failed');
  assert.equal(tables.orders.length, 0);
});

await check('cancel: admin only, tells ECPay to stop charging, later charges are flagged for refund', async () => {
  reset(); setOpen(true);
  const { subscriptionId: id } = await (await post(subBody())).json();
  await ecpay(paidNotice(id, 880));
  const cancel = auth => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ action: 'cancel-subscription', id }) }), ENV);
  assert.equal((await cancel()).status, 401);
  assert.equal((await cancel('Bearer someone-else')).status, 401);
  assert.equal((await cancel(ADMIN_AAL1)).status, 401, 'admin without two-step verification is refused');
  const res = await cancel(ADMIN);
  assert.equal(res.status, 200);
  assert.equal(tables.subscriptions[0].status, 'cancelled');
  const call = sent.find(s => s.host === 'ecpay-cancel').body;
  assert.equal(call.Action, 'Cancel'); assert.equal(call.MerchantTradeNo, id); assert.ok(await verifyMac(call, STAGE));
  await ecpay(periodNotice(id, 2, 880), 'period');
  assert.equal(tables.orders.length, 1);
  assert.ok(tables.subscriptions[0].data.history.some(h => h.text.includes('退款')));
  validState();
});

await check('inventory log and batch details stay private; public catalog only keeps what the shop pages need', async () => {
  reset();
  const before = tables.site_state[0].data.ledger.length;
  const res = await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' });
  assert.equal(res.status, 200);
  const pub = tables.site_state[0].data, priv = tables.site_private[0].data;
  assert.equal(pub.privateSplit, true);
  assert.deepEqual(pub.ledger, []);
  assert.ok(pub.batches.every(b => b.notes === '' && b.packs['200'] === 0 && b.roastDate));
  assert.equal(priv.ledger.length, before + 1);
  assert.ok(priv.batches.some(b => b.notes));
  // 第二筆訂單：從私有表接續，不會遺失之前的紀錄
  await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' });
  assert.equal(tables.site_private[0].data.ledger.length, before + 2);
});

await check('production mode: ECPay "simulated payment" notices never mark an order paid', async () => {
  reset();
  const PROD = { ...ENV, ECPAY_MODE: 'prod', ECPAY_MERCHANT_ID: STAGE.merchantId, ECPAY_HASH_KEY: STAGE.hashKey, ECPAY_HASH_IV: STAGE.hashIV };
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, PROD)).json();
  const fields = { MerchantID: STAGE.merchantId, MerchantTradeNo: body.orderId, RtnCode: '1', RtnMsg: '交易成功', TradeNo: 'T1', TradeAmt: String(body.total), PaymentType: 'Credit_CreditCard', PaymentDate: '2026/11/02 12:00:00', SimulatePaid: '1' };
  const signed = { ...fields, CheckMacValue: await checkMacValue(fields, STAGE.hashKey, STAGE.hashIV) };
  const res = await handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=notify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signed).toString() }), PROD);
  assert.equal(await res.text(), '1|OK');
  assert.equal(tables.orders[0].data.payment, 'unpaid');
  assert.ok(tables.orders[0].data.history.some(h => h.text.includes('模擬付款')));
});

const postFrom = (ip, body) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { origin: 'https://encountercoffee2025.com', 'content-type': 'application/json', 'x-forwarded-for': ip + ', 10.0.0.1' }, body: JSON.stringify(withStore(body)) }), ENV);
const sweep = () => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout?sweep=1'), ENV);
const age = (row, minutes) => { row.created_at = new Date(Date.now() - minutes * 60000).toISOString() };
const stockOf = () => tables.site_state[0].data.products.find(p => p.id === 'guji').variants[0].stock;

await check('unpaid orders older than 30 minutes are cancelled automatically and their stock comes back', async () => {
  reset();
  const start = stockOf();
  const one = { action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 2 }], customer, delivery: '711' };
  for (let i = 0; i < 4; i++) assert.equal((await post(one)).status, 200);
  assert.equal(stockOf(), start - 8);
  const [expired, paid, confirmed, fresh] = tables.orders;
  age(expired, 31); age(paid, 45); age(confirmed, 45); age(fresh, 10);
  paid.payment = 'paid'; paid.data.payment = 'paid';
  confirmed.status = 'confirmed'; confirmed.data.status = 'confirmed';
  const res = await (await sweep()).json();
  assert.equal(res.released, 1);
  assert.equal(expired.status, 'cancelled');
  assert.equal(expired.data.reserved, false);
  assert.ok(expired.data.history.some(h => h.text.includes('自動取消')));
  assert.equal(paid.status, 'new'); assert.equal(confirmed.status, 'confirmed'); assert.equal(fresh.status, 'new');
  assert.equal(stockOf(), start - 6, 'only the expired order gives its 2 bags back');
  assert.ok(tables.site_private[0].data.ledger.some(m => m.reason === '取消訂單 ' + expired.id));
  assert.equal((await (await sweep()).json()).released, 0, 'running again changes nothing');
  assert.equal(stockOf(), start - 6);
});

await check('opening the cart (config) and placing a new order also release expired holds', async () => {
  reset();
  const start = stockOf();
  await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 3 }], customer, delivery: '711' });
  age(tables.orders[0], 40);
  await handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout?config=1'), ENV);
  assert.equal(tables.orders[0].status, 'cancelled');
  assert.equal(stockOf(), start);
  await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' });
  age(tables.orders[1], 40);
  await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' });
  assert.equal(tables.orders[1].status, 'cancelled');
  assert.equal(stockOf(), start - 1);
});

await check('the same visitor can place at most 5 orders in 10 minutes', async () => {
  reset();
  const one = { action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' };
  for (let i = 0; i < 5; i++) assert.equal((await postFrom('203.0.113.7', one)).status, 200);
  const blocked = await postFrom('203.0.113.7', one);
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /10 分鐘/);
  assert.equal((await postFrom('198.51.100.2', one)).status, 200, 'another visitor is not affected');
  assert.ok(tables.orders.every(o => /^[0-9a-f]{32}$/.test(o.client) && !JSON.stringify(o).includes('203.0.113.7')), 'only a hash is stored, never the IP');
  tables.orders.forEach(o => age(o, 11));
  assert.equal((await postFrom('203.0.113.7', one)).status, 200, 'allowed again after 10 minutes');
});

await check('a forged x-forwarded-for cannot bypass the order limit when Cloudflare reports the real IP', async () => {
  reset();
  const one = { action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' };
  const forged = i => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { origin: 'https://encountercoffee2025.com', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': `198.51.100.${i}, 10.0.0.1` }, body: JSON.stringify(withStore(one)) }), ENV);
  for (let i = 0; i < 5; i++) assert.equal((await forged(i)).status, 200);
  assert.equal((await forged(99)).status, 429, 'changing x-forwarded-for does not reset the limit');
});

await check('payment that arrives after auto-cancel is flagged for refund and the owner gets a LINE message', async () => {
  reset();
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' })).json();
  age(tables.orders[0], 31);
  await sweep();
  assert.equal(await (await ecpay(paidNotice(body.orderId, body.total), 'notify', NOTIFY_ENV)).text(), '1|OK');
  const o = tables.orders[0].data;
  assert.equal(o.status, 'cancelled'); assert.equal(o.payment, 'refund_pending');
  const line = sent.find(x => x.host === 'api.line.me');
  assert.match(line.body.messages[0].text, /已取消的訂單收到付款/);
  assert.ok(!sent.some(x => x.host === 'api.resend.com'), 'no "thanks for your order" email for a cancelled order');
});

// 後台自動翻譯（DeepL）：用假的 DeepL 服務，確認權限、用語對照、輸入檢查與錯誤訊息
const { handleTranslate, cleanItems, translateItems } = await import('../supabase/functions/_shared/translate.js');
let deeplCalls = [], deeplStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.hostname.endsWith('deepl.com')) {
    const body = JSON.parse(init.body);
    deeplCalls.push({ host: u.hostname, auth: init.headers.Authorization, body });
    if (deeplStatus !== 200) return new Response('{}', { status: deeplStatus });
    return new Response(JSON.stringify({ translations: body.text.map(t => ({ detected_source_language: 'ZH', text: 'en ' + t })) }), { status: 200 });
  }
  return realFetch(url, init);
};
const translateReq = (body, auth = ADMIN) => new Request('https://demo.supabase.co/functions/v1/translate', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://encountercoffee2025.com', Authorization: auth }, body: JSON.stringify(body) });
const TENV = { ...ENV, DEEPL_API_KEY: 'abc-123:fx' };

await check('translate: only 2FA admins can call it, and the DeepL key never reaches the browser', async () => {
  reset(); deeplCalls = []; deeplStatus = 200;
  const items = [{ id: 'description', zh: '清楚的柑橘香氣伴隨白花感。' }];
  assert.equal((await handleTranslate(translateReq({ items }, 'Bearer nope'), TENV)).status, 401);
  assert.equal((await handleTranslate(translateReq({ items }, ADMIN_AAL1), TENV)).status, 401);
  assert.equal(deeplCalls.length, 0);
  const res = await handleTranslate(translateReq({ items }), TENV), body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { translations: { description: 'en 清楚的柑橘香氣伴隨白花感。' } });
  assert.ok(!JSON.stringify(body).includes('abc-123'));
  assert.equal(deeplCalls[0].host, 'api-free.deepl.com', 'free keys use the free endpoint');
  assert.equal(deeplCalls[0].auth, 'DeepL-Auth-Key abc-123:fx');
  assert.equal(deeplCalls[0].body.source_lang, 'ZH'); assert.equal(deeplCalls[0].body.target_lang, 'EN-US');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://encountercoffee2025.com');
});

await check('translate: coffee glossary wins, flavor tags are translated one by one and only unknown words go to DeepL', async () => {
  deeplCalls = []; deeplStatus = 200;
  const t = await translateItems([{ id: 'process', kind: 'text', zh: '水洗' }, { id: 'tags', kind: 'tags', zh: '檸檬、白花、香草、桂圓' }, { id: 'country', kind: 'text', zh: '衣索比亞' }], 'pro-key');
  assert.deepEqual(t, { process: 'Washed', tags: 'Lemon, White florals, Vanilla, En 桂圓', country: 'Ethiopia' });
  assert.equal(deeplCalls.length, 1); assert.deepEqual(deeplCalls[0].body.text, ['桂圓']);
  assert.equal(deeplCalls[0].host, 'api.deepl.com', 'paid keys use the normal endpoint');
  deeplCalls = [];
  assert.deepEqual(await translateItems([{ id: 'a', kind: 'tags', zh: '檸檬，蜂蜜' }], 'k:fx'), { a: 'Lemon, Honey' });
  assert.equal(deeplCalls.length, 0, 'nothing sent when every word is in the glossary');
});

await check('translate: validates input and reports missing key, bad key and used-up quota in Chinese', async () => {
  reset(); deeplCalls = []; deeplStatus = 200;
  assert.throws(() => cleanItems([]), /沒有需要翻譯/);
  assert.throws(() => cleanItems([{ id: 'a b', zh: '字' }]), /格式不正確/);
  assert.throws(() => cleanItems([{ id: 'a', zh: '字' }, { id: 'a', zh: '字' }]), /格式不正確/);
  assert.throws(() => cleanItems([{ id: 'a', zh: 'x'.repeat(2001) }]), /最多 2000 字/);
  assert.deepEqual(cleanItems([{ id: 'a', zh: '  ' }, { id: 'b', zh: '檸檬、白花', kind: 'tags' }, { id: 'c', zh: '說明', kind: 'weird' }]), [{ id: 'b', kind: 'tags', zh: '檸檬、白花' }, { id: 'c', kind: 'text', zh: '說明' }]);
  const one = { items: [{ id: 'a', zh: '一段說明' }] };
  const noKey = await handleTranslate(translateReq(one), ENV);
  assert.equal(noKey.status, 503); assert.match((await noKey.json()).error, /DEEPL_API_KEY/);
  deeplStatus = 403; const bad = await handleTranslate(translateReq(one), TENV);
  assert.equal(bad.status, 503); assert.match((await bad.json()).error, /金鑰無效/);
  deeplStatus = 456; const quota = await handleTranslate(translateReq(one), TENV);
  assert.equal(quota.status, 429); assert.match((await quota.json()).error, /額度已用完/);
  deeplStatus = 200;
  assert.equal((await handleTranslate(new Request('https://demo.supabase.co/functions/v1/translate', { method: 'OPTIONS' }), TENV)).status, 204);
});

// ===== 後台「取消並退款」 =====
// 正式模式在台北時間 20:15～20:30 會擋下退款（綠界關帳時段），這段時間跑測試會失敗，請稍後再跑
if (inCloseWindow(new Date())) throw new Error('台北時間 20:15～20:30 是綠界關帳時段，退款測試會被擋下，請 20:30 後再執行');
const PRODENV = { ...ENV, ECPAY_MODE: 'prod', ECPAY_MERCHANT_ID: STAGE.merchantId, ECPAY_HASH_KEY: STAGE.hashKey, ECPAY_HASH_IV: STAGE.hashIV };
const refundReq = (id, auth = ADMIN, env = PRODENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://encountercoffee2025.com', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ action: 'refund-order', id }) }), env);
async function paidOrder(env = PRODENV) {
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, env)).json();
  assert.equal(await (await ecpay(paidNotice(body.orderId, body.total), 'notify', env)).text(), '1|OK');
  return body;
}
const doActions = () => sent.filter(s => s.host === 'ecpay-doaction').map(s => s.body.Action).join('');

await check('refund: only 2FA admins can call it', async () => {
  reset(); doAction = { N: true };
  const { orderId } = await paidOrder();
  assert.equal((await refundReq(orderId, null)).status, 401);
  assert.equal((await refundReq(orderId, ADMIN_AAL1)).status, 401);
  assert.equal(doActions(), '', 'ECPay is never called for non-admins');
  assert.equal(tables.orders[0].data.payment, 'paid');
});

await check('refund: authorized card is released (N), order cancelled and refunded, stock restored once', async () => {
  reset(); doAction = { N: true };
  const start = stockOf();
  const { orderId, total } = await paidOrder();
  assert.equal(stockOf(), start - 1);
  const res = await refundReq(orderId);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const call = sent.find(s => s.host === 'ecpay-doaction').body;
  assert.equal(call.Action, 'N'); assert.equal(call.MerchantTradeNo, orderId); assert.equal(call.TradeNo, '2510311234567890'); assert.equal(call.TotalAmount, String(total));
  assert.ok(await verifyMac(call, STAGE), 'DoAction is signed');
  const o = tables.orders[0].data;
  assert.equal(o.status, 'cancelled'); assert.equal(o.payment, 'refunded'); assert.equal(o.reserved, false);
  assert.ok(o.history.some(h => h.text.includes('放棄授權')));
  assert.equal(stockOf(), start);
  assert.equal((await refundReq(orderId)).status, 200, 'a second click is harmless');
  assert.equal(doActions(), 'N'); assert.equal(stockOf(), start);
});

await check('refund: picks the right ECPay action for to-be-closed and closed trades', async () => {
  reset(); doAction = { E: true, N: false };
  let { orderId } = await paidOrder();
  let res = await refundReq(orderId);
  assert.equal(res.status, 502); assert.match((await res.json()).error, /已取消關帳/);
  assert.equal(tables.orders[0].data.payment, 'paid', 'partial ECPay success leaves the order unchanged');
  reset(); doAction = { R: true };
  ({ orderId } = await paidOrder());
  res = await refundReq(orderId);
  assert.equal(res.status, 200);
  assert.equal(doActions(), 'NER', 'closed trade: N and E are refused, R refunds');
  assert.ok(tables.orders[0].data.history.some(h => h.text.includes('退刷')));
});

await check('refund: when ECPay refuses everything the order and stock are left untouched', async () => {
  reset(); doAction = {};
  const start = stockOf();
  const { orderId } = await paidOrder();
  const res = await refundReq(orderId);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /訂單沒有變更.*狀態不符/);
  assert.equal(tables.orders[0].data.status, 'new'); assert.equal(tables.orders[0].data.payment, 'paid');
  assert.equal(stockOf(), start - 1);
});

await check('refund: refuses unpaid, shipped, manually paid orders and the 20:15-20:30 close window', async () => {
  reset(); doAction = { N: true };
  const unpaid = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, PRODENV)).json();
  assert.equal((await refundReq(unpaid.orderId)).status, 409);
  const { orderId } = await paidOrder();
  const row = tables.orders.find(r => r.id === orderId);
  const D = db(PRODENV), cfg = ecpayConfig(PRODENV);
  const at = (hh, mm) => new Date(`2026-11-15T${hh}:${mm}:00+08:00`);
  assert.equal(inCloseWindow(at('20', '20')), true); assert.equal(inCloseWindow(at('20', '30')), false); assert.equal(inCloseWindow(at('20', '14')), false);
  await assert.rejects(refundOrder(D, cfg, orderId, at('20', '20')), /20:15～20:30/);
  row.data.status = 'shipped';
  assert.match((await (await refundReq(orderId)).json()).error, /已出貨/);
  row.data.status = 'new'; delete row.data.ecpay;
  assert.match((await (await refundReq(orderId)).json()).error, /沒有綠界刷卡資料/);
  assert.equal(doActions(), '', 'ECPay is never called in any refused case');
});

await check('refund: a cancelled order awaiting refund is refunded without restocking twice; stage mode never calls ECPay', async () => {
  reset(); doAction = { N: true };
  const start = stockOf();
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, PRODENV)).json();
  age(tables.orders[0], 31); await sweep();
  assert.equal(stockOf(), start);
  await ecpay(paidNotice(body.orderId, body.total), 'notify', PRODENV);
  assert.equal(tables.orders[0].data.payment, 'refund_pending');
  assert.equal((await refundReq(body.orderId)).status, 200);
  assert.equal(tables.orders[0].data.payment, 'refunded'); assert.equal(stockOf(), start);
  reset();
  const s = await paidOrder(ENV);
  assert.equal((await refundReq(s.orderId, ADMIN, ENV)).status, 200);
  assert.equal(doActions(), ''); assert.ok(tables.orders[0].data.history.some(h => h.text.includes('測試環境')));
  assert.equal(tables.orders[0].data.payment, 'refunded');
});

// ===== 顧客自行取消（咖啡開始烘焙前，綠界全額退款） =====
const buyerCancel = (id, token, env = PRODENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://encountercoffee2025.com' }, body: JSON.stringify({ action: 'cancel-order', id, token }) }), env);
const buyerView = async (id, token, env = PRODENV) => (await (await handleCheckout(new Request(`https://demo.supabase.co/functions/v1/checkout?id=${id}&t=${token}`, { method: 'GET', headers: { origin: 'https://encountercoffee2025.com' } }), env)).json()).order;

await check('buyer cancel: allowed while coffee is preparing; refunds via ECPay, cancels and restocks once; wrong token refused', async () => {
  reset(); doAction = { N: true };
  const start = stockOf();
  const { orderId, token } = await paidOrder();
  let view = await buyerView(orderId, token);
  assert.equal(view.canCancel, true); assert.equal(view.items[0].roast, 'preparing');
  assert.equal((await buyerCancel(orderId, 'x'.repeat(token.length))).status, 404);
  assert.equal(doActions(), '', 'no refund with a wrong token');
  const res = await buyerCancel(orderId, token);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const o = tables.orders[0].data;
  assert.equal(o.status, 'cancelled'); assert.equal(o.payment, 'refunded'); assert.equal(stockOf(), start);
  assert.ok(o.history.some(h => h.text.startsWith('顧客自行取消訂單並退款')));
  assert.equal(doActions(), 'N');
  view = await buyerView(orderId, token);
  assert.equal(view.canCancel, false); assert.equal(view.cancelNote, '');
  assert.equal((await buyerCancel(orderId, token)).status, 200, 'a second click is harmless');
  assert.equal(doActions(), 'N');
});

await check('buyer cancel: refused once coffee is roasting, the order is packing or a shipping label exists', async () => {
  reset(); doAction = { N: true };
  const { orderId, token } = await paidOrder();
  const row = tables.orders.find(r => r.id === orderId);
  row.data.items[0].roastStatus = 'roasting';
  let view = await buyerView(orderId, token);
  assert.equal(view.canCancel, false); assert.match(view.cancelNote, /開始烘焙/);
  let res = await buyerCancel(orderId, token);
  assert.equal(res.status, 409); assert.match((await res.json()).error, /開始烘焙/);
  row.data.items[0].roastStatus = 'preparing'; row.data.status = 'packing';
  assert.match((await (await buyerCancel(orderId, token)).json()).error, /備貨/);
  row.data.status = 'confirmed'; row.data.shipment = { id: '1', label: '7-ELEVEN 交貨便' };
  assert.match((await (await buyerCancel(orderId, token)).json()).error, /寄件單/);
  delete row.data.shipment;
  assert.equal((await buyerView(orderId, token)).canCancel, true, 'confirmed with preparing coffee can still be cancelled');
  assert.equal(doActions(), '', 'ECPay is never called in any refused case');
  assert.equal(row.data.payment, 'paid');
});

// ===== 7-ELEVEN／全家寄件單 =====
const LSTAGE = { hashKey: 'XBERn1YOvpM9nfZc', hashIV: 'h1ONHk4P4yqbl5LK' };
const shipReq = (body, auth = ADMIN, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://encountercoffee2025.com', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }), env);
const FAMILY = { id: '006598', name: '全家深坑店', address: '新北市深坑區深坑街 1 號', type: 'FAMIC2C' };
async function paidPickup(delivery = '711', env = ENV) {
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery, ...(delivery === 'family' ? { store: FAMILY } : {}) }, env)).json();
  assert.ok(body.orderId, JSON.stringify(body));
  await ecpay(paidNotice(body.orderId, body.total), 'notify', env);
  return body;
}
const logisticsCalls = () => sent.filter(s => s.host === 'ecpay-logistics');
const logisticsNotify = async (fields, sign = true) => {
  const params = { ...fields };
  if (sign) params.CheckMacValue = logisticsMac(params, LSTAGE.hashKey, LSTAGE.hashIV);
  return (await handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=logistics', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }), ENV)).text();
};

await check('checkout: store pickup needs a real name (2-5 Chinese or 4-10 letters) and a 09 mobile; home delivery does not', async () => {
  reset();
  const try711 = c => post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, ...c }, delivery: '711' });
  assert.match((await (await try711({ name: '林小姐' })).json()).error, /真實姓名/);
  assert.match((await (await try711({ name: '林' })).json()).error, /2～5 個中文字/);
  assert.match((await (await try711({ name: 'Amy Lin' })).json()).error, /空格/);
  assert.match((await (await try711({ phone: '02-12345678' })).json()).error, /09 開頭/);
  assert.equal((await try711({ name: 'AmyLin' })).status, 200);
  assert.equal((await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, name: '林小姐', address: '台北市信義路 1 號' }, delivery: 'home' })).status, 200);
});

await check('shipment: admin-only; refuses unpaid and home-delivery orders without calling ECPay', async () => {
  reset();
  const { orderId } = await paidPickup();
  assert.equal((await shipReq({ action: 'create-shipment', id: orderId }, null)).status, 401);
  assert.equal((await shipReq({ action: 'create-shipment', id: orderId }, ADMIN_AAL1)).status, 401);
  const unpaid = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' })).json();
  assert.match((await (await shipReq({ action: 'create-shipment', id: unpaid.orderId })).json()).error, /尚未收款/);
  const home = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, address: '台北市信義路 1 號' }, delivery: 'home' })).json();
  await ecpay(paidNotice(home.orderId, home.total));
  assert.match((await (await shipReq({ action: 'create-shipment', id: home.orderId })).json()).error, /7-ELEVEN／全家/);
  assert.equal(logisticsCalls().length, 0);
});

await check('shipment: 7-ELEVEN order gets a signed C2C request, code saved as tracking number, second click reuses it', async () => {
  reset();
  const { orderId, total } = await paidPickup('711');
  const res = await shipReq({ action: 'create-shipment', id: orderId, name: customer.name, phone: customer.phone });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const [call] = logisticsCalls();
  assert.equal(call.path, '/Express/Create');
  assert.equal(call.body.LogisticsSubType, 'UNIMARTC2C'); assert.equal(call.body.ReceiverStoreID, STORE.id); assert.equal(call.body.MerchantTradeNo, orderId);
  assert.equal(call.body.GoodsAmount, String(total)); assert.equal(call.body.IsCollection, 'N'); assert.equal(call.body.ReceiverName, customer.name);
  assert.equal(call.body.SenderName, '王小明', 'stage uses the test sender when none is set');
  assert.ok(call.body.ServerReplyURL.endsWith('/functions/v1/ecpay?type=logistics'));
  assert.equal(call.body.CheckMacValue, logisticsMac(call.body, LSTAGE.hashKey, LSTAGE.hashIV), 'MD5 logistics signature');
  const o = tables.orders[0].data;
  assert.equal(o.shipment.paymentNo, 'D8858302'); assert.equal(o.shipment.validationNo, '6015');
  assert.equal(o.tracking, 'D88583026015');
  assert.ok(o.history.some(h => h.text.includes('寄件代碼 D88583026015')));
  assert.equal((await shipReq({ action: 'create-shipment', id: orderId })).status, 200);
  assert.equal(logisticsCalls().length, 1, 'no duplicate shipment');
});

await check('shipment: FamilyMart, corrected receiver, ECPay errors and production without a sender', async () => {
  reset();
  const fam = await paidPickup('family');
  assert.match((await (await shipReq({ action: 'create-shipment', id: fam.orderId, name: '陳先生', phone: '0912345678' })).json()).error, /真實姓名/);
  assert.equal(logisticsCalls().length, 0);
  assert.equal((await shipReq({ action: 'create-shipment', id: fam.orderId, name: '陳大文', phone: '0987654321' })).status, 200);
  const o = tables.orders.find(r => r.id === fam.orderId).data;
  assert.equal(logisticsCalls()[0].body.LogisticsSubType, 'FAMIC2C'); assert.equal(o.shipment.paymentNo, '16000587908'); assert.equal(o.shipment.validationNo, '');
  assert.ok(o.history.some(h => h.text.includes('寄件收件人：陳大文・0987654321')));
  reset(); logisticsFail = '0|門市已關轉';
  const bad = await paidPickup('711');
  const res = await shipReq({ action: 'create-shipment', id: bad.orderId });
  assert.equal(res.status, 502); assert.match((await res.json()).error, /門市已關轉/);
  assert.equal(tables.orders[0].data.shipment, undefined);
  logisticsFail = '';
  reset();
  const PRODENV2 = { ...ENV, ECPAY_MODE: 'prod', ECPAY_MERCHANT_ID: STAGE.merchantId, ECPAY_HASH_KEY: STAGE.hashKey, ECPAY_HASH_IV: STAGE.hashIV };
  const p = await paidPickup('711', PRODENV2);
  assert.match((await (await shipReq({ action: 'create-shipment', id: p.orderId }, ADMIN, PRODENV2)).json()).error, /LOGISTICS_SENDER_NAME/);
  assert.equal(logisticsCalls().length, 0);
});

await check('shipment: print form is signed; 7-ELEVEN supports A6 labels', async () => {
  reset();
  const { orderId } = await paidPickup('711');
  assert.equal((await (await shipReq({ action: 'print-shipment', id: orderId })).json()).error, '這筆訂單還沒有寄件單');
  await shipReq({ action: 'create-shipment', id: orderId });
  const { print } = await (await shipReq({ action: 'print-shipment', id: orderId, mode: '2' })).json();
  assert.equal(print.action, 'https://logistics-stage.ecpay.com.tw/Express/PrintUniMartC2COrderInfo');
  assert.equal(print.fields.PrintMode, '2'); assert.equal(print.fields.CVSValidationNo, '6015');
  assert.equal(print.fields.CheckMacValue, logisticsMac(print.fields, LSTAGE.hashKey, LSTAGE.hashIV));
  assert.equal((await shipReq({ action: 'print-shipment', id: orderId }, null)).status, 401);
});

await check('logistics notices: signed only; sent → shipped (from packing), picked up → completed, duplicates ignored', async () => {
  reset();
  const { orderId } = await paidPickup('711');
  await shipReq({ action: 'create-shipment', id: orderId });
  const row = tables.orders[0];
  row.data.status = 'packing'; row.status = 'packing';
  const base = { MerchantID: '2000933', MerchantTradeNo: orderId, AllPayLogisticsID: '3805223', LogisticsType: 'CVS', LogisticsSubType: 'UNIMARTC2C', GoodsAmount: '450', CVSPaymentNo: 'D8858302', CVSValidationNo: '6015' };
  assert.equal(await logisticsNotify({ ...base, RtnCode: '2030', RtnMsg: '物流中心驗收成功', CheckMacValue: 'BAD' }, false), '0|CheckMacValue Error');
  assert.equal(row.data.status, 'packing');
  assert.equal(await logisticsNotify({ ...base, RtnCode: '2030', RtnMsg: '物流中心驗收成功', UpdateStatusDate: '2026/11/16 10:00:00' }), '1|OK');
  assert.equal(row.data.status, 'shipped'); assert.equal(row.data.shipment.code, '2030');
  const n = row.data.history.length;
  assert.equal(await logisticsNotify({ ...base, RtnCode: '2030', RtnMsg: '物流中心驗收成功', UpdateStatusDate: '2026/11/16 10:00:00' }), '1|OK');
  assert.equal(row.data.history.length, n, 'duplicate notice ignored');
  assert.equal(await logisticsNotify({ ...base, RtnCode: '2067', RtnMsg: '消費者成功取件', UpdateStatusDate: '2026/11/18 15:00:00' }), '1|OK');
  assert.equal(row.data.status, 'completed');
  assert.equal(await logisticsNotify({ ...base, AllPayLogisticsID: '999', RtnCode: '2073', RtnMsg: '商品配達買家取貨門市' }), '1|OK', 'unknown shipment is acknowledged but ignored');
});


await check('shipment: sender secrets are trimmed, and a malformed sender is explained before calling ECPay', async () => {
  // 正式模式：物流用另一組金鑰（ECPAY_LOGISTICS_HASH_*），也順便測這個覆寫設定
  const PROD3 = { ...ENV, ECPAY_MODE: 'prod', ECPAY_MERCHANT_ID: STAGE.merchantId, ECPAY_HASH_KEY: STAGE.hashKey, ECPAY_HASH_IV: STAGE.hashIV, ECPAY_LOGISTICS_HASH_KEY: LSTAGE.hashKey, ECPAY_LOGISTICS_HASH_IV: LSTAGE.hashIV };
  reset();
  let p = await paidPickup('711', PROD3);
  const pasted = { ...PROD3, LOGISTICS_SENDER_NAME: ' 王 小明\n', LOGISTICS_SENDER_PHONE: '0912-345 678\n' };
  const ok = await shipReq({ action: 'create-shipment', id: p.orderId }, ADMIN, pasted);
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal(logisticsCalls()[0].body.SenderName, '王小明'); assert.equal(logisticsCalls()[0].body.SenderCellPhone, '0912345678');
  for (const [env, re] of [[{ LOGISTICS_SENDER_NAME: '王先生', LOGISTICS_SENDER_PHONE: '0912345678' }, /LOGISTICS_SENDER_NAME/], [{ LOGISTICS_SENDER_NAME: '王小明2', LOGISTICS_SENDER_PHONE: '0912345678' }, /LOGISTICS_SENDER_NAME/], [{ LOGISTICS_SENDER_NAME: '王小明', LOGISTICS_SENDER_PHONE: '02 1234 5678' }, /LOGISTICS_SENDER_PHONE/]]) {
    reset();
    p = await paidPickup('711', PROD3);
    const res = await shipReq({ action: 'create-shipment', id: p.orderId }, ADMIN, { ...PROD3, ...env });
    assert.equal(res.status, 502); assert.match((await res.json()).error, re);
    assert.equal(logisticsCalls().length, 0, 'ECPay is not called with a bad sender');
  }
});


// ===== 訂單進度：確認信連結、進度資料、出貨通知信 =====
const mails = () => sent.filter(s => s.host === 'api.resend.com').map(s => s.body);

await check('confirmation email links to the order progress page with its private token', async () => {
  reset();
  const { orderId, token, total } = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, MAIL_ENV)).json();
  await ecpay(paidNotice(orderId, total), 'notify', MAIL_ENV);
  const [mail] = mails();
  assert.ok(mail.html.includes(`https://encountercoffee2025.com/checkout.html?order=${orderId}&amp;t=${token}`), 'link with order id and token');
  assert.ok(mail.html.includes('查看訂單進度'));
});

await check('order status shows shipping code, store and arrival — but never the receiver details', async () => {
  reset();
  const { orderId, token } = await paidPickup('711');
  let o = (await (await get(`?id=${orderId}&t=${token}`)).json()).order;
  assert.equal(o.status, 'new'); assert.equal(o.shipment, null); assert.equal(o.tracking, ''); assert.equal(o.storeName, STORE.name);
  await shipReq({ action: 'create-shipment', id: orderId });
  const row = tables.orders[0]; row.data.status = 'packing'; row.status = 'packing';
  const base = { MerchantID: '2000933', MerchantTradeNo: orderId, AllPayLogisticsID: '3805223', LogisticsType: 'CVS', LogisticsSubType: 'UNIMARTC2C', GoodsAmount: '450', CVSPaymentNo: 'D8858302', CVSValidationNo: '6015' };
  await logisticsNotify({ ...base, RtnCode: '2030', RtnMsg: '物流中心驗收成功', UpdateStatusDate: '2026/11/16 10:00:00' });
  await logisticsNotify({ ...base, RtnCode: '2073', RtnMsg: '商品配達買家取貨門市', UpdateStatusDate: '2026/11/17 09:00:00' });
  o = (await (await get(`?id=${orderId}&t=${token}`)).json()).order;
  assert.equal(o.status, 'shipped');
  assert.deepEqual({ ...o.shipment, updatedAt: undefined }, { label: '7-ELEVEN 交貨便', code: 'D88583026015', status: '商品配達買家取貨門市', updatedAt: undefined, arrived: true, pickedUp: false });
  const json = JSON.stringify(o);
  assert.ok(!json.includes(customer.phone) && !json.includes(customer.email) && !json.includes(customer.name), 'no personal data in the public order');
  assert.equal((await get(`?id=${orderId}&t=${'0'.repeat(32)}`)).status, 404, 'wrong token sees nothing');
});

await check('shipped email: sent once when the admin marks shipped, admin-only, with code and progress link', async () => {
  reset();
  const { orderId, token, total } = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, address: '台北市信義路 1 號' }, delivery: 'home' }, MAIL_ENV)).json();
  await ecpay(paidNotice(orderId, total), 'notify', MAIL_ENV);
  const notify = (auth = ADMIN) => shipReq({ action: 'notify-shipped', id: orderId }, auth, MAIL_ENV);
  assert.equal((await notify(null)).status, 401);
  assert.deepEqual((await (await notify()).json()).results, [], 'not shipped yet → nothing sent');
  const row = tables.orders[0]; row.data.status = 'shipped'; row.data.tracking = 'HCT123456'; row.status = 'shipped';
  const before = mails().length;
  assert.deepEqual((await (await notify()).json()).results, ['已寄出出貨通知信']);
  const mail = mails().at(-1);
  assert.equal(mails().length, before + 1);
  assert.match(mail.subject, /出貨通知/); assert.ok(mail.html.includes('HCT123456')); assert.ok(mail.html.includes(`order=${orderId}&amp;t=${token}`));
  assert.equal(mail.to[0], customer.email);
  assert.ok(row.data.shippedMailAt); assert.ok(row.data.history.some(h => h.text === '已寄出出貨通知信'));
  assert.deepEqual((await (await notify()).json()).results, [], 'second call does not resend');
  assert.equal(mails().length, before + 1);
});

await check('shipped email: sent automatically once when ECPay reports the parcel reached the logistics center', async () => {
  reset();
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711' }, MAIL_ENV)).json();
  await ecpay(paidNotice(body.orderId, body.total), 'notify', MAIL_ENV);
  await shipReq({ action: 'create-shipment', id: body.orderId }, ADMIN, MAIL_ENV);
  const row = tables.orders[0]; row.data.status = 'packing'; row.status = 'packing';
  const before = mails().length;
  const params = { MerchantID: '2000933', MerchantTradeNo: body.orderId, AllPayLogisticsID: '3805223', LogisticsType: 'CVS', LogisticsSubType: 'UNIMARTC2C', GoodsAmount: '450', CVSPaymentNo: 'D8858302', CVSValidationNo: '6015', RtnCode: '2030', RtnMsg: '物流中心驗收成功', UpdateStatusDate: '2026/11/16 10:00:00' };
  params.CheckMacValue = logisticsMac(params, LSTAGE.hashKey, LSTAGE.hashIV);
  const res = await handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=logistics', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }), MAIL_ENV);
  assert.equal(await res.text(), '1|OK');
  assert.equal(row.data.status, 'shipped');
  assert.equal(mails().length, before + 1);
  assert.ok(mails().at(-1).html.includes('D88583026015'));
  assert.ok(mails().at(-1).html.includes('證件'));
});


// ===== 查詢訂單 =====
const lookupFrom = (ip, body, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { origin: 'https://encountercoffee2025.com', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env);
async function paidOrderFor(c, env = MAIL_ENV) {
  const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, ...c }, delivery: '711' }, env)).json();
  await ecpay(paidNotice(body.orderId, body.total), 'notify', env);
  return body;
}

await check('lookup A: order number + ordering mobile returns the progress token; anything else is a generic not-found', async () => {
  reset();
  const { orderId, token } = await paidOrderFor({}, ENV);
  const ok = await (await lookupFrom('198.51.100.1', { action: 'lookup-order', id: orderId.toLowerCase(), phone: '0912-345-678' })).json();
  assert.deepEqual(ok, { orderId, token }, 'case-insensitive ID, phone digits only');
  assert.equal((await (await lookupFrom('198.51.100.1', { action: 'lookup-order', id: orderId, phone: '+886912345678' })).json()).token, token, '+886 works');
  for (const body of [{ id: orderId, phone: '0987654321' }, { id: 'EC20991231ZZZZZZ', phone: '0912345678' }, { id: 'nope', phone: '0912345678' }, { id: orderId, phone: '' }]) {
    const res = await lookupFrom('198.51.100.1', { action: 'lookup-order', ...body });
    assert.equal(res.status, 404); assert.match((await res.json()).error, /找不到符合的訂單/);
  }
  assert.ok(tables.rate_events.every(e => e.kind === 'lookup' && /^[0-9a-f]{32}$/.test(e.key)), 'only hashes are stored');
  assert.ok(!JSON.stringify(tables.rate_events).includes('198.51.100.1'));
});

await check('lookup A: at most 10 tries per visitor in 10 minutes, then blocked even with the right phone', async () => {
  reset();
  const { orderId } = await paidOrderFor({}, ENV);
  for (let i = 0; i < 10; i++) assert.equal((await lookupFrom('203.0.113.50', { action: 'lookup-order', id: orderId, phone: `09000000${String(i).padStart(2, '0')}` })).status, 404);
  const blocked = await lookupFrom('203.0.113.50', { action: 'lookup-order', id: orderId, phone: '0912345678' });
  assert.equal(blocked.status, 429); assert.match((await blocked.json()).error, /10 分鐘/);
  assert.equal((await lookupFrom('203.0.113.51', { action: 'lookup-order', id: orderId, phone: '0912345678' })).status, 200, 'another visitor is fine');
  tables.rate_events.forEach(e => { e.created_at = new Date(Date.now() - 11 * 60000).toISOString() });
  assert.equal((await lookupFrom('203.0.113.50', { action: 'lookup-order', id: orderId, phone: '0912345678' })).status, 200, 'allowed again after 10 minutes');
});

await check('lookup B: emails progress links for that exact address only (case-insensitive), same reply either way', async () => {
  reset();
  const a1 = await paidOrderFor({ email: 'Buyer@Example.com' });
  const a2 = await paidOrderFor({ email: 'buyer@example.com' });
  const longer = await paidOrderFor({ email: 'buyer@example.com.tw' });
  const other = await paidOrderFor({ email: 'b_yer@example.com' });
  const abandoned = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer: { ...customer, email: 'buyer@example.com' }, delivery: '711' }, MAIL_ENV)).json();
  age(tables.orders.find(r => r.id === abandoned.orderId), 31); await sweep();
  sent = [];
  const res = await lookupFrom('192.0.2.10', { action: 'email-orders', email: ' BUYER@example.com ' }, MAIL_ENV);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
  const [mail] = sent.filter(s => s.host === 'api.resend.com').map(s => s.body);
  assert.deepEqual(mail.to, ['buyer@example.com']);
  assert.ok(mail.html.includes(`order=${a1.orderId}&amp;t=${a1.token}`) && mail.html.includes(`order=${a2.orderId}&amp;t=${a2.token}`), 'both orders of that address');
  assert.ok(!mail.html.includes(other.orderId), '_ in another address is not a wildcard match');
  assert.ok(!mail.html.includes(longer.orderId), 'a longer address is a different address');
  assert.ok(!mail.html.includes(abandoned.orderId), 'never-paid cancelled orders are left out');
  assert.ok(mail.html.includes('已付款'));
  sent = [];
  const none = await lookupFrom('192.0.2.11', { action: 'email-orders', email: 'nobody@example.com' }, MAIL_ENV);
  assert.deepEqual(await none.json(), { ok: true }, 'same reply when there are no orders');
  assert.equal(sent.filter(s => s.host === 'api.resend.com').length, 0, 'no email to addresses without orders');
  assert.equal((await lookupFrom('192.0.2.11', { action: 'email-orders', email: 'not-an-email' }, MAIL_ENV)).status, 400);
});

await check('lookup B: limits 3 emails per address and 5 per visitor per hour', async () => {
  reset();
  await paidOrderFor({ email: 'buyer@example.com' });
  for (let i = 0; i < 3; i++) assert.equal((await lookupFrom(`192.0.2.${20 + i}`, { action: 'email-orders', email: 'buyer@example.com' }, MAIL_ENV)).status, 200);
  const perAddress = await lookupFrom('192.0.2.99', { action: 'email-orders', email: 'buyer@example.com' }, MAIL_ENV);
  assert.equal(perAddress.status, 429); assert.match((await perAddress.json()).error, /這個信箱剛寄過/);
  for (let i = 0; i < 5; i++) assert.equal((await lookupFrom('192.0.2.200', { action: 'email-orders', email: `x${i}@example.com` }, MAIL_ENV)).status, 200);
  const perVisitor = await lookupFrom('192.0.2.200', { action: 'email-orders', email: 'x9@example.com' }, MAIL_ENV);
  assert.equal(perVisitor.status, 429); assert.match((await perVisitor.json()).error, /1 小時/);
  assert.ok(!JSON.stringify(tables.rate_events).includes('example.com'), 'addresses are stored only as hashes');
});

console.log(`${results.length} server checks passed`);
