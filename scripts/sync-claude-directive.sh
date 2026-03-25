#!/bin/bash
# sync-claude-directive.sh
# Syncs ~/CLAUDE.md master directive to all project roots on this machine.
# Run manually: bash ~/scripts/sync-claude-directive.sh
# Or add to crontab: 0 */6 * * * /bin/bash ~/scripts/sync-claude-directive.sh >> ~/scripts/sync-claude-directive.log 2>&1

set -euo pipefail

SOURCE="$HOME/CLAUDE.md"
LOG_FILE="$HOME/scripts/sync-claude-directive.log"
SEARCH_DIRS=("$HOME/Desktop" "$HOME/Documents" "$HOME/Projects" "$HOME/repos" "$HOME/dev" "$HOME/code" "$HOME/sites")
INSTALLED=0
FAILED=0
FAILED_DIRS=()

echo "━━━━━━━━━━━━━━━━━━━━━━━"
echo "CLAUDE.md Sync — $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━"

# Check source exists
if [ ! -f "$SOURCE" ]; then
    echo "ERROR: $SOURCE not found. Create the master directive at ~/CLAUDE.md first."
    exit 1
fi

# Find all project roots (directories containing .git, package.json, or src/)
find_projects() {
    for dir in "${SEARCH_DIRS[@]}"; do
        [ -d "$dir" ] || continue
        # Find .git directories (project roots)
        find "$dir" -maxdepth 5 -type d -name ".git" -not -path "*/node_modules/*" 2>/dev/null | while read gitdir; do
            dirname "$gitdir"
        done
        # Find package.json files (project roots)
        find "$dir" -maxdepth 5 -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | while read pkg; do
            dirname "$pkg"
        done
    done | sort -u
}

echo ""
echo "Scanning for projects..."
echo ""

PROJECTS=$(find_projects)

if [ -z "$PROJECTS" ]; then
    echo "No projects found in search directories."
    echo "Searched: ${SEARCH_DIRS[*]}"
    exit 0
fi

while IFS= read -r project; do
    # Copy to project root
    if cp "$SOURCE" "$project/CLAUDE.md" 2>/dev/null; then
        echo "✓ $project/CLAUDE.md"
        INSTALLED=$((INSTALLED + 1))
    else
        echo "✗ $project (write failed)"
        FAILED=$((FAILED + 1))
        FAILED_DIRS+=("$project")
    fi

    # Also copy to .claude/ subdirectory if it exists
    if [ -d "$project/.claude" ]; then
        if cp "$SOURCE" "$project/.claude/CLAUDE.md" 2>/dev/null; then
            echo "  ✓ $project/.claude/CLAUDE.md"
        fi
    fi
done <<< "$PROJECTS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━"
echo "Installed: $INSTALLED"
echo "Failed: $FAILED"
if [ ${#FAILED_DIRS[@]} -gt 0 ]; then
    echo "Failed directories:"
    for d in "${FAILED_DIRS[@]}"; do
        echo "  - $d"
    done
fi

# Verify home directory fallback
if [ -f "$HOME/CLAUDE.md" ]; then
    echo "Global fallback: ✓ ~/CLAUDE.md exists"
else
    echo "Global fallback: ✗ ~/CLAUDE.md missing"
fi

echo ""
echo "Done."
