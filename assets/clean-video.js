// 挑豆影片（首頁「乾淨的豆・AI 挑豆」與品牌故事 02 共用）
// 1. 捲到畫面中才播放（預設靜音循環），可按鈕暫停／開聲音；系統設定減少動態時不自動播放
// 2. 桌機版：影片高度＝右側整欄文字高度（二分搜尋影片寬度，直式 9:16）；1100px 以下不處理
(() => {
  const en = () => document.documentElement.dataset.lang === 'en';

  document.querySelectorAll('.story-video').forEach(box => {
    const v = box.querySelector('video'), b = box.querySelector('.story-video-toggle'), snd = box.querySelector('.story-video-sound');
    if (!v || !b) return;
    let userPaused = matchMedia('(prefers-reduced-motion: reduce)').matches, inView = false;
    const sync = () => {
      const playing = !v.paused;
      b.setAttribute('aria-pressed', String(playing));
      b.setAttribute('aria-label', playing ? (en() ? 'Pause video' : '暫停影片') : (en() ? 'Play video' : '播放影片'));
      box.classList.toggle('is-playing', playing);
    };
    const update = () => { if (inView && !userPaused) v.play().catch(() => {}); else v.pause() };
    v.addEventListener('play', sync); v.addEventListener('pause', sync);
    b.addEventListener('click', () => { userPaused = !v.paused; if (userPaused) v.pause(); else v.play().catch(() => {}) });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; update() }, { threshold: 0.35 }).observe(v);
    if (snd) {
      const syncSnd = () => {
        snd.setAttribute('aria-pressed', String(!v.muted));
        snd.setAttribute('aria-label', v.muted ? (en() ? 'Turn sound on' : '開啟聲音') : (en() ? 'Mute' : '關閉聲音'));
      };
      snd.addEventListener('click', () => { v.muted = !v.muted; if (!v.muted && v.paused) { userPaused = false; v.play().catch(() => {}) } syncSnd() });
      v.addEventListener('volumechange', syncSnd);
      syncSnd();
    }
    sync();
  });

  const mobile = matchMedia('(max-width:1100px)');
  document.querySelectorAll('.clean-layout').forEach(layout => {
    const fig = layout.querySelector('.clean-video'), txt = layout.querySelector('.clean-text');
    if (!fig || !txt) return;
    let busy = false, timer = 0;
    const fit = () => {
      if (busy) return; busy = true;
      if (mobile.matches) { fig.style.width = ''; busy = false; return }
      const W = layout.clientWidth, min = 240, max = Math.max(min, W * 0.5);
      let lo = min, hi = max;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2; fig.style.width = mid + 'px';
        if (mid * 16 / 9 < txt.getBoundingClientRect().height) lo = mid; else hi = mid;
      }
      fig.style.width = Math.round(lo) + 'px';
      busy = false;
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(fit, 120) };
    fit();
    addEventListener('resize', later);
    mobile.addEventListener('change', fit);
    document.fonts?.ready.then(fit);
    // 後台內容、中英切換會改文字 → 重算
    new MutationObserver(later).observe(txt, { childList: true, subtree: true, characterData: true });
  });
})();
