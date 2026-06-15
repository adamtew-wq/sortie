#!/usr/bin/env bash
# afk-ralph.sh — autonomous Ralph loop.
#
# Default: run iterations on the host with --dangerously-skip-permissions.
#          Uses the host's existing claude auth — no extra setup. Same risk
#          posture as ralph-once.sh.
#
# --sandbox: run each iteration inside a Docker sandbox VM (isolation from
#            host filesystem). Requires Docker Desktop with `docker sandbox`,
#            and a one-time interactive /login inside the sandbox.
#
# Usage:
#   ./afk-ralph.sh <iterations>            # host loop
#   ./afk-ralph.sh --sandbox <iterations>  # docker sandbox loop

set -e

MODE="host"
if [[ "$1" == "--sandbox" ]]; then
  MODE="sandbox"
  shift
fi

ITERATIONS="${1:-}"
if [[ -z "$ITERATIONS" || ! "$ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [--sandbox] <iterations>" >&2
  exit 1
fi

PROMPT="@progress.txt \
1. Run 'gh issue list --label ready-for-agent --state open' to find the next task. \
2. Pick the lowest-numbered issue not blocked by an open issue. \
3. Use the /tdd skill to implement it (red-green-refactor: failing test first, then make it pass, then refactor). Run the full test suite before committing. \
4. Commit with 'Closes #N' in the message and push. \
5. Append to progress.txt what you did. \
ONLY WORK ON A SINGLE TASK. \
If no unblocked issues remain, output <promise>COMPLETE</promise>."

# -----------------------------------------------------------------------------
# Sandbox preflight (only when --sandbox is requested)
# -----------------------------------------------------------------------------
SANDBOX_NAME=""
if [[ "$MODE" == "sandbox" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker not found on PATH — install Docker Desktop or drop --sandbox" >&2
    exit 1
  fi

  if ! docker sandbox --help >/dev/null 2>&1; then
    echo "error: 'docker sandbox' subcommand unavailable — needs Docker Desktop 4.50+" >&2
    echo "       drop --sandbox to use the host loop instead" >&2
    exit 1
  fi

  SANDBOX_NAME="claude-$(basename "$PWD")"

  if ! docker sandbox ls 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$SANDBOX_NAME"; then
    echo "info: creating sandbox '$SANDBOX_NAME' for $PWD"
    if ! echo y | docker sandbox create claude . >/dev/null 2>&1; then
      echo "error: failed to create sandbox '$SANDBOX_NAME'" >&2
      exit 1
    fi
  fi

  # Auth check — `claude --print` exits 1 with "Not logged in" if unauthenticated.
  AUTH_OUT=$(docker sandbox exec "$SANDBOX_NAME" claude --permission-mode acceptEdits -p "ok" 2>&1 || true)
  if echo "$AUTH_OUT" | grep -qi "not logged in"; then
    cat >&2 <<EOF
error: claude inside sandbox '$SANDBOX_NAME' is not logged in.

One-time setup (interactive):
  docker sandbox run $SANDBOX_NAME
  # inside the sandbox, run: /login   (follow the OAuth flow)
  # then: /exit

Then re-run this script.
EOF
    exit 1
  fi
fi

# -----------------------------------------------------------------------------
# Failure-mode helpers (lessons learned from prior runs)
# -----------------------------------------------------------------------------
# Exit codes:
#   0 — complete (loop finished or <promise>COMPLETE</promise>)
#   1 — real failure (claude exit non-zero, not a known transient cause)
#   2 — Claude usage limit hit; resume after reset
#
# When piping this script through `tee` or similar, remember to set
# `set -o pipefail` in the caller — otherwise the pipe will mask these
# exit codes and a failed run will report success.
MAX_RETRIES=2
RETRY_BACKOFF_SECONDS=30

run_claude_iteration() {
  if [[ "$MODE" == "sandbox" ]]; then
    docker sandbox run "$SANDBOX_NAME" -- --permission-mode acceptEdits -p "$PROMPT" 2>&1
  else
    claude --dangerously-skip-permissions -p "$PROMPT" 2>&1
  fi
}

is_usage_limit() {
  [[ "$1" == *"hit your limit"* ]] || [[ "$1" == *"usage limit"* ]]
}

is_transient_error() {
  [[ "$1" == *"Stream idle timeout"* ]] || \
  [[ "$1" == *"partial response received"* ]] || \
  [[ "$1" == *"ETIMEDOUT"* ]] || \
  [[ "$1" == *"ECONNRESET"* ]] || \
  [[ "$1" == *"503 Service Unavailable"* ]] || \
  [[ "$1" == *"504 Gateway Timeout"* ]] || \
  [[ "$1" == *"Internal Server Error"* ]]
}

# -----------------------------------------------------------------------------
# Loop
# -----------------------------------------------------------------------------
for ((i=1; i<=ITERATIONS; i++)); do
  echo "=== Ralph iteration $i/$ITERATIONS ($MODE) ==="

  attempt=0
  while true; do
    if result=$(run_claude_iteration); then
      break
    fi

    # Non-zero exit. Inspect $result to decide whether to retry, stop, or fail.
    if is_usage_limit "$result"; then
      reset_line=$(echo "$result" | grep -oE "resets [^[:cntrl:]]*" | head -1 || true)
      cat >&2 <<EOF
=== Usage limit hit on iteration $i ===
${reset_line:-Reset time not parseable from claude output.}

Ralph cannot make progress until the limit resets. Stopping the loop
cleanly (exit 2) so you can re-run \`./afk-ralph.sh\` after the reset.

Any uncommitted work from previous iterations is preserved in the
working tree — check \`git status\` and \`git diff --cached\`. The last
iteration may have staged a complete implementation that just needs
\`git commit\` after the reset.
EOF
      echo "--- claude output (last 20 lines) ---" >&2
      echo "$result" | tail -20 >&2
      exit 2
    fi

    if is_transient_error "$result" && (( attempt < MAX_RETRIES )); then
      attempt=$((attempt + 1))
      backoff=$(( RETRY_BACKOFF_SECONDS * attempt ))
      echo "warn: iteration $i transient API error (attempt $attempt/$MAX_RETRIES); retrying in ${backoff}s..." >&2
      echo "--- transient output (last 10 lines) ---" >&2
      echo "$result" | tail -10 >&2
      sleep "$backoff"
      continue
    fi

    # Real failure, or transient retries exhausted.
    echo "error: iteration $i failed (claude exit non-zero)" >&2
    echo "--- output ---" >&2
    echo "$result" >&2
    exit 1
  done

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "Complete after $i iterations."
    exit 0
  fi
done
