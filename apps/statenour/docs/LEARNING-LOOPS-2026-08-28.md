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

## Rule-7 verification (external state, searched 2026-08-28 — before committing to the design)

Charter rule 7: an uncited claim about the outside world is expired by default. Four searches
against the load-bearing priors of this design. **All four corroborated; none forced a plan
change**, and the contradiction budget went unspent — which is itself the finding.

| Prior this design rests on | Searched | Result |
|---|---|---|
| Typicality (cluster SIZE) beats uncertainty sampling at single-digit label budgets — Hacohen et al., [arXiv:2202.02794](https://arxiv.org/abs/2202.02794) | current status + follow-ups | Still current. A May 2025 follow-up ([arXiv:2505.19404](https://arxiv.org/html/2505.19404)) re-tests TypiClust in federated low-budget settings and finds its advantage **larger with a simple model and heterogeneous data partitions** — which is this system exactly (one operator, four heterogeneous engines). Prior strengthened, not weakened. |
| Aggressive suppression beats re-asking — alert-fatigue literature (Ancker, [PMC5387195](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5387195/)) | current CDS guidance | Corroborated and sharpened. Current practitioner guidance ([Mindbowser, 2026](https://www.mindbowser.com/reduce-cdss-alert-fatigue-clinical-decision-support/)) names **duplicate-alert suppression and risk tiering** as the two primary levers — precisely the judged-identity join plus severity-escalation resurface. Override rates remain 49–96%, and 88.2% for very-severe DDI alerts ([PMC9754301](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9754301/)). Two levers listed there do NOT transfer: "require a reason to override" and "role tailoring" (single-operator system). |
| Explicit taps are the right signal to build on | implicit vs explicit feedback, 2025 | Partial challenge worth recording. Current guidance is that implicit signals dominate by volume and best practice **combines both**. This system already carries the implicit half (`recordShown` → surfaced-and-not-acted-on, which is exactly what `known`→`ignored` encodes), so the design is on the recommended side — but a purely-explicit successor would not be. Noted as a constraint on future work, not a change here. |
| String-normalised cluster identity (leading-digit collapse) rather than embedding similarity | semantic dedup current form | The modern form is **hybrid exact + fuzzy with conservatively-chosen thresholds**, explicitly to avoid merging related-but-distinct entities ([NVIDIA NeMo Curator SemDeDup](https://docs.nvidia.com/nemo/curator/curate-text/process-data/deduplication/semdedup)). This design is the exact half, chosen after a measured over-merge incident (`Order 4 winter tires` vs `Order 6 winter tires` — one Noise tap would have suppressed both). Adding a semantic threshold with no eval to tune it against would ship an unmeasured knob; **parked as a lever, with the reason.** |

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

## Closing pass — the effect the operator could not see (#1971)

The wave above made `known` *do* something. A follow-up read of the surface found it still did
not *say* so, and that two comments still asserted the opposite:

1. **The ordinary tap was silent.** `judge()` set a message only on partial failure or
   beyond-page extras; suppressing a six-row cluster produced no text at all. And the one
   informational message it did emit rode the `actionError` string, so "we found more copies for
   you" rendered in error amber — the feature working, painted as a fault. Now
   `describeJudgeOutcome()` (`lib/brain/discover-feedback.ts`, pure, 11 canaries) returns
   `{tone, text}` for every path, and the tap reports **"Already knew — suppressed 6 similar.
   Copies the engines regenerate stay hidden…"** in an `aria-live` status region.
2. **Two comments outlived their truth by one wave.** `discoveries.ts`'s VERDICT_TO_DECISION note
   ("Nothing consumes that yet") and `discover-tab.tsx`'s header both still said `known` had no
   consumer — and were quoted three times as proof the loop was open. Both now name what consumes
   it, and keep the honest residue: the ledger `resultRef` novelty TRACE is still unread, because
   the behaviour reads the verdict column, and nothing yet asks the over-time question.
3. **The footer carried a second falsehood.** It told the operator "Noise" suppresses from
   "Nick's system prompt" — a path that was orphaned dead code and never ran, and that the wave
   above replaced with the live-surface filter. Corrected to what the code does.
