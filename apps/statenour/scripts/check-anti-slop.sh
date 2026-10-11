#!/bin/bash
# v10.0.197 · Anti-slop UI guard.
#
# /web-artifacts-builder + /frontend-design enumerate the AI-slop
# patterns we want kept out of statenour:
#   · Inter font (the AI-default — every Vercel template uses it)
#   · Purple-on-white SaaS gradients (from-purple-/to-purple- in
#     Tailwind)
#   · Roboto/Arial system-font imports (the other AI defaults)
#
# This gate git-greps tracked AND untracked files under app/, components/,
# features/, hooks/ and lib/ (PATHS below). Strict: fails verify:hard on
# ANY occurrence, and fails closed when git grep cannot run. The link-review
# editorial spread (v10.0.193 · DFII 15) is the baseline — every
# new component should match or exceed that bar.
#
# Override (emergency only): ANTI_SLOP_GATE_SOFT=1 downgrades a hit to a warning.
# It does NOT relate to `git push` - this script is not in any push hook. It runs
# inside `pnpm verify:hard`. The old text here paired the flag with a push command,
# which told the reader a push gate existed AND how to bypass it; neither was true.

set -e

LEAKS=""
LEAK_COUNT=0

# 2026-10-10 (R3-10) scope: every UI tree. features/ and hooks/ ship UI too, and lib/ is in every arm
# (the purple arm skipped it). Vendored tool integrations (lib/ai/last30days, lib/ai/moneyprinter) are
# not UI surfaces - excluded 2026-07-30 so the gate reports only real leaks.
PATHS=('app/**' 'components/**' 'features/**' 'hooks/**' 'lib/**' ':!lib/ai/last30days/**' ':!lib/ai/moneyprinter/**')

