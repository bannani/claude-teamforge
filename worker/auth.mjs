// Request authentication for the local worker. The dashboard can make the
// agent run commands, so every request must come from this machine's own
// browser page or CLI: a secret token (cookie or header) plus Host/Origin checks.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_FILE = 'worker.token';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function loadOrCreateToken(dir) {
  const file = join(dir, TOKEN_FILE);
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch { /* first start */ }
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // writeFileSync keeps the mode of an existing file
  return token;
}

function hostnameOf(host) {
  try { return new URL(`http://${host}`).hostname; } catch { return ''; }
}

export function createAuth(token) {
  const expected = Buffer.from(token);
  const matches = (value) => {
    if (typeof value !== 'string') return false;
    const given = Buffer.from(value);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  // What the TeamForge Chrome extension holds: derived from the worker's token, so it
  // survives a restart, but only good for picking up and answering browser commands —
  // it cannot start the agent or read the conversation.
  const bridgeToken = createHmac('sha256', token).update('teamforge-browser-bridge').digest('hex');
  const bridgeExpected = Buffer.from(bridgeToken);

  return {
    cookie: `teamforge=${token}; HttpOnly; SameSite=Strict; Path=/`,
    bridgeToken,

    // The extension's two routes: a local host name and the bridge token. Its requests
    // come from a chrome-extension:// origin, so the same-origin rule cannot apply.
    checkBridge(req) {
      if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host || ''))) return { ok: false, status: 403, error: 'forbidden host' };
      const given = Buffer.from(String(req.headers['x-teamforge-bridge'] || ''));
      if (given.length === bridgeExpected.length && timingSafeEqual(given, bridgeExpected)) return { ok: true };
      return { ok: false, status: 401, error: 'missing or invalid bridge token' };
    },

    // Every request: only reachable under a local name (blocks DNS rebinding),
    // and a state-changing request must not come from another site's page.
    checkOrigin(req) {
      const host = req.headers.host || '';
      if (!LOCAL_HOSTS.has(hostnameOf(host))) return { ok: false, status: 403, error: 'forbidden host' };
      const { origin } = req.headers;
      if (origin && req.method !== 'GET') {
        let originHost = '';
        try { originHost = new URL(origin).host; } catch { /* malformed → rejected below */ }
        if (originHost !== host) return { ok: false, status: 403, error: 'forbidden origin' };
      }
      return { ok: true };
    },

    // API and event stream: the caller must hold the token.
    checkToken(req) {
      const cookie = /(?:^|;\s*)teamforge=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      if (matches(req.headers['x-teamforge-token']) || matches(cookie)) return { ok: true };
      return { ok: false, status: 401, error: 'missing or invalid token' };
    },
  };
}
