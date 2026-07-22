#!/usr/bin/env bash
set -euo pipefail

export CODEX_HOME="${CODEX_API_HOME:-$HOME/.codex-api}"

exec codex "$@"
