// Drawn in the page the team is working in: TeamForge's own cursor, a ripple where
// it clicks, and a frame around the page. The extension moves it — it never reacts
// to the client's mouse, so it is a second cursor, not theirs.
(() => {
  if (window.top !== window || window.__teamforge) return;
  const KEY = '__teamforgeCursor';
  const FRAME_MS = 20000;
  let host; let root; let cursor; let frame; let frameTimer = 0;

  function build() {
    if (host || !document.documentElement) return !!host;
    host = document.createElement('teamforge-cursor');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .frame { position: fixed; inset: 0; opacity: 0; transition: opacity .4s ease;
          box-shadow: inset 0 0 0 3px #59e0f2, inset 0 0 28px 4px rgba(143,127,248,.55); }
        .tag { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 12px;
          border-radius: 999px; font: 700 11px/1.4 Inter, system-ui, sans-serif; letter-spacing: .6px;
          color: #06222a; background: linear-gradient(135deg, #59e0f2, #8f7ff8); box-shadow: 0 4px 18px rgba(89,224,242,.45); }
        .cursor { position: fixed; left: 0; top: 0; will-change: transform; transition: transform .3s cubic-bezier(.2,.8,.2,1); }
        .cursor svg { display: block; filter: drop-shadow(0 2px 6px rgba(6,9,15,.55)); }
        .name { position: absolute; left: 18px; top: 20px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
          font: 700 10px/1.5 Inter, system-ui, sans-serif; letter-spacing: .5px; color: #06222a; background: #59e0f2; }
        .ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
          border: 2px solid #59e0f2; background: rgba(89,224,242,.25); animation: tf-ripple .6s ease-out forwards; }
        @keyframes tf-ripple { to { transform: scale(4.2); opacity: 0; } }
        .on { opacity: 1; }
        @media (prefers-reduced-motion: reduce) { .cursor { transition: none; } .ripple { animation-duration: .01s; } }
      </style>
      <div class="frame"><div class="tag">TeamForge is working in this tab</div></div>
      <div class="cursor">
        <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#59e0f2"/><stop offset="1" stop-color="#8f7ff8"/></linearGradient></defs>
          <path d="M2 2l7.2 19 2.7-7.6L19.5 11z" fill="url(#g)" stroke="#06090f" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <span class="name">TeamForge</span>
      </div>`;
    frame = root.querySelector('.frame');
    cursor = root.querySelector('.cursor');
    document.documentElement.appendChild(host);
    // an application that redraws its whole page takes the cursor away with it: put it back
    new MutationObserver(() => { if (!host.isConnected) document.documentElement.appendChild(host); })
      .observe(document.documentElement, { childList: true });
    return true;
  }

  function place(x, y, animate) {
    if (!animate) cursor.style.transition = 'none';
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
    if (!animate) { void cursor.offsetWidth; cursor.style.transition = ''; }
    try { sessionStorage.setItem(KEY, `${Math.round(x)},${Math.round(y)}`); } catch { /* storage refused */ }
  }
  function busy() {
    if (!build()) return;
    frame.classList.add('on');
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => frame.classList.remove('on'), FRAME_MS);
  }

  window.__teamforge = {
    busy,
    point(x, y) { if (build()) { place(x, y, true); busy(); } },
    click(x, y) {
      if (!build()) return;
      place(x, y, true);
      busy();
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    },
  };

  // there from the start, where the team left it on the previous page
  const arrive = () => {
    if (!build()) return;
    let at = null;
    try { at = /^(\d+),(\d+)$/.exec(sessionStorage.getItem(KEY) || ''); } catch { /* no storage */ }
    place(at ? Math.min(+at[1], innerWidth - 24) : Math.round(innerWidth * 0.6), at ? Math.min(+at[2], innerHeight - 24) : Math.round(innerHeight * 0.35), false);
    busy();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrive, { once: true });
  else arrive();
})();
