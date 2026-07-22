#!/usr/bin/env bash
set -euo pipefail

export CODEX_HOME="${CODEX_CHATGPT_HOME:-$HOME/.codex-chatgpt}"

exec codex "$@"
