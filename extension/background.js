// TeamForge Browser — the service worker. It asks the local TeamForge worker for
// the next thing the team wants done, does it in the TeamForge tab through the
// debugger (the same way DevTools drives a page), and sends the outcome back.

const DEFAULT_URL = 'http://127.0.0.1:4519';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const attached = new Set(); // tabs the debugger is attached to
let running = false;
let sources = null;         // the scripts evaluated in the page

const settings = () => chrome.storage.local.get({ url: DEFAULT_URL, token: '' });
async function setStatus(status) {
  await chrome.storage.session.set({ status });
  chrome.action.setBadgeBackgroundColor({ color: status === 'connected' ? '#45de8a' : '#f6b95c' });
  chrome.action.setBadgeText({ text: status === 'connected' ? '●' : status === 'offline' ? '!' : '' });
}

// ---------- the link with the worker ----------

async function loop() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      await chrome.runtime.getPlatformInfo(); // an API call keeps the service worker awake
      const { url, token } = await settings();
      if (!token) { await setStatus('unpaired'); return; } // pairing starts the loop again
      let res;
      try {
        // under 30 s: Chrome ends a service worker whose fetch waits longer
        res = await fetch(`${url}/api/bridge/poll?wait=20000`, { headers: { 'x-teamforge-bridge': token } });
      } catch { await setStatus('offline'); await sleep(3000); continue; }
      if (res.status === 401) { await chrome.storage.local.set({ token: '' }); continue; } // another worker: pair again
      await setStatus('connected');
      if (res.status !== 200) continue;
      const command = await res.json();
      let outcome;
      try { outcome = { ok: true, ...(await run(command)) }; } catch (err) { outcome = { ok: false, error: String(err?.message || err) }; }
      await fetch(`${url}/api/bridge/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-teamforge-bridge': token },
        body: JSON.stringify({ id: command.id, ...outcome }),
      }).catch(() => {});
    }
  } finally { running = false; }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  // only a page served from this machine can pair, and only with its own origin
  if (message?.type !== 'pair' || typeof message.token !== 'string') return;
  let origin = '';
  try { origin = new URL(sender.url || '').origin; } catch { return; }
  if (origin !== message.url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return;
  chrome.storage.local.set({ url: origin, token: message.token }).then(loop);
});
// A click on the extension's icon, from a web page: that page joins the TeamForge
// tab group and becomes the tab the team works in, and TeamForge opens beside it
// (or its tab comes back to the front). From anywhere else it just opens TeamForge.
// If the worker does not answer, a page says how to start it.
chrome.action.onClicked.addListener(async (current) => {
  const { url } = await settings();
  let up = false;
  try { up = (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* not running */ }
  if (!up) {
    await setStatus('offline');
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    return;
  }
  const windowId = current?.windowId;
  const isTeamForge = (tab) => !!tab?.url && tab.url.startsWith(`${url}/`);
  const isWebPage = !!originOf(current?.url) && !isTeamForge(current);
  if (isWebPage) {
    await chrome.storage.session.set({ tabId: current.id }); // the team now works here
    await joinGroup([current.id], windowId);
  }
  const { tabId: teamTabId } = await chrome.storage.session.get('tabId');
  let dashboard = isTeamForge(current) ? current : (await chrome.tabs.query({ url: `${url}/*` })).find((t) => t.id !== teamTabId);
  if (dashboard) {
    if (isWebPage && dashboard.windowId !== windowId) dashboard = await chrome.tabs.move(dashboard.id, { windowId, index: -1 });
  } else {
    dashboard = await chrome.tabs.create({ url: `${url}/`, ...(isWebPage ? { index: current.index + 1 } : {}) });
  }
  await joinGroup([dashboard.id], dashboard.windowId);
  await chrome.tabs.update(dashboard.id, { active: true });
  await chrome.windows.update(dashboard.windowId, { focused: true });
  loop(); // opening the page pairs the extension if it was not
});

// Puts tabs in the window's TeamForge group, creating it when there is none.
async function joinGroup(tabIds, windowId) {
  try {
    const [group] = await chrome.tabGroups.query({ title: 'TeamForge', windowId });
    const groupId = await chrome.tabs.group(group ? { tabIds, groupId: group.id } : { tabIds, createProperties: { windowId } });
    if (!group) await chrome.tabGroups.update(groupId, { title: 'TeamForge', color: 'cyan' });
  } catch { /* a window without tab groups */ }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('wake', { periodInMinutes: 0.5 }); loop(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('wake', { periodInMinutes: 0.5 }); loop(); });
chrome.alarms.onAlarm.addListener(loop);
chrome.debugger.onDetach.addListener((source) => attached.delete(source.tabId));
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));
loop();

