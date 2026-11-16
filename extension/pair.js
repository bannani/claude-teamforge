// Runs on local pages. A TeamForge dashboard answers /api/bridge/pair (this request
// carries the page's own cookie); any other local site does not, and nothing happens.
// The extension gets a token that is only good for receiving browser commands.
(async () => {
  if (!document.title.startsWith('TeamForge')) return;
  try {
    const res = await fetch('/api/bridge/pair', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { token } = await res.json();
    if (typeof token !== 'string') return;
    chrome.runtime.sendMessage({ type: 'pair', url: location.origin, token });
  } catch { /* not a TeamForge page */ }
})();
