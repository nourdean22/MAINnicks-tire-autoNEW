# Learning loops — measured 2026-08-28

Three surfaces collect the operator's judgment; the question was which of them lets a judgment
alter future behavior, and which to close properly. Census: three parallel read-only code
readers (every claim verified against origin/main, file:line receipts) + prod probes run from
the orchestrator (agents get no prod credentials). Numbers below are prod, 2026-08-28.

## Loop A — Discover verdicts (`known`/`noise`/`investigate`)

**What already works (the briefing was stale here):** cluster-level rating shipped in #1787 —
`rateDiscoveryCluster` re-derives full cluster membership server-side, any non-null verdict
(including `known`) drops the card from the default feed, judged rows get `expiresAt: null` so
they outlive GC, and suppression survives regeneration for 3 of 4 engines (stable keys +
verdict inheritance). The single-id `rateDiscovery` tRPC was removed 08-23.

**What is actually broken — four gaps, all measured:**

1. **`counter_intuitive` still mints clock keys** — `ci_${category}_${Date.now()}`
   (counter-intuitive.ts:458, writes through `remember()`). The exact defect the 08-22 wave
   fixed for blind_spot is live for this engine: a judged finding re-emitted after rating
   returns as a NEW unjudged card. Prod: 1 live ci row, clock-keyed; **zero verdicts have ever
   landed on counter_intuitive**, so the legacy-inheritance bridge blind_spot needed is YAGNI
   here — but the TTL-trap reconcile (probation clear, tombstone revive, lastSeen refresh) is
   NOT optional: the row writes through the same `remember()` chain the 08-22 postmortem
   documented (a stable key alone is worse than the bug).
2. **The live Nick surfaces consult no verdict.** The documented consumer
   (`getBlindSpotContext`) is ORPHANED — zero importers; its documented injector
   (`lib/ai/system-prompt.ts`) no longer exists (prompt stack is `prompt/v2/`). The surfaces
   that actually run — the `getBlindSpots` AI tool (lib/ai/tools/brain.ts:1058) and Ultron
   (ultron-situation.ts:79) — call `detectBlindSpots()` fresh and ignore verdicts entirely. A
   spot rated `noise` still reaches Nick's tool output and Ultron cards: **his judgment never
   alters what Nick says.** (Same orphan state: `getCounterIntuitiveContext`,
   `getCorrelationContext` — flagged for separate cleanup, not deleted in this wave.)
3. **No feed-time identity join.** A verdict binds only its own cluster rows at rating time; a
   twin regenerated under a fresh key (gap 1) or reinforced back into the 30-day window later
   returns unjudged. Judged rows older than the window never bind anything.
4. **The effect is invisible.** Suppression happens with no standing count — only a transient
   toast at rate time. Prod: 222 unjudged rows in-window collapse to **47 clusters** (top
   cluster 37 rows; top 10 clusters ≈ 70% of the queue), so each judgment suppresses ~5 rows
   on average and nothing tells him so.

## Loop B — the "3/200" corpus gate

**The briefing conflates two different gates wearing one counter.** The 200
(outcome-harvest/route.ts:38, corpus-odometer.ts:28) is the **fine-tune training-data volume**
trigger for two docs/UPSTREAMS.md WATCH rows (LoRA · Ax/DSPy) — crossing it flips a SENTENCE
in one BrainMemory row telling the operator to hand-edit UPSTREAMS; no code branches on it.
Lowering it would reopen adoption rows with nothing to feed them — rejected. Eval
decision-grade-ness needs ~tens of LABELED cases and is not measured by that counter at all.

