# Installing Claude TeamForge

## Requirements

- Node.js **≥ 24** (`node --version`) — the worker uses the built-in `node:sqlite`, no npm installs needed at runtime.
- Claude Code with plugin support.

## Install

In any Claude Code session:

```
/plugin marketplace add /home/fares/claude-teamforge
/plugin install claude-teamforge@teamforge-local
/reload-plugins
```

Then start a **new session** (or `/clear`) so the SessionStart hook fires: it boots the
worker and injects the TeamForge workflow instructions.

Open the dashboard: **http://127.0.0.1:4519**

## What gets installed

| Piece | Effect |
|---|---|
| SessionStart hook | starts worker, injects workflow law + past project decisions |
| UserPromptSubmit / PostToolUse hooks | stream prompts and tool events to the timeline |
| PreToolUse hook (Write\|Edit) | **denies source-file writes** while the workflow is pre-implementation |
| `teamforge` skill | the phase pipeline Claude follows |
| 7 agents | `teamforge-pm`, `-architect`, `-frontend`, `-backend`, `-qa`, `-security`, `-reviewer` |

Data lives in `~/.claude-teamforge/teamforge.db`; worker log in `~/.claude-teamforge/worker.log`.

## Updating

After editing the plugin source: rebuild the dashboard if it changed
(`cd dashboard && npm install && npm run build`), then `/reload-plugins` and restart the
worker: `pkill -f 'worker/server.mjs'` (the next session restarts it).

## Uninstall

```
/plugin uninstall claude-teamforge@teamforge-local
```

Then optionally `rm -rf ~/.claude-teamforge` and `pkill -f 'worker/server.mjs'`.

## Troubleshooting

- **Dashboard empty** — no mission started yet; give Claude a build request.
- **Port 4519 busy** — something else owns the port; stop it or edit `PORT` in `worker/server.mjs` (and the URLs in `worker/cli.mjs`, `worker/hook.mjs`, `dashboard/vite.config.js`).
- **Writes blocked unexpectedly** — a stale active session is holding the gate. `node worker/cli.mjs state` to inspect; advance it or approve its gates. The hook is fail-open: if the worker is down, nothing is ever blocked.
- **Hooks silent** — check `~/.claude-teamforge/worker.log` and that `node` is on PATH for GUI-launched apps.
