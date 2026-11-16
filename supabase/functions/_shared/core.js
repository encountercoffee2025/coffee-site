// 伺服器下單：使用與網站相同的 store.js 規則計算價格、運費、庫存與訂單內容，不相信瀏覽器送來的金額。
import { loadStore } from './store.js';
import { pickupNameProblem, pickupPhoneProblem, shipmentCode, ARRIVED_CODES, PICKED_UP_CODES } from './logistics.js';

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

// 取消逾時未付款的訂單並回補庫存（與後台按「取消」相同的規則）。回傳新的商品資料與取消後的訂單。
export function cancelOrders(catalog, orders, reason) {
  storage.setItem(KEY, JSON.stringify({ ...catalog, version: 3, cart: [], orders, subscriptions: [] }));
  for (const o of orders) {
    S.updateOrder(o.id, { status: 'cancelled' });
  }
  const at = new Date().toISOString();
  const done = S.state().orders.map(o => ({ ...o, history: [...o.history, { at, text: reason }] }));
  return { catalog: S.cloudCatalog(), orders: done };
}

export const splitCatalog = c => S.splitCatalog(c);
export const mergeCatalog = (pub, priv) => S.mergeCatalog(pub, priv);

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
  const delivery = String(input.delivery || ''), store = pickedStore(input);
  // 冷凍箱可以選和常溫不同的寄送方式：超商冷凍要另選門市（同一家超商就沿用常溫門市），黑貓冷凍宅配要有地址
  const hasFrozen = S.cartDetails(undefined, S.deliveries.includes(delivery) ? delivery : '711').hasFrozen;
  const frozenDelivery = hasFrozen ? String(input.frozenDelivery || delivery) : undefined;
  if (hasFrozen && !S.frozenDeliveries.includes(frozenDelivery)) throw new Error('請選擇冷凍配送方式');
  let frozenStore = null, frozenAddress = '';
  if (hasFrozen && frozenDelivery !== 'home') frozenStore = frozenDelivery === delivery && store ? store : pickedStore({ delivery: frozenDelivery, store: input.frozenStore });
  if (hasFrozen && frozenDelivery === 'home' && delivery !== 'home') {
    frozenAddress = String(input.frozenAddress ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, 300);
    if (!frozenAddress) throw new Error('請填寫冷凍配送地址');
  }
  if (store || frozenStore) { const problem = pickupNameProblem(c.name) || pickupPhoneProblem(c.phone); if (problem) throw new Error(problem) }
  const order = S.createOrder(
    { name: String(c.name ?? '').trim(), email: String(c.email ?? '').trim(), phone: String(c.phone ?? '').trim(), address: store ? `${store.name}（店號 ${store.id}）${store.address}` : String(c.address ?? '').trim() },
    { delivery, frozenDelivery, note: String(input.note || ''), id, notes: '', historyText: '建立訂單並保留庫存，等待付款' }
  );
  if (store) order.store = store;
  if (frozenStore && frozenStore !== store) order.frozenStore = frozenStore;
  if (frozenAddress) order.frozenAddress = frozenAddress;
  return { order, catalog: S.cloudCatalog() };
}

const STORE_TYPE = { '711': 'UNIMARTC2C', family: 'FAMIC2C' };
export function pickedStore(input) {
  const type = STORE_TYPE[input.delivery];
  if (!type) return null;
  const s = input.store || {}, clean = (v, n) => String(v ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, n);
  if (!/^[A-Za-z0-9]{1,10}$/.test(String(s.id ?? '')) || !clean(s.name, 60)) throw new Error('請先選擇取貨門市');
  if (s.type && s.type.replace(/C2C$/, '') !== type.replace(/C2C$/, '')) throw new Error('取貨門市與配送方式不符，請重新選擇門市');
  return { id: String(s.id), name: clean(s.name, 60), address: clean(s.address, 120), type };
}

