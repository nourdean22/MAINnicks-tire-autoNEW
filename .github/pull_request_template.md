<!-- The four headings below are read by scripts/agent-os/merge-gate.mjs (assessBody). Replace every comment with your
text: a heading whose only content is a comment counts as EMPTY and the gate refuses the PR (exit 8). -->

## Summary

<!-- What changed, why now, which boundary it touches. One short paragraph. -->

## Self-review

<!-- Hostile read of my own diff. What did it find, and what did I fix or leave? ("No defects" is not a review.)
- Verify gate for the touched app(s) run, with counts: `pnpm verify:nick` / `pnpm verify:state` / worker `pnpm check`
- New or changed test seen RED on the old code first
- Docs and ledger row updated in this PR
Receipts: paste counts and exit codes, not "tests pass". -->

## Kill criterion + live check

<!-- Kill criterion: the result that would make us drop or revert this. -->

Live check YYYY-MM-DD: <!-- what will be read in production on that date, and what it must show; the date must be real -->

<!-- Ruling: each reversible decision made without Nour, with its cost if wrong (one line each, or "none"). -->

## 10x option

<!-- The bigger version of this change, and why it was or was not taken now. -->

<!-- Benchmarked against: name (URL, date), adopted: mechanism, rejected: mechanism and why. Or "nothing to benchmark" for a small fix. -->

## Second reader

<!-- Who or what read the diff besides me (agent, reviewer, tool) and what they found. -->

## Rollback

<!-- How to revert quickly, and any data caveat. -->
