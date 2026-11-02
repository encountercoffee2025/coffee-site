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
    ...(o.items.some(i => i.kind === 'treat') ? ['❄ 含甜點：甜點需另裝一箱冷凍寄出'] : []),
    ...(o.customerNote ? [`備註：${o.customerNote}`] : [])
  ].join('\n').slice(0, 4900);
}

export function customerEmail(o, site) {
  const rows = o.items.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHTML(lineSpec(i))}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">× ${i.quantity}</td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(i.price * i.quantity)}</td></tr>`).join('');
  const html = `<div style="font-family:'Noto Sans TC',Arial,sans-serif;color:#292d29;max-width:560px;margin:auto;line-height:1.7">
<h1 style="font-size:22px;font-weight:600">謝謝你的訂購，${escapeHTML(o.customer.name)}。</h1>
<p>我們已收到你的付款。咖啡會依你選擇的焙度烘焙，約 3–7 天出貨。${o.items.some(i => i.kind === 'treat') ? '甜點會另外以冷凍包裹寄出。' : ''}</p>
<p style="color:#6b6458">訂單編號 <strong>${escapeHTML(o.id)}</strong></p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
${o.shipping - (o.frozenShipping || 0) || !o.frozenShipping ? `<tr><td style="padding:8px 0">運費（${escapeHTML(deliveryLabel(o.delivery))}）</td><td></td><td style="text-align:right">${money(o.shipping - (o.frozenShipping || 0))}</td></tr>` : ''}
${o.frozenShipping ? `<tr><td style="padding:8px 0">甜點冷凍運費</td><td></td><td style="text-align:right">${money(o.frozenShipping)}</td></tr>` : ''}
<tr><td style="padding:8px 0;font-weight:600">合計</td><td></td><td style="text-align:right;font-weight:600">${money(o.total)}</td></tr></table>
<p>收件資訊：${escapeHTML(o.customer.name)}・${escapeHTML(o.customer.phone)}<br>${escapeHTML(deliveryLabel(o.delivery))}：${escapeHTML(o.customer.address)}</p>
${o.customerNote ? `<p>備註：${escapeHTML(o.customerNote)}</p>` : ''}
<p><a href="${escapeHTML(site)}" style="color:#8a5a2b">一遇 Encounter Coffee</a></p></div>`;
  return { subject: `一遇 Encounter Coffee 訂單確認 ${o.id}`, html };
}

export async function notifyPaid(o, paymentLabel, env) {
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
      const { subject, html } = customerEmail(o, env.SITE_URL || 'https://encountercoffee2025.com');
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
