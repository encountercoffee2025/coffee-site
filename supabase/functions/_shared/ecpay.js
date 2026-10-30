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
  if (order.shipping) names.push('運費 x 1');
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
    ChoosePayment: ['Credit', 'ATM', 'CVS'].includes(order.payMethod) ? order.payMethod : 'ALL',
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
