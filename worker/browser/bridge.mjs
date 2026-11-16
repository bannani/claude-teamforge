// The link between the team and the TeamForge Chrome extension. The agent's
// browser tools (worker/browser/mcp.mjs) hand a command to the worker; the
// extension, which can only call out, picks it up with a long poll, does it in
// the client's Chrome and posts the result back.

import { randomUUID } from 'node:crypto';

const ALIVE_MS = 35_000; // the extension polls at least every 20 s

export function createBridge({ now = Date.now } = {}) {
  const queue = [];           // commands the extension has not picked up yet
  const waiting = new Map();  // command id → the caller waiting for its result
  let poller = null;          // the extension's pending long poll
  let lastSeen = 0;

  const connected = () => now() - lastSeen < ALIVE_MS;

  return {
    connected,

    // From the agent's tool. Resolves with the extension's answer, or { ok: false, error }.
    call(command, timeoutMs = 60_000) {
      if (!connected()) {
        return Promise.resolve({ ok: false, error: 'The TeamForge extension is not connected. Install it in Chrome (see the README) and open the TeamForge page once, then try again.' });
      }
      const id = randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          const at = queue.findIndex((c) => c.id === id);
          if (at >= 0) queue.splice(at, 1);
          resolve({ ok: false, error: `The browser did not answer within ${Math.round(timeoutMs / 1000)} s.` });
        }, timeoutMs);
        waiting.set(id, { resolve, timer });
        const full = { id, ...command };
        if (poller) { const give = poller; poller = null; give(full); } else queue.push(full);
      });
    },

    // From the extension. Resolves with the next command, or null after waitMs.
    poll(waitMs = 20_000) {
      lastSeen = now();
      if (queue.length) return Promise.resolve(queue.shift());
      if (poller) poller(null); // a newer poll replaces a stale one
      return new Promise((resolve) => {
        const timer = setTimeout(() => { if (poller === give) poller = null; resolve(null); }, waitMs);
        const give = (command) => { clearTimeout(timer); lastSeen = now(); resolve(command); };
        poller = give;
      });
    },

    // From the extension: the outcome of one command.
    result(id, outcome) {
      lastSeen = now();
      const caller = waiting.get(id);
      if (!caller) return false;
      waiting.delete(id);
      clearTimeout(caller.timer);
      caller.resolve(outcome);
      return true;
    },

    stop() {
      if (poller) poller(null);
      for (const [, caller] of waiting) { clearTimeout(caller.timer); caller.resolve({ ok: false, error: 'The worker is stopping.' }); }
      waiting.clear();
      queue.length = 0;
    },
  };
}
