// 付款完成通知：LINE 推播給店家、Email 確認信給顧客。尚未設定的服務會自動略過。
import { lineSpec, deliveryLabel } from './core.js';

const money = n => 'NT$ ' + Number(n).toLocaleString('en-US');
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ownerMessage(o, paymentLabel) {
  return [
    '☕ 一遇・新訂單已付款',
    `訂單 ${o.id}`,
    `金額 ${money(o.total)}（${paymentLabel}）`,
    `配送 ${deliveryLabel(o.delivery)}：${o.customer.address}`,
    `顧客 ${o.customer.name}・${o.customer.phone}`,
    '品項：',
    ...o.items.map(i => `・${lineSpec(i)} × ${i.quantity}`),
    ...(o.frozenShipping !== undefined ? ['❄ 含冷凍甜點：標 ❄ 的品項需另裝一箱冷凍寄出'] : []),
    ...(o.customerNote ? [`備註：${o.customerNote}`] : [])
  ].join('\n').slice(0, 4900);
}

// 訂單進度頁（帶查詢碼，只有收到信的人看得到）
export const orderLink = (site, id, token) => `${String(site).replace(/\/$/, '')}/checkout.html?order=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
const button = (href, label) => `<p style="margin:24px 0"><a href="${escapeHTML(href)}" style="display:inline-block;background:#292d29;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px">${label}</a></p>`;

export function customerEmail(o, site, link) {
  const rows = o.items.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHTML(lineSpec(i))}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">× ${i.quantity}</td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(i.price * i.quantity)}</td></tr>`).join('');
  const html = `<div style="font-family:'Noto Sans TC',Arial,sans-serif;color:#292d29;max-width:560px;margin:auto;line-height:1.7">
<h1 style="font-size:22px;font-weight:600">謝謝你的訂購，${escapeHTML(o.customer.name)}。</h1>
<p>我們已收到你的付款。咖啡會依你選擇的焙度烘焙，約 3–7 天出貨。${o.frozenShipping !== undefined ? '冷凍甜點會另外以冷凍包裹寄出。' : ''}</p>
<p style="color:#6b6458">訂單編號 <strong>${escapeHTML(o.id)}</strong></p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
${o.shipping - (o.frozenShipping || 0) || !o.frozenShipping ? `<tr><td style="padding:8px 0">運費（${escapeHTML(deliveryLabel(o.delivery))}）</td><td></td><td style="text-align:right">${money(o.shipping - (o.frozenShipping || 0))}</td></tr>` : ''}
${o.frozenShipping ? `<tr><td style="padding:8px 0">冷凍運費</td><td></td><td style="text-align:right">${money(o.frozenShipping)}</td></tr>` : ''}
<tr><td style="padding:8px 0;font-weight:600">合計</td><td></td><td style="text-align:right;font-weight:600">${money(o.total)}</td></tr></table>
<p>收件資訊：${escapeHTML(o.customer.name)}・${escapeHTML(o.customer.phone)}<br>${escapeHTML(deliveryLabel(o.delivery))}：${escapeHTML(o.customer.address)}</p>
${o.customerNote ? `<p>備註：${escapeHTML(o.customerNote)}</p>` : ''}
${link ? button(link, '查看訂單進度') + '<p style="color:#6b6458;font-size:13px">出貨時會再寄信通知你；隨時可以點上面的按鈕查看進度。</p>' : ''}
<p><a href="${escapeHTML(site)}" style="color:#8a5a2b">一遇 Encounter Coffee</a></p></div>`;
  return { subject: `一遇 Encounter Coffee 訂單確認 ${o.id}`, html };
}

export async function notifyOwner(text, env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_OWNER_USER_ID) return [];
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: env.LINE_OWNER_USER_ID, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] })
    });
    return [res.ok ? '已傳送 LINE 通知給店家' : `LINE 通知失敗（${res.status}）`];
  } catch (err) { return ['LINE 通知失敗：' + err.message] }
}

export async function notifyPaid(o, paymentLabel, env, token) {
  const results = [];
  if (env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_OWNER_USER_ID) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: env.LINE_OWNER_USER_ID, messages: [{ type: 'text', text: ownerMessage(o, paymentLabel) }] })
      });
      results.push(res.ok ? '已傳送 LINE 通知給店家' : `LINE 通知失敗（${res.status}）`);
    } catch (err) { results.push('LINE 通知失敗：' + err.message) }
  }
  if (env.RESEND_API_KEY) {
    try {
      const site = env.SITE_URL || 'https://encountercoffee2025.com', { subject, html } = customerEmail(o, site, token ? orderLink(site, o.id, token) : '');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM || '一遇 Encounter Coffee <order@encountercoffee2025.com>', to: [o.customer.email], ...(env.OWNER_EMAIL ? { bcc: [env.OWNER_EMAIL] } : {}), ...(env.REPLY_TO || env.OWNER_EMAIL ? { reply_to: env.REPLY_TO || env.OWNER_EMAIL } : {}), subject, html })
      });
      results.push(res.ok ? '已寄出訂單確認信' : `確認信寄送失敗（${res.status}）`);
    } catch (err) { results.push('確認信寄送失敗：' + err.message) }
  }
  return results;
}

