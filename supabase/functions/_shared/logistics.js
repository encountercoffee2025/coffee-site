// 綠界物流 C2C（7-ELEVEN 交貨便、全家店到店）：建立寄件單、列印託運單、接收物流狀態通知。
// 物流的檢查碼是 MD5（金流是 SHA256）；Web Crypto 沒有 MD5，所以用 Supabase 與 Node 都支援的 node:crypto。
import { createHash } from 'node:crypto';
import { taipeiTime } from './ecpay.js';

const BASE = { stage: 'https://logistics-stage.ecpay.com.tw', prod: 'https://logistics.ecpay.com.tw' };
// 綠界公開的 C2C 測試特店（僅限測試環境）
const STAGE = { merchantId: '2000933', hashKey: 'XBERn1YOvpM9nfZc', hashIV: 'h1ONHk4P4yqbl5LK', senderName: '王小明', senderPhone: '0912345678' };
export const SUB_TYPES = { '711': 'UNIMARTC2C', family: 'FAMIC2C' };
const LABEL = { UNIMARTC2C: '7-ELEVEN 交貨便', FAMIC2C: '全家店到店' };

// 寄件人姓名與手機只放在 Supabase secrets（LOGISTICS_SENDER_NAME、LOGISTICS_SENDER_PHONE）
export function logisticsConfig(env) {
  const mode = env.ECPAY_MODE === 'prod' ? 'prod' : 'stage';
  const c = mode === 'prod'
    ? { merchantId: env.ECPAY_LOGISTICS_MERCHANT_ID || env.ECPAY_MERCHANT_ID, hashKey: env.ECPAY_LOGISTICS_HASH_KEY || env.ECPAY_HASH_KEY, hashIV: env.ECPAY_LOGISTICS_HASH_IV || env.ECPAY_HASH_IV, senderName: env.LOGISTICS_SENDER_NAME, senderPhone: env.LOGISTICS_SENDER_PHONE }
    : { ...STAGE, ...(env.LOGISTICS_SENDER_NAME ? { senderName: env.LOGISTICS_SENDER_NAME } : {}), ...(env.LOGISTICS_SENDER_PHONE ? { senderPhone: env.LOGISTICS_SENDER_PHONE } : {}) };
  if (!c.merchantId || !c.hashKey || !c.hashIV) throw Object.assign(new Error('物流尚未設定完成'), { status: 503 });
  // 貼上 secrets 時常多帶空白或換行：寄件人姓名去掉所有空白，手機只留數字
  return { mode, base: BASE[mode], ...c, senderName: String(c.senderName ?? '').replace(/\s+/g, ''), senderPhone: String(c.senderPhone ?? '').replace(/[\s-]/g, '') };
}

