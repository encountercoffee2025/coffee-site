// 後台自動翻譯：把中文商品、點心與頁面文字翻成英文（DeepL API Free，每月 50 萬字免費）。
// 只有登入且完成兩步驟驗證的管理員能呼叫；DeepL 金鑰（DEEPL_API_KEY）只存在 Supabase Edge Function secrets。
import { db } from './db.js';
import { requireAdmin, corsHeaders } from './handlers.js';

const MAX_ITEMS = 60, MAX_CHARS = 2000, MAX_TOTAL = 20000, BATCH = 50;
const KINDS = ['text', 'tags'];

// 咖啡用語對照：整個欄位或單一風味標籤剛好是這些詞時，直接用固定譯法（比機器翻譯道地）。
export const GLOSSARY = {
  // 處理法・焙度・規格
  '水洗': 'Washed', '日曬': 'Natural', '蜜處理': 'Honey', '紅蜜': 'Red honey', '紅蜜處理': 'Red honey', '黑蜜': 'Black honey', '黑蜜處理': 'Black honey', '黃蜜': 'Yellow honey', '白蜜': 'White honey',
  '濕剝': 'Wet-hulled', '厭氧': 'Anaerobic', '厭氧發酵': 'Anaerobic fermentation', '厭氧日曬': 'Anaerobic natural', '厭氧水洗': 'Anaerobic washed',
  '淺焙': 'Light roast', '淺中焙': 'Light-medium roast', '中焙': 'Medium roast', '中深焙': 'Medium-dark roast', '深焙': 'Dark roast',
  '濾掛包': 'Drip bag', '濾泡包': 'Steep bag', '咖啡豆': 'Coffee beans', '手沖': 'Pour-over',
  // 產地與品種
  '衣索比亞': 'Ethiopia', '耶加雪菲': 'Yirgacheffe', '古吉': 'Guji', '西達摩': 'Sidamo', '肯亞': 'Kenya', '涅里': 'Nyeri', '巴拿馬': 'Panama', '波奎特': 'Boquete',
  '哥倫比亞': 'Colombia', '薇拉': 'Huila', '瓜地馬拉': 'Guatemala', '安提瓜': 'Antigua', '哥斯大黎加': 'Costa Rica', '塔拉珠': 'Tarrazú', '巴西': 'Brazil', '喜拉朵': 'Cerrado',
  '印尼': 'Indonesia', '曼特寧': 'Mandheling', '林東': 'Lintong', '台灣': 'Taiwan', '阿里山': 'Alishan', '藝伎': 'Geisha', '瑰夏': 'Geisha', '依批次確認': 'Confirm with the batch', '依實際批次確認': 'Confirm with the actual batch',
  // 常見風味
  '白花': 'White florals', '花香': 'Floral', '茉莉花': 'Jasmine', '玫瑰': 'Rose', '柑橘': 'Citrus', '檸檬': 'Lemon', '檸檬皮': 'Lemon peel', '萊姆': 'Lime', '柳橙': 'Orange', '橘子': 'Tangerine', '葡萄柚': 'Grapefruit', '佛手柑': 'Bergamot',
  '蜂蜜': 'Honey', '紅糖': 'Brown sugar', '黑糖': 'Muscovado', '蔗糖': 'Cane sugar', '楓糖': 'Maple syrup', '焦糖': 'Caramel', '太妃糖': 'Toffee', '香草': 'Vanilla', '奶油': 'Butter',
  '巧克力': 'Chocolate', '黑巧克力': 'Dark chocolate', '牛奶巧克力': 'Milk chocolate', '可可': 'Cocoa', '堅果': 'Nutty', '杏仁': 'Almond', '榛果': 'Hazelnut',
  '莓果': 'Berries', '藍莓': 'Blueberry', '草莓': 'Strawberry', '覆盆莓': 'Raspberry', '黑醋栗': 'Blackcurrant', '櫻桃': 'Cherry', '李子': 'Plum', '葡萄': 'Grape', '紅酒': 'Red wine', '酒香': 'Winey',
  '桃子': 'Peach', '水蜜桃': 'White peach', '杏桃': 'Apricot', '蘋果': 'Apple', '青蘋果': 'Green apple', '熱帶水果': 'Tropical fruit', '芒果': 'Mango', '鳳梨': 'Pineapple', '百香果': 'Passion fruit', '荔枝': 'Lychee',
  '紅茶': 'Black tea', '烏龍茶': 'Oolong', '綠茶': 'Green tea', '香料': 'Spice', '肉桂': 'Cinnamon', '木質': 'Woody', '草本': 'Herbal'
};
const gloss = s => GLOSSARY[s.trim()];