// 出貨通知信：寄件代碼／物流單號與進度連結
export function shippedEmail(o, site, link) {
  const s = o.shipment, pickup = Boolean(s || o.store);
  const code = s ? s.paymentNo + (s.validationNo || '') : o.tracking;
  const html = `<div style="font-family:'Noto Sans TC',Arial,sans-serif;color:#292d29;max-width:560px;margin:auto;line-height:1.7">
<h1 style="font-size:22px;font-weight:600">${escapeHTML(o.customer.name)}，你的咖啡出發了。</h1>
<p>訂單 <strong>${escapeHTML(o.id)}</strong> 已經寄出（${escapeHTML(deliveryLabel(o.delivery))}）。</p>
${code ? `<p>${s ? '寄件代碼' : '物流單號'}：<strong>${escapeHTML(code)}</strong></p>` : ''}
${pickup ? `<p>取貨門市：${escapeHTML(o.customer.address)}<br>包裹送達門市後，請攜帶與收件人姓名相同的證件取貨。</p>` : ''}
${link ? button(link, '查看配送進度') : ''}
<p><a href="${escapeHTML(site)}" style="color:#8a5a2b">一遇 Encounter Coffee</a></p></div>`;
  return { subject: `一遇 Encounter Coffee 出貨通知 ${o.id}`, html };
}

export async function notifyShipped(o, env, token) {
  if (!env.RESEND_API_KEY || !o.customer?.email) return [];
  try {
    const site = env.SITE_URL || 'https://encountercoffee2025.com', { subject, html } = shippedEmail(o, site, token ? orderLink(site, o.id, token) : '');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || '一遇 Encounter Coffee <order@encountercoffee2025.com>', to: [o.customer.email], ...(env.REPLY_TO || env.OWNER_EMAIL ? { reply_to: env.REPLY_TO || env.OWNER_EMAIL } : {}), subject, html })
    });
    return [res.ok ? '已寄出出貨通知信' : `出貨通知信寄送失敗（${res.status}）`];
  } catch (err) { return ['出貨通知信寄送失敗：' + err.message] }
}

// 「查詢訂單」寄給顧客的訂單清單：每筆附進度連結
export function orderProgressLabel(o) {
  if (o.payment === 'refunded') return '已退款';
  if (o.status === 'cancelled') return o.payment === 'refund_pending' ? '已取消・退款處理中' : '已取消';
  if (o.payment === 'unpaid') return '尚未付款';
  return { new: '已付款', confirmed: '備貨中', packing: '備貨中', shipped: '已出貨', completed: '已完成' }[o.status] || '處理中';
}
export function orderListEmail(rows, site) {
  const date = iso => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const items = rows.map(r => `<tr><td style="padding:12px 0;border-bottom:1px solid #eee"><strong>${escapeHTML(r.data.id)}</strong><br><span style="color:#6b6458;font-size:13px">${escapeHTML(date(r.data.createdAt || r.created_at))}・${money(r.data.total)}・${escapeHTML(orderProgressLabel(r.data))}</span></td><td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right"><a href="${escapeHTML(orderLink(site, r.data.id, r.token))}" style="color:#8a5a2b">查看進度 →</a></td></tr>`).join('');
  const html = `<div style="font-family:'Noto Sans TC',Arial,sans-serif;color:#292d29;max-width:560px;margin:auto;line-height:1.7">
<h1 style="font-size:22px;font-weight:600">你在一遇的訂單</h1>
<p>這是你在「查詢訂單」頁要求寄送的訂單連結。如果不是你本人操作，可以忽略這封信。</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${items}</table>
<p><a href="${escapeHTML(site)}" style="color:#8a5a2b">一遇 Encounter Coffee</a></p></div>`;
  return { subject: '一遇 Encounter Coffee 訂單查詢', html };
}
export async function notifyOrderList(email, rows, env) {
  if (!env.RESEND_API_KEY) return false;
  const site = env.SITE_URL || 'https://encountercoffee2025.com', { subject, html } = orderListEmail(rows, site);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || '一遇 Encounter Coffee <order@encountercoffee2025.com>', to: [email], ...(env.REPLY_TO || env.OWNER_EMAIL ? { reply_to: env.REPLY_TO || env.OWNER_EMAIL } : {}), subject, html })
  }).catch(() => null);
  return Boolean(res?.ok);
}