const dotnetEncode = s => encodeURIComponent(s).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27');
export function logisticsMac(params, hashKey, hashIV) {
  const keys = Object.keys(params).filter(k => k !== 'CheckMacValue').sort((a, b) => {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const raw = `HashKey=${hashKey}&${keys.map(k => `${k}=${params[k]}`).join('&')}&HashIV=${hashIV}`;
  return createHash('md5').update(dotnetEncode(raw).toLowerCase()).digest('hex').toUpperCase();
}
export const verifyLogisticsMac = (params, cfg) => typeof params.CheckMacValue === 'string' && params.CheckMacValue.toUpperCase() === logisticsMac(params, cfg.hashKey, cfg.hashIV);

// 超商取貨規定：收件人要用證件上的真實姓名（2～5 個中文字或 4～10 個英文字母），手機為 09 開頭 10 碼
export function pickupNameProblem(name) {
  const n = String(name ?? '').trim();
  if (!/^[一-鿿]{2,5}$/.test(n) &&!/^[A-Za-z]{4,10}$/.test(n)) return '超商取貨的收件人姓名須為 2～5 個中文字或 4～10 個英文字母，不能有數字、空格或符號（取貨時會核對證件）';
  if (/(小姐|先生|太太|女士)$/.test(n)) return '超商取貨須填證件上的真實姓名，不能用「小姐」「先生」等稱呼（取貨時會核對證件）';
  return '';
}
export const pickupPhoneProblem = phone => /^09\d{8}$/.test(String(phone ?? '').trim()) ? '' : '超商取貨的手機須為 09 開頭的 10 碼數字';

const post = async (url, fields) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  return (await res.text()).trim();
};

// 建立寄件單。回傳 { ok, shipment } 或 { ok:false, message }
export async function createShipment(order, receiver, cfg, replyURL, now = new Date()) {
  const subType = SUB_TYPES[order.delivery];
  if (!subType || !order.store?.id) return { ok: false, message: '這筆訂單不是 7-ELEVEN／全家取貨，或沒有取貨門市' };
  if (!cfg.senderName || !cfg.senderPhone) return { ok: false, message: '尚未設定寄件人：請在 Supabase secrets 新增 LOGISTICS_SENDER_NAME（你的真實姓名）與 LOGISTICS_SENDER_PHONE（09 開頭手機）' };
  // 寄件人格式與收件人相同；先檢查，避免送到綠界才收到難懂的錯誤
  if (pickupNameProblem(cfg.senderName)) return { ok: false, message: 'Supabase secret LOGISTICS_SENDER_NAME 的寄件人姓名不符合規定：須為身分證上的姓名，2～5 個中文字或 4～10 個英文字母，不能有數字、符號或「先生」「小姐」等稱呼' };
  if (pickupPhoneProblem(cfg.senderPhone)) return { ok: false, message: 'Supabase secret LOGISTICS_SENDER_PHONE 的寄件人手機不符合規定：須為 09 開頭的 10 碼數字，不能有空格或「-」' };
  const fields = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: order.id,
    MerchantTradeDate: taipeiTime(now),
    LogisticsType: 'CVS',
    LogisticsSubType: subType,
    GoodsAmount: String(Math.min(Math.max(Math.round(order.total) || 1, 1), 20000)),
    IsCollection: 'N',
    GoodsName: '一遇咖啡',
    SenderName: cfg.senderName,
    SenderCellPhone: cfg.senderPhone,
    ReceiverName: receiver.name,
    ReceiverCellPhone: receiver.phone,
    ReceiverStoreID: order.store.id,
    ServerReplyURL: replyURL
  };
  fields.CheckMacValue = logisticsMac(fields, cfg.hashKey, cfg.hashIV);
  const text = await post(cfg.base + '/Express/Create', fields);
  if (!text.startsWith('1|')) return { ok: false, message: text.replace(/^0\|/, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || '綠界沒有回應' };
  const r = Object.fromEntries(new URLSearchParams(text.slice(2)));
  if (!verifyLogisticsMac(r, cfg)) return { ok: false, message: '綠界回覆的檢查碼不符，請到綠界物流後台確認這筆是否已建立' };
  return {
    ok: true,
    shipment: {
      id: r.AllPayLogisticsID, subType, label: LABEL[subType], merchantTradeNo: r.MerchantTradeNo,
      paymentNo: r.CVSPaymentNo || '', validationNo: r.CVSValidationNo || '',
      receiverName: receiver.name, receiverPhone: receiver.phone, storeId: order.store.id,
      code: r.RtnCode, status: r.RtnMsg || '', createdAt: now.toISOString(), updatedAt: now.toISOString()
    }
  };
}

// 寄件代碼：7-ELEVEN 是寄貨編號 8 碼 + 驗證碼 4 碼；全家是寄貨編號
export const shipmentCode = s => s.paymentNo + (s.validationNo || '');

// 列印託運單：回傳要以新分頁 POST 的表單（不能用 iframe，綠界會轉到超商頁面）。mode 2 = A6 熱感應標籤（只有 7-ELEVEN 支援）
export function printForm(shipment, cfg, mode = '1') {
  const seven = shipment.subType === 'UNIMARTC2C';
  const fields = { MerchantID: cfg.merchantId, AllPayLogisticsID: shipment.id, CVSPaymentNo: shipment.paymentNo, ...(seven ? { CVSValidationNo: shipment.validationNo, PrintMode: mode === '2' ? '2' : '1' } : {}) };
  fields.CheckMacValue = logisticsMac(fields, cfg.hashKey, cfg.hashIV);
  return { action: cfg.base + (seven ? '/Express/PrintUniMartC2COrderInfo' : '/Express/PrintFAMIC2COrderInfo'), fields };
}

// 物流狀態代碼：送達物流中心＝已寄出；顧客取貨成功＝完成
export const SENT_CODES = ['2030', '3024'], ARRIVED_CODES = ['2073', '3018'], PICKED_UP_CODES = ['2067', '3022'];
