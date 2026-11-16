// A spike saved as a document. The worker writes it from the transcript: the
// agent itself stays read-only.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { splitAnswer } from '../../dashboard/src/spike.js';

// One section per question: the last answer given to it, functional part first.
export function spikeReport({ title, date, messages }) {
  const exchanges = [];
  for (const m of messages) {
    if (m.role === 'user') exchanges.push({ question: m.text, answer: null });
    else if (m.role === 'assistant' && exchanges.length) exchanges.at(-1).answer = m.text;
  }
  const sections = exchanges.filter((e) => e.answer).map((e, i) => {
    const { functional, technical, confidence } = splitAnswer(e.answer);
    const sure = confidence ? `\n\n**Confidence: ${confidence.level}**${confidence.reason ? ` — ${confidence.reason}` : ''}` : '';
    return `## ${i + 1}. ${e.question.replace(/\s+/g, ' ').trim()}\n\n${functional}${sure}\n${
      technical ? `\n### Technical details\n\n${technical}\n` : ''}`;
  });
  return { count: sections.length, content: `# Spike — ${title}\n\n_${date} · answers read from the code by TeamForge_\n\n${sections.join('\n')}` };
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'spike';

// Writes docs/spikes/<date>-<title>.md and returns its project-relative path.
// Saving the same spike again replaces its file.
export function saveSpikeReport(project, session, messages) {
  const date = String(session.created_at || '').slice(0, 10);
  const { count, content } = spikeReport({ title: session.title || 'spike', date, messages });
  if (!count) return { count };
  const root = realpathSync(project);
  const dir = join(project, 'docs', 'spikes');
  // never through a symlink that leaves the project
  for (const d of [join(project, 'docs'), dir]) {
    if (existsSync(d) && !realpathSync(d).startsWith(root + sep)) throw new Error('docs/ is outside the project');
  }
  mkdirSync(dir, { recursive: true });
  const path = `docs/spikes/${date}-${slug(session.title || '')}.md`;
  writeFileSync(join(project, path), content);
  return { count, path };
}
