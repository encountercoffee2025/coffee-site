// 月費訂購：建立訂閱資料、每期扣款成功後產生該期出貨訂單。方案價格以網站方案加上後台「頁面內容 → 月費方案」的修改為準。
import { PLANS } from './plans.js';
import { pickedStore } from './core.js';

export const ROAST_PREFS = { any: '交給烘豆師', 'light-medium': '淺中焙', medium: '中焙', 'medium-dark': '中深焙' };
export const GRINDS = { whole: '原豆（不研磨）', pour: '手沖研磨', espresso: '義式研磨' };
const CYCLE_NAMES = { '1': '每月', '2': '每兩個月' };

export function planFor(id, content) {
  const base = PLANS.find(p => p.id === id);
  if (!base) return null;
  const o = content?.plans?.[id] || {};
  return { ...base, ...(o.name ? { name: o.name } : {}), ...(Number.isInteger(o.price) && o.price > 0 ? { price: o.price } : {}), ...(Array.isArray(o.items) && o.items.length ? { items: o.items } : {}) };
}

export const taipeiDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number), last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

const text = (v, label, max) => { const t = String(v ?? '').trim(); if (!t || t.length > max) throw new Error(`${label}必須填寫，且不能超過 ${max} 字`); return t };

export function newSubscription(input, content, id, now = new Date()) {
  const plan = planFor(String(input?.planId || ''), content);
  if (!plan) throw new Error('請選擇訂閱方案');
  const cycle = String(input.cycle || '');
  if (!CYCLE_NAMES[cycle]) throw new Error('請選擇配送週期');
  const roast = String(input.roast || '');
  if (!ROAST_PREFS[roast]) throw new Error('請選擇烘焙度偏好');
  const grind = plan.beans ? String(input.grind || 'whole') : undefined;
  if (grind && !GRINDS[grind]) throw new Error('研磨方式不正確');
  const delivery = String(input.delivery || '');
  if (!['711', 'family', 'home'].includes(delivery)) throw new Error('請選擇配送方式');
  const store = pickedStore({ delivery, store: input.store });
  const c = input.customer || {};
  const customer = { name: text(c.name, '姓名', 80), email: text(c.email, '電子信箱', 150), phone: text(c.phone, '手機', 30), address: store ? `${store.name}（店號 ${store.id}）${store.address}` : text(c.address, '配送地址', 300) };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error('電子信箱格式不正確');
  const at = now.toISOString();
  return {
    id, createdAt: at, planId: plan.id, name: plan.name, price: plan.price, cycle, roast, ...(grind ? { grind } : {}),
    status: 'pending', nextDate: taipeiDate(now), delivery, ...(store ? { store } : {}), customer, periods: 0, orders: [],
    history: [{ at, text: '建立訂閱，等待信用卡授權' }]
  };
}

// 第 n 期出貨訂單（已付款、免運、不扣庫存；焙度與研磨偏好寫在備註）
export function periodOrder(sub, n, orderId, now = new Date()) {
  const at = now.toISOString();
  const note = [`焙度偏好：${ROAST_PREFS[sub.roast] || sub.roast}`, sub.grind && `研磨：${GRINDS[sub.grind]}`, `月費訂購 ${sub.id}`].filter(Boolean).join('・');
  return {
    id: orderId, createdAt: at, status: 'new', payment: 'paid', customer: { ...sub.customer },
    items: [{ kind: 'plan', planId: sub.planId, sku: 'plan-' + sub.planId, name: `${sub.name}（第 ${n} 期・${CYCLE_NAMES[sub.cycle]}）`, grams: 0, price: sub.price, quantity: 1 }],
    subtotal: sub.price, shipping: 0, giftFee: 0, total: sub.price, delivery: sub.delivery, ...(sub.store ? { store: sub.store } : {}),
    customerNote: note.slice(0, 200), gift: { wrap: false, card: '' }, reserved: false, tracking: '', notes: '', payMethod: 'Credit',
    subscriptionId: sub.id, history: [{ at, text: `月費訂購第 ${n} 期信用卡扣款成功（訂閱 ${sub.id}）` }]
  };
}

export function publicSubscription(sub) {
  return { id: sub.id, status: sub.status, name: sub.name, price: sub.price, cycle: sub.cycle, cycleName: CYCLE_NAMES[sub.cycle], periods: sub.periods || 0, nextDate: sub.nextDate, delivery: sub.delivery };
}
