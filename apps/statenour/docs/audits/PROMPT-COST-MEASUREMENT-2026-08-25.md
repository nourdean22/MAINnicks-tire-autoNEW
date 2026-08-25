# Prompt-cost measurement — where the chat tokens actually go (2026-08-25)

**Phase 4 of the chat-stack wave, re-scoped by operator directive:** the tool
layer was measured NOT to be the problem; the system prompt + context blocks
are. This is the measurement. **No prompt edits ship with this report** — every
lever below is a proposal gated on the eval suite, per the same directive
("measure before touching anything").

## Instruments (each named, each runnable)

| Instrument | What it measures | Run |
|---|---|---|
| `scripts/measure-prompt-size.ts` | The REAL prompt built against live Neon (runs inside `verify:hard` as `prompt:size-check`) | `pnpm prompt:size-check` |
| `scripts/measure-static-layer.ts` | Layer 1 (static prefix) offline, zero I/O | `pnpm tsx scripts/measure-static-layer.ts` |
| `ai_generations` table | Real per-request `prompt_tokens` as billed | SQL below |
| Sibling session's tool-layer serialization (2026-08-25) | Tool-schema share per request | their receipts |

## The stack, measured 2026-08-25

| Layer | Size | Share of built prompt | Source |
|---|---|---|---|
| **Whole built prompt (live)** | 49,344 chars ≈ **12,336 tok** · 38 sections · cap 65,000 (24% headroom) | 100% | measure-prompt-size vs live Neon |
| Layer 1 static prefix | 13,806 chars ≈ **3,452 tok** (operator policy alone: 1,183) | 28% | measure-static-layer |
| **Dynamic context blocks** | ≈ **8,884 tok** | **72%** | subtraction of the two above |
| — ACTIVE AGENDA ITEMS | 10,583 chars ≈ **2,646 tok** | **21% — the single largest section** | measure-prompt-size section table |
| — Processing intake (static) | 4,125 chars ≈ 1,031 tok | 8% | same |
| — persona/style cluster (NICK header + Response style + BRAND VOICE + Behavioral patterns) | ≈ 2,017 tok combined | 16% | same |
| Tool layer (per request) | pruned floor 18 ≈ 1.9K · budget 24 ≈ 2.4K | ~10–13% of request | sibling measurement |
| Real request p50 `prompt_tokens` | **17,737** (n=62 of 764 rows carry the field — 8.1% coverage, lane-biased; stated, not hidden) | — | `ai_generations`, 14d |
| Remainder ≈ history + user msg | ≈ 17.7K − 12.3K − ~2.2K ≈ **~3.2K** | — | subtraction |

Corroboration: 764 chat requests / 14d, avg prompt 21,868 tok, p90 23,896
(`ai_generations`, full-row aggregate — the total includes tool schemas and
history, which the built-prompt instrument does not).

## Root cause behind the #1 line item — found, not just sized

`lib/ai/context/nick-prime-context.ts:116-120`: the agenda query is
**unbounded** — `prisma.agendaItem.findMany({ where: { status: { in:
["ACTIVE","SNOOZED"] } } })` with **no `take`**, and
`lib/ai/prompt/v2/renderer.ts:renderAgendaItems` renders **every row** (title
≤120 + description ≤200 chars each). Prod today: **71 ACTIVE rows, oldest
2026-06-28** — two months of accumulated commitments, all injected into every
turn. 71 × ~149 avg stored chars → the measured 10,583-char block. The prompt
grows monotonically with agenda accumulation; the 65K cap's 24% headroom is
being consumed by a table with no pruning story.

## Ranked levers — PROPOSALS ONLY, each gated on the eval suite

1. **Cap + rank the agenda block** (biggest, safest): `take` ~15–20 ranked by
   dueDate-soonest then recency, plus a one-line "and N older items — ask to
   see them" tail so nothing silently disappears. Est. saving ≈ **1,800–2,100
   tok/turn** (~15% of the built prompt). Behavior-visible (which commitments
   Nick spontaneously enforces) → operator sign-off + `tests/eval` persona/
   memory replay before/after.
2. **Compress "Processing intake"** (static, 1,031 tok): prose → numbered
   rules. Est. ≈ **300–500 tok**. Low risk; still eval-gated (intake rules
   steer tool-first behavior).
3. **Persona/style cluster** (~2,017 tok): dedupe overlap between Response
   style / BRAND VOICE / Behavioral patterns. Est. ≈ **400–700 tok**. HIGHEST
   regression risk — the 2026-08-15 "feels dumb" incident taught that quality
   complaints trace to output budgets, not prompt length; do LAST, smallest
   first, with the persona golden set as the gate.
4. **NOT proposed:** trimming Layer-2 live data (task counts, truth grounding,
   brain recall) — the fabrication-defense stack (L4) depends on it; and any
   move against the 65K cap itself.

Sequencing note: lever 1 alone brings the built prompt to ~10.3K tok and the
p50 request to ~15.9K — a ~10% total-cost cut from one bounded query.

## What this report deliberately does not do

Ship any of it. Operator picks levers; each lands as its own PR with
before/after `measure-prompt-size` numbers and an eval replay in the body.
