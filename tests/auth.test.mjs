import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken } from '../worker/auth.mjs';
import { createTeamforgeServer } from '../worker/server.mjs';

const TOKEN = 'a'.repeat(64);
let server; let port;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-auth-'));
  ({ server } = createTeamforgeServer({ dbPath: join(dir, 'a.db'), token: TOKEN, provider: () => ({ provider: null, reason: 'none' }) }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => server.close());

// Raw request so the test controls Host and Origin (fetch forbids setting them).
function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(method === 'GET' ? undefined : '{}');
  });
}

test('health needs no token', async () => {
  assert.equal((await request('GET', '/api/health')).status, 200);
});

test('API without a token is refused', async () => {
  assert.equal((await request('GET', '/api/state')).status, 401);
  assert.equal((await request('POST', '/api/chat', { 'content-type': 'application/json' })).status, 401);
  assert.equal((await request('GET', '/api/state', { 'x-teamforge-token': 'b'.repeat(64) })).status, 401);
  assert.equal((await request('GET', '/events')).status, 401);
});

test('API accepts the token as header (CLI) or cookie (browser)', async () => {
  assert.equal((await request('GET', '/api/state', { 'x-teamforge-token': TOKEN })).status, 200);
  assert.equal((await request('GET', '/api/state', { cookie: `other=1; teamforge=${TOKEN}` })).status, 200);
});

test('a foreign Host is refused even with the token, including for the page itself', async () => {
  assert.equal((await request('GET', '/api/state', { host: 'evil.example', 'x-teamforge-token': TOKEN })).status, 403);
  assert.equal((await request('GET', '/', { host: 'evil.example' })).status, 403);
});

test('a state-changing request from another origin is refused', async () => {
  const headers = { 'x-teamforge-token': TOKEN, 'content-type': 'application/json' };
  assert.equal((await request('POST', '/api/chat/stop', { ...headers, origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('POST', '/api/chat/stop', { ...headers, origin: `http://127.0.0.1:${port}` })).status, 200);
});

test('opening the dashboard hands the browser an HttpOnly, SameSite=Strict cookie', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, new RegExp(`teamforge=${TOKEN}`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('the token file is private and stable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-token-'));
  const token = loadOrCreateToken(dir);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(loadOrCreateToken(dir), token);
  assert.equal(statSync(join(dir, 'worker.token')).mode & 0o777, 0o600);
});