**The deeper defect: the harvested eval corpus is structurally unable to fail.** All three
case constructors hard-code `relevantKeys: []` AND `forbiddenKeys: []`
(recall-corpus-builder.ts:52-53, 79-80, 112-113 — the header's claim that keys are "asserted
when the source row names a memory key" describes a branch that does not exist). Under
`runRecallEval` such a case is excluded from precision scoring and can never fail abstention.
Every harvested case passes unconditionally; the corpus can detect a crashed retriever, never
a bad one. Manual "promotion" (hand-editing SEED_CASES) has never happened — SEED_CASES is
still 100% synthetic.

**The fix that accumulates:** a `noise` Discover verdict is a perfect labeled case — the
judged row's own key becomes `forbiddenKeys: [key]` ("retrieval must NOT surface this"), no
schema change, one case per tap that already happens. Report a second odometer metric —
labeled eval cases / 30 (precedent: `MIN_TRUSTED_LABELS = 30`, judge-eval/calibration.ts:37)
— beside the untouched 200 fine-tune gate.

## Loop C — the Trust Ladder (report only; fixes are operator decisions)

**Structurally closed at BOTH ends, measured:** all 20 engine rules carry actionTypes
(`send_telegram` ×18, `send_email`, `promote_memory`) that `canAutoExecute` can never approve
(denylist/not-allowlist, confidence-tier.ts:70-94); the lanes with allowlisted types
(`nick_action_*`) never consult the gate; engine-deferred pending rows have **no decide
surface** (`decideApproval` tRPC has zero UI callers; /system/actions' "Pending Approvals" tab
decides a different table); `NICK_CONFIDENCE_TIER` is default OFF. Prod: **every "decided"
row all-time — 485 of 485 — was decided by `auto-purge`**, which the live gate counts as
operator rejection (pinning acceptance toward 0) while the scoreboard excludes it. Auto-fired
successes never enter the tally, so even a perfect lane builds no track record.

Closing this loop means: UI wiring for `decideApproval`, gate-arithmetic changes to a
documented fail-safe, and allowlist edits the module header forbids without operator sign-off
— plus the operator actually deciding rows. The census's 5-step plan is preserved in the
census artifact; steps 3–5 are explicitly operator calls. **Not attempted in this wave.**

## Decision

**Close Loop A properly, with the Loop B labeled-case rider on the same surfaces.** The
orchestrator's read (known-verdict, cheapest, daily-visible) holds, but for revised reasons:
the cheap suppression already shipped; what remains is exactly "judgment alters future
behavior" — durable identity (gaps 1+3), the live Nick surfaces (gap 2), visibility (gap 4).
The rider makes every future `noise` tap ALSO grow the eval corpus that yesterday's retrieval
waves measure against — judgment literally training the retrieval evaluation. Loop C is the
biggest build with the most operator-gated steps and an adoption dependency; reported with its
plan instead.

## Shipped in this wave (numbers in AFTER)

- S1 `counter-intuitive.ts`: content-derived stable key (sha16 of category+assumption,
  leading-digit collapse — the blindSpotKey pattern) + TTL-trap reconcile.
- S2 `discoveries.ts`: feed-time judged-identity join (no lastSeen floor, tombstones
  included, metadata-precedence honored in JS after overfetch) → `suppressedSimilar` count on
  the result; UI strip "suppressed N similar".
- S3 `blind-spot-identity.ts` + `lib/ai/tools/brain.ts` + `ultron-situation.ts`: judged spots
  (noise|known) filtered from the live surfaces via stable-key lookup, suppressed count
  surfaced in the tool payload.
- S4 `recall-corpus-builder.ts` + odometer route/script: noise-verdict discovery rows become
  the first label-bearing harvested cases (`forbiddenKeys: [key]`); second odometer metric
  (labeled cases / 30).

## AFTER (measured against prod through the real services, write-stub-verified read-only)

| Surface | Before | After |
|---|---|---|
| Nick's `getBlindSpots` tool + Ultron board | verdict-blind: 14 detected, all 14 recited — including 2 the operator had already judged | **2 of 14 suppressed** (kept 12); count surfaced in the tool payload |
| Eval corpus, label-bearing cases | **0** (all 38 harvested cases had empty keys — structurally unable to fail) | **6** (`forbiddenKeys = [judged row's key]`; a retriever surfacing a noise row now FAILS the case — proven end-to-end through `runRecallEval`) |
| Corpus odometer | one number, `3/200`, gating a sentence | second metric: **labeled eval cases 6/30** (the gate that governs eval decision-grade-ness); 200 fine-tune gate untouched, on purpose |
| `counter_intuitive` identity | `ci_<cat>_<Date.now()>` — every regeneration minted an unjudged twin | content-derived sha16 key + TTL-trap reconcile (probation clear on 2nd sighting, tombstone revive, lastSeen refresh) |
| Feed suppression | verdict bound only the rows rated at tap time | judged-identity join, no lastSeen floor, tombstones included; `suppressedSimilar` returned + rendered |

Honest zeros: `suppressedSimilar` measures **0 today** in both feed views — the entire current
unjudged pile (222 rows) is restore-provenance, and provenance is deliberately part of cluster
identity (an engine verdict must not blanket-suppress the operator's restored data). The join's
value is prospective — it binds the twins the nightly engines will regenerate — and its
mechanism is canaried (fresh twin withheld + counted; no-lastSeen-floor pinned on the query;
explicit-null resurface NOT suppressed). Also observed: the default Discover feed currently
shows **0 engine cards** (everything in-window is restored) — pre-existing behavior, recorded
here so nobody reads the empty feed as this wave's doing.

Receipts: 602 test files, 6,446 passed, exit-summary clean · `tsc --noEmit` 0 · eslint 0 errors
(137 pre-existing warnings) · all four canary sets armed → 7 failed → restored green · AFTER
probe intercepted 1 write attempt (the stub's own sentinel), i.e. the measured paths are pure
reads.
