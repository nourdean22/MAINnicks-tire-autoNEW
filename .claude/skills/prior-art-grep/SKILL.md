---
name: prior-art-grep
description: Use BEFORE adding any new table, queue, tool, feature flag, cron, env var, or registry entry. Run a fixed grep set and write the answer down before building. This repo has standing "no second implementation" rules that are easy to violate by accident.
---

# Prior-Art Grep

Cheap, mechanical, and it has already fired twice in one session.

## The base rate

Two near-misses in a single wave (2026-08-28):

- A tool was nearly rebuilt under a new name while the original existed.
- A `next_action` table was nearly added when **`PostTurnOutbox` already
  provided it** — a durable queue with claim/retry/dead-letter and
  `nextAttemptAt` as a scheduling primitive. Caught by research, not by
  the author.

The second would have violated the standing rule that there is **no third
queue beside `PostTurnOutbox` and `WorkItem`**.

## Run this before building, and paste the result

```bash
# schema models
git grep -nE "^model " -- apps/statenour/prisma/schema.prisma
git grep -rn "pgTable(" -- apps/nickstire/drizzle

# tool names + catalog
git grep -rn "<candidate-name>" -- apps/statenour/lib/ai
# cron manifest
git grep -rn "<candidate-name>" -- apps/statenour/config apps/nickstire/server
# feature flags / env
git grep -n "<CANDIDATE_ENV>" -- .env.example
```

Then write ONE line before you build:

> Prior art: none / `<file:line>` — reusing / `<file:line>` — insufficient
> because \<reason\>.

"Insufficient because" must name a concrete missing capability, not a
preference for a fresh start.

## The searches that miss

A grep is only as good as the shape you searched for. Known blind spots
in this repo:

- **Dynamic `import()`** hides a dependency from three plain greps. The
  first dependency-cruiser scan caught `lib/services/ultron-ticker.ts`
  dynamically importing an otherwise-unused route (`void maturityMod`) —
  a shape greps had missed.
- **Case.** Use `grep -i`. A case-sensitive sweep for `"new ownership"`
  missed the capitalized `"New ownership"` and shipped it to production
  (2026-09-03, fixed in #2099).
- **Line-number windows.** When a claim rests on what a structure does
  NOT contain, read the whole structure by its delimiters —
  `sed -n '/const typeMap/,/};/p'`, never `sed -n '140,165p'`. A window
  that clips a map's head manufactures a false "no such mapping".
- **Comments.** Filter them before believing a hit
  (`grep -vE '^\S+:[0-9]+: *(//|\*|#)'`); see `assert-the-consumer`.

## Confidence

Medium — two instances, one session. Kept because the cost is one command
and the failure it prevents is a duplicate durable store.

Related: `assert-the-consumer` · `plan-gate` (gate a pasted plan's claims
the same way) · `statenour-verify`.
