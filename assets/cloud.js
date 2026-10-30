(() => {
  'use strict';
  // Supabase 公開設定：網址與 publishable key 本來就會出現在前端，資料安全由資料庫權限規則（RLS）保護。
  const CLOUD_URL = 'https://ytejdngkxnebbpxedshz.supabase.co';
  const CLOUD_KEY = 'sb_publishable_pCNZuMk-MuT4ZnLpL0fnQA_5AxJJRRI';
  const MARK = 'encounter-cloud-at';
  const VERSION = (document.currentScript?.getAttribute('src').match(/\?v=[^&]+/) || [''])[0];
  const S = window.CoffeeStore, root = document.documentElement;
  // 網站配色由後台「商店與資料設定」決定，所有訪客看到同一種配色。
  const THEME_CACHE = 'encounter-site-theme', themeColors = { terra: '#f5eee4', forest: '#ecefe2', cobalt: '#eeecf8', nocturne: '#181e1d' };
  function applyTheme(theme) {
    if (!Object.hasOwn(themeColors, theme)) theme = 'terra';
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
    try { localStorage.setItem(THEME_CACHE, theme) } catch (_) {}
  }
  let cachedTheme = null;
  try { cachedTheme = localStorage.getItem(THEME_CACHE) } catch (_) {}
  if (document.body.dataset.page !== 'admin') applyTheme(S?.state().settings.theme || cachedTheme);
  const admin = document.body.dataset.page === 'admin';
  const t = s => window.CoffeeI18n?.translate(s) ?? s;
  const remember = () => { try { localStorage.setItem(MARK, new Date().toISOString()) } catch (_) {} };
  const seen = () => { try { return !!localStorage.getItem(MARK) } catch (_) { return false } };
  const toast = message => { const n = document.getElementById('app-toast'); if (!n) return; n.textContent = t(message); n.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => n.hidden = true, 6000) };

  // 頁面內容：後台改過的文字與圖片（只存有改動的欄位），套用到 data-content / data-content-img 元素。
  const CONTENT_CACHE = 'encounter-content-v1';
  const okImage = src => typeof src === 'string' && (/^https:\/\//.test(src) || (/^assets\/[\w./-]+$/.test(src) && !src.includes('..')));
  // 可編輯的文字是元素開頭的文字與換行；後面的子元素（例如按鈕箭頭）保留不動。
  const leadNodes = el => { const out = []; for (const n of el.childNodes) { if (n.nodeType === 3 || n.nodeName === 'BR') out.push(n); else break } return out };
  const readText = el => leadNodes(el).map(n => n.nodeName === 'BR' ? '\n' : n.nodeValue.replace(/\s+/g, ' ')).join('').replace(/ *\n */g, '\n').trim();
  function writeText(el, value) {
    leadNodes(el).forEach(n => n.remove());
    const parts = String(value).split('\n'), frag = document.createDocumentFragment();
    parts.forEach((part, i) => { if (i) frag.append(document.createElement('br')); frag.append(part) });
    if (el.firstChild) frag.append(' ');
    el.prepend(frag);
  }
  let content = { texts: {}, images: {}, plans: {} }, paused = false;
  const basePlans = JSON.parse(JSON.stringify(window.COFFEE_PLANS || []));
  function applyContent(c) {
    if (paused) return;
    content = { texts: c?.texts || {}, images: c?.images || {}, plans: c?.plans || {} };
    const en = window.CoffeeI18n?.lang === 'en';
    document.querySelectorAll('[data-content]').forEach(el => {
      // 中文頁面套用 zh、英文頁面套用 en；該語言沒有修改時保留原本的文字（英文頁維持原本翻譯）。
      const raw = content.texts[el.dataset.content], o = raw && (en ? raw.en : raw.zh) ? raw : null;
      if (el.dataset.contentDefault === undefined) { if (!o) return; el.dataset.contentDefault = readText(el); }
      const value = o ? (en ? o.en : o.zh) : el.dataset.contentDefault;
      if (readText(el) !== value) writeText(el, value);
      if (en && o?.en) el.setAttribute('data-no-translate', ''); else if (el.dataset.contentDefault !== undefined) el.removeAttribute('data-no-translate');
    });
    document.querySelectorAll('[data-content-img]').forEach(el => {
      const o = content.images[el.dataset.contentImg];
      if (el.dataset.contentSrc === undefined) { if (!o) return; el.dataset.contentSrc = el.getAttribute('src'); el.dataset.contentAlt = el.getAttribute('alt') || ''; }
      const src = o && okImage(o.src) ? o.src : el.dataset.contentSrc, alt = (en ? o?.altEn : o?.alt) ?? el.dataset.contentAlt;
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
      if (el.getAttribute('alt') !== alt) el.setAttribute('alt', alt);
    });
    if (window.COFFEE_PLANS) basePlans.forEach((base, i) => {
      const o = content.plans[base.id] || {};
      const name = window.CoffeeI18n?.lang === 'en' ? o.nameEn : o.name, items = window.CoffeeI18n?.lang === 'en' ? o.itemsEn : o.items;
      window.COFFEE_PLANS[i] = { ...base, ...(name ? { name } : {}), ...(Number.isInteger(o.price) && o.price > 0 ? { price: o.price } : {}), ...(Array.isArray(items) && items.length ? { items } : {}) };
    });
  }
  window.CoffeeContent = { image: key => { const o = content.images[key]; return o && okImage(o.src) ? { src: o.src, alt: o.alt || '' } : null } };

  // 圖片壓縮與上傳（後台與頁面編輯模式共用）：長邊縮到 1600px 以內，存到 Supabase Storage 的 images 空間。
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('請選擇 JPG、PNG 或 WebP 圖片');
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1500000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('圖片壓縮失敗')), 'image/webp', 0.85));
  }
  async function uploadImage(client, file) {
    const blob = await shrink(file);
    if (blob.size > 5000000) throw new Error('圖片超過 5MB，請換一張較小的圖片');
    const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
    const path = `uploads/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await client.storage.from('images').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (error) throw new Error(error.message);
    return client.storage.from('images').getPublicUrl(path).data.publicUrl;
  }
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js';
  const loadScript = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('無法載入 ' + src)); document.head.append(s) });
  // 結帳：建立訂單、重新付款與查詢訂單都交給伺服器（Supabase Edge Function checkout），付款在綠界頁面完成。
  async function callCheckout(method, body, query = '') {
    let res;
    try { res = await fetch(CLOUD_URL + '/functions/v1/checkout' + query, { method, headers: { apikey: CLOUD_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }) }
    catch (_) { throw new Error('網路連線失敗，請稍後再試') }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '系統忙碌，請稍後再試');
    return json;
  }
  function goPay(payment) {
    const form = document.createElement('form');
    form.method = 'POST'; form.action = payment.action; form.acceptCharset = 'UTF-8'; form.hidden = true;
    Object.entries(payment.fields).forEach(([name, value]) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input) });
    document.body.append(form);
    form.submit();
  }
  const shared = {
    url: CLOUD_URL, key: CLOUD_KEY, contentCache: CONTENT_CACHE, pause: () => { paused = true }, okImage, readText, writeText, uploadImage, getContent: () => content, setContent: c => { content = c },
    checkout: input => callCheckout('POST', { action: 'create', ...input }),
    repay: (id, token) => callCheckout('POST', { action: 'pay', id, token }),
    orderStatus: (id, token) => callCheckout('GET', null, `?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`),
    paymentMode: () => callCheckout('GET', null, '?config'),
    subscribe: input => callCheckout('POST', { action: 'subscribe', ...input }),
    subscriptionStatus: (id, token) => callCheckout('GET', null, `?sub=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`),
    goPay
  };

  // 前台：讀取雲端商品資料與頁面內容。第一次造訪先隱藏商品區與可編輯內容，避免閃過舊資料；最多等 2.5 秒。
  if (!admin) {
    let cachedContent = '';
    try { cachedContent = localStorage.getItem(CONTENT_CACHE) || '' } catch (_) {}
    if (cachedContent) try { applyContent(JSON.parse(cachedContent)) } catch (_) {}
    if (!seen()) root.classList.add('cloud-loading');
    const done = () => root.classList.remove('cloud-loading');
    setTimeout(done, 2500);
    // 商店頁面的開頭文字由程式繪製，重新繪製後再套用一次頁面內容。
    const storeMain = document.getElementById('store-main');
    if (storeMain) new MutationObserver(() => applyContent(content)).observe(storeMain, { childList: true });
    const ready = fetch(CLOUD_URL + '/rest/v1/site_state?id=in.(main,content)&select=id,data', { headers: { apikey: CLOUD_KEY }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('cloud ' + r.status)))
      .then(rows => {
        const main = rows.find(r => r.id === 'main'), fresh = rows.find(r => r.id === 'content')?.data || {};
        const json = JSON.stringify(fresh);
        if (json !== cachedContent) {
          applyContent(fresh);
          try { localStorage.setItem(CONTENT_CACHE, json) } catch (_) {}
          window.dispatchEvent(new CustomEvent('coffee:content'));
        }
        if (main?.data && S) S.applyCloud(main.data);
        if (main?.data?.settings) applyTheme(main.data.settings.theme);
        const email = main?.data?.settings?.supportEmail;
        if (email && !S) document.querySelectorAll('.support-email').forEach(a => { a.textContent = email; a.href = 'mailto:' + email });
        remember();
      })
      .catch(err => console.warn('雲端資料暫時無法讀取，使用本機資料。', err))
      .finally(done);
    window.CoffeeCloud = shared;
    // 頁面編輯模式（網址加 ?edit=1）：載入登入元件、欄位對照表與編輯器。
    if (new URLSearchParams(location.search).get('edit') === '1') ready.then(() => loadScript(SUPABASE_JS)).then(() => loadScript('assets/content-map.js' + VERSION)).then(() => loadScript('assets/editor.js' + VERSION)).catch(err => alert(err.message));
    return;
  }

  // 後台：登入後才顯示；所有修改自動存回雲端。
  root.classList.add('cloud-locked');
  const sb = window.supabase?.createClient(CLOUD_URL, CLOUD_KEY);
  const gate = document.createElement('div');
  gate.className = 'cloud-gate';
  gate.innerHTML = `<form class="admin-panel" id="cloud-login"><p class="section-kicker">ENCOUNTER OPERATIONS</p><h1>後台登入</h1><p class="muted">請使用在 Supabase 建立的管理員帳號登入。</p><label>電子信箱<input name="email" type="email" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><p id="cloud-login-error" role="alert"></p><button class="primary-button" type="submit">登入</button><a class="admin-back" href="index.html">← 回到首頁</a></form>`;
  document.body.prepend(gate);
  const form = gate.querySelector('form'), loginError = gate.querySelector('#cloud-login-error');
  const status = document.createElement('span');
  status.id = 'cloud-status';
  const logout = document.createElement('button');
  logout.type = 'button'; logout.className = 'cloud-logout'; logout.textContent = '登出';
  document.querySelector('.admin-topbar')?.append(status, logout);
  const setStatus = (text, kind = '') => { status.textContent = t(text); status.dataset.kind = kind };

  // 商品資料與訂單都帶版本號：顧客下單（扣庫存）或綠界付款通知比後台先更新時，後台不會覆蓋，而是重新載入最新資料。
  let synced = '', catalogVersion = 1, unlocked = false, pushing = Promise.resolve(), pending = 0;
  const syncedOrders = new Map(), orderVersions = new Map();
  class Stale extends Error {}
  async function pull() {
    const [{ data: main, error: mainError }, { data: orders, error: ordersError }] = await Promise.all([
      sb.from('site_state').select('data,version').eq('id', 'main').maybeSingle(),
      sb.from('orders').select('id,data,version').order('created_at', { ascending: false }).limit(1000)
    ]);
    if (mainError || ordersError) throw new Error((mainError || ordersError).message);
    // 月費訂閱（只顯示已授權成功的訂閱；取消要透過伺服器通知綠界）
    const { data: subs, error: subsError } = await sb.from('subscriptions').select('data').in('status', ['active', 'cancelled']).order('created_at', { ascending: false }).limit(1000);
    if (!subsError) S.applySubscriptions(subs.map(x => x.data));
    if (main?.data) { S.applyCloud(main.data); catalogVersion = main.version; }
    synced = JSON.stringify(S.cloudCatalog());
    S.applyOrders(orders.map(o => o.data));
    syncedOrders.clear(); orderVersions.clear();
    orders.forEach(o => orderVersions.set(o.id, o.version));
    S.state().orders.forEach(o => { if (orderVersions.has(o.id)) syncedOrders.set(o.id, JSON.stringify(o)) });
    return main;
  }
  async function push() {
    const now = new Date().toISOString();
    // 先存訂單（取消訂單時，寧可少算庫存也不要重複販售），再存商品資料
    for (const o of S.state().orders) {
      const json = JSON.stringify(o);
      if (!orderVersions.has(o.id) || syncedOrders.get(o.id) === json) continue;
      setStatus('同步中…', 'busy');
      const v = orderVersions.get(o.id);
      const { data, error } = await sb.from('orders').update({ data: o, status: o.status, payment: o.payment, version: v + 1, updated_at: now }).eq('id', o.id).eq('version', v).select('version');
      if (error) throw new Error(error.message);
      if (!data.length) throw new Stale(`訂單 ${o.id} 剛被更新（例如收到付款通知），已載入最新資料，請再操作一次`);
      orderVersions.set(o.id, data[0].version); syncedOrders.set(o.id, json);
    }
    const catalog = S.cloudCatalog(), json = JSON.stringify(catalog);
    if (json !== synced) {
      setStatus('同步中…', 'busy');
      const { data, error } = await sb.from('site_state').update({ data: catalog, version: catalogVersion + 1, updated_at: now }).eq('id', 'main').eq('version', catalogVersion).select('version');
      if (error) throw new Error(error.message);
      if (!data.length) throw new Stale('商品資料剛被更新（例如有新訂單扣了庫存），已載入最新資料，請再做一次剛才的修改');
      catalogVersion = data[0].version; synced = json;
    }
    setStatus('已同步雲端', 'ok');
  }
  const queuePush = () => {
    if (!unlocked) return;
    pending++;
    pushing = pushing.then(push).catch(async err => {
      if (err instanceof Stale) { try { await pull(); window.dispatchEvent(new CustomEvent('coffee:cloud')); setStatus('已同步雲端', 'ok') } catch (_) { setStatus('雲端同步失敗', 'error') } toast(err.message); return }
      setStatus('雲端同步失敗', 'error'); toast('雲端同步失敗：' + err.message);
    }).finally(() => pending--);
  };
  window.addEventListener('coffee:change', queuePush);
  window.addEventListener('beforeunload', event => { if (pending) { event.preventDefault(); event.returnValue = '' } });
  // 回到後台分頁時、以及每分鐘，自動載入新訂單與最新庫存
  async function refresh() {
    if (!unlocked || pending || document.hidden || dialogOpen()) return;
    try { const before = JSON.stringify([S.state().orders, S.cloudCatalog()]); await pull(); if (JSON.stringify([S.state().orders, S.cloudCatalog()]) !== before) window.dispatchEvent(new CustomEvent('coffee:cloud')) } catch (_) {}
  }
  const dialogOpen = () => !!document.getElementById('admin-dialog')?.open;
  window.addEventListener('focus', refresh);
  setInterval(refresh, 60000);

  async function enter() {
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error) throw new Error(error.message);
    if (!isAdmin) { await sb.auth.signOut(); throw new Error('此帳號沒有後台權限'); }
    const { data: rows, error: readError } = await sb.from('site_state').select('id,data').in('id', ['main', 'content']);
    if (readError) throw new Error(readError.message);
    applyContent(rows.find(r => r.id === 'content')?.data || {});
    if (!rows.some(r => r.id === 'main')) {
      // 第一次登入：把目前的商品資料建立成雲端資料。
      const { error: insertError } = await sb.from('site_state').insert({ id: 'main', data: S.cloudCatalog() });
      if (insertError) throw new Error(insertError.message);
    }
    await pull();
    remember();
    unlocked = true;
    S.cleanDemoText();
    setStatus('已同步雲端', 'ok');
    root.classList.remove('cloud-locked');
    window.dispatchEvent(new CustomEvent('coffee:cloud'));
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    loginError.textContent = ''; button.disabled = true; button.textContent = t('登入中…');
    try {
      const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
      if (error) throw new Error('電子信箱或密碼不正確');
      form.password.value = '';
      await enter();
    } catch (err) { loginError.textContent = t(err.message) }
    finally { button.disabled = false; button.textContent = t('登入'); }
  });
  logout.addEventListener('click', async () => {
    if (pending && !window.confirm(t('還有資料正在同步，確定要登出嗎？'))) return;
    await sb.auth.signOut();
    unlocked = false; root.classList.add('cloud-locked'); setStatus('');
  });
  if (!sb) loginError.textContent = t('登入元件載入失敗，請檢查網路後重新整理');
  else sb.auth.getSession().then(({ data }) => data.session && enter()).catch(err => { loginError.textContent = t(err.message) });

  // 圖片上傳：在後台每個圖片網址欄位旁加「上傳圖片」，壓縮後存到 Supabase Storage，網址自動填入。
  const upload = file => uploadImage(sb, file);
  function addUploaders(scope) {
    scope.querySelectorAll('input[data-image-src], input[name="image"]').forEach(input => {
      if (input.dataset.uploader) return;
      input.dataset.uploader = '1';
      const picker = document.createElement('input');
      picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; picker.hidden = true;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary-button cloud-upload'; button.textContent = t('上傳圖片');
      button.addEventListener('click', () => picker.click());
      picker.addEventListener('change', async () => {
        const file = picker.files[0]; picker.value = '';
        if (!file) return;
        button.disabled = true; button.textContent = t('上傳中…');
        try {
          const url = await upload(file);
          input.value = url;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const preview = input.closest('.image-editor-row')?.querySelector('img');
          if (preview) preview.src = url;
          toast('圖片已上傳，記得按保存。');
        } catch (err) { toast('圖片上傳失敗：' + err.message) }
        finally { button.disabled = false; button.textContent = t('上傳圖片'); }
      });
      (input.closest('label') || input).after(button, picker);
    });
  }
  const dialog = document.getElementById('admin-dialog');
  if (dialog) new MutationObserver(() => addUploaders(dialog)).observe(dialog, { childList: true, subtree: true });
  // 後台「頁面內容」：讀取各頁原始 HTML 當預設值，只把有改動的欄位存到雲端（site_state id = content）。
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pageDefaults = {};
  async function defaultsFor(page) {
    if (pageDefaults[page]) return pageDefaults[page];
    const html = await fetch(page, { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(new Error('無法讀取 ' + page)));
    const doc = new DOMParser().parseFromString(html, 'text/html'), out = {};
    doc.querySelectorAll('[data-content]').forEach(el => out[el.dataset.content] = readText(el));
    doc.querySelectorAll('[data-content-img]').forEach(el => out[el.dataset.contentImg] = { src: el.getAttribute('src'), alt: el.getAttribute('alt') || '' });
    return pageDefaults[page] = out;
  }
  let contentTab = 'site';
  async function saveContent(next) {
    const { error } = await sb.from('site_state').upsert({ id: 'content', data: next, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    applyContent(next);
  }
  async function renderContent(main) {
    const map = window.COFFEE_CONTENT_MAP || [], tabs = [...map.map(p => [p.id, p.name]), ['plans', '月費方案']];
    const tabBar = `<div class="content-tabs" role="tablist">${tabs.map(([id, name]) => `<button type="button" class="${id === contentTab ? 'primary-button' : 'secondary-button'}" data-content-tab="${esc(id)}" aria-pressed="${id === contentTab}">${esc(name)}</button>`).join('')}</div>`;
    const head = `<div class="admin-heading"><div><p class="section-kicker">ENCOUNTER OPERATIONS</p><h1>頁面內容</h1><p>修改頁首頁尾、首頁、商店頁面、品牌故事、關於我們與月費方案的文字和圖片。按「儲存」後客人重新整理頁面就會看到。</p></div></div>`;
    main.innerHTML = head + tabBar + '<div class="admin-panel" data-no-translate><p>載入中…</p></div>';
    main.querySelectorAll('[data-content-tab]').forEach(b => b.onclick = () => { contentTab = b.dataset.contentTab; renderContent(main) });
    const panel = main.querySelector('.admin-panel');
    try {
      if (contentTab === 'plans') {
        panel.innerHTML = `<form id="content-form"><p class="muted">修改方案名稱、每期價格與內容（每行一項）。已訂閱的顧客維持訂閱當時的價格。英文欄位留空時，英文頁面維持目前的英文。</p>${basePlans.map(base => { const p = window.COFFEE_PLANS.find(x => x.id === base.id) || base; const o = content.plans[base.id] || {}; return `<fieldset class="content-item"><legend>${esc(base.mark)}・${esc(base.name)}</legend><label>方案名稱<input name="${esc(base.id)}.name" value="${esc(p.name)}" maxlength="30" required></label><label>每期價格（NT$）<input name="${esc(base.id)}.price" type="number" min="1" max="100000" step="1" value="${p.price}" required></label><label>方案內容（每行一項）<textarea name="${esc(base.id)}.items" rows="4" maxlength="400" required>${esc(p.items.join('\n'))}</textarea></label><label>英文方案名稱（選填）<input name="${esc(base.id)}.nameEn" value="${esc(o.nameEn || '')}" maxlength="40" placeholder="${esc(window.COFFEE_EN?.[base.name] || '')}"></label><label>英文方案內容（每行一項，選填）<textarea name="${esc(base.id)}.itemsEn" rows="3" maxlength="500">${esc((o.itemsEn || []).join('\n'))}</textarea></label></fieldset>` }).join('')}<div class="admin-actions"><button class="primary-button" type="submit">儲存月費方案</button></div></form>`;
        panel.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          const f = event.target, plans = {};
          for (const base of basePlans) {
            const name = f[base.id + '.name'].value.trim(), price = Number(f[base.id + '.price'].value), items = f[base.id + '.items'].value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
            if (!name || !Number.isInteger(price) || price < 1 || price > 100000 || !items.length) return toast('請完整填寫每個方案的名稱、價格與內容');
            const o = {};
            if (name !== base.name) o.name = name;
            if (price !== base.price) o.price = price;
            if (items.join('\n') !== base.items.join('\n')) o.items = items;
            const nameEn = f[base.id + '.nameEn'].value.trim(), itemsEn = f[base.id + '.itemsEn'].value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
            if (nameEn) o.nameEn = nameEn;
            if (itemsEn.length) o.itemsEn = itemsEn;
            if (Object.keys(o).length) plans[base.id] = o;
          }
          await submitContent(f, { ...content, plans });
        };
        return;
      }
      const page = map.find(p => p.id === contentTab) || map[0], defaults = Object.assign({}, ...(await Promise.all(page.sources.map(defaultsFor))));
      const defText = key => defaults[key] ?? page.groups.flatMap(g => g.items).find(i => i[0] === key)?.[2] ?? '';
      const item = ([key, label, defSrc, defAlt]) => {
        const isImage = key.includes('.img');
        if (isImage) {
          const def = defaults[key] || { src: defSrc, alt: defAlt || '' }, o = content.images[key], cur = o || def;
          return `<div class="content-item content-image" data-key="${esc(key)}" data-kind="img"><img src="${esc(cur.src)}" alt=""><div><strong>${esc(label)}</strong>${o ? '<span class="content-changed">已修改</span>' : ''}<label>圖片網址<input name="image" data-field="src" value="${esc(cur.src)}" required></label><label>圖片說明（給看不到圖的人與搜尋引擎）<input data-field="alt" value="${esc(o?.alt ?? def.alt)}" maxlength="120"></label><label>英文圖片說明（選填）<input data-field="altEn" value="${esc(o?.altEn || '')}" maxlength="160"></label>${o ? '<button type="button" class="text-button" data-reset>還原預設</button>' : ''}</div></div>`;
        }
        const def = defText(key), o = content.texts[key], zh = o?.zh ?? def, rows = Math.min(8, Math.max(2, Math.ceil(zh.length / 38) + zh.split('\n').length - 1));
        return `<div class="content-item" data-key="${esc(key)}" data-kind="txt"><strong>${esc(label)}</strong>${o ? '<span class="content-changed">已修改</span>' : ''}<label>中文<textarea data-field="zh" rows="${rows}" maxlength="1000" required>${esc(zh)}</textarea></label><label>英文版（選填；留空時英文頁面維持原本的英文，也可以到英文頁面上直接修改）<textarea data-field="en" rows="2" maxlength="1500">${esc(o?.en || '')}</textarea></label>${o ? '<button type="button" class="text-button" data-reset>還原預設</button>' : ''}</div>`;
      };
      panel.innerHTML = `<div class="content-live">${(page.edit || [[page.id, page.name]]).map(([href, name]) => `<a class="primary-button" href="${esc(href)}?edit=1">✎ 在頁面上編輯「${esc(name)}」</a><a class="secondary-button" href="${esc(href)}?lang=en&amp;edit=1">✎ 英文頁面「${esc(name)}」</a>`).join('')}<span>${page.note ? esc(page.note) + ' ' : ''}直接在網頁上點文字修改、點 📷 更換圖片，最直覺；在英文頁面上修改的就是英文版。</span></div><form id="content-form"><p class="muted">換行會照樣顯示在網頁上。圖片可直接「上傳圖片」，建議橫式照片、寬度 1600px 左右。</p>${page.groups.map(g => `<h2 class="content-group">${esc(g.title)}</h2>${g.items.map(item).join('')}`).join('')}<div class="admin-actions content-save"><button class="primary-button" type="submit">儲存「${esc(page.name)}」</button></div></form>`;
      addUploaders(panel);
      panel.querySelectorAll('.content-image input[data-field=src]').forEach(input => input.addEventListener('input', () => { if (okImage(input.value.trim())) input.closest('.content-item').querySelector('img').src = input.value.trim() }));
      panel.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
        const key = b.closest('[data-key]').dataset.key, next = { texts: { ...content.texts }, images: { ...content.images }, plans: content.plans };
        delete next.texts[key]; delete next.images[key];
        await submitContent(panel.querySelector('form'), next);
      });
      panel.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const next = { texts: { ...content.texts }, images: { ...content.images }, plans: content.plans };
        for (const box of panel.querySelectorAll('[data-key]')) {
          const key = box.dataset.key, get = f => box.querySelector(`[data-field=${f}]`).value.trim();
          if (box.dataset.kind === 'img') {
            const src = get('src'), alt = get('alt'), altEn = get('altEn'), def = defaults[key] || page.groups.flatMap(g => g.items).filter(i => i[0] === key).map(i => ({ src: i[2], alt: i[3] || '' }))[0];
            if (!okImage(src)) return toast('圖片網址需為 https:// 開頭，或使用「上傳圖片」');
            const entry = { src, ...(alt !== def.alt ? { alt } : {}), ...(altEn ? { altEn } : {}) };
            if (src === def.src && Object.keys(entry).length === 1) delete next.images[key]; else next.images[key] = entry;
          } else {
            const zh = get('zh').replace(/\r/g, ''), en = get('en').replace(/\r/g, '');
            if (!zh) return toast('文字不能空白；想恢復原文請按「還原預設」');
            const entry = { ...(zh !== defText(key) ? { zh } : {}), ...(en ? { en } : {}) };
            if (Object.keys(entry).length) next.texts[key] = entry; else delete next.texts[key];
          }
        }
        await submitContent(event.target, next);
      };
    } catch (err) { panel.innerHTML = `<p>${esc(err.message)}</p>` }
  }
  async function submitContent(form, next) {
    const button = form.querySelector('[type=submit]');
    if (button) { button.disabled = true; }
    try { setStatus('同步中…', 'busy'); await saveContent(next); setStatus('已同步雲端', 'ok'); toast('已儲存，客人重新整理頁面就會看到。'); renderContent(document.getElementById('admin-main')); }
    catch (err) { setStatus('雲端同步失敗', 'error'); toast('儲存失敗：' + err.message); if (button) button.disabled = false; }
  }
  async function cancelSubscription(id) {
    const { data } = await sb.auth.getSession();
    const res = await fetch(CLOUD_URL + '/functions/v1/checkout', { method: 'POST', headers: { apikey: CLOUD_KEY, Authorization: 'Bearer ' + (data.session?.access_token || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-subscription', id }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '取消失敗，請稍後再試');
    await pull(); window.dispatchEvent(new CustomEvent('coffee:cloud'));
    return json;
  }
  window.CoffeeCloud = { ...shared, client: sb, renderContent, cancelSubscription };
})();
