// What the company knows how to do, kept as markdown the team can edit:
// `skills/<name>.md` is the method for a phase (or for spike mode), and
// `agents/<role>.md` is an employee's charter. Both reach the agent when they
// are needed — entering a phase, an employee starting work — not all up front.

import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const cache = new Map();

function load(dir, name) {
  if (!/^[a-z_]+$/.test(String(name))) return '';
  const key = `${dir}/${name}`;
  if (!cache.has(key)) {
    let text = '';
    try { text = readFileSync(new URL(`${key}.md`, ROOT), 'utf8'); } catch { /* no file: nothing to add */ }
    cache.set(key, text.replace(/^---\n[\s\S]*?\n---\n/, '').trim());
  }
  return cache.get(key);
}

export const skill = (name) => load('skills', name);
export const charter = (roleId) => load('agents', roleId);