# git grep over PATHS, untracked files included (verify:hard runs before a new file's first `git add`).
# git grep exits 1 for "no match" and >1 for an error (not a work tree, a bad pattern). The old
# `2>/dev/null || true` read an error as a clean tree; now only exit 1 may mean clean.
scan() {
  local out code=0
  out=$(git grep --untracked "$@" -- "${PATHS[@]}") || code=$?
  if [ "$code" -gt 1 ]; then
    echo "  FAIL  anti-slop gate could not scan (git grep exit $code) - failing closed" >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

# Drops lines that are only a comment, since a note naming a font is not a use of it: `// ...`, or a
# JSDoc middle line ` * ...` that does not close the comment. Anything that can carry code after the
# comment (`/* x */ import`, ` */ export`, `{/* x */} <p>`) and `* {` (a CSS selector) stays: fail closed.
# With $1=1 each line is `file:line:text` from git grep -n.
drop_comment_lines() {
  awk -v p="${1:-0}" '{
    t = $0
    if (p) sub(/^[^:]*:[0-9]+:/, "", t)
    if (t ~ /^[ \t]*\/\//) next
    if (t ~ /^[ \t]*\*([ \t]+[^{,+>~ \t]|$)/ && t !~ /\*\//) next
    print
  }'
}

# `file:line:text` hits -> unique files, comment-only lines dropped.
files_of_code_hits() {
  drop_comment_lines 1 | cut -d: -f1 | sed '/^$/d' | sort -u
}

# Prettier wraps a long font import over several lines, which a line grep never sees: join each file
# that names next/font/google (comment lines dropped) and match one whole `import { ... } from`. $1 = names.
multiline_font_imports() {
  local f cands
  cands=$(scan -l 'next/font/google') || exit 1
  while IFS= read -r f; do
    if [ -n "$f" ] && drop_comment_lines < "$f" | tr '\n' ' ' |
      grep -qE "import[[:space:]]*\{[^}]*\b($1)\b[^}]*\}[[:space:]]*from[[:space:]]*[\"']next/font/google"; then
      echo "$f"
    fi
  done <<< "$cands"
}

# A quoted CSS/JS font stack ("Inter, sans-serif") is read item by item: Q is a quote, NQ a non-quote.
Q="[\"'\`]"
NQ="[^\"'\`]"

# 1. Inter font imports — covers next/font/google + raw imports
# Vendored tool integrations (lib/ai/last30days, lib/ai/moneyprinter) are
# not UI surfaces — excluded 2026-07-30 so the gate reports only real leaks.
# 2026-08-25 · `\bInter\b.*next/font/google` ADDED. The original alternation
# required next/font/google to come BEFORE Inter on the line, so it could not
# match the canonical Next.js form, which is the single most common way the
# AI-default font enters a codebase:
#
#     import { Inter } from "next/font/google";
#
# Inter is first, so `next/font/google.*Inter` never fired, `"Inter"` needs
# double quotes around the bare word, and the gate printed
# "no anti-slop UI patterns" over the exact pattern it names first. Found by
# writing a canary that RUNS this script against a planted offender — reading
# the source had confirmed the check existed for months.
# `\b` is load-bearing: bare `Inter` also matches Interface / Internal /
# "Inter-post", and the paired next/font/google term is what keeps the
# alternative from firing on the several comments that say "NO Inter".
# 2026-10-10 (R3-10): a Tailwind v4 `--font-*:` token and Inter anywhere in a quoted font stack
# (`fontFamily: "Inter, sans-serif"`) are uses too; the stack arm replaces the bare `"Inter"` one.
INTER_RE="next/font/google.*Inter|\bInter\b.*next/font/google|fonts\.googleapis.*Inter|font-family:\s*[^;]*Inter|Inter[a-zA-Z]*_init"
INTER_RE="$INTER_RE|--font-[a-zA-Z0-9-]*:[^;]*\bInter\b|${Q}(${NQ}*,[[:space:]]*)?Inter([[:space:]]*,${NQ}*)?${Q}"
INTER_LINES=$(scan -nE "$INTER_RE")
INTER_ML=$(multiline_font_imports 'Inter')
INTER_HITS=$({ printf '%s\n' "$INTER_LINES" | files_of_code_hits; printf '%s\n' "$INTER_ML"; } | sed '/^$/d' | sort -u)
if [ -n "$INTER_HITS" ]; then
  LEAK_COUNT=$((LEAK_COUNT + $(echo "$INTER_HITS" | wc -l)))
  LEAKS="$LEAKS\n  Inter font imports:"
  for f in $INTER_HITS; do
    LEAKS="$LEAKS\n    · $f"
  done
fi

# 2. Roboto / Arial defaults
# Same order-bug fix as the Inter block above: `import { Roboto } from
# "next/font/google"` put the font name first and slipped the original
# alternation. Fixed here in the same pass rather than left for the next
# person to rediscover — it is one regex, and the two checks are the same
# defect wearing different names.
# 2026-10-10 (R3-10): docs/DESIGN.md bans Roboto/Arial as the PRIMARY face, so the font-family, `--font-*`
# and quoted-stack arms match them only as the first item; the system stack's `..., Roboto, sans-serif`
# fallback (app/api/cron/weekly-digest) stays legal.
DEFAULT_RE="next/font/google.*(Roboto|Arial)|\b(Roboto|Arial)\b.*next/font/google|fonts\.googleapis.*Roboto"
DEFAULT_RE="$DEFAULT_RE|(font-family|--font-[a-zA-Z0-9-]*):[[:space:]]*${Q}?(Roboto|Arial)\b|${Q}(Roboto|Arial)([[:space:]]*,${NQ}*)?${Q}"
DEFAULT_LINES=$(scan -nE "$DEFAULT_RE")
DEFAULT_ML=$(multiline_font_imports 'Roboto|Arial')
DEFAULT_FONT_HITS=$({ printf '%s\n' "$DEFAULT_LINES" | files_of_code_hits; printf '%s\n' "$DEFAULT_ML"; } | sed '/^$/d' | sort -u)
if [ -n "$DEFAULT_FONT_HITS" ]; then
  LEAK_COUNT=$((LEAK_COUNT + $(echo "$DEFAULT_FONT_HITS" | wc -l)))
  LEAKS="$LEAKS\n  Roboto/Arial AI-default fonts:"
  for f in $DEFAULT_FONT_HITS; do
    LEAKS="$LEAKS\n    · $f"
  done
fi

# 3. Purple SaaS gradients (from-purple-* / to-purple-* / via-purple-*)
#
# Waivers are BY SIGNATURE, not by filename: a line carrying an
# `anti-slop-allow` marker is exempt, but a NEW purple gradient in that
# same file still trips the gate. Excluding whole files would have made
# this check permanently blind to the file it was waived for.
# Comment lines are NOT exempt here: tests/repo/anti-slop-gate.test.ts plants its canary as a comment.
PURPLE_LINES=$(scan -nE 'from-purple-|to-purple-|via-purple-')
PURPLE_HITS=$(printf '%s\n' "$PURPLE_LINES" | grep -v 'anti-slop-allow' | cut -d: -f1 | sed '/^$/d' | sort -u)
if [ -n "$PURPLE_HITS" ]; then
  LEAK_COUNT=$((LEAK_COUNT + $(echo "$PURPLE_HITS" | wc -l)))
  LEAKS="$LEAKS\n  Purple-on-white SaaS gradients:"
  for f in $PURPLE_HITS; do
    LEAKS="$LEAKS\n    · $f"
  done
fi

if [ "$LEAK_COUNT" -gt 0 ]; then
  if [ "${ANTI_SLOP_GATE_SOFT:-0}" = "1" ]; then
    echo -e "  ⚠️   $LEAK_COUNT anti-slop leak(s) (soft override):$LEAKS"
  else
    echo -e "  ❌  $LEAK_COUNT anti-slop UI pattern leak(s):$LEAKS"
    echo ""
    echo "  background · /web-artifacts-builder + /frontend-design"
    echo "  enumerate Inter font, Roboto/Arial defaults, and purple"
    echo "  SaaS gradients as AI-slop signatures. The repo's design"
    echo "  baseline is /brain/link-review (DFII 15). New components"
    echo "  should match or exceed it."
    echo ""
    echo "  fix · pick a non-default font (statenour uses system stack"
    echo "        + custom display where needed) and skip purple"
    echo "        gradients (gold-on-dark is the brand)."
    echo ""
    # No override is advertised here any more. This script is not wired into a
    # push hook, so the old override line named an escape hatch for a gate that
    # did not run - telling the reader both that a push gate existed and how to
    # bypass it, neither of which was true. It runs inside verify:hard.
    echo "  this runs inside pnpm verify:hard - fix the hit, do not skip the gate."
    exit 1
  fi
else
  echo "  ✅  no anti-slop UI patterns (Inter / Roboto / Arial / purple gradients)"
fi
