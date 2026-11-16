// Evaluated in the page the team works in: reads it as a list the agent can act
// on, and finds an element again from its number.
(() => {
  if (window.__tfPage) return;
  const ACTIONABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'IFRAME', 'CANVAS', 'TEAMFORGE-CURSOR']);
  const MAX_CHARS = 24000;
  let refs = [];

  const clean = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
  function visible(el) {
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    return true;
  }
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function role(el) {
    const given = el.getAttribute('role');
    if (given) return given;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (['checkbox', 'radio'].includes(type)) return type;
      return type === 'search' ? 'searchbox' : 'textbox';
    }
    return el.isContentEditable ? 'textbox' : 'button';
  }
  function name(el) {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.innerText).filter(Boolean).join(' ');
    const label = el.labels?.[0]?.innerText;
    const img = el.querySelector?.('img[alt]')?.alt;
    const tag = el.tagName.toLowerCase();
    const own = ['input', 'select', 'textarea'].includes(tag)
      ? (['button', 'submit', 'reset'].includes(el.type) ? el.value : '')
      : el.innerText;
    return clean(el.getAttribute('aria-label') || labelled || label || own || el.getAttribute('placeholder') || el.getAttribute('title') || img || el.getAttribute('name') || '', 120);
  }
  function state(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    // what is in a password field stays in the page
    if (tag === 'input' && el.type === 'password') out.push(el.value ? 'filled' : 'empty');
    else if (tag === 'input' && ['checkbox', 'radio'].includes(el.type)) out.push(el.checked ? 'checked' : 'unchecked');
    else if (tag === 'select') out.push(`selected="${clean(el.selectedOptions?.[0]?.text, 60)}"`);
    else if (tag === 'input' || tag === 'textarea') { if (el.value) out.push(`value="${clean(el.value, 80)}"`); }
    for (const [attr, word] of [['aria-checked', 'checked'], ['aria-selected', 'selected'], ['aria-expanded', 'expanded'], ['aria-pressed', 'pressed']]) {
      if (el.getAttribute(attr) === 'true') out.push(word);
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.push('disabled');
    return out.length ? ` (${out.join(', ')})` : '';
  }

  function snapshot() {
    refs = [];
    const lines = [];
    let size = 0; let cut = false;
    const add = (line) => { if (cut) return; if (size + line.length > MAX_CHARS) { cut = true; return; } lines.push(line); size += line.length + 1; };
    (function walk(node) {
      if (cut) return;
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = clean(child.nodeValue, 400);
          if (text.length > 1) add(`text "${text}"`);
        } else if (child.nodeType === Node.ELEMENT_NODE && !SKIP.has(child.tagName) && visible(child)) {
          if (child.matches(ACTIONABLE)) {
            if (shown(child)) { refs.push(child); add(`[${refs.length}] ${role(child)} "${name(child)}"${state(child)}`); }
          } else if (/^H[1-6]$/.test(child.tagName)) {
            // a heading can be pointed at too (hovering a title, checking where it is)
            refs.push(child);
            add(`[${refs.length}] heading(${child.tagName[1]}) "${clean(child.innerText, 200)}"`);
          } else {
            walk(child);
            if (child.shadowRoot) walk(child.shadowRoot);
          }
        }
      }
    })(document.body);
    return [`Page: ${clean(document.title, 150)}`, `Address: ${location.href}`, '', ...lines, ...(cut ? ['', '(The page is longer: scroll and take another snapshot for the rest.)'] : [])].join('\n');
  }

  function element(ref) {
    const el = /^\d+$/.test(String(ref).trim()) ? refs[Number(ref) - 1] : null;
    if (!el) throw new Error(`"${ref}" is not an element number. Pass the number shown in brackets in the last snapshot, e.g. 12 for "[12] button …".`);
    if (!el.isConnected) throw new Error(`Element ${ref} is not on the page any more: take a new snapshot.`);
    return el;
  }
  // Scrolls the element into view and gives the point to act on.
  function locate(ref) {
    const el = element(ref);
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const what = /^H[1-6]$/.test(el.tagName) ? 'heading' : role(el);
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: `${what} "${name(el)}"` };
  }
  function focus(ref) {
    const el = element(ref);
    el.focus();
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) document.getSelection().selectAllChildren(el);
    return true;
  }
  function choose(ref, values) {
    const el = element(ref);
    if (el.tagName !== 'SELECT') throw new Error(`Element ${ref} is not a list of options: click it instead.`);
    const wanted = values.map((v) => String(v).trim().toLowerCase());
    let hit = 0;
    for (const option of el.options) {
      const match = wanted.includes(option.text.trim().toLowerCase()) || wanted.includes(option.value.toLowerCase());
      if (el.multiple) option.selected = match; else if (match && !hit) el.value = option.value;
      if (match) hit += 1;
    }
    if (!hit) throw new Error(`No option ${values.join(', ')} in that list. Options: ${[...el.options].map((o) => o.text.trim()).slice(0, 30).join(' | ')}`);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  window.__tfPage = { snapshot, locate, focus, choose, hasText: (t) => document.body.innerText.includes(t) };
})();
