#!/bin/bash
# v10.0.182 · idempotent git hook installer.
#
# Installs .git/hooks/pre-push as a thin SHIM that execs the source
# script (scripts/pre-push-check.sh). The previous install pattern
# was `cp` — which created a copy that drifted from the source.
# v10.0.181's [12/12] Venice gate didn't run on its own ship push
# because the existing .git/hooks/pre-push was a stale May-03 copy.
#
# Shim pattern means edits to scripts/pre-push-check.sh take effect
# IMMEDIATELY on the next push. No re-install required after script
# changes — only after running this once per fresh clone.
#
# Run: bash scripts/install-hooks.sh
# Or:  pnpm run install-hooks

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-push"
SOURCE="$REPO_ROOT/scripts/pre-push-check.sh"

if [ ! -f "$SOURCE" ]; then
  echo "✗ source script not found: $SOURCE"
  exit 1
fi

cat > "$HOOK_PATH" <<'SHIM'
#!/bin/bash
# Auto-installed shim · always execs the latest scripts/pre-push-check.sh
# from the working tree. Edit the source script, not this file.
# Re-install: bash scripts/install-hooks.sh
set -e
REPO_ROOT=$(git rev-parse --show-toplevel)
exec bash "$REPO_ROOT/scripts/pre-push-check.sh" "$@"
SHIM

chmod +x "$HOOK_PATH"
echo "✓ pre-push hook installed as shim → scripts/pre-push-check.sh"
echo "  edits to the source script take effect on the next push automatically"
