# GATE — 2026-08-14 · Nick Chat persona/content slate (two scans merged)

Two independent scans arrived the same day against the same brief: *make
Nick more truth-seeking, creative, observant, useful, wise, non-sycophantic,
and faithfully direction-following*. This gate merges them, applies
[`plan-gate`](../../../.claude/skills/plan-gate/SKILL.md), and records what
was executed.

- **Scan A** (in-session, web sweep + repo gate) — 7 findings, persona-led.
- **Scan B** (external, "current leverage scan") — 8 findings, verification-
  infrastructure-led, with verified `code to copy` links.

Ledger rows: [MISSION-CALIBRATION-LEDGER.md](MISSION-CALIBRATION-LEDGER.md)
run-5 section. Prior runs' rules 1-6 applied before ranking.

## Headline verdict

**The operator's persona ask is ~80% INCUMBENT.** Nick's prompt already
encodes every trait in the brief. The genuine gap is that *not one of them
is measured*.

| Trait asked for | Incumbent | Receipt |
|---|---|---|
| Aggressive, non-fawning | "Cold, precise, direct… no groveling, no hedging, no courtier-flattery" | `lib/ai/prompt/static.ts` `identityBlock()` |
| Obedience / no refusals / open expression | **OWNER AUTHORITY** block (2026-07-05) — no bare "No", no "as an AI", no ethics preamble, no content-policy hedging, no moralizing. Pinned at idx-0 so `trimPromptToBudget` can never drop it | `static.ts:70-78` |
| Truth-seeking | Rule 5 NEVER ASSUME + `TRUTH_RULE_NEVER_FABRICATE`, backed by a **server-side verifier that rewrites fabrication and flags `[verifier-corrected]`** | `operator-rules.ts` |
| Creativity | Rule 2 INTERESTING+CLEVER; `SPAR_MODE` diverge→attack→converge | `spar-mode.ts` |
| Observation | `BROADEN_AND_SUGGEST` → superseded by ANTICIPATE_AND_ELEVATE | `operator-rules.ts:104` |
| Not yes-manning | "Advising is NOT yes-manning… honest read ONCE, then the decision is HIS" | `static.ts:76` |

**REFUTED:** there is no meaningful refusal layer left to remove. What
remains is fenced tool-data handling, injection surfacing, and the two-tap
destructive confirm — which the prompt itself labels *"protection, not
refusal."* Perceived stonewalling is a **measurement gap, not a policy gap.**

**The real hole:** `judge-eval.ts` scores five axes — accuracy,
actionability, brevity, tone, evidence. **None is obedience, sycophancy,
calibration, or persona.** Every trait above is asserted in prose and
verified nowhere.

## Merged slate

Ranked by leverage (payoff + asymmetry + reversibility). Scan A ranks are
`A#n`, Scan B `B#n`.

| # | Item | Source | Verdict | Status |
|---|---|---|---|---|
| 1 | Per-lane persona measurement | A#1 | **NEW (narrowed)** | **EXECUTED** |
| 2 | Split likelihood from confidence | A#2 | **NEW** | **EXECUTED** |
| 3 | Persona is an app-layer contract (contrarian trade) | A#3 | NEW | RECORDED — no build |
| 4 | Trajectory grading over receipts | B#2 | **NEW — best item in Scan B** | WP — next slice |
| 5 | Obedience + anti-sycophancy golden set | A#4 / B#3 | **NEW (converged)** | WP — needs real traces |
| 6 | Tool metadata is an untrusted claim | B#6 | **NEW — missed by Scan A** | WP |
| 7 | Delete-before-add prompt trim | A#5 | NEW, unmeasured | PARKED — see below |
| 8 | Verbalized Sampling for SPAR diverge | A#6 | NEW | WATCH — fast lane unproven |
| 9 | ClaimLedger | B#1 | **PARTIAL INCUMBENT** | WATCH |
| 10 | Correction → regression bank | B#3 | **PARTIAL INCUMBENT** | WATCH |
| 11 | Memory freshness / supersession | B#4 | **PARTIAL INCUMBENT** | BLOCKED (DDL) |
| 12 | IntentContract | B#5 / A#7 | **PARTIAL INCUMBENT** | REJECT as specified |
| 13 | Context budget / stable prefixes | B#7 | **INCUMBENT** | NATIVE |
| 14 | MCP control plane (contrarian) | B#8 | **REPEAT of BDN-207** | ACTED ON 2026-08-13 |