// ---------- the TeamForge tab ----------

async function teamTab() {
  const { tabId } = await chrome.storage.session.get('tabId');
  if (tabId) { try { return await chrome.tabs.get(tabId); } catch { /* the client closed it */ } }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await joinGroup([tab.id], tab.windowId);
  await chrome.storage.session.set({ tabId: tab.id });
  return tab;
}

async function scripts() {
  if (!sources) {
    const read = async (file) => (await fetch(chrome.runtime.getURL(file))).text();
    sources = { page: await read('page.js'), overlay: await read('overlay.js') };
  }
  return sources;
}
// (kept for as long as the service worker lives: reload the extension after editing page.js or overlay.js)

async function cdp(tabId, method, params = {}) {
  if (!attached.has(tabId)) {
    try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (err) {
      if (!/already attached/i.test(String(err?.message))) throw new Error(`Chrome refused to let TeamForge drive this tab: ${err?.message || err}`);
    }
    attached.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    // the cursor is drawn in every page the team opens, from the first moment
    await chrome.debugger.sendCommand({ tabId }, 'Page.addScriptToEvaluateOnNewDocument', { source: (await scripts()).overlay });
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// Runs an expression in the page, with the page helpers and the cursor in place.
async function inPage(tabId, expression) {
  const { page, overlay } = await scripts();
  const out = await cdp(tabId, 'Runtime.evaluate', {
    expression: `${overlay}\n${page}\n(${expression})`, returnByValue: true, awaitPromise: true,
  });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description?.split('\n')[0].replace(/^Error: /, '') || 'The page raised an error.');
  return out.result?.value;
}

async function settle(tabId, ms = 15000) {
  const until = Date.now() + ms;
  await sleep(300);
  while (Date.now() < until) {
    try {
      const out = await cdp(tabId, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (out.result?.value === 'complete') break;
    } catch { /* between two pages */ }
    await sleep(250);
  }
  await sleep(600); // applications keep drawing after "load"
}

// ---------- the sites the client allowed ----------

const originOf = (url) => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.origin : null; } catch { return null; } };

// After anything that can change the page: if the tab ended up on a site the client
// did not allow, it goes back and the team is told.
async function stayOnSites(tabId, sites) {
  const { url } = await chrome.tabs.get(tabId);
  const origin = originOf(url);
  if (!origin || sites.includes(origin)) return;
  await chrome.tabs.goBack(tabId).catch(() => {});
  await settle(tabId, 8000);
  throw new Error(`That led to ${origin}, a site the client has not allowed: the browser went back. The client allows a site with /browser ${origin}.`);
}

// ---------- the pointer and the keyboard ----------

async function pointAt(tabId, ref) {
  const at = await inPage(tabId, `window.__tfPage.locate(${JSON.stringify(ref)})`);
  await inPage(tabId, `window.__teamforge.point(${at.x}, ${at.y})`);
  await sleep(330); // let the client see the cursor travel
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  return at;
}

async function press(tabId, at, clickCount = 1) {
  await inPage(tabId, `window.__teamforge.click(${at.x}, ${at.y})`);
  for (let n = 1; n <= clickCount; n += 1) {
    const event = { x: at.x, y: at.y, button: 'left', clickCount: n };
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...event });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...event });
  }
}

const KEYS = {
  Enter: [13, '\r'], Tab: [9], Escape: [27], Backspace: [8], Delete: [46], Space: [32, ' '],
  ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39], PageUp: [33], PageDown: [34], Home: [36], End: [35],
};
async function key(tabId, name) {
  const found = Object.keys(KEYS).find((k) => k.toLowerCase() === String(name).toLowerCase());
  if (!found) throw new Error(`Unknown key "${name}". Keys: ${Object.keys(KEYS).join(', ')}.`);
  const [code, text] = KEYS[found];
  const event = { key: found === 'Space' ? ' ' : found, code: found, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...event, ...(text ? { text } : {}) });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

// ---------- the tools ----------

