// The mission documents the client can read and edit in the browser. The same
// list is the only thing the agent may write before the plan is validated.

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';

export const DOCS = [
  { path: 'docs/spec.md', title: 'Specification' },
  { path: 'docs/stories.md', title: 'User stories' },
  { path: 'docs/design.md', title: 'Design' },
  { path: 'docs/plan.md', title: 'Plan' },
];
export const MAX_DOC_BYTES = 512 * 1024;

export class DocError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const revOf = (content) => createHash('sha1').update(content).digest('hex');

export function requireProjectDir(project, Err = DocError) {
  if (typeof project !== 'string' || !isAbsolute(project)) throw new Err(400, 'project_path must be an absolute path');
  let ok = false;
  try { ok = statSync(project).isDirectory(); } catch { /* missing */ }
  if (!ok) throw new Err(400, `project directory not found: ${project}`);
}

// Only the listed documents, and never through a symlink that leaves the project.
function resolve(project, path) {
  requireProjectDir(project);
  const doc = DOCS.find((d) => d.path === path);
  if (!doc) throw new DocError(400, `not a mission document: ${path}`);
  const file = join(project, doc.path);
  const root = realpathSync(project);
  let dir = dirname(file);
  try { dir = realpathSync(dir); } catch { /* docs/ not created yet */ }
  if (dir !== root && !dir.startsWith(root + sep)) throw new DocError(400, 'document directory is outside the project');
  let link = false;
  try { link = lstatSync(file).isSymbolicLink(); } catch { /* does not exist yet */ }
  if (link) throw new DocError(400, 'document is a symbolic link');
  return { doc, file };
}

function current(file) {
  try { return readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function listDocs(project) {
  requireProjectDir(project);
  return DOCS.map((d) => {
    let exists = false;
    try { exists = statSync(join(project, d.path)).isFile(); } catch { /* not written yet */ }
    return { ...d, exists };
  });
}

export function readDoc(project, path) {
  const { doc, file } = resolve(project, path);
  const content = current(file);
  if (content === null) throw new DocError(404, `${doc.path} has not been written yet`);
  return { ...doc, content, rev: revOf(content) };
}

// `baseRev` is the revision the editor started from (null for a new document):
// if the file changed since, the save is refused instead of overwriting the team's work.
export function writeDoc(project, path, content, baseRev = null) {
  const { doc, file } = resolve(project, path);
  if (typeof content !== 'string') throw new DocError(400, 'content must be text');
  if (Buffer.byteLength(content) > MAX_DOC_BYTES) throw new DocError(413, 'document too large');
  const existing = current(file);
  const existingRev = existing === null ? null : revOf(existing);
  if (existingRev !== baseRev) {
    throw new DocError(409, `${doc.path} changed while you were editing it`, { rev: existingRev });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return { ...doc, rev: revOf(content) };
}
