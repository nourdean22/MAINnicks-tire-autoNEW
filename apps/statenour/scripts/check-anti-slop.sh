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
# This gate does git-grep on tracked files. Strict: fails the push
# on ANY new occurrence under app/ or components/. The link-review
# editorial spread (v10.0.193 · DFII 15) is the baseline — every
# new component should match or exceed that bar.
#
# Override (emergency only): ANTI_SLOP_GATE_SOFT=1 git push

set -e

LEAKS=""
LEAK_COUNT=0

# 1. Inter font imports — covers next/font/google + raw imports
# Vendored tool integrations (lib/ai/last30days, lib/ai/moneyprinter) are
# not UI surfaces — excluded 2026-07-30 so the gate reports only real leaks.
INTER_HITS=$(git grep -lE 'next/font/google.*Inter|fonts\.googleapis.*Inter|font-family:\s*[^;]*Inter|Inter[a-zA-Z]*_init|"Inter"' -- 'app/**' 'components/**' 'lib/**' ':!lib/ai/last30days/**' ':!lib/ai/moneyprinter/**' 2>/dev/null || true)
if [ -n "$INTER_HITS" ]; then
  LEAK_COUNT=$((LEAK_COUNT + $(echo "$INTER_HITS" | wc -l)))
  LEAKS="$LEAKS\n  Inter font imports:"
  for f in $INTER_HITS; do
    LEAKS="$LEAKS\n    · $f"
  done
fi

# 2. Roboto / Arial defaults
DEFAULT_FONT_HITS=$(git grep -lE 'next/font/google.*Roboto|fonts\.googleapis.*Roboto|"Roboto"|"Arial"' -- 'app/**' 'components/**' 'lib/**' ':!lib/ai/last30days/**' ':!lib/ai/moneyprinter/**' 2>/dev/null || true)
if [ -n "$DEFAULT_FONT_HITS" ]; then
  LEAK_COUNT=$((LEAK_COUNT + $(echo "$DEFAULT_FONT_HITS" | wc -l)))
  LEAKS="$LEAKS\n  Roboto/Arial AI-default fonts:"
  for f in $DEFAULT_FONT_HITS; do
    LEAKS="$LEAKS\n    · $f"
  done
fi

# 3. Purple SaaS gradients (from-purple-* / to-purple-* / via-purple-*)
PURPLE_HITS=$(git grep -lE 'from-purple-|to-purple-|via-purple-' -- 'app/**' 'components/**' 2>/dev/null || true)
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
    echo "  emergency override: ANTI_SLOP_GATE_SOFT=1 git push"
    exit 1
  fi
else
  echo "  ✅  no anti-slop UI patterns (Inter / Roboto / Arial / purple gradients)"
fi
