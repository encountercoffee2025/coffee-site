(() => {
  'use strict';
  const lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
  const dictionary = window.COFFEE_EN || {};
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const terms = new RegExp(Object.keys(dictionary).sort((a, b) => b.length - a.length).map(escape).join('|'), 'g');
  function translate(value) {
    const text = String(value ?? '');
    if (lang !== 'en') return text;
    if (Object.hasOwn(dictionary, text.trim())) return text.replace(text.trim(), dictionary[text.trim()]);
    return text
      .replace(/將用備份的 (\d+) 款商品與 (\d+) 筆訂單取代目前資料。/g, 'Replace current data with $1 products and $2 orders from the backup.')
      .replace(/(\d+) 款熟豆選品，從花果香到可可尾韻。/g, '$1 roasted coffees, from floral aromas to cocoa finishes.')
      .replace(/找到 (\d+) 款熟豆/g, 'Found $1 coffees')
      .replace(/(\d+) 款精選咖啡/g, '$1 featured coffees')
      .replace(/瀏覽全部 (\d+) 款熟豆/g, 'Explore all $1 coffees')
      .replace(/第(\d+)張：/g, 'Image $1: ')
      .replace(/(\d+) 分 (\d+) 秒/g, '$1 min $2 sec')
      .replace(/再買 (NT\$ [\d,]+)，即可享免運（滿 (NT\$ [\d,]+) 免運）/g, 'Add $1 more for free shipping (free over $2)')
      .replace(/✓ 已達 (NT\$ [\d,]+)，享免運費/g, '✓ Free shipping unlocked (over $1)')
      .replace(/可售 (\d+) 份/g, '$1 available')
      .replace(/(\d+) 入/g, '$1 pcs')
      .replace(/(\d+) 份/g, '$1 pcs')
      .replace(/(\d+) 種/g, '$1 options')
      .replace(/(\d+) 包可售/g, '$1 bags available')
      .replace(/(\d+) 包/g, (_, n) => `${n} ${n === '1' ? 'bag' : 'bags'}`)
      .replace(/\/ 包/g, '/ bag')
      .replace(/(\d+) 款商品/g, '$1 products')
      .replace(/(\d+) 款/g, '$1 coffees')
      .replace(/調查售價 (.*?) \/ (\d+)g · 查閱 (.*?)。本網站 (\d+)g 價為獨立示範定價。/g, 'Reference: $1 / $2g · Checked $3. The $4g price here is a separate demo price.')
      .replace(/將用備份的 (\d+) 款商品與 (\d+) 筆訂單取代目前資料。/g, 'Replace current data with $1 products and $2 orders from the backup.')
      .replace(/(.*?)必須填寫，且不能超過 (\d+) 字/g, '$1 is required (maximum $2 characters)')
      .replace(terms, match => dictionary[match])
      .replace(/，/g, ', ').replace(/。/g, '.').replace(/（/g, '(').replace(/）/g, ')').replace(/・/g, ' · ').replace(/：/g, ': ');
  }
  function localLink(href, targetLang = lang) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !(/\.html$/.test(url.pathname) || url.pathname.endsWith('/'))) return href;
    if (targetLang === 'en') url.searchParams.set('lang', 'en');
    else url.searchParams.set('lang', 'zh');
    return url.pathname + url.search + url.hash;
  }
  window.CoffeeI18n = { lang, translate, localLink };
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-TW';
  document.documentElement.dataset.lang = lang;
  const toggle = document.createElement('a');
  toggle.className = 'language-switch';
  toggle.textContent = lang === 'en' ? '繁中' : 'EN';
  toggle.lang = lang === 'en' ? 'zh-TW' : 'en';
  toggle.href = localLink(location.href, lang === 'en' ? 'zh' : 'en');
  toggle.setAttribute('aria-label', lang === 'en' ? 'Switch to Traditional Chinese' : '切換至英文版');
  const slot = document.querySelector('.nav-actions') || document.querySelector('.shop-nav nav') || document.querySelector('.admin-topbar') || document.querySelector('header nav');
  if (slot) slot.append(toggle);
  for (const locale of ['en', 'zh']) {
    const alternate = document.createElement('link');
    alternate.rel = 'alternate';
    alternate.hreflang = locale === 'zh' ? 'zh-Hant' : 'en';
    alternate.href = localLink(location.href, locale);
    document.head.append(alternate);
  }
  function update(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement?.closest('script,style,textarea,[data-no-translate]')) {
        const result = translate(node.nodeValue);
        if (result !== node.nodeValue) node.nodeValue = result;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node !== document) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches('script,style,textarea,[data-no-translate]')) return;
      // Option labels may change; their original values must remain stable for filters and forms.
      if (node.matches('option') && !node.hasAttribute('value')) node.setAttribute('value', node.value);
      if (node.matches('a[href]') && !node.classList.contains('language-switch') && lang === 'en') {
        const href = node.getAttribute('href');
        const localized = localLink(href);
        if (localized !== href) node.setAttribute('href', localized);
      }
      for (const attribute of ['aria-label', 'alt', 'placeholder', 'data-search', 'content']) {
        if (!node.hasAttribute(attribute)) continue;
        const original = node.getAttribute(attribute), result = translate(original);
        if (original !== result) node.setAttribute(attribute, result);
      }
    }
    Array.from(node.childNodes).forEach(update);
  }
  update(document);
  if (lang === 'en') {
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(update);
        else update(record.target);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'aria-label', 'alt', 'placeholder', 'data-search', 'content'] });
  }
  window.addEventListener('hashchange', () => {
    toggle.href = localLink(location.href, lang === 'en' ? 'zh' : 'en');
  });
})();
