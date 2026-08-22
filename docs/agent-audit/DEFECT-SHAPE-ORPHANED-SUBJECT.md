# Defect shape · the orphaned subject

**Status:** new shape, first confirmed 2026-08-22 (statenour `/brain` → Discover).
**Adjacent to** [`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md), which tracks
per-control canary coverage. This file describes a defect *class* that the coverage table's
question ("does this control have a canary?") does not detect. The two want reconciling; they
are deliberately separate files because they were written by concurrent sessions.

---

## The shape

> **A feedback loop whose write survives, but whose subject does not.**

The control is present. It fires. It persists. Its consumer exists and reads it. Every
link in the chain passes inspection **individually** — and the loop is still dead, because the
row the signal was attached to is replaced by the producer before the signal is ever used.

The signal is not lost. Its *referent* is.

## Why the standard audit scores it GREEN

The dominant defect class in this repo — eleven confirmed instances on 2026-08-21 alone — is
*a correct control that was never wired to anything*. The standard probe is:

```
grep for readers of <the thing the control writes>
```

Zero readers → dead control. One or more readers → wired.

**That probe cannot see this shape.** Run against Discover on 2026-08-22:

- `discoveryVerdict` — written by `rateDiscovery()`, read by `listDiscoveries()`. Wired.
- `IntelligenceOutcome.decision` — written, read by `outcomesNeedingReview()`. Wired.
- `outcomeUseful` — written, read by the weekly `outcome-harvest` cron. Wired.
- One ledger row had closed end-to-end with a real `result_ref='task:cmt0kz8qw…'`. Proven live.

Every check green. The feature was nonetheless asking for verdicts that could not survive
24 hours, because the producer wrote its rows under

```ts
`blindspot_${spot.domain}_${Date.now()}`
```

and `remember()` upserts on `(category, key)`. A clock in the key asserts *"today's sighting of
this fact is a different fact from yesterday's."* Every nightly run therefore minted new rows,
and the operator's verdict stayed attached to a row nothing would ever look at again.

## The prod receipt

All six rows the live engine had ever written, at the moment of diagnosis:

| key | content head | created | verdict |
|---|---|---|---|
| `blindspot_PERSONAL_1787367702183` | `[HIGH] Open loop untouched: "Research and compile…` | 2026-08-22 | **null** |
| `blindspot_PERSONAL_1787367702048` | `[HIGH] Open loop untouched: "Review day's outcomes…` | 2026-08-22 | **null** |
| `blindspot_BUSINESS_1787367701580` | `[HIGH] Open loop untouched: "Create recurring Monday…` | 2026-08-22 | **null** |
| `blindspot_PERSONAL_1787281352755` | `[HIGH] Open loop untouched: "Research and compile…` | 2026-08-21 | `noise` |
| `blindspot_PERSONAL_1787281352607` | `[HIGH] Open loop untouched: "Review day's outcomes…` | 2026-08-21 | `noise` |
| `blindspot_BUSINESS_1787281352472` | `[HIGH] Open loop untouched: "Create recurring Monday…` | 2026-08-21 | `investigate` |

**3 of 3 verdicts given, 3 of 3 regenerated as unjudged within 24 hours — a 100% erasure rate
against a 100% participation rate.** The operator did everything the UI asked and the system
retained none of it.

Aggravating factor: `getBlindSpotContext()` read the newest rows into the model's system prompt
with no verdict filter, so a spot explicitly marked *Noise* was recited back to the system
nightly. The operator's instruction to disregard something became an instruction to attend to it.

## The probe that DOES detect it

Grepping for readers asks *"is the signal consumed?"* — the wrong question. Ask instead:

> **Does the producer and the consumer agree on what identifies the thing?**

Concretely, for any control whose state attaches to a persisted row:

1. **Find the producer's identity expression** — the upsert key, primary key, dedup hash,
   correlation id, or content hash. Read the literal expression, not its name.
2. **Check it for non-determinism.** `Date.now()`, `Math.random()`, `uuid()`, an
   auto-increment, a request id, a run id, a wall-clock bucket. Any of these means the producer
   mints a new identity per run.
3. **Check what the consumer assumes.** If the consumer's state (a verdict, an ack, a mute, a
   snooze, a "seen" flag, a resolution) is stored *on the row*, and step 2 found a
   non-deterministic key, **the loop is dead regardless of how many readers exist.**
4. **Prove it across a boundary, not within one.** See the trap below.

### The trap that nearly hid it a second time

The first canary written for this fix — "run the generator twice, assert zero new rows" —
**passed against the defect**. Both calls landed in the same millisecond, so `Date.now()`
returned the same value and even the broken key produced one row.

A test for a time-derived identity bug must **cross the boundary the producer runs on**. The
fixed canary advances a fake clock 24 hours between the two passes, and is paired with a
negative arm that drives the *old* key scheme through the same store and asserts it yields two
rows — so a harness that cannot see the failure cannot score green either.

This generalises: **an idempotence test that does not advance whatever the key is derived from
is not an idempotence test.**

## Relationship to the known shapes

| Shape | Question that detects it | Detects this one? |
|---|---|---|
| Control wired to nothing | Does anything read what it writes? | **No** — readers exist |
| Gate that fails open | Does a broken input still score green? | **No** — no gate involved |
| BUILT-TESTED-UNWIRED | Does a route import the surface? | **No** — fully wired and mounted |
| Fixture-only test | Does the test see real data? | **No** — the ledger row was real |
| **Orphaned subject** | **Do producer and consumer agree on identity?** | — |

## Where else to look

Any writer that stores operator state on a row it does not own the identity of. Candidates
worth the four-step probe, not yet audited:

- Every `remember()` call site whose key is built with a template literal — a key containing an
  expression rather than a stable referent is the signature.
- Ack / mute / snooze / dismiss flags stored in `metadata` on rows a cron regenerates.
- Any `contentHash` dedup where the hashed content includes a timestamp, a count, or a
  rendered date.

## Fix landed

`lib/brain/blind-spot-identity.ts` — identity-derived stable key, plus an explicit recurrence
policy (suppress by default; resurface only on severity escalation, bounded at three per spot in
its lifetime, per Ancker et al. PMC5387195 on repeat-alert override). Canaries:
`tests/brain/blind-spot-identity.test.ts` (idempotence proven across a 24h boundary, with the
breaking arm) and `tests/brain/blind-spot-context.test.ts` (verdict-aware prompt read, with a
canary for the Prisma JSON-path null trap that kept 1 of 241 rows).