// 品項說明：例如「衣索比亞・耶加雪菲 水洗｜200g 咖啡豆 · 中焙 · 手沖研磨」
export function lineSpec(item) {
  if (item.kind === 'treat') return (item.frozen ? '❄ ' : '') + item.name;
  if (item.kind === 'plan') return item.name;
  const size = item.format ? (item.format === 'drip' ? '濾掛包' : '濾泡包') : `${item.grams}g 咖啡豆`;
  return [item.name + '｜' + size, item.roast && S.roastLabels[item.roast], item.grind && S.grindLabels[item.grind]].filter(Boolean).join(' · ');
}

export const deliveryLabel = d => S.deliveryLabels[d] || d;

// 給顧客查詢訂單狀態用：不含 Email、電話、地址等個資以外的內部資料
// 顧客自行取消（並由綠界全額退款）的條件：已刷卡付款、還沒備貨（新訂單／已確認）、沒有建立寄件單、每支咖啡都還在「準備中」。
// 回傳 null 代表可以取消，否則回傳不能取消的原因（會顯示給顧客）。
export function buyerCancelBlock(o) {
  if (o.payment !== 'paid') return '只有已付款的訂單可以線上取消';
  if (['shipped', 'completed'].includes(o.status)) return '訂單已出貨，無法取消';
  if (o.status === 'cancelled') return '訂單已取消';
  if (o.status === 'packing') return '訂單已開始備貨，無法線上取消；如需協助請來信客服';
  if (o.shipment) return '已建立寄件單，無法線上取消；如需協助請來信客服';
  if (o.items.some(i => i.kind !== 'treat' && i.kind !== 'plan' && i.roastStatus && i.roastStatus !== 'preparing')) return '咖啡已開始烘焙，無法取消訂單';
  if (o.items.some(i => i.kind === 'plan')) return '月費訂購的訂單無法線上取消，請來信客服';
  if (!o.ecpay?.tradeNo || !o.ecpay?.merchantTradeNo || o.ecpay.simulated) return '這筆訂單無法線上退款，請來信客服';
  return null;
}

export function publicOrder(o) {
  return {
    id: o.id, createdAt: o.createdAt, status: o.status, payment: o.payment,
    subtotal: o.subtotal, shipping: o.shipping, frozenShipping: o.frozenShipping ?? 0, total: o.total,
    delivery: o.delivery, deliveryLabel: deliveryLabel(o.delivery),
    items: o.items.map(i => { const coffee = i.kind !== 'treat' && i.kind !== 'plan'; return { name: lineSpec(i), quantity: i.quantity, price: i.price, frozen: !!i.frozen, ...(coffee ? { roast: i.roastStatus || 'preparing' } : {}) }; }),
    // 冷凍點心另寄一箱時的單號（後台填寫）
    frozenTracking: o.frozenTracking || '',
    frozenDelivery: o.frozenDelivery || '', frozenDeliveryLabel: o.frozenDelivery ? S.frozenDeliveryLabels[o.frozenDelivery] || '' : '',
    frozenStoreName: o.frozenStore?.name || (o.frozenDelivery && o.frozenDelivery === o.delivery && o.frozenDelivery !== 'home' ? o.store?.name || '' : ''),
    // 線上取消：可以取消時 canCancel 為 true；已付款但不能取消時附上原因
    canCancel: !buyerCancelBlock(o), cancelNote: o.payment === 'paid' && !['cancelled', 'shipped', 'completed'].includes(o.status) ? (buyerCancelBlock(o) || '') : '',
    // 出貨進度：只給持有查詢碼的人看，不含收件人個資
    tracking: o.tracking || '', storeName: o.store?.name || '',
    shipment: o.shipment ? { label: o.shipment.label, code: shipmentCode(o.shipment), status: o.shipment.status || '', updatedAt: o.shipment.updatedAt || '', arrived: ARRIVED_CODES.includes(o.shipment.code), pickedUp: PICKED_UP_CODES.includes(o.shipment.code) } : null
  };
}
