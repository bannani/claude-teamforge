// The team's browser: a Playwright MCP server Copilot starts for the turn, so the
// agent can open the running product, click, type and look — on the sites the
// client named. Two kinds:
//   own      — the client's own Chrome, through the TeamForge extension
//              (extension/): a TeamForge tab among theirs, with their sign-ins.
//              The tools are TeamForge's own server (worker/browser/mcp.mjs).
//   separate — a Chrome window of TeamForge's own, with its own profile, driven
//              by Playwright's MCP server.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The name Copilot knows the server by; `--allow-tool browser` allows its tools.
export const BROWSER_SERVER = 'browser';
// Injected in every page the team drives: the cursor, click ripple and frame the client sees.
export const CURSOR_SCRIPT = fileURLToPath(new URL('./browser-cursor.js', import.meta.url));
// Pinned: an unpinned `npx` would run whatever was published last.
const PACKAGE = '@playwright/mcp@0.0.84';

// What the team may do in the browser: see and act on the page. Left out on
// purpose: `browser_run_code_unsafe` runs code in the server process, outside the
// page — it would get around the write lock — and `browser_file_upload` reads
// local files; `browser_evaluate` and the rest are not needed to test a product.
export const BROWSER_TOOLS = [
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot',
  'browser_click', 'browser_hover', 'browser_type', 'browser_fill_form', 'browser_press_key',
  'browser_select_option', 'browser_drag', 'browser_wait_for', 'browser_find', 'browser_tabs',
  'browser_resize', 'browser_handle_dialog', 'browser_console_messages', 'browser_network_requests',
  'browser_close',
];
// Refused even if a later version of the server renames nothing and Copilot ignores `tools`.
export const BROWSER_DENIED = ['browser_run_code_unsafe', 'browser_file_upload', 'browser_evaluate'];

// "localhost:4200", "https://app.example.com/login" → { origin, url, page }, or
// null. `page` says the client named a page, not just a site.
export function parseSite(input) {
  const text = String(input || '').trim();
  if (!text || /\s/.test(text)) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text);
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${local ? 'http' : 'https'}://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return { origin: url.origin, url: url.href, page: url.pathname !== '/' || url.search !== '' };
  } catch { return null; }
}
export const parseOrigin = (input) => parseSite(input)?.origin ?? null;

// TeamForge's own browser tools: they reach the client's Chrome through the worker and the extension.
export const OWN_SERVER = fileURLToPath(new URL('../browser/mcp.mjs', import.meta.url));

// The MCP servers for one turn. Screenshots land in outputDir.
export function browserConfig({ kind = 'separate', profileDir, outputDir, headless = false, url = '', token = '', project = '' }) {
  if (kind === 'own') {
    return {
      mcpServers: {
        [BROWSER_SERVER]: {
          type: 'local',
          command: process.execPath,
          args: [OWN_SERVER],
          // how the tools reach the worker; the sites are checked there and in the extension
          env: { TEAMFORGE_URL: url, TEAMFORGE_TOKEN: token, TEAMFORGE_PROJECT: project, TEAMFORGE_SHOTS: outputDir },
          tools: ['*'],
        },
      },
    };
  }
  return {
    mcpServers: {
      [BROWSER_SERVER]: {
        type: 'local',
        command: 'npx',
        args: [
          '-y', PACKAGE,
          // No --allowed-origins: it blocks every request to another origin, so a real
          // page loses its scripts and styles (Jira: 128 requests blocked, a skeleton on
          // screen). The sites the client allowed are enforced on navigation, in chat.mjs.
          '--output-dir', outputDir,
          '--init-script', CURSOR_SCRIPT,
          // its own profile, so a sign-in survives from one turn to the next
          '--user-data-dir', profileDir, '--viewport-size', '1280x800', ...(headless ? ['--headless'] : []),
        ],
        cwd: outputDir, // a screenshot saved under a name of the agent's choosing stays out of the project
        tools: BROWSER_TOOLS,
      },
    },
  };
}

// Written to a file only the user can read, and passed as `@file`: the worker's
// token never appears on a command line.
export function writeBrowserConfig(file, options) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(browserConfig(options)), { mode: 0o600 });
  return `@${file}`;
}

