import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../dashboard/src/markdown.js';

test('headings, paragraphs and rules', () => {
  const blocks = parseBlocks('# Title\n\nFirst line\nsecond line\n\n---\n\n### Sub ###\n');
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'paragraph', text: 'First line\nsecond line' },
    { type: 'rule' },
    { type: 'heading', level: 3, text: 'Sub' },
  ]);
});

test('lists: bullets, numbers, nesting, checkboxes, wrapped lines', () => {
  const [list] = parseBlocks('- one\n  - nested\n1. first\n2) second\n- [ ] todo\n- [x] done\n- long\n  continued\n');
  assert.equal(list.type, 'list');
  assert.deepEqual(list.items.map((i) => [i.depth, i.marker, i.checked, i.text]), [
    [0, '•', null, 'one'], [1, '•', null, 'nested'], [0, '1.', null, 'first'], [0, '2.', null, 'second'],
    [0, '•', false, 'todo'], [0, '•', true, 'done'], [0, '•', null, 'long continued'],
  ]);
});

test('tables, code fences and quotes', () => {
  const blocks = parseBlocks('| A | B |\n|---|:-:|\n| 1 | 2 |\n| 3 |\n\n```js\nconst a = "# not a heading";\n- not a list\n```\n\n> quoted\n> text\n');
  assert.deepEqual(blocks[0], { type: 'table', head: ['A', 'B'], rows: [['1', '2'], ['3']] });
  assert.deepEqual(blocks[1], { type: 'code', text: 'const a = "# not a heading";\n- not a list' });
  assert.deepEqual(blocks[2], { type: 'quote', text: 'quoted\ntext' });
});

test('a paragraph ends where a list or heading starts, and an unclosed fence does not hang', () => {
  assert.deepEqual(parseBlocks('Intro:\n- item\n## Next').map((b) => b.type), ['paragraph', 'list', 'heading']);
  assert.deepEqual(parseBlocks('```\nnever closed'), [{ type: 'code', text: 'never closed' }]);
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks(null), []);
});

test('inline: code, bold, italic, links', () => {
  assert.deepEqual(parseInline('run `npm test` **now** or *later*, see [docs](https://example.com/a).'), [
    { type: 'text', text: 'run ' }, { type: 'code', text: 'npm test' }, { type: 'text', text: ' ' },
    { type: 'strong', text: 'now' }, { type: 'text', text: ' or ' }, { type: 'em', text: 'later' },
    { type: 'text', text: ', see ' }, { type: 'link', text: 'docs', href: 'https://example.com/a' }, { type: 'text', text: '.' },
  ]);
});

test('inline: snake_case and arithmetic are left alone; only http links become links', () => {
  assert.deepEqual(parseInline('spec_gate then plan_gate, 2 * 3 * 4'), [{ type: 'text', text: 'spec_gate then plan_gate, 2 * 3 * 4' }]);
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'file:///etc/passwd']) {
    assert.deepEqual(parseInline(`[x](${href})`), [{ type: 'text', text: `[x](${href})` }], href);
  }
});
