// Each TeamForge tab in the browser is its own session: a new tab starts fresh, a
// reload stays in its conversation. The key lives in sessionStorage, which the
// browser keeps per tab (and copies when a tab is duplicated or restored).
function tabKey() {
  try {
    let key = sessionStorage.getItem('teamforge-tab');
    if (!/^[\w-]{1,40}$/.test(key || '')) {
      key = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
      sessionStorage.setItem('teamforge-tab', key);
    }
    return key;
  } catch {
    return ''; // no storage: every tab shares the project's session, as before
  }
}

export const TAB = tabKey();