## Gate detail on Scan B's partial-incumbents

Scan B's links were spot-checked and are **real, not fabricated** —
`openai/openai-knowledge-retrieval`, the Cerebras fact-checker notebook, and
the evaluation-flywheel doc all resolve, and its cited "~50 failing traces"
and train/validation/test split match the source (20/40/40). Its code-to-copy
section is the strongest part of either scan. The gate below is about fit to
*this* repo, not source quality.

- **#9 ClaimLedger — PARTIAL INCUMBENT.** `lib/ai/vnext/truth/claims.ts`
  (199 lines), `known-truth-guard.ts`, `hallucination-guard.ts` and the
  fabrication verifier already carry claim-level semantics. Map the proposed
  fields onto those before adding a parallel structure.
- **#10 regression bank — PARTIAL INCUMBENT.** `harvest:evals` already folds
  failed tool calls via `caseFromFailedToolCall`, and `pnpm eval:recall`
  shipped 2026-08-13. Scan B is **right about the residual gap** — the
  ledger's own BDN-203 row says the corpus is still synthetic. The genuine
  delta is the *frozen holdout*, not the harness.
- **#11 memory supersession — PARTIAL INCUMBENT, BLOCKED.**
  `memory-commit-gateway.ts` is live (Scan B got that right), and
  `contradiction-surfacer.ts` + `contradiction-cleanup.ts` already do
  conflict work. But the proposal adds six schema fields, and statenour
  migrations are **hand-applied and DDL is a protected operation**. Scan B
  flagged neither. Operator decision required.
- **#12 IntentContract — REJECT as specified.** `ActionRule.plan()`
  pre-receipts + `outcomeVsPlan` (BDN-204, shipped 2026-08-13) plus
  `AutomationPolicy.approvalClass` already implement the enforcing subset.
  The unmet half is *objective/acceptance criteria*, which is Scan A's
  commander's-intent finding — and that is operator game-feel HOLD class.
- **#13 context budget — NATIVE.** `prepare-tools.ts` + `chat-mode.ts`
  already prune against `NICK_TOOL_BUDGET` (24); the ephemeral-cache
  prefix fix shipped 2026-08-13 (BDN-206, 5-minute time bucketing).
- **#14 — already acted on** as BDN-207 (`queryData`, vm sandbox over a
  frozen 12-tool read-only whitelist). Scan B re-proposes its own prior
  trade; logged as continuation, not new.

## What was EXECUTED

### BDN-302 · likelihood/confidence split

`CONFIDENCE_CUES` blended two quantities into one hedge token
(`"Best guess:"` / `"Probably:"` / `"If I had to bet:"`). ICD 203 — the US
IC's binding analytic standard — requires them separately: estimative
**likelihood** (odds of the event) vs analytic **confidence** (strength of
the evidence base).

**Why it mattered here and not just in doctrine:** BDN-106 shipped a
Brier-score calibration report on 2026-08-12 reporting honest n=0. **A Brier
score requires a probability.** A blended hedge word is not one, so the
report was structurally ungradeable — the instrument could not see its
target. This is the unblock.

Second-order: *"high confidence in a 30% call"* becomes a sayable sentence.
Under the blended token it was linguistically impossible, which quietly
pushed Nick toward stating only what he was already sure of — the opposite
of the operator's ask.

- `ESTIMATIVE_LIKELIHOOD` — ODNI seven-point scale, verbatim, so the
  vocabulary is citable rather than house-invented.
- `ANALYTIC_CONFIDENCE` — evidence strength, plus the compact tail tag
  `[~30% · conf: high]`, reusing the `INLINE_CITATIONS` bracket idiom rather
  than inventing a second syntax.
