#!/usr/bin/env bash
# UserPromptSubmit / PostToolUse: record events ("prompt" or "tool" as $1).
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
command -v node >/dev/null 2>&1 || exit 0
exec node "$DIR/../worker/hook.mjs" emit "${1:-tool}"