async function run({ tool, args = {}, sites = [] }) {
  const tab = await teamTab();
  const tabId = tab.id;
  // The client can hand the team any tab with a click on the extension: the team
  // still only reads and acts on the sites they allowed.
  const here = originOf(tab.url);
  if (tool !== 'browser_navigate' && here && !sites.includes(here)) {
    throw new Error(`The TeamForge tab is on ${here}, a site the client has not allowed, so it was not read or touched. The client allows it with /browser ${here}.`);
  }
  switch (tool) {
    case 'browser_navigate': {
      const origin = originOf(args.url);
      if (!origin) throw new Error(`Not a web address: ${args.url}`);
      // refused before anything is sent to that site
      if (!sites.includes(origin)) throw new Error(`${origin} is not a site the client allowed (allowed: ${sites.join(', ')}). The client allows it with /browser ${origin}.`);
      await chrome.tabs.update(tabId, { active: true });
      const out = await cdp(tabId, 'Page.navigate', { url: args.url });
      if (out.errorText) throw new Error(`The page did not open: ${out.errorText}`);
      await settle(tabId);
      await stayOnSites(tabId, sites); // a redirect may have left the allowed sites
      const now = await chrome.tabs.get(tabId);
      return { text: `Opened "${now.title}" — ${now.url}. Take a snapshot to read it.` };
    }
    case 'browser_navigate_back':
      await chrome.tabs.goBack(tabId);
      await settle(tabId, 8000);
      await stayOnSites(tabId, sites);
      return { text: `Back on ${(await chrome.tabs.get(tabId)).url}.` };
    case 'browser_snapshot':
      await inPage(tabId, 'window.__teamforge.busy()');
      return { text: await inPage(tabId, 'window.__tfPage.snapshot()') };
    case 'browser_click': {
      const at = await pointAt(tabId, args.ref);
      await press(tabId, at, args.doubleClick ? 2 : 1);
      await settle(tabId, 6000);
      await stayOnSites(tabId, sites);
      return { text: `Clicked ${at.label}. The page may have changed: take a snapshot.` };
    }
    case 'browser_hover': {
      const at = await pointAt(tabId, args.ref);
      await sleep(400);
      return { text: `The pointer is over ${at.label}.` };
    }
    case 'browser_type': {
      const at = await pointAt(tabId, args.ref);
      await press(tabId, at);
      await inPage(tabId, `window.__tfPage.focus(${JSON.stringify(args.ref)})`);
      await cdp(tabId, 'Input.insertText', { text: String(args.text ?? '') });
      if (args.submit) { await key(tabId, 'Enter'); await settle(tabId, 6000); await stayOnSites(tabId, sites); }
      return { text: `Typed in ${at.label}${args.submit ? ' and pressed Enter' : ''}.` };
    }
    case 'browser_press_key':
      await inPage(tabId, 'window.__teamforge.busy()');
      await key(tabId, args.key);
      await settle(tabId, 4000);
      await stayOnSites(tabId, sites);
      return { text: `Pressed ${args.key}.` };
    case 'browser_select_option': {
      const at = await pointAt(tabId, args.ref);
      await inPage(tabId, `window.__tfPage.choose(${JSON.stringify(args.ref)}, ${JSON.stringify(args.values || [])})`);
      await inPage(tabId, `window.__teamforge.click(${at.x}, ${at.y})`);
      return { text: `Chose ${(args.values || []).join(', ')} in ${at.label}.` };
    }
    case 'browser_scroll': {
      const how = { down: 'scrollBy(0, innerHeight * 0.85)', up: 'scrollBy(0, -innerHeight * 0.85)', top: 'scrollTo(0, 0)', bottom: 'scrollTo(0, document.documentElement.scrollHeight)' }[args.direction];
      if (!how) throw new Error('direction is one of: down, up, top, bottom.');
      await inPage(tabId, `(window.__teamforge.busy(), ${how}, true)`);
      await sleep(400);
      return { text: `Scrolled ${args.direction}. Take a snapshot to read what is there.` };
    }
    case 'browser_wait_for': {
      if (typeof args.text === 'string' && args.text) {
        const until = Date.now() + 15000;
        while (Date.now() < until) {
          if (await inPage(tabId, `window.__tfPage.hasText(${JSON.stringify(args.text)})`).catch(() => false)) return { text: `"${args.text}" is on the page.` };
          await sleep(400);
        }
        throw new Error(`"${args.text}" did not appear within 15 s.`);
      }
      const seconds = Math.min(15, Math.max(0, Number(args.time) || 1));
      await sleep(seconds * 1000);
      return { text: `Waited ${seconds} s.` };
    }
    case 'browser_take_screenshot': {
      await chrome.tabs.update(tabId, { active: true }); // Chrome only paints the tab in front
      await inPage(tabId, 'window.__teamforge.busy()');
      const { cssVisualViewport: view } = await cdp(tabId, 'Page.getLayoutMetrics');
      // at most 1280 px wide: enough to read, a fraction of the cost for the model
      const clip = { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale: Math.min(1, 1280 / view.clientWidth) };
      const shot = await cdp(tabId, 'Page.captureScreenshot', { format: 'png', clip });
      return { text: `Screenshot of ${(await chrome.tabs.get(tabId)).url}.`, image: shot.data };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