const fail = (status, message) => Object.assign(new Error(message), { status });

export function cleanItems(raw) {
  if (!Array.isArray(raw) || !raw.length) throw fail(400, '沒有需要翻譯的文字');
  if (raw.length > MAX_ITEMS) throw fail(400, `一次最多翻譯 ${MAX_ITEMS} 段文字`);
  const ids = new Set();
  const items = raw.map(x => {
    const id = String(x?.id ?? ''), zh = String(x?.zh ?? '').trim(), kind = KINDS.includes(x?.kind) ? x.kind : 'text';
    if (!/^[\w.:-]{1,80}$/.test(id) || ids.has(id)) throw fail(400, '翻譯欄位格式不正確');
    if (zh.length > MAX_CHARS) throw fail(400, `每段文字最多 ${MAX_CHARS} 字`);
    ids.add(id);
    return { id, kind, zh };
  }).filter(x => x.zh);
  if (!items.length) throw fail(400, '沒有需要翻譯的文字');
  if (items.reduce((n, x) => n + x.zh.length, 0) > MAX_TOTAL) throw fail(400, '文字太長，請分次翻譯');
  return items;
}

// 一次送最多 50 段給 DeepL；免費金鑰（結尾 :fx）用 api-free 網址
async function deepl(texts, key) {
  const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com', out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(host + '/v2/translate', {
      method: 'POST',
      headers: { Authorization: 'DeepL-Auth-Key ' + key.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts.slice(i, i + BATCH), source_lang: 'ZH', target_lang: 'EN-US', preserve_formatting: true, context: 'Website copy for a specialty coffee roaster in Taiwan: product names, origins, processing methods, flavor notes and descriptions.' })
    });
    if (res.status === 403) throw fail(503, 'DeepL 金鑰無效，請檢查 Supabase 的 DEEPL_API_KEY');
    if (res.status === 456) throw fail(429, '本月 DeepL 免費翻譯額度已用完，下個月會自動恢復');
    if (res.status === 429) throw fail(429, '翻譯服務忙碌中，請稍後再試');
    if (!res.ok) { console.error('deepl', res.status, (await res.text()).slice(0, 300)); throw fail(502, '翻譯服務暫時無法使用，請稍後再試'); }
    const json = await res.json();
    out.push(...(json.translations || []).map(t => String(t.text || '')));
  }
  return out;
}

export async function translateItems(items, key) {
  // 先拆成要翻的片段：風味標籤逐一翻，查得到對照的就不送 DeepL
  const parts = items.map(x => x.kind === 'tags' ? x.zh.split(/[、,，]/).map(s => s.trim()).filter(Boolean) : [x.zh]);
  const pending = [...new Set(parts.flat().filter(s => !gloss(s)))];
  const done = pending.length ? await deepl(pending, key) : [];
  const lookup = new Map(pending.map((s, i) => [s, done[i]]));
  const translations = {};
  items.forEach((x, n) => {
    const words = parts[n].map(s => gloss(s) || (lookup.get(s) || '').trim()).filter(Boolean);
    if (!words.length) return;
    const en = x.kind === 'tags' ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ') : words[0];
    translations[x.id] = en.slice(0, 4000);
  });
  return translations;
}

export async function handleTranslate(req, env) {
  const headers = corsHeaders(req, env, 'POST, OPTIONS');
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: '不支援的請求' });
  try {
    await requireAdmin(req, env, db(env));
    if (!env.DEEPL_API_KEY) return reply(503, { error: '自動翻譯尚未設定（Supabase 缺少 DEEPL_API_KEY）' });
    const items = cleanItems((await req.json().catch(() => null))?.items);
    return reply(200, { translations: await translateItems(items, env.DEEPL_API_KEY) });
  } catch (err) {
    if (err.status) return reply(err.status, { error: err.message });
    console.error('translate', err);
    return reply(500, { error: '自動翻譯失敗，請稍後再試' });
  }
}
