// Runs inside every page the team's browser drives (Playwright --init-script):
// shows where the team is acting — a second cursor that belongs to TeamForge, a
// ripple on each of its clicks and a glowing frame around the page — so the
// client can follow it in their Chrome.
//
// It is a second cursor, never the client's: it stays where the team last acted
// and ignores the client's own mouse. The page gets both as ordinary mouse
// events, so it tells them apart by their shape. The team's pointer jumps: one
// move out of nowhere, usually followed at once by a press on the same spot. A
// hand glides: a stream of moves, each a few pixels and milliseconds from the last.
(() => {
  if (window.top !== window || window.__teamforgeCursor) return;
  window.__teamforgeCursor = true;
  const FRAME_MS = 20000;       // the frame fades this long after the team's last action
  const CURSOR_MS = 5 * 60000;  // the cursor stays much longer: the team thinks between two actions
  const KEY = '__teamforgeCursor'; // where the cursor was, so it is there again on the next page
  let host; let cursor; let frame; let layer;
  let frameTimer = 0; let cursorTimer = 0;

  function build() {
    if (host || !document.documentElement) return;
    host = document.createElement('teamforge-cursor');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .frame { position: fixed; inset: 0; opacity: 0; transition: opacity .4s ease;
          box-shadow: inset 0 0 0 3px #59e0f2, inset 0 0 28px 4px rgba(143,127,248,.55); }
        .tag { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 12px;
          border-radius: 999px; font: 700 11px/1.4 Inter, system-ui, sans-serif; letter-spacing: .6px;
          color: #06222a; background: linear-gradient(135deg, #59e0f2, #8f7ff8); box-shadow: 0 4px 18px rgba(89,224,242,.45); }
        .cursor { position: fixed; left: 0; top: 0; opacity: 0; will-change: transform;
          transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease; }
        .cursor svg { display: block; filter: drop-shadow(0 2px 6px rgba(6,9,15,.55)); }
        .name { position: absolute; left: 18px; top: 20px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
          font: 700 10px/1.5 Inter, system-ui, sans-serif; letter-spacing: .5px; color: #06222a; background: #59e0f2; }
        .ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
          border: 2px solid #59e0f2; background: rgba(89,224,242,.25); animation: tf-ripple .6s ease-out forwards; }
        @keyframes tf-ripple { to { transform: scale(4.2); opacity: 0; } }
        .on { opacity: 1; }
        @media (prefers-reduced-motion: reduce) { .cursor { transition: opacity .2s ease; } .ripple { animation-duration: .01s; } }
      </style>
      <div class="frame"><div class="tag">TeamForge is working in this tab</div></div>
      <div class="cursor">
        <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#59e0f2"/><stop offset="1" stop-color="#8f7ff8"/></linearGradient></defs>
          <path d="M2 2l7.2 19 2.7-7.6L19.5 11z" fill="url(#g)" stroke="#06090f" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <span class="name">TeamForge</span>
      </div>`;
    layer = root;
    frame = root.querySelector('.frame');
    cursor = root.querySelector('.cursor');
    document.documentElement.appendChild(host);
  }

  // The team is at work in this tab: light the frame, and keep the cursor on screen.
  function active(ms = FRAME_MS) {
    frame.classList.add('on');
    cursor.classList.add('on');
    clearTimeout(frameTimer);
    clearTimeout(cursorTimer);
    frameTimer = setTimeout(() => frame.classList.remove('on'), ms);
    cursorTimer = setTimeout(() => cursor.classList.remove('on'), CURSOR_MS);
  }
  function moveTo(x, y) {
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
    try { sessionStorage.setItem(KEY, `${Math.round(x)},${Math.round(y)}`); } catch { /* storage refused: it starts from the middle next time */ }
  }
  function show(x, y) {
    build();
    if (!host) return;
    moveTo(x, y);
    active();
  }

  const QUIET_MS = 100;  // a move this long after the previous one starts something new
  const SETTLE_MS = 120; // …and is a jump only if no other move follows it this soon
  const FAR_PX = 30;     // a hand resumes where it stopped; a jump lands elsewhere
  let prev = null;       // the last mouse event, whoever made it
  let pending = null;    // a move that may be the team's: confirmed by a press, or by silence
  let timer = 0;
  let placed = null;     // where the team's cursor is

  function place(x, y) { placed = { x, y, t: performance.now() }; show(x, y); }
  function ripple(x, y) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
  const near = (a, x, y, d) => !!a && Math.abs(a.x - x) <= d && Math.abs(a.y - y) <= d;

  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    const quiet = !prev || now - prev.t > QUIET_MS;
    const far = !prev || !near(prev, e.clientX, e.clientY, FAR_PX);
    // a second move right behind the first: that was a hand starting to glide
    clearTimeout(timer);
    pending = null;
    if (quiet) {
      pending = { x: e.clientX, y: e.clientY };
      // without a press, only a jump to somewhere else is taken for the team hovering
      if (far) timer = setTimeout(() => { if (pending) { place(pending.x, pending.y); pending = null; } }, SETTLE_MS);
    }
    prev = { x: e.clientX, y: e.clientY, t: now };
  }, true);

  window.addEventListener('mousedown', (e) => {
    const x = e.clientX; const y = e.clientY;
    if (near(pending, x, y, 2)) {
      // one move out of nowhere and a press on the very same spot: the team's click
      clearTimeout(timer);
      pending = null;
      place(x, y);
      ripple(x, y);
    } else if (near(placed, x, y, 2) && performance.now() - placed.t < 1500) {
      ripple(x, y); // the second press of a double-click
    }
  }, true);

  // This script is only injected while the team holds the tab, so a page that
  // loads with it is a page the team just opened: say so before the first click.
  // The cursor is there from the start, where the team left it on the previous page.
  const arrived = () => {
    build();
    if (!host) return;
    let at = null;
    try { at = /^(\d+),(\d+)$/.exec(sessionStorage.getItem(KEY) || ''); } catch { /* no storage */ }
    const x = at ? Math.min(+at[1], window.innerWidth - 24) : Math.round(window.innerWidth * 0.6);
    const y = at ? Math.min(+at[2], window.innerHeight - 24) : Math.round(window.innerHeight * 0.35);
    cursor.style.transition = 'none'; // it does not fly in from the corner
    moveTo(x, y);
    void cursor.offsetWidth;
    cursor.style.transition = '';
    placed = { x, y, t: 0 };
    active();
    // an application that redraws its whole page takes the cursor away with it: put it back
    new MutationObserver(() => { if (!host.isConnected) document.documentElement.appendChild(host); })
      .observe(document.documentElement, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrived, { once: true });
  else arrived();

  // typing: no pointer moves, but the team is still at work in the tab
  window.addEventListener('keydown', () => { if (cursor?.classList.contains('on')) active(); }, true);
  // reading a long page: the team scrolls, the cursor stays in view and the frame stays lit
  window.addEventListener('scroll', () => { if (cursor?.classList.contains('on')) active(); }, true);
})();
