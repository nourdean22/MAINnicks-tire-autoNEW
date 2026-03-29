#!/bin/bash
echo "=== Pre-Deploy Check ==="
echo ""
echo "1. TypeScript..."
npx tsc --noEmit 2>&1 | tail -3
echo ""
echo "2. Build..."
pnpm run build 2>&1 | tail -3
echo ""
echo "3. Git status..."
git status --short
echo ""
echo "=== Done ==="
