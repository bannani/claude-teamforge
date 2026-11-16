// Which model provider runs the company. Today: GitHub Copilot through the
// installed `copilot` CLI (it uses its own login — TeamForge never reads it).

import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export function onPath(bin, env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try { accessSync(join(dir, bin), constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

export function resolveProvider({ env = process.env, which = (bin) => onPath(bin, env) } = {}) {
  const model = env.TEAMFORGE_MODEL || null;
  if (which('copilot')) return { provider: 'copilot', label: 'GitHub Copilot', model };
  return {
    provider: null,
    label: null,
    model: null,
    reason: 'No model provider found. Install the GitHub Copilot CLI and sign in '
      + '(run `copilot` once in a terminal), then restart TeamForge.',
  };
}
