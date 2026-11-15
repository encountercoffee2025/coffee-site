// 綠界 ECPay 全方位金流（AIO）：產生付款表單與驗證 CheckMacValue。
export const ECPAY_URL = {
  stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  prod: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
};
// 綠界公開的測試特店（僅限測試環境，不會真的扣款）
const STAGE_MERCHANT = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };

// 超商電子地圖（C2C 店到店）：測試環境用綠界公開的 C2C 測試特店 2000933；正式環境用自己的特店編號
export const MAP_URL = { stage: 'https://logistics-stage.ecpay.com.tw/Express/map', prod: 'https://logistics.ecpay.com.tw/Express/map' };
export const STORE_TYPES = { '711': 'UNIMARTC2C', family: 'FAMIC2C' };
export function mapConfig(env) {
  const mode = env.ECPAY_MODE === 'prod' ? 'prod' : 'stage';
  return { action: MAP_URL[mode], merchantId: mode === 'prod' ? env.ECPAY_LOGISTICS_MERCHANT_ID || env.ECPAY_MERCHANT_ID : '2000933', types: STORE_TYPES, replyURL: env.SUPABASE_URL + '/functions/v1/ecpay?type=store' };
}

export function ecpayConfig(env) {
  const mode = env.ECPAY_MODE === 'prod' ? 'prod' : 'stage';
  const merchant = mode === 'prod' || env.ECPAY_MERCHANT_ID
    ? { merchantId: env.ECPAY_MERCHANT_ID, hashKey: env.ECPAY_HASH_KEY, hashIV: env.ECPAY_HASH_IV }
    : STAGE_MERCHANT;
  if (!merchant.merchantId || !merchant.hashKey || !merchant.hashIV) throw new Error('金流尚未設定完成');
  return { mode, ...merchant };
}

// 與綠界相同的編碼：.NET UrlEncode（空白為 +，~ 與 ' 需編碼），轉小寫後 SHA256，再轉大寫
const dotnetEncode = s => encodeURIComponent(s).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27');

