# Product Roadmap — NOUR OS

**Honest state: statenour has no single canonical roadmap file**, unlike Nick's Tire. Work here has
run in *waves* — each one closed out in `CURRENT-TRUTH.md` and the memory index rather than planned
far ahead in a document. This file records where the plan actually lives so the next session does
not invent a roadmap that competes with reality.

## Where the plan actually lives

| Source | What it tells you | Trust |
|---|---|---|
| [`apps/statenour/docs/CURRENT-TRUTH.md`](../../../apps/statenour/docs/CURRENT-TRUTH.md) | What shipped, what is retired, what the landmines are | **Highest** — read first |
| `~/.claude/projects/C--Users-nourd-NOURCITY/memory/` | Wave-by-wave outcomes and standing rules | High, but verify against prod |
| [`apps/statenour/docs/roadmap/next-arc-2026-05-12.md`](../../../apps/statenour/docs/roadmap/next-arc-2026-05-12.md) | A **brainstorm** of three candidate arcs (observability · cognitive amplification · business-OS expansion) | Historical — dated 2026-05-12, predates most of what shipped |
| `apps/statenour/.remember/` | Last-session handoff | Verify before acting |

Production evidence outranks every row above — see the source-of-truth hierarchy in
[`AGENTS.md`](../../../AGENTS.md).

## Standing direction

Rather than a feature queue, the durable direction is:

1. **Make the system honest** — loud failures, real receipts, no fabricated data in any
   operator-facing surface.
2. **Make memory reliable** — recall that cites evidence and does not silently go stale.
3. **Reduce operator input cost** — fewer taps, answer-first output, phone-first surfaces.
4. **Only then, add capability.**

## Before proposing a wave — read this first

**The dominant failure mode here is proposing work that is already built.** Multiple consecutive
plans have been gated for exactly this, several within a single day, including a controller that
was already fully wired and a set of "missing" guards that were already default-on. Cost per
incident is a full planning cycle.

So, before writing a roadmap item:

1. Read `CURRENT-TRUTH.md` — especially the "Retired — do NOT treat as current" section.
2. Confirm the gap exists **in production**, not in documentation.
3. Confirm your instrument can actually see the target before you read a zero from it.
4. Check [`docs/UPSTREAMS.md`](../../../docs/UPSTREAMS.md) before proposing any new platform,
   library or MCP server — a row there is an answer, not a starting point.
