#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing in WSL. Install Node 22 first."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@9.0.0 --activate
fi

if ! command -v openclaw >/dev/null 2>&1; then
  npm i -g openclaw
fi

openclaw setup --wizard
openclaw gateway install
openclaw gateway start
openclaw plugins enable voice-call || true
openclaw gateway restart
openclaw status
