// 伺服器下單與綠界通知測試：以記憶體假資料庫取代 Supabase，模擬 LINE 與 Email。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { handleCheckout, handleEcpay } = await import('../supabase/functions/_shared/handlers.js');
const { checkMacValue, verifyMac } = await import('../supabase/functions/_shared/ecpay.js');

const results = [];
async function check(name, fn) { await fn(); results.push('PASS ' + name); console.log('PASS ' + name); }

// 種子商品資料 → 雲端 main 資料
const seedContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(base, 'assets/catalog-data.js'), 'utf8'), seedContext);
const seed = seedContext.window.COFFEE_SEED;
const catalog = () => JSON.parse(JSON.stringify({ version: 3, products: seed.products, treats: seed.treats, batches: seed.batches, ledger: seed.ledger, settings: seed.settings }));

const STAGE = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
let tables, sent, failNextCatalogWrite;
function reset() { tables = { site_state: [{ id: 'main', data: catalog(), version: 1 }], site_private: [], orders: [], subscriptions: [], admins: [{ user_id: '11111111-2222-3333-4444-555555555555' }] }; sent = []; failNextCatalogWrite = false; }

// 假的 Supabase REST 與外部服務
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET';
  if (u.hostname === 'api.line.me' || u.hostname === 'api.resend.com') { sent.push({ host: u.hostname, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
  if (u.pathname === '/Cashier/CreditCardPeriodAction') { sent.push({ host: 'ecpay-cancel', body: Object.fromEntries(new URLSearchParams(init.body)) }); return new Response('MerchantID=3002607&RtnCode=1&RtnMsg=成功', { status: 200 }); }
  if (u.pathname === '/auth/v1/user') { const ok = [ADMIN, ADMIN_AAL1].includes(init.headers?.Authorization); return new Response(JSON.stringify(ok ? { id: '11111111-2222-3333-4444-555555555555' } : { msg: 'invalid' }), { status: ok ? 200 : 401 }); }
  const table = u.pathname.split('/').pop(), rows = tables[table];
  const filters = [...u.searchParams].filter(([k]) => k !== 'select');
  const match = r => filters.every(([k, v]) => v.startsWith('eq.') ? String(r[k]) === v.slice(3) : v.startsWith('cs.') ? r[k].includes(v.slice(4, -1)) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(r[k])) : false);
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
  if (method === 'POST') { const row = { version: 1, created_at: new Date().toISOString(), ...JSON.parse(init.body) }; if (rows.some(r => r.id === row.id)) return json({ message: 'duplicate' }, 409); rows.push(row); return json([row], 201); }
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
const customer = { name: '林小姐', email: 'buyer@example.com', phone: '0912345678', address: '7-ELEVEN 深坑門市' };
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

await check('chosen payment method goes to ECPay and is kept on the order', async () => {
  reset();
  for (const [method, expected] of [['ATM', 'ATM'], ['CVS', 'CVS'], ['Credit', 'Credit'], ['Bitcoin', 'ALL'], [undefined, 'ALL']]) {
    const body = await (await post({ action: 'create', cart: [{ productId: 'guji', sku: 'guji-200', quantity: 1 }], customer, delivery: '711', payMethod: method })).json();
    assert.equal(body.payment.fields.ChoosePayment, expected);
    assert.ok(await verifyMac(body.payment.fields, STAGE));
  }
  assert.equal(tables.orders[0].data.payMethod, 'ATM');
  const { id, token } = tables.orders[0];
  const again = await (await post({ action: 'pay', id, token })).json();
  assert.equal(again.payment.fields.ChoosePayment, 'ATM');
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
  assert.ok(mail.html.includes('林小姐'));
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

console.log(`${results.length} server checks passed`);
