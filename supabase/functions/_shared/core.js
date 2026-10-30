// 伺服器下單：使用與網站相同的 store.js 規則計算價格、運費、庫存與訂單內容，不相信瀏覽器送來的金額。
import { loadStore } from './store.js';

// store.js 在瀏覽器使用 window 與 localStorage；伺服器給它一份專用的記憶體版本，不動到全域環境。
const memory = new Map();
const storage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)) },
  removeItem: key => { memory.delete(key) }
};
const Event = globalThis.CustomEvent ?? class { constructor(type) { this.type = type } };
const S = loadStore({ addEventListener() {}, dispatchEvent() {}, COFFEE_SEED: null, COFFEE_PLANS: [] }, storage, Event);
const KEY = 'pure-select-store-v1';
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 訂單編號 = 綠界第一次付款的交易編號：EC + 台北日期 + 6 碼（英數 16 字，重新付款再加 R1、R2…）
export function newOrderId(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
  return 'EC' + day + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ID_CHARS[b % ID_CHARS.length]).join('');
}

export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

export function placeOrder(catalog, input, id) {
  if (!input || !Array.isArray(input.cart) || !input.cart.length) throw new Error('購物車是空的');
  if (input.cart.length > 30) throw new Error('購物車品項太多，請分開下單');
  storage.setItem(KEY, JSON.stringify({ ...catalog, version: 3, cart: [], orders: [], subscriptions: [] }));
  for (const line of input.cart) {
    const quantity = Number(line?.quantity);
    if (line?.kind === 'treat') S.addTreat(String(line.treatId ?? ''), quantity);
    else S.addCart(String(line?.productId ?? ''), String(line?.sku ?? ''), quantity, line?.grind ? String(line.grind) : undefined, line?.roast ? String(line.roast) : undefined);
  }
  const c = input.customer || {};
  const store = pickedStore(input);
  const order = S.createOrder(
    { name: String(c.name ?? '').trim(), email: String(c.email ?? '').trim(), phone: String(c.phone ?? '').trim(), address: store ? `${store.name}（店號 ${store.id}）${store.address}` : String(c.address ?? '').trim() },
    { delivery: String(input.delivery || ''), note: String(input.note || ''), id, notes: '', historyText: '建立訂單並保留庫存，等待付款' }
  );
  if (store) order.store = store;
  return { order, catalog: S.cloudCatalog() };
}

const STORE_TYPE = { '711': 'UNIMARTC2C', family: 'FAMIC2C' };
function pickedStore(input) {
  const type = STORE_TYPE[input.delivery];
  if (!type) return null;
  const s = input.store || {}, clean = (v, n) => String(v ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, n);
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(s.id ?? '')) || !clean(s.name, 60)) throw new Error('請先選擇取貨門市');
  if (s.type && s.type.replace(/C2C$/, '') !== type.replace(/C2C$/, '')) throw new Error('取貨門市與配送方式不符，請重新選擇門市');
  return { id: String(s.id), name: clean(s.name, 60), address: clean(s.address, 120), type };
}

// 品項說明：例如「衣索比亞・耶加雪菲 水洗｜200g 咖啡豆 · 中焙 · 手沖研磨」
export function lineSpec(item) {
  if (item.kind === 'treat') return item.name;
  const size = item.format ? (item.format === 'drip' ? '濾掛包' : '濾泡包') : `${item.grams}g 咖啡豆`;
  return [item.name + '｜' + size, item.roast && S.roastLabels[item.roast], item.grind && S.grindLabels[item.grind]].filter(Boolean).join(' · ');
}

export const deliveryLabel = d => S.deliveryLabels[d] || d;

// 給顧客查詢訂單狀態用：不含 Email、電話、地址等個資以外的內部資料
export function publicOrder(o) {
  return {
    id: o.id, createdAt: o.createdAt, status: o.status, payment: o.payment,
    subtotal: o.subtotal, shipping: o.shipping, total: o.total,
    delivery: o.delivery, deliveryLabel: deliveryLabel(o.delivery),
    items: o.items.map(i => ({ name: lineSpec(i), quantity: i.quantity, price: i.price }))
  };
}
