// A small markdown reader for the mission documents (no dependency, no HTML
// injection: the output is plain data that React renders). Covers what specs
// and plans use: headings, paragraphs, lists (nested, numbered, checkboxes),
// tables, code blocks, quotes, rules; inline code, bold, italic, links.

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/; // at least two columns

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const startsBlock = (line, next) => FENCE.test(line) || HEADING.test(line) || RULE.test(line)
  || QUOTE.test(line) || ITEM.test(line) || (line.includes('|') && next !== undefined && TABLE_RULE.test(next));

export function parseBlocks(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (FENCE.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1; // closing fence (or end of document)
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); i += 1; continue; }

    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i += 1; continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(lines[i].replace(QUOTE, '')); i += 1; }
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }

    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (ITEM.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (m) {
          const box = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
          items.push({
            depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
            marker: /\d/.test(m[2]) ? m[2].replace(')', '.') : '•',
            checked: box ? box[1] !== ' ' : null,
            text: box ? box[2] : m[3],
          });
          i += 1;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          items.at(-1).text += ` ${lines[i].trim()}`; // wrapped line of the same item
          i += 1;
        } else break;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const body = [];
    while (i < lines.length && lines[i].trim() && !(body.length && startsBlock(lines[i], lines[i + 1]))) {
      body.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\([^)\s]+\))/g;

// Text → [{type:'text'|'code'|'strong'|'em'|'link', text, href?}]. Only http(s)
// links become links; anything else stays visible as typed.
export function parseInline(text) {
  const out = [];
  // neighbouring plain text is kept as one piece
  const plain = (t) => { if (out.at(-1)?.type === 'text') out.at(-1).text += t; else out.push({ type: 'text', text: t }); };
  let last = 0;
  for (const m of String(text ?? '').matchAll(INLINE)) {
    if (m.index > last) plain(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push({ type: 'code', text: t.slice(1, -1) });
    else if (t.startsWith('**')) out.push({ type: 'strong', text: t.slice(2, -2) });
    else if (t.startsWith('*')) out.push({ type: 'em', text: t.slice(1, -1) });
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      if (/^https?:\/\//i.test(href)) out.push({ type: 'link', text: label, href }); else plain(t);
    }
    last = m.index + t.length;
  }
  if (last < String(text ?? '').length) plain(text.slice(last));
  return out;
}
