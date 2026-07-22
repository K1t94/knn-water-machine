#!/usr/bin/env bash
set -euo pipefail

CHATGPT_HOME="${CODEX_CHATGPT_HOME:-$HOME/.codex-chatgpt}"
API_HOME="${CODEX_API_HOME:-$HOME/.codex-api}"

DO_CHATGPT=true
DO_API=true
DEVICE_AUTH=false
CONTINUE_ON_ERROR=false

usage() {
  cat <<'EOF'
Usage:
  ./.codex/bin/codex-login-modes.sh [options]

Options:
  --device-auth
      Use device-code auth for ChatGPT/subscription login.
      Useful on remote/headless machines.

  --subscription-only
  --chatgpt-only
      Login only to ChatGPT/Codex subscription mode.

  --api-only
      Login only to Platform API-key mode.

  --skip-subscription
  --skip-chatgpt
      Skip ChatGPT/Codex subscription login.

  --skip-api
      Skip Platform API-key login.

  --continue-on-error
      Continue if one login mode fails.

  -h, --help
      Show this help.

Examples:
  # Login both modes normally
  ./.codex/bin/codex-login-modes.sh

  # Login both modes, using device-code auth for ChatGPT mode
  ./.codex/bin/codex-login-modes.sh --device-auth

  # Only login subscription mode on a remote/headless machine
  ./.codex/bin/codex-login-modes.sh --subscription-only --device-auth

  # Only login API-key mode
  ./.codex/bin/codex-login-modes.sh --api-only

  # Try both, but continue if one fails
  ./.codex/bin/codex-login-modes.sh --device-auth --continue-on-error
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-auth)
      DEVICE_AUTH=true
      ;;
    --subscription-only|--chatgpt-only)
      DO_CHATGPT=true
      DO_API=false
      ;;
    --api-only)
      DO_CHATGPT=false
      DO_API=true
      ;;
    --skip-subscription|--skip-chatgpt)
      DO_CHATGPT=false
      ;;
    --skip-api)
      DO_API=false
      ;;
    --continue-on-error)
      CONTINUE_ON_ERROR=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex command not found." >&2
  echo "Install Codex CLI first, then rerun this script." >&2
  exit 127
fi

if [[ "$DO_CHATGPT" == false && "$DO_API" == false ]]; then
  echo "Error: nothing to do. Both login modes are disabled." >&2
  usage
  exit 2
fi

run_step() {
  local label="$1"
  shift

  echo
  echo "========================================"
  echo "$label"
  echo "========================================"

  if "$@"; then
    echo
    echo "OK: $label"
    return 0
  fi

  local exit_code=$?
  echo
  echo "FAILED: $label"
  echo "Exit code: $exit_code"

  if [[ "$CONTINUE_ON_ERROR" == true ]]; then
    echo "Continuing because --continue-on-error was set."
    return 0
  fi

  return "$exit_code"
}

login_chatgpt() {
  mkdir -p "$CHATGPT_HOME"

  echo "CODEX_HOME=$CHATGPT_HOME"
  echo "Mode: ChatGPT/Codex subscription"
  echo

  if [[ "$DEVICE_AUTH" == true ]]; then
    echo "Using device-code auth."
    echo "Follow the URL/code shown by Codex."
    CODEX_HOME="$CHATGPT_HOME" codex login --device-auth
  else
    echo "Using normal browser login."
    echo "Choose: Sign in with ChatGPT"
    CODEX_HOME="$CHATGPT_HOME" codex login
  fi
}

login_api() {
  mkdir -p "$API_HOME"

  echo "CODEX_HOME=$API_HOME"
  echo "Mode: Platform API-key billing"
  echo
  echo "Choose: API key"
  echo
  echo "Note: --device-auth is not used for API-key login."
  echo "Paste your API key when Codex asks for it."
  echo

  CODEX_HOME="$API_HOME" codex login
}

if [[ "$DO_CHATGPT" == true ]]; then
  run_step "Login: ChatGPT/Codex subscription mode" login_chatgpt
fi

if [[ "$DO_API" == true ]]; then
  run_step "Login: Platform API-key mode" login_api
fi

echo
echo "Done."
echo
echo "Available launchers:"
echo "  ./.codex/bin/codex-subscription.sh"
echo "  ./.codex/bin/codex-api.sh"
echo
echo "You only need to use the launcher for the mode you successfully configured."