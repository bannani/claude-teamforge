#!/usr/bin/env node
// The MCP server Copilot starts for the team's browser tools. It has no browser
// of its own: every call goes to the worker, which hands it to the TeamForge
// extension in the client's Chrome. Zero dependencies: MCP over stdio is JSON-RPC,
// one message per line.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { TOOLS } from './tools.mjs';

const URL_ = process.env.TEAMFORGE_URL || 'http://127.0.0.1:4519';
const TOKEN = process.env.TEAMFORGE_TOKEN || '';
const PROJECT = process.env.TEAMFORGE_PROJECT || '';
const SHOTS = process.env.TEAMFORGE_SHOTS || '';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function callBrowser(tool, args) {
  let res;
  try {
    res = await fetch(`${URL_}/api/bridge/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-teamforge-token': TOKEN },
      body: JSON.stringify({ project_path: PROJECT, tool, args }),
    });
  } catch {
    return text('The TeamForge worker is not reachable.', true);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) return text(out.error || `The worker refused (${res.status}).`, true);
  if (!out.image) return text(out.text || 'Done.');
  // a screenshot: kept where the console fetches it, and given to the model
  let saved = '';
  if (SHOTS) {
    try {
      mkdirSync(SHOTS, { recursive: true });
      const name = `page-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      writeFileSync(join(SHOTS, name), Buffer.from(out.image, 'base64'), { mode: 0o600 });
      saved = ' The client sees it in the console.';
    } catch { /* the model still gets the image */ }
  }
  return { content: [{ type: 'text', text: `${out.text || 'Screenshot taken.'}${saved}` }, { type: 'image', data: out.image, mimeType: 'image/png' }] };
}

async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return; // a notification: nothing to answer
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'TeamForge browser', version: '1' },
      } });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id, result: text(`Unknown tool: ${params?.name}`, true) });
      return send({ jsonrpc: '2.0', id, result: await callBrowser(tool.name, params.arguments || {}) });
    }
    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  handle(message).catch((err) => {
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(err?.message || err) } });
  });
}).on('close', () => process.exit(0));
