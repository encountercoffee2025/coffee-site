(() => {
  'use strict';
  // Supabase 公開設定：網址與 publishable key 本來就會出現在前端，資料安全由資料庫權限規則（RLS）保護。
  const CLOUD_URL = 'https://pdnhryhdiknoterpasua.supabase.co';
  const CLOUD_KEY = 'sb_publishable_Uy_QgC-eiPTkVACNxMk5Fg_vYOYslMz';
  const MARK = 'encounter-cloud-at';
  const S = window.CoffeeStore, root = document.documentElement;
  const admin = document.body.dataset.page === 'admin';
  const t = s => window.CoffeeI18n?.translate(s) ?? s;
  const remember = () => { try { localStorage.setItem(MARK, new Date().toISOString()) } catch (_) {} };
  const seen = () => { try { return !!localStorage.getItem(MARK) } catch (_) { return false } };
  const toast = message => { const n = document.getElementById('app-toast'); if (!n) return; n.textContent = t(message); n.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => n.hidden = true, 6000) };

  // 前台：讀取雲端商品資料。第一次造訪先隱藏商品區，避免閃過舊資料；最多等 2.5 秒。
  if (!admin) {
    if (!seen()) root.classList.add('cloud-loading');
    const done = () => root.classList.remove('cloud-loading');
    setTimeout(done, 2500);
    fetch(CLOUD_URL + '/rest/v1/site_state?id=eq.main&select=data', { headers: { apikey: CLOUD_KEY }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('cloud ' + r.status)))
      .then(([row]) => { if (row?.data) { S.applyCloud(row.data); remember() } })
      .catch(err => console.warn('雲端資料暫時無法讀取，使用本機資料。', err))
      .finally(done);
    window.CoffeeCloud = { url: CLOUD_URL };
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

  let synced = '', unlocked = false, pushing = Promise.resolve(), pending = 0;
  async function push() {
    const catalog = S.cloudCatalog(), json = JSON.stringify(catalog);
    if (json === synced) return;
    setStatus('同步中…', 'busy');
    const { data, error } = await sb.from('site_state').update({ data: catalog, updated_at: new Date().toISOString() }).eq('id', 'main').select('id');
    if (error || !data?.length) throw new Error(error?.message || '沒有寫入權限，請重新登入');
    synced = json;
    setStatus('已同步雲端', 'ok');
  }
  const queuePush = () => {
    if (!unlocked) return;
    pending++;
    pushing = pushing.then(push).catch(err => { setStatus('雲端同步失敗', 'error'); toast('雲端同步失敗：' + err.message) }).finally(() => pending--);
  };
  window.addEventListener('coffee:change', queuePush);
  window.addEventListener('beforeunload', event => { if (pending) { event.preventDefault(); event.returnValue = '' } });

  async function enter() {
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error) throw new Error(error.message);
    if (!isAdmin) { await sb.auth.signOut(); throw new Error('此帳號沒有後台權限'); }
    const { data: row, error: readError } = await sb.from('site_state').select('data').eq('id', 'main').maybeSingle();
    if (readError) throw new Error(readError.message);
    if (row?.data) S.applyCloud(row.data);
    else {
      // 第一次登入：把目前的商品資料建立成雲端資料。
      const { error: insertError } = await sb.from('site_state').insert({ id: 'main', data: S.cloudCatalog() });
      if (insertError) throw new Error(insertError.message);
    }
    synced = JSON.stringify(S.cloudCatalog());
    remember();
    unlocked = true;
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
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('請選擇 JPG、PNG 或 WebP 圖片');
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1500000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('圖片壓縮失敗')), 'image/webp', 0.85));
  }
  async function upload(file) {
    const blob = await shrink(file);
    if (blob.size > 5000000) throw new Error('圖片超過 5MB，請換一張較小的圖片');
    const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
    const path = `uploads/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('images').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (error) throw new Error(error.message);
    return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
  }
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
  window.CoffeeCloud = { url: CLOUD_URL, client: sb };
})();