export async function checkMacValue(params, hashKey, hashIV) {
  const keys = Object.keys(params).filter(k => k !== 'CheckMacValue').sort((a, b) => {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const raw = `HashKey=${hashKey}&${keys.map(k => `${k}=${params[k]}`).join('&')}&HashIV=${hashIV}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dotnetEncode(raw).toLowerCase()));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function verifyMac(params, cfg) {
  return typeof params.CheckMacValue === 'string' && params.CheckMacValue.toUpperCase() === await checkMacValue(params, cfg.hashKey, cfg.hashIV);
}

export function taipeiTime(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// urls: { notify, result, back }（ReturnURL 伺服器通知、OrderResultURL 付款後導回、ClientBackURL 返回商店）
export async function paymentForm(order, tradeNo, cfg, urls, now = new Date()) {
  const clean = s => String(s).replace(/[#&=<>"'\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
  const names = order.items.map(i => `${clean(i.name)} x ${i.quantity}`);
  const frozen = order.frozenShipping || 0;
  if (order.shipping - frozen) names.push('運費 x 1');
  if (frozen) names.push('冷凍運費 x 1');
  let itemName = names.join('#');
  if (itemName.length > 200) itemName = itemName.slice(0, 197) + '...';
  const fields = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: taipeiTime(now),
    PaymentType: 'aio',
    TotalAmount: String(order.total),
    TradeDesc: '一遇咖啡訂單',
    ItemName: itemName,
    ReturnURL: urls.notify,
    OrderResultURL: urls.result,
    ClientBackURL: urls.back,
    ChoosePayment: 'Credit', // 只收信用卡：ATM／超商代碼付款期限長，會讓未付款訂單佔住庫存
    EncryptType: '1',
    CustomField1: order.id
  };
  fields.CheckMacValue = await checkMacValue(fields, cfg.hashKey, cfg.hashIV);
  return { action: ECPAY_URL[cfg.mode], fields };
}

export function paymentTypeLabel(type = '') {
  if (type.startsWith('Credit')) return '信用卡';
  if (type.startsWith('WebATM')) return '網路 ATM';
  if (type.startsWith('ATM')) return 'ATM 轉帳';
  if (type.startsWith('CVS')) return '超商代碼';
  if (type.startsWith('BARCODE')) return '超商條碼';
  if (type.startsWith('ApplePay')) return 'Apple Pay';
  if (type.startsWith('TWQR')) return '台灣 Pay';
  return type || '綠界';
}

// 信用卡定期定額：第一期立即授權，之後依週期自動扣款（每月或每兩個月，最多 99 期）
export async function periodicForm(sub, cfg, urls, now = new Date()) {
  const clean = s => String(s).replace(/[#&=<>"'\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
  const fields = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: sub.id,
    MerchantTradeDate: taipeiTime(now),
    PaymentType: 'aio',
    TotalAmount: String(sub.price),
    TradeDesc: '一遇咖啡月費訂購',
    ItemName: `${clean(sub.name)}（${sub.cycle === '2' ? '每兩個月' : '每月'}）x 1`,
    ReturnURL: urls.notify,
    OrderResultURL: urls.result,
    ClientBackURL: urls.back,
    ChoosePayment: 'Credit',
    EncryptType: '1',
    PeriodAmount: String(sub.price),
    PeriodType: 'M',
    Frequency: sub.cycle === '2' ? '2' : '1',
    ExecTimes: '99',
    PeriodReturnURL: urls.period,
    CustomField1: sub.id
  };
  fields.CheckMacValue = await checkMacValue(fields, cfg.hashKey, cfg.hashIV);
  return { action: ECPAY_URL[cfg.mode], fields };
}

// 信用卡請退款（CreditDetail/DoAction）：只有正式環境能用，測試環境沒有真實授權。
// 交易狀態決定要用哪個動作：已授權 → N 放棄；要關帳 → E 取消關帳再 N；已關帳 → R 退刷。
// 查狀態的 API 需要另外的商家檢查碼，所以改為依序嘗試；狀態不符的動作綠界會直接拒絕、不會有任何效果。
const DO_ACTION_URL = 'https://payment.ecpay.com.tw/CreditDetail/DoAction';
export async function creditAction(trade, action, cfg) {
  const fields = { MerchantID: cfg.merchantId, MerchantTradeNo: trade.merchantTradeNo, TradeNo: trade.tradeNo, Action: action, TotalAmount: String(trade.amount) };
  fields.CheckMacValue = await checkMacValue(fields, cfg.hashKey, cfg.hashIV);
  const res = await fetch(DO_ACTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  const body = await res.text();
  const reply = Object.fromEntries(new URLSearchParams(body.trim()));
  return { ok: reply.RtnCode === '1', message: reply.RtnMsg || body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || `HTTP ${res.status}` };
}

const ACTION_LABEL = { N: '放棄授權', E: '取消關帳', R: '退刷' };
// 全額退款。回傳 { ok, method, message }；method 是實際成功的動作，例如「放棄授權」或「取消關帳＋放棄授權」。
export async function refundCredit(trade, cfg) {
  const tried = [];
  const step = async action => {
    const r = await creditAction(trade, action, cfg);
    tried.push(`${ACTION_LABEL[action]}：${r.ok ? '成功' : r.message}`);
    return r.ok;
  };
  if (await step('N')) return { ok: true, method: '放棄授權（尚未請款，款項不會入帳）' };
  if (await step('E')) {
    if (await step('N')) return { ok: true, method: '取消關帳＋放棄授權（尚未撥款）' };
    return { ok: false, message: `已取消關帳，但放棄授權失敗（${tried.join('；')}）。請稍後再按一次退款。` };
  }
  if (await step('R')) return { ok: true, method: '退刷（已請款，款項會退回顧客信用卡）' };
  return { ok: false, message: tried.join('；') };
}

// 每天 20:15～20:30 綠界在做自動關帳，不能呼叫請退款 API
export function inCloseWindow(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes >= 20 * 60 + 15 && minutes < 20 * 60 + 30;
}

const PERIOD_ACTION_URL = { stage: 'https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction', prod: 'https://payment.ecpay.com.tw/Cashier/CreditCardPeriodAction' };
// 通知綠界停止之後的定期定額扣款；回傳 { ok, message }
export async function cancelPeriod(tradeNo, cfg, now = new Date()) {
  const fields = { MerchantID: cfg.merchantId, MerchantTradeNo: tradeNo, Action: 'Cancel', TimeStamp: String(Math.floor(now.getTime() / 1000)) };
  fields.CheckMacValue = await checkMacValue(fields, cfg.hashKey, cfg.hashIV);
  const res = await fetch(PERIOD_ACTION_URL[cfg.mode], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  const body = await res.text();
  const reply = Object.fromEntries(new URLSearchParams(body.trim()));
  return { ok: reply.RtnCode === '1', message: reply.RtnMsg || body.slice(0, 120) };
}
