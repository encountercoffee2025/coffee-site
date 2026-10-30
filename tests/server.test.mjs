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
function reset() { tables = { site_state: [{ id: 'main', data: catalog(), version: 1 }], orders: [] }; sent = []; failNextCatalogWrite = false; }

// 假的 Supabase REST 與外部服務
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET';
  if (u.hostname === 'api.line.me' || u.hostname === 'api.resend.com') { sent.push({ host: u.hostname, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
  const table = u.pathname.split('/').pop(), rows = tables[table];
  const filters = [...u.searchParams].filter(([k]) => k !== 'select');
  const match = r => filters.every(([k, v]) => v.startsWith('eq.') ? String(r[k]) === v.slice(3) : v.startsWith('cs.') ? r[k].includes(v.slice(4, -1)) : false);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (method === 'GET') return json(structuredClone(rows.filter(match)));
  if (method === 'POST') { const row = { version: 1, created_at: new Date().toISOString(), ...JSON.parse(init.body) }; if (rows.some(r => r.id === row.id)) return json({ message: 'duplicate' }, 409); rows.push(row); return json([row], 201); }
  if (method === 'PATCH') {
    if (table === 'site_state' && failNextCatalogWrite) { failNextCatalogWrite = false; tables.site_state[0].version++; return json([]); }
    const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(init.body))); return json(structuredClone(hit));
  }
  if (method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return json([]); }
  throw new Error('unexpected ' + method + ' ' + url);
};

const ENV = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SITE_URL: 'https://encountercoffee2025.com' };
const NOTIFY_ENV = { ...ENV, LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_OWNER_USER_ID: 'Uowner', RESEND_API_KEY: 'resend' };
const customer = { name: '林小姐', email: 'buyer@example.com', phone: '0912345678', address: '7-ELEVEN 深坑門市' };
const cart = [{ productId: 'guji', sku: 'guji-200', quantity: 2, roast: 'medium', grind: 'pour' }, { kind: 'treat', treatId: 'financier', quantity: 1 }];
const post = (body, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout', { method: 'POST', headers: { origin: 'https://encountercoffee2025.com', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
const get = (query, env = ENV) => handleCheckout(new Request('https://demo.supabase.co/functions/v1/checkout' + query, { headers: { origin: 'http://localhost:4173' } }), env);
async function ecpay(params, type = 'notify', env = ENV) {
  const signed = { ...params, CheckMacValue: params.CheckMacValue ?? await checkMacValue(params, STAGE.hashKey, STAGE.hashIV) };
  return handleEcpay(new Request('https://demo.supabase.co/functions/v1/ecpay?type=' + type, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signed).toString() }), env);
}
const paidNotice = (tradeNo, amount, extra = {}) => ({ MerchantID: '3002607', MerchantTradeNo: tradeNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2510311234567890', TradeAmt: String(amount), PaymentDate: '2026/10/31 12:00:00', PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '10', TradeDate: '2026/10/31 11:59:00', SimulatePaid: '0', CustomField1: '', CustomField2: '', CustomField3: '', CustomField4: '', StoreID: '', ...extra });

await check('server copy of store.js matches the site', () => {
  const { build } = createRequire(import.meta.url)('../scripts/sync-store.cjs');
  assert.equal(fs.readFileSync(path.join(base, 'supabase/functions/_shared/store.js'), 'utf8'), build(), 'run: node scripts/sync-store.cjs');
});

await check('create order: server prices, shipping and stock; signed ECPay form', async () => {
  reset();
  const res = await post({ action: 'create', cart: cart.map(l => ({ ...l, price: 1 })), customer, delivery: '711', note: '請下午寄出' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://encountercoffee2025.com');
  const guji = seed.products.find(p => p.id === 'guji').variants[0], fin = seed.treats.find(t => t.id === 'financier');
  const subtotal = guji.price * 2 + fin.price, shipping = subtotal >= seed.settings.freeShipping ? 0 : seed.settings.shippingRates['711'];
  assert.equal(body.total, subtotal + shipping);
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
  assert.equal(await (await ecpay(paidNotice(orderId, total), 'notify', NOTIFY_ENV)).text(), '1|OK');
  assert.equal(sent.length, 2);
  const back = await ecpay(paidNotice(orderId, total), 'return');
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), `https://encountercoffee2025.com/checkout.html?order=${orderId}&t=${token}`);
  const repay = await post({ action: 'pay', id: orderId, token });
  assert.equal(repay.status, 409);
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

console.log(`${results.length} server checks passed`);
