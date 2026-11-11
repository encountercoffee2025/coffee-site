(() => {
  'use strict';
  // 頁面編輯模式：管理員在真正的網頁上點文字直接修改、點相機按鈕更換圖片，按「儲存」寫回雲端（site_state id = content）。
  const C = window.CoffeeCloud, root = document.documentElement;
  const sb = window.supabase.createClient(C.url, C.key);
  const map = window.COFFEE_CONTENT_MAP || [];
  const items = Object.fromEntries(map.flatMap(p => p.groups.flatMap(g => g.items.map(([key, label, src, alt]) => [key, { label: g.title.replace(/（.*）/, '') + '・' + label, src, alt }]))));
  // 中文頁面修改的是中文版（zh），英文頁面修改的是英文版（en）；圖片兩種語言共用，圖片說明各自保存（alt / altEn）。
  const en = window.CoffeeI18n?.lang === 'en', lang = en ? 'en' : 'zh', altKey = en ? 'altEn' : 'alt', modeName = en ? '✎ 編輯模式・英文頁面' : '✎ 編輯模式';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `
.ce-text{white-space:pre-wrap;outline:1px dashed rgba(176,122,52,.75);outline-offset:3px;border-radius:2px;cursor:text;min-width:1em;display:inline}
.ce-text:hover{outline-style:solid;background:rgba(255,236,196,.18)}
.ce-text:focus{outline:2px solid #b07a34;background:rgba(255,236,196,.28)}
.ce-text.ce-changed{outline-color:#3f6b48}
.ce-text.ce-invalid{outline:2px solid #c0392b}
.ce-ui,.ce-ui *{box-sizing:border-box;font-family:"Noto Sans TC","Inter",system-ui,sans-serif;letter-spacing:0;text-transform:none}
.ce-layer{position:fixed;inset:0;pointer-events:none;z-index:9998}
.ce-photo{position:absolute;pointer-events:auto;display:flex;align-items:center;gap:6px;padding:7px 12px;border:0;border-radius:999px;background:rgba(30,26,22,.86);color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
.ce-photo:hover,.ce-photo:focus-visible{background:#b07a34;outline:none}
.ce-photo.ce-changed{background:#3f6b48}
.ce-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:#1e1a16;color:#f6efe3;font-size:14px;box-shadow:0 -4px 18px rgba(0,0,0,.2)}
.ce-bar strong{font-weight:600}
.ce-bar .ce-count{opacity:.8;font-size:13px}
.ce-bar .ce-actions{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
.ce-btn{border:1px solid rgba(246,239,227,.45);background:transparent;color:inherit;padding:8px 14px;font-size:14px;cursor:pointer;border-radius:4px;text-decoration:none;line-height:1.2}
.ce-btn:disabled{opacity:.45;cursor:default}
.ce-btn.ce-primary{background:#b07a34;border-color:#b07a34;color:#fff;font-weight:600}
.ce-dialog{position:fixed;z-index:10000;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#292d29;padding:20px;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:grid;gap:12px;font-size:14px}
.ce-dialog h2{margin:0;font-size:17px}
.ce-dialog img{width:100%;max-height:220px;object-fit:cover;background:#eee6d4;border-radius:4px}
.ce-dialog label{display:grid;gap:4px;font-size:12px;color:#5e594b}
.ce-dialog input[type=text]{width:100%;padding:9px 10px;border:1px solid #d9ddd4;font-size:14px;color:#292d29;background:#fff}
.ce-dialog .ce-row{display:flex;gap:8px;flex-wrap:wrap}
.ce-dialog .ce-btn{border-color:#d9ddd4;color:#292d29}
.ce-dialog .ce-btn.ce-primary{color:#fff}
.ce-dim{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35)}
.ce-toast{position:fixed;z-index:10001;left:50%;top:16px;transform:translateX(-50%);background:#292d29;color:#fff;padding:10px 16px;border-radius:6px;font-size:14px;max-width:calc(100vw - 32px)}
.ce-text.ce-current{outline:2px solid #b07a34}
.ce-style{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding-bottom:8px;border-bottom:1px solid rgba(246,239,227,.18);font-size:13px}
.ce-style[hidden]{display:none}
.ce-style .ce-name{flex:1 1 100%;opacity:.8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ce-style .ce-field{display:flex;align-items:center;gap:5px}
.ce-style output{min-width:3.4em;text-align:center}
.ce-style .ce-btn{padding:4px 9px}
.ce-style input[type=number],.ce-style select{width:4.6em;padding:4px 6px;border:1px solid rgba(246,239,227,.45);border-radius:4px;background:#2c2620;color:#f6efe3;font-size:13px}
.ce-style input[type=color]{width:34px;height:28px;padding:1px;border:1px solid rgba(246,239,227,.45);border-radius:4px;background:#2c2620;cursor:pointer}
body.ce-editing{padding-bottom:150px}
@media (max-width:640px){.ce-bar{padding:8px 10px calc(8px + env(safe-area-inset-bottom));gap:6px;font-size:13px}.ce-bar>strong{display:none}.ce-bar .ce-actions{margin-left:0;width:100%;flex-wrap:nowrap;justify-content:space-between}.ce-btn{padding:7px 9px;font-size:13px}.ce-photo{font-size:12px;padding:6px 10px}}`;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'ce-bar ce-ui';
  bar.setAttribute('data-no-translate', '');
  document.body.append(bar);
  const toast = message => {
    let n = document.querySelector('.ce-toast');
    if (!n) { n = document.createElement('div'); n.className = 'ce-toast ce-ui'; n.setAttribute('role', 'status'); n.setAttribute('data-no-translate', ''); document.body.append(n); }
    n.textContent = message; n.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => n.hidden = true, 5000);
  };
  const stop = html => { bar.innerHTML = html; };

  stop(`<strong>${modeName}</strong><span class="ce-count">確認登入中…</span>`);

  sb.auth.getSession().then(async ({ data }) => {
    const leave = new URL(location.href); leave.searchParams.delete('edit');
    if (!data.session) return stop(`<strong>請先登入後台</strong><span class="ce-count">登入後再回到這一頁就能編輯。</span><div class="ce-actions"><a class="ce-btn" href="${esc(leave.pathname + leave.search)}">離開編輯模式</a><a class="ce-btn ce-primary" href="admin-orders.html#content">前往後台登入</a></div>`);
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error || !isAdmin) return stop(`<strong>此帳號沒有編輯權限，或尚未完成兩步驟驗證</strong><div class="ce-actions"><a class="ce-btn ce-primary" href="admin-orders.html#content">前往後台登入</a><a class="ce-btn" href="${esc(leave.pathname + leave.search)}">離開編輯模式</a></div>`);
    // 讀取最新內容，避免覆蓋其他裝置剛儲存的修改。
    const { data: row, error: readError } = await sb.from('site_state').select('data').eq('id', 'content').maybeSingle();
    if (readError) return stop(`<strong>無法讀取頁面內容</strong><span class="ce-count">${esc(readError.message)}</span>`);
    start(row?.data || {}, leave.pathname + leave.search);
  }).catch(err => stop(`<strong>無法進入編輯模式</strong><span class="ce-count">${esc(err.message)}</span>`));

  function start(saved, leaveHref) {
    const content = { texts: { ...(saved.texts || {}) }, images: { ...(saved.images || {}) }, plans: saved.plans || {} };
    C.pause(); C.setContent(content);
    document.body.classList.add('ce-editing');

    // 停止首頁輪播，打開常見問題，並讓連結、摺疊與表單在編輯時不作用。
    let motionWas = null;
    try { motionWas = localStorage.getItem('pure-select-motion') } catch (_) {}
    if (root.dataset.motion !== 'paused') document.getElementById('motion-toggle')?.click();
    window.addEventListener('pagehide', () => { try { if (motionWas === null) localStorage.removeItem('pure-select-motion'); else localStorage.setItem('pure-select-motion', motionWas) } catch (_) {} });
    document.querySelectorAll('details').forEach(d => d.open = true);
    document.addEventListener('click', event => { if (!event.target.closest('.ce-ui') && event.target.closest('a[href], summary')) event.preventDefault() }, true);
    // 表單欄位名稱（姓名、電子信箱…）在 label 裡：點文字時留在文字上，不要跳到輸入框。
    document.addEventListener('click', event => { if (event.target.closest('.ce-text') && event.target.closest('label')) event.preventDefault() }, true);
    document.addEventListener('submit',event => { if (!event.target.closest('.ce-ui')) event.preventDefault() }, true);

    // 文字：把元素開頭的文字包成可編輯區塊；後面的箭頭等子元素保留。
    const plain = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' })();
    const texts = [...document.querySelectorAll('[data-content]')].map(el => {
      const key = el.dataset.content, def = el.dataset.contentDefault ?? C.readText(el), value = C.readText(el);
      const lead = []; for (const n of el.childNodes) { if (n.nodeType === 3 || n.nodeName === 'BR') lead.push(n); else break }
      const span = document.createElement('span');
      span.className = 'ce-text'; span.contentEditable = plain ? 'plaintext-only' : 'true'; span.spellcheck = false;
      span.title = (items[key]?.label || key) + (en ? '（英文版，點一下直接修改）' : '（點一下直接修改）');
      if (en) span.setAttribute('data-no-translate', '');
      value.split('\n').forEach((part, i) => { if (i) span.append(document.createElement('br')); span.append(part) });
      lead.forEach(n => n.remove());
      el.prepend(span);
      if (span.nextSibling && span.nextSibling.nodeType === 1) span.after(' ');
      if (!plain) span.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')) });
      span.addEventListener('keydown', event => { if (event.key === 'Enter' && !plain) { event.preventDefault(); document.execCommand('insertLineBreak') } event.stopPropagation() });
      span.addEventListener('keyup', event => event.stopPropagation());
      span.addEventListener('input', refresh);
      const style = C.cleanStyle(content.texts[key]?.[lang + 'Style']);
      C.applyStyle(el, style);
      const t = { key, el, span, def, saved: value, style, savedStyle: JSON.stringify(style) };
      span.addEventListener('focus', () => pick(t));
      return t;
    });
    const styleChanged = t => JSON.stringify(t.style) !== t.savedStyle;
    // 直接讀取文字與換行（不用 innerText）：手機版會隱藏部分換行，用 innerText 會被誤判成修改。
    const flat = n => [...n.childNodes].map(c => c.nodeType === 3 ? c.nodeValue : c.nodeName === 'BR' ? '\n' : (/^(DIV|P)$/.test(c.nodeName) ? '\n' : '') + flat(c)).join('');
    const read = span => flat(span).replace(/ /g, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    // 圖片：在每張可編輯圖片左上角放「更換圖片」按鈕。挑豆工藝的圖片會跟著目前選取的步驟切換。
    const layer = document.createElement('div');
    layer.className = 'ce-layer ce-ui';
    layer.setAttribute('data-no-translate', '');
    document.body.append(layer);
    const processKey = () => { const buttons = [...document.querySelectorAll('[data-process]')], n = buttons.findIndex(b => b.getAttribute('aria-pressed') === 'true'); return 'home.process.img' + ((n < 0 ? 0 : n) + 1) };
    const images = [...document.querySelectorAll('[data-content-img]')].map(img => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ce-photo';
      layer.append(button);
      const entry = { img, button, baseKey: img.dataset.contentImg, defSrc: img.dataset.contentSrc ?? img.getAttribute('src'), defAlt: img.dataset.contentAlt ?? (img.getAttribute('alt') || '') };
      button.addEventListener('click', () => openImage(entry));
      return entry;
    });
    const keyOf = entry => entry.baseKey === 'home.process.img1' ? processKey() : entry.baseKey;
    const defaultOf = (entry, key) => key === entry.baseKey ? { src: entry.defSrc, alt: entry.defAlt } : { src: items[key]?.src || entry.defSrc, alt: items[key]?.alt || '' };
    function place() {
      const headerBottom = Math.max(0, document.querySelector('.site-header, .shop-nav, header')?.getBoundingClientRect().bottom || 0);
      for (const entry of images) {
        const r = entry.img.getBoundingClientRect(), cs = getComputedStyle(entry.img), key = keyOf(entry);
        const visible = r.width > 40 && r.height > 30 && r.bottom > headerBottom + 50 && r.top < innerHeight - 70 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1;
        entry.button.hidden = !visible;
        if (!visible) continue;
        const label = '📷 更換' + (items[key]?.label || '圖片');
        if (entry.button.textContent !== label) entry.button.textContent = label;
        entry.button.classList.toggle('ce-changed', JSON.stringify(content.images[key] || null) !== JSON.stringify(JSON.parse(baseline)[key] || null));
        entry.button.style.left = Math.max(8, r.left + 12) + 'px';
        entry.button.style.top = Math.max(r.top + 12, headerBottom + 8) + 'px';
      }
      requestAnimationFrame(place);
    }
    requestAnimationFrame(place);

    function openImage(entry) {
      const key = keyOf(entry), def = defaultOf(entry, key), saved = content.images[key], cur = { src: saved?.src ?? def.src, alt: saved?.[altKey] ?? def.alt };
      const dim = document.createElement('div'); dim.className = 'ce-dim ce-ui';
      const box = document.createElement('div'); box.className = 'ce-dialog ce-ui'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('data-no-translate', '');
      box.innerHTML = `<h2>${esc(items[key]?.label || '圖片')}</h2><img src="${esc(cur.src)}" alt=""><div class="ce-row"><button type="button" class="ce-btn ce-primary" data-upload>上傳新圖片</button>${content.images[key] ? '<button type="button" class="ce-btn" data-reset>還原預設圖片</button>' : ''}</div><input type="file" accept="image/jpeg,image/png,image/webp" hidden><label>${en ? '英文圖片說明' : '圖片說明'}（給看不到圖的人與搜尋引擎，可留空）${en ? '<br>圖片本身中英文頁面共用' : ''}<input type="text" maxlength="120" value="${esc(cur.alt)}"></label><div class="ce-row"><button type="button" class="ce-btn ce-primary" data-done>完成</button></div>`;
      document.body.append(dim, box);
      const preview = box.querySelector('img'), file = box.querySelector('[type=file]'), alt = box.querySelector('[type=text]');
      let src = cur.src;
      const close = () => { dim.remove(); box.remove(); entry.button.focus() };
      dim.onclick = close;
      box.addEventListener('keydown', e => { if (e.key === 'Escape') close() });
      box.querySelector('[data-upload]').onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files[0]; file.value = ''; if (!f) return;
        const up = box.querySelector('[data-upload]'); up.disabled = true; up.textContent = '上傳中…';
        try { src = await C.uploadImage(sb, f); preview.src = src; toast('圖片已上傳，按「完成」套用到頁面。') }
        catch (err) { toast('圖片上傳失敗：' + err.message) }
        finally { up.disabled = false; up.textContent = '上傳新圖片' }
      };
      const reset = box.querySelector('[data-reset]');
      if (reset) reset.onclick = () => { delete content.images[key]; entry.img.setAttribute('src', def.src); entry.img.setAttribute('alt', def.alt); refresh(); close() };
      box.querySelector('[data-done]').onclick = () => {
        const a = alt.value.trim();
        const next = { ...(content.images[key] || {}), src };
        if (a === def.alt) delete next[altKey]; else next[altKey] = a;
        if (src === def.src && next.alt === undefined && next.altEn === undefined) delete content.images[key]; else content.images[key] = next;
        entry.img.setAttribute('src', src); entry.img.setAttribute('alt', a);
        refresh(); close();
      };
      box.querySelector('[data-upload]').focus();
    }

    // 工具列：顯示修改數量、儲存、放棄與離開。
    bar.innerHTML = `<div class="ce-style" hidden><span class="ce-name"></span><span class="ce-field">字級<button type="button" class="ce-btn" data-size="-10" aria-label="縮小字">A−</button><output data-size-out>100%</output><button type="button" class="ce-btn" data-size="10" aria-label="放大字">A+</button></span><label class="ce-field">顏色<input type="color" data-color></label><label class="ce-field">每行最多<input type="number" min="4" max="80" step="1" placeholder="自動" data-width>字</label><label class="ce-field">行距<select data-lh><option value="">自動</option>${[1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.6].map(v => `<option value="${v}">${v}</option>`).join('')}</select></label><button type="button" class="ce-btn" data-style-reset>還原樣式</button></div><strong>${modeName}</strong><span class="ce-count"></span><div class="ce-actions"><a class="ce-btn" href="admin-orders.html#content" data-leave>回到後台</a><a class="ce-btn" href="${esc(leaveHref)}" data-leave>離開編輯</a>${en ? '<button type="button" class="ce-btn" data-translate>依中文自動翻譯</button>' : ''}<button type="button" class="ce-btn" data-discard>放棄修改</button><button type="button" class="ce-btn ce-primary" data-save>儲存</button></div>`;
    const count = bar.querySelector('.ce-count'), saveButton = bar.querySelector('[data-save]'), discard = bar.querySelector('[data-discard]');
    // 文字樣式：點一段文字後，工具列上方出現字級、顏色、每行字數與行距；只影響目前這個語言的頁面。
    const panel = bar.querySelector('.ce-style'), sizeOut = panel.querySelector('[data-size-out]'), colorIn = panel.querySelector('[data-color]'), widthIn = panel.querySelector('[data-width]'), lhIn = panel.querySelector('[data-lh]');
    let current = null;
    const toHex = c => { const m = c.match(/\d+(\.\d+)?/g); return m ? '#' + m.slice(0, 3).map(v => Math.round(+v).toString(16).padStart(2, '0')).join('') : '#000000' };
    function showStyle() {
      const s = current.style;
      sizeOut.textContent = (s.size || 100) + '%';
      colorIn.value = s.color || toHex(getComputedStyle(current.el).color);
      widthIn.value = s.width ?? '';
      lhIn.value = s.lh ? String(s.lh) : '';
    }
    function pick(t) {
      if (current) current.span.classList.remove('ce-current');
      current = t; t.span.classList.add('ce-current');
      panel.hidden = false;
      panel.querySelector('.ce-name').textContent = '目前選取：' + (items[t.key]?.label || t.key) + (en ? '（英文頁面）' : '');
      showStyle();
    }
    function setStyle(change) {
      if (!current) return;
      current.style = C.cleanStyle({ ...current.style, ...change });
      C.applyStyle(current.el, current.style);
      showStyle(); refresh();
    }
    panel.addEventListener('keydown', event => event.stopPropagation());
    panel.querySelectorAll('[data-size]').forEach(b => b.onclick = () => setStyle({ size: Math.min(300, Math.max(50, (current?.style.size || 100) + Number(b.dataset.size))) }));
    colorIn.addEventListener('input', () => setStyle({ color: colorIn.value }));
    widthIn.addEventListener('change', () => { const v = widthIn.value.trim(); if (v !== '' && !C.cleanStyle({ width: Number(v) }).width) { toast('每行字數請填 4 到 80 之間的整數，留空是自動'); return showStyle() } setStyle({ width: v === '' ? undefined : Number(v) }) });
    lhIn.addEventListener('change', () => setStyle({ lh: lhIn.value === '' ? undefined : Number(lhIn.value) }));
    panel.querySelector('[data-style-reset]').onclick = () => setStyle({ size: undefined, color: undefined, width: undefined, lh: undefined });

    let baseline = JSON.stringify(content.images), leaving = false;
    const dirty = () => texts.filter(t => read(t.span) !== t.saved || styleChanged(t)).length + Object.keys({ ...JSON.parse(baseline), ...content.images }).filter(k => JSON.stringify(JSON.parse(baseline)[k] || null) !== JSON.stringify(content.images[k] || null)).length;
    function refresh() {
      texts.forEach(t => { const v = read(t.span); t.span.classList.toggle('ce-changed', v !== t.saved || styleChanged(t)); if (v) t.span.classList.remove('ce-invalid') });
      const n = dirty();
      count.textContent = n ? `已修改 ${n} 處，記得按「儲存」` : '點文字直接修改（可調字級、顏色、每行字數）；點 📷 更換圖片';
      saveButton.disabled = !n; discard.disabled = !n;
    }
    refresh();
    window.addEventListener('beforeunload', event => { if (!leaving && dirty()) { event.preventDefault(); event.returnValue = '' } });
    bar.querySelectorAll('[data-leave]').forEach(a => a.addEventListener('click', event => { if (dirty() && !confirm('還有修改沒有儲存，確定要離開嗎？')) event.preventDefault(); else leaving = true }));
    discard.onclick = () => { if (confirm('放棄這次所有還沒儲存的修改？')) { leaving = true; location.reload() } };

    // 英文頁面：把中文改過的段落交給伺服器翻譯，填進頁面上的英文文字，確認後再按「儲存」。
    const translateBtn = bar.querySelector('[data-translate]');
    if (translateBtn) {
      const sources = () => texts.filter(t => content.texts[t.key]?.zh);
      translateBtn.title = '把中文頁面改過的文字翻成英文';
      translateBtn.onclick = async () => {
        const list = sources();
        if (!list.length) return toast('中文頁面沒有改過的文字；沒改過的段落已經有內建英文。');
        if (!confirm(`要把中文改過的 ${list.length} 段文字翻成英文，並取代目前的英文嗎？翻譯後請檢查，再按「儲存」。`)) return;
        translateBtn.disabled = true; translateBtn.textContent = '翻譯中…';
        try {
          const result = await C.translate(list.map(t => ({ id: t.key, zh: content.texts[t.key].zh, kind: 'text' })), sb);
          let n = 0;
          for (const t of list) {
            const value = result[t.key]; if (!value) continue;
            t.span.textContent = '';
            value.split('\n').forEach((part, i) => { if (i) t.span.append(document.createElement('br')); t.span.append(part) });
            n++;
          }
          refresh();
          toast(n ? `已翻譯 ${n} 段，請檢查後按「儲存」。` : '沒有取得翻譯結果，請再試一次。');
        } catch (err) { toast('自動翻譯失敗：' + err.message) }
        finally { translateBtn.disabled = false; translateBtn.textContent = '依中文自動翻譯' }
      };
    }

    saveButton.onclick = async () => {
      const empty = texts.filter(t => !read(t.span));
      if (empty.length) { empty.forEach(t => t.span.classList.add('ce-invalid')); empty[0].span.focus(); return toast('文字不能空白；想恢復原文，請到後台「頁面內容」按「還原預設」') }
      const next = { texts: { ...content.texts }, images: { ...content.images }, plans: content.plans };
      for (const t of texts) {
        const value = read(t.span);
        if (value === t.saved && !styleChanged(t)) continue;
        const entry = { ...(content.texts[t.key] || {}) };
        if (value === t.def) delete entry[lang]; else entry[lang] = value;
        if (Object.keys(t.style).length) entry[lang + 'Style'] = t.style; else delete entry[lang + 'Style'];
        if (['zh', 'en', 'zhStyle', 'enStyle'].every(f => entry[f] === undefined)) delete next.texts[t.key]; else next.texts[t.key] = entry;
      }
      saveButton.disabled = true; saveButton.textContent = '儲存中…';
      try {
        const { error } = await sb.from('site_state').upsert({ id: 'content', data: next, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        content.texts = next.texts;
        texts.forEach(t => { t.saved = read(t.span); t.savedStyle = JSON.stringify(t.style) });
        baseline = JSON.stringify(content.images);
        try { localStorage.setItem(C.contentCache, JSON.stringify(next)) } catch (_) {}
        toast('已儲存，客人重新整理頁面就會看到。');
      } catch (err) { toast('儲存失敗：' + err.message) }
      finally { saveButton.textContent = '儲存'; refresh() }
    };
  }
})();