// What the team did in the browser, in words: { verb, target } for the console.
// Copilot names an MCP tool after its server, e.g. "browser-browser_click".
export function browserAction(toolName, args = {}) {
  const tool = /browser_([a-z_]+)$/.exec(String(toolName || ''))?.[1];
  if (!tool || typeof args !== 'object' || args === null) return null;
  const el = typeof args.element === 'string' ? args.element : '';
  const short = (v, n = 80) => { const t = String(v ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
  // what is typed into a password field is nobody's business, least of all a transcript's
  const typed = (label, text) => (/pass|secret|mot de passe|token|pin\b/i.test(label) ? '••••••' : `“${short(text, 40)}”`);
  switch (tool) {
    case 'navigate': return { verb: 'opens', target: short(args.url) };
    case 'navigate_back': return { verb: 'goes back', target: '' };
    case 'click': return { verb: args.doubleClick ? 'double-clicks' : 'clicks', target: short(el) };
    case 'hover': return { verb: 'points at', target: short(el) };
    case 'type': return { verb: 'types', target: `${typed(el, args.text)}${el ? ` in ${short(el, 40)}` : ''}` };
    case 'fill_form': return { verb: 'fills in', target: short((args.fields || []).map((f) => f?.name).filter(Boolean).join(', ') || 'a form') };
    case 'press_key': return { verb: 'presses', target: short(args.key, 20) };
    case 'select_option': return { verb: 'chooses', target: `${short((args.values || []).join(', '), 40)}${el ? ` in ${short(el, 40)}` : ''}` };
    case 'drag': return { verb: 'drags', target: short(`${args.startElement || ''} → ${args.endElement || ''}`) };
    case 'take_screenshot': return { verb: 'takes a screenshot', target: '' };
    case 'snapshot': return { verb: 'reads the page', target: '' };
    case 'wait_for': return { verb: 'waits', target: short(args.text ? `for “${args.text}”` : args.time ? `${args.time}s` : '') };
    case 'scroll': return { verb: 'scrolls', target: short(args.direction, 10) };
    case 'find': return { verb: 'looks for', target: short(args.text ?? args.query ?? '') };
    case 'tabs': return { verb: args.action === 'new' ? 'opens a tab' : args.action === 'close' ? 'closes a tab' : args.action === 'select' ? 'switches tab' : 'lists the tabs', target: '' };
    case 'handle_dialog': return { verb: args.accept ? 'accepts the dialog' : 'dismisses the dialog', target: '' };
    case 'close': return { verb: 'closes the page', target: '' };
    case 'resize': return { verb: 'resizes the window', target: `${args.width}×${args.height}` };
    case 'console_messages': return { verb: 'reads the browser console', target: '' };
    case 'network_requests': return { verb: 'reads the network requests', target: '' };
    default: return { verb: tool.replaceAll('_', ' '), target: '' };
  }
}

// Without a display there is no window to show.
export const needsHeadless = (env = process.env, platform = process.platform) => (
  platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY
);

// Image files that appeared in dir since `since` (ms) and were not reported yet.
export function newScreenshots(dir, since, seen) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  const fresh = names
    .filter((n) => /^[\w-]+\.(png|jpg)$/.test(n) && !seen.has(n))
    .filter((n) => { try { return statSync(join(dir, n)).mtimeMs >= since - 1000; } catch { return false; } })
    .sort();
  for (const n of fresh) seen.add(n);
  return fresh;
}

// Reading a page is the expensive part of browsing: a snapshot or a screenshot is
// thousands of tokens. So the browser is driven by an agent of its own, on a
// light model, which hands the team a short account of what it saw.
export const BROWSER_AGENT = 'teamforge-browser';
export const BROWSER_MODEL = 'claude-haiku-5.5';

// Copilot loads agents from `<dir>/.github/agents` of a directory passed with
// --add-dir (checked on CLI 1.0.112), so this one lives in TeamForge's data
// directory and nothing is written in the project. Returns the directory to add.
export function writeBrowserAgent(home, { model, sites, observeOnly }) {
  const dir = join(home, '.github', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${BROWSER_AGENT}.agent.md`), `---
name: ${BROWSER_AGENT}
description: "TeamForge browser operator. Does what it is asked in the browser and reports what is on the screen."
model: ${model}
---
You are the **browser operator** of the TeamForge company. An employee gives you a
task in the browser; you do it with the \`browser\` tools and report back.

- Sites you may open: ${sites.join(', ')}. Opening any other site ends the turn.
- ${observeOnly
    ? 'Observe only: navigate, read, hover, take screenshots. Never submit, save, delete or change anything.'
    : 'Do exactly what the task says — nothing more. Before a step that changes data (submit, save, delete), make sure the task asked for it.'}
- The client may have put the TeamForge tab on a page themselves: when the task speaks of “this page” or names no address, take a snapshot first to see where you are.
- Wait for a page to finish loading before you read it or take a screenshot.
- Your tools are the ones of the \`browser\` server and no other: their names start with \`browser-\` (\`browser-browser_navigate\`, \`browser-browser_snapshot\`…). Ignore any other browser or Playwright tool you may see.
- Read with \`browser_snapshot\` — headings and the elements you can act on carry a number in brackets: pass that number, and nothing else, as \`ref\`. Take a screenshot (without a file name) when the task asks for one or when the look of the page matters.
- Never repeat a password or a token you see or type.

Report in a few lines: what you did, what is on the screen that answers the task
(the exact labels, values and messages — do not paraphrase them), and anything that
failed or looked wrong. No page dump: the employee only reads your report.
`);
  return home;
}