- `CONFIDENCE_CUES` **stays exported, stops being injected** — same
  treatment `BROADEN_AND_SUGGEST` got on 2026-07-11. Shipping both would put
  two competing uncertainty vocabularies in one prompt, the exact drift
  `operator-rules.ts` exists to prevent. Pinned by test.
- `lib/ai/vnext/truth/estimative.ts` — pure reader: `parseEstimative`,
  `brierScore`, `summarizeEstimativeCompliance`. `brierScore` returns
  **null, not zero**, when there is nothing to grade (BDN-105 lesson).
- **Size discipline held.** The split is capped at 2.5x the rule it replaced
  and the test *failed first* at 842 vs 827.5. The fix was to tighten the
  prose, not raise the ceiling — per BDN-305, marginal prompt prose has
  negative expected yield.

### BDN-301 · per-lane persona census

**Gate-eye catch on Scan A's own #1:** the finding proposed instrumenting
lane capture. That was already incumbent — `judge-eval.ts` has recorded
`judgedBy = "${provider}:${model}"` into every `reply_judgment` row's
metadata since v10.0.412. **The genuine delta is aggregation, not capture.**
Scan A over-scoped this; the shipped module is a read model over data
already on disk, at zero new generation spend.

`lib/observability/persona-lane-census.ts` groups stored judgments by
`(lane x taskClass)` and reports per-cell n, per-axis means, and cross-lane
spread.

**The confound is the point.** Lanes do not receive the same work — the fast
lane is routed short classify-shaped turns, the frontier lane gets strategy.
A naive per-lane mean measures *routing*, not persona. So the census
computes total-variation distance between lane task mixes and sets
`comparable: false` on every axis when mixes diverge past 0.35, with an
on-screen disclosure. Underpowered cells (n < 5) are shown and marked, never
dropped. Same discipline as the BDN-202 tool census, which discloses its
pruner confound on screen.

**Composite semantics deliberately unchanged** — still the mean of the
original five axes. Folding persona axes into it would silently break
comparability with every historical judgment on disk.

## Not implemented, and why

- **Prompt trim (#7) — PARKED, not done.** The context-rot evidence is
  generic-model. Nick's live prompt size was **not** re-measured this run
  (`measure-prompt-size.ts` queries live Neon). Per ledger rule 6, a thesis
  number must be measured live before anything is built on it. Payoff was
  scored 3 for exactly this reason. Trimming a prompt on an unmeasured
  premise is the failure this rule exists to stop.
- **Verbalized Sampling (#8) — WATCH.** All published gains are
  frontier-model; the repo itself recommends GPT-5/Opus/Gemini-Pro class.
  This is the *same* kill shot as BDN-201 — now a structural pattern, not a
  per-finding caveat: **the fast lane is where cheap sampling would be most
  affordable and least likely to work.** Needs the A/B before adoption.
- **Golden set (#5) — WP, not built.** Needs *real* traces. Authoring 40
  cases from imagination would produce a fixture-only eval, which the
  ledger's own false-green lesson forbids.
- **Memory supersession (#11) — BLOCKED.** Requires hand-applied DDL, a
  protected operation. Operator decision.
- **Commander's intent / IntentContract — operator HOLD class.** Same
  class as the R/A/G weeks deferred in BDN-208.

## Next scan's highest-leverage hypothesis

**Hypothesis:** persona variance across lanes is large enough to dominate
prompt wording — i.e. the fast lane under-expresses candor and
direction-following regardless of what `operator-rules.ts` says.

**Falsification test:** once `reply_judgment` rows accumulate on both lanes
with overlapping task classes, run `summarizePersonaByLane`. If
`comparable: true` and the `tone` spread is **< 1.0 point**, the hypothesis
is dead and prompt wording is the right lever after all. If the spread
exceeds 2.0 points on comparable cells, persona work belongs at the routing
layer, not in the prompt.

**Integrity note:** this test cannot run until the mixes overlap. If lane
routing keeps the mixes disjoint forever, the honest verdict is
*permanently unmeasurable at the turn level*, and the next step is a
deliberate paired-prompt probe — not a louder prompt.
