# CURRENT-TRUTH.md — Statenour

## 2026-09-28 late evening — Decision Plane shadow/calibration (branch/test truth, not production truth)

- **Built + locally verified on `feat/nouros-decision-plane-20260928`:** vendor-neutral typed decision contracts; strict private/external System-One-compatible HTTP adapter; deterministic sampled shadow evaluation through existing Inngest; Decision Episodes through the existing Reality Ledger; multiclass Brier/log-loss/ECE calibration primitives; operator report + /system/tools panel.
- **Zero authority change:** the incumbent StateNour router still owns production. `NICK_DECISION_PLANE_SHADOW` defaults OFF; the report hard-codes `promotionReady=false`.
- **Privacy/egress boundary:** private-mode and obvious-PII turns never enqueue. Public backends require explicit `NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE=1`; an API key alone is insufficient.
- **Honest comparison:** candidate decisions are compared only against incumbent-owned fields. `needsBackgroundMission` has no fabricated incumbent label. Incumbent agreement is not correctness or calibration.
- **Verification:** 17/17 focused Decision Plane tests; changed-file ESLint; `git diff --check`. Full local TypeScript is withheld as a correctness signal because NattyNour exhausted machine RAM/pagefile during the repo-wide compiler sweep; GitHub CI is the authoritative full check after push.
- **Not yet proven:** merge, deploy, live shadow receipts, real outcome labels, replay/regret evaluation, or any candidate promotion.
- Durable receipt: `docs/00-current-truth/nouros-decision-plane-2026-09-28.md`.

## 2026-09-28 evening — NourOS intelligence foundation (branch/test truth, not production truth)

- **Current base repo truth for this work:** `origin/main` = `4e628f0dbdc2bbdbdb91f196a7889b90a706305a` (#2753) when the foundation branch was refreshed. Camera PRs #2746/#2747 remain separate sibling workstreams.
- **Built + locally verified on `feat/nouros-foundation-20260928`:** typed Episode envelopes over the existing Reality Ledger; bounded Inngest mission execution over existing Mission rows; tool-gap intelligence over existing `ToolSelectionTurn`/`ToolGateDecision`; persistence for the already-built verified-regen telemetry; explicit E2B deny-egress.
- **Verification:** 45/45 focused tests passed; StateNour TypeScript passed after fresh-worktree workspace dependencies were built; changed-file ESLint passed; `git diff --check` passed; staged secret scan found no findings.
- **Promotion boundaries:** `NICK_DURABLE_MISSIONS` defaults OFF until a deployed Inngest registration + harmless checkpoint-only run produce real RealityEvent receipts. E2B remains unprovisioned by this slice.
- **Not built here:** the Jev/TypeSafe-style probabilistic Decision Plane, backend calibration/shadowing, and outcome-threshold promotion. Those remain a separate next slice.
- Durable receipt: `docs/00-current-truth/nouros-foundation-2026-09-28.md`.

## 2026-09-28 — original-plan infrastructure + private-worker observability

- **Repository current truth:** `main` = `18db7de13af5fe0f6f4f2fb62456e371db3dd698` (#2726); GitHub showed **0 open PRs** immediately after the #2724/#2725/#2726 wave.
- **#2724 closed the original-plan reconciliation gap, not every operator action.** It merged the 24-slice evidence ledger plus Railway IaC/source-of-truth hardening. Live receipts in that pass: worker moved to east4/private-only, Nick + worker negated watch paths applied, Redis public TCP proxy removed, and Neon `pg_stat_statements` v1.11 enabled. Redis service/volume deletion is still blocked on Railway dashboard 2FA; Wait-for-CI and sealed-secret status remain dashboard-only; the project deploy webhook is still absent.
- **#2725 is merged and live on StateNour web.** Deployment `bdfe33a5-0a80-48e0-b992-b9662ae42079` is SUCCESS on exact commit `7fbeb855d5bc12a33e5592d09380ab081f86f6cb`. The default Obsidian rollup keeps newest-100/category semantics but avoids full-payload loading for 32,410 of the current 36,042 eligible BrainMemory rows; only 3,632 full rows are needed today. Individual mode and `export-brain-archive.ts` stay complete.
- **#2726 is merged and live on both worker + web.** Worker deployment `aa4db42e-5b0e-4611-a461-2338d3d7f12c` and web deployment `f14abc77-e0cb-4e90-915a-250a21bdee0a` are SUCCESS on exact commit `18db7de13af5fe0f6f4f2fb62456e371db3dd698`. The worker remains private. Deploy-drift/smoke observation now derives from the persisted `brain-bus-drain` success receipt instead of a public worker URL. A live NicksMax request to `/api/system/heartbeat` returned `status: ok`, DB latency 5 ms, and `worker.status: fresh` at age 12 minutes.
- **Worker freshness definition:** fresh through 1 hour (four missed 15-minute ticks), stale afterward, public probe failure => `unknown`; internal fleet truth preserves the difference between “no receipt ever” and “DB probe failed.” The production lookup uses an index-only scan and measured ~0.076 ms warm.
- **Durable plan ledger:** `docs/research/2026-09-28-original-plan-reconciliation.md`. The old “code backlog exhausted” sentence below is historical scope for stale worktree reconciliation, not a claim that the broader operator/infrastructure plan is finished.

## 2026-09-28 — Ollama liveness repaired on the real web AI runtime

- **Neither #2727 nor #2726 changed the Ollama liveness implementation.** The deployed `/api/cron/ollama-model-liveness` route, model resolver, cron manifest, Inngest registration and cron-control service were unchanged.
- **The cron was healthy and exposed a real retired model.** A live authenticated route call resolved chat=`minimax-m3` (200), fast=`deepseek-v4-flash:0731` (**410 retired**), vision=`gemma4:31b` (200). Production `CronJobLog` already contained repeated failures on Sep 25–27; the missing `cron_control` row means the kill switch leaves this job enabled by default.
- **Fast-lane replacement was measured, not guessed.** A live Ollama bake-off on strict JSON classify/extract/summary tasks put `glm-5.3-flash` at 6/6 valid JSON, ~1.1 s average and zero length stops. `deepseek-v4.1-flash` was 5/6 with one length stop; `minimax-m3` was 6/6 but ~2.5 s; `glm-5.2` was slower / less reliable in this run. Railway `OLLAMA_FAST_MODEL` is now `glm-5.3-flash`.
- **Final live liveness receipt:** chat `minimax-m3` 200/alive (648 ms), fast `glm-5.3-flash` 200/alive (365 ms), vision `gemma4:31b` 200/alive (368 ms); route envelope `data.ok=true`. Latest production liveness row: 2026-09-28T03:22:51.032Z, `status=success`, no error, 649 ms.
- **Worker boundary:** `apps/worker/src` has zero AI/model-call sites. It forwards cron HTTP calls to StateNour web and also runs the in-process `processVideoRenders()` Remotion render/upload loop. A stale worker-only `OLLAMA_MODEL=deepseek-v3.1:671b` pin was therefore unused AI configuration debris, not a second model-serving outage. It was aligned to `minimax-m3` for hygiene. Worker health remains the #2726 persisted-freshness contract, not a duplicate Ollama probe.
- Durable receipt: `docs/00-current-truth/ollama-liveness-repair-2026-09-28.md`.

## 2026-09-27 afternoon — recovery closeout after #2712

- **Recovery handoff is now closed on repo truth.** `main` reached `93f0f66ca285600831ca50df87fb79f0497e3ed2` after #2712 (`fix · security · remove legacy Resend token from source`) squash-merged.
- #2712's two P1 review threads were both outdated because the current head already contained the fixes: the remaining hardcoded Resend token copies were removed from `get-dns-records.py`, and the smoke probe was factored into `resend_smoke.py` with discoverable `test_resend_smoke.py` behavioral coverage. The threads were formally resolved and Completion Authority reran **green**.
- Final #2712 reviewed head `bc02816e00fed586c5a7195b65a3dd5e8a800646`: StateNour E2E, affected CI, Secret Scanning, local-agent, Adoption, Admin, Agent Policy, and Completion Authority all passed.
- **Open PR count after #2712 merge: 0.**
- Durable recovery artifact remains `docs/00-current-truth/session-recovery-2026-09-27.md`. Treat the earlier #2712-open notes below as historical snapshots, not current instructions.

> **The one-screen answer to "where am I and what's real?"** If any other doc
> contradicts this file as a *present-tense instruction*, this file and live
> code win. Last verified **2026-09-28**. When in doubt, **verify in code, git,
> the DB, or logs** — not in prose.

## 2026-09-27 afternoon — recovery after lost visible session trail

- **The visible chat was incomplete; GitHub/repo receipts are authoritative.** A recovery sweep on 2026-09-27 reconstructed work that had disappeared from the UI-visible conversation. Durable handoff: `docs/00-current-truth/session-recovery-2026-09-27.md`.
- **Snapshot source `main`: `a01abc97eb6ee4bd5c9f8519f48d49c3fb2545e3`**, the squash merge of #2711 (`feat · instagram · unify publish truth and creative quality`).
- **Fourteen PRs after #2696 are confirmed merged:** #2697, #2698, #2699, #2700, #2701, #2702, #2703, #2704, #2705, #2706, #2707, #2708, #2710, and #2711. #2709 closed without merge.
- **The earlier “0 open PRs” closeout is historical, not current.** At this recovery snapshot the only open PR is #2712 (`fix · security · remove legacy Resend token from source`), head `bc02816e00fed586c5a7195b65a3dd5e8a800646`.
- **#2712 build/test/security lanes are green; Completion Authority is red at the review gate.** Two unresolved P1 threads remain in GitHub: the first says remove every remaining hardcoded token copy (a follow-up on the PR says the current head fixed those copies, but the thread remained unresolved); the second requests behavioral coverage for the smoke-test guards because the hyphenated `test-resend.py` is not discovered by the workflow's `test_*.py` unittest pattern. Do not merge #2712 until the review state is reconciled and Completion Authority is green on the current head.
- **Recovery rule:** when transcript/context looks truncated, re-query current `main`, open PRs, review threads, CI, and live deployment receipts before trusting an old memory line or visible chat excerpt.

## Since 2026-09-26/27 — repo reconciliation and dependency patch

- **Repo dependency patch #2696 is merged, but deploy truth is separate.** Repository `main` contains Next 16.3.6 and the aligned Next tooling patch plus the refreshed dev-minor set. The reviewed head passed StateNour `check`, lint with zero errors, a production build, 935/935 test files (9,748/9,748 tests), Linux affected CI, and authenticated E2E. This proves repository/build compatibility; it does **not** prove `statenour-web` is serving that dependency patch. Use `/api/version` plus Railway deployment ancestry before claiming it live.
- **Q35 is not pending.** Current `main` exactly matches the old Q35 branch for deploy-skew recovery, standalone social-assets font tracing, expected `lead.list` denial cleanup, retirement of the duplicate audit cron, and the strengthened `no-cron-calls-nickstire-trpc` import-graph guard.
- **Agent/runtime memory #2681 remains repo-only runtime guidance unless app code changes.** Commit `8f0de2f4d` is patch-equivalent to `main`; its `NOUR-COMMAND.md`, runtime-kernel doc, intelligence-context hook/test and Claude settings are already absorbed.
- **Historical dirty worktrees are not authoritative.** The 2026-09-26/27 portfolio sweep proved the old Q49/Q37/Q51 worktrees contain superseded or regressive variants. Compare concrete tree/patch state to current `main` before reviving one.
- **Reconciliation closeout is complete.** A follow-up check on 2026-09-27 found 0 open PRs. Three clean redundant local worktrees (`deps-dev-minor-current`, `nour-intelligence-runtime-20260926`, `portfolio-truth-20260927`) were removed; dirty historical Q35/Q37/Q49/Q51 worktrees were intentionally preserved instead of force-deleted; camera/Eufy/Q12 worktrees remain separate active-session property. The reconciled **code** backlog is exhausted. Remaining issue #2628 items are operator/vendor/infrastructure actions, not missing code.

## Since 2026-09-25/26 — Nick operator runtime + one-shot quality repair

- **#2673 `2b0783ea` made the live chat solution/principle-first, proactive, creative when useful, and explicitly truth-seeking.**
  The always-on Prompt V2 kernel says: recover context, use available tools/data, take the obvious safe/authorized next step,
  seek disconfirming evidence, separate fact/inference/unknown, finish through verification, and defer the final decision to
  the operator without rubber-stamping a false premise. Existing mutation confirmation, fencing, and injection safeguards
  were preserved.
- **The first production sample showed the kernel was useful but the quality loop was still observational.**
  On the #2673 deployment, 27 completed assistant turns had an average critic score of **91.3/100**, 12 scored 100,
  and 21/27 (77.8%) were clean at the reply gate. Median reply length was 167 words. But the same cohort's evidence
  shadow returned 14 `pass`, 9 `repair`, and 4 `block` verdicts, and the critic could emit `REGEN_CANDIDATE`
  without forcing the streamed answer to change. This is the measured reason #2680 exists.
- **#2680 `2b021632` changes the buffered regen lane from "detect/log" to "detect -> one targeted repair -> compare -> ship the better draft."**
  `pre-stream-regen.ts` now scores each candidate with the universal critic plus the per-turn response contract.
  Gated intents are `factual`, `decision`, `creative`, `instructional`, `procedural`, and `analytical`;
  casual/emotional/reflective turns stay flow-first. A failing first draft gets exactly one repair prompt containing the
  measured failure reasons. The second draft wins when the same deterministic selector finds it cleaner, lower-severity,
  higher-overall, or (at equal score) more specific. A partial repair may replace a worse first draft; a worse repair never wins.
- **Operator preference is now an explicit boundary, not implied persona.** Nick supplies facts, mechanisms, options,
  consequences, and execution toward Nour's stated objective. He does not substitute his own preferences/values/taste.
  A recommendation is given when explicitly asked, optimized for Nour's objective and constraints. If the premise conflicts
  with evidence, Nick corrects it once with evidence and then respects the operator's decision.
- **Deployment truth:** #2680 merged at 2026-09-26 13:16:28Z and Railway deployment
  `99ab4bda-931f-4dce-ba0d-807b91b8d9ec` reached **SUCCESS** on exact commit
  `2b021632bf2806c95e7e275ba56b7c64117ba8b6`. Fresh post-merge push CI was green for
  StateNour affected verify, authenticated e2e, Agent Policy, Adoption gates, Lighthouse, and deploy-drift.
  Repo HEAD then advanced to #2681 `36961a342`, but that commit touched only Agent OS files and Railway correctly
  marked the StateNour deployment **SKIPPED**. Therefore repo HEAD and live StateNour app SHA are intentionally different.
- **#2681 is cross-agent memory, not a StateNour app deploy.** It adds/updates `NOUR-COMMAND.md`,
  `docs/agent-os/NOUR-RUNTIME-KERNEL.md`, the intelligence-context hook, and its tests so coding agents inherit the same
  outcome/truth/completion posture. It does not change bdnick.info runtime code.
- **Still owed:** read post-#2680 `verified_regen_path` logs after enough real weak drafts exist. This is the
  live proof source today: it emits `regenFired`, `regenAttempted`, `regenWasBetter`, `selectionReason`,
  `firstOverall`, `firstSeverity`, `regenOverall`, `regenSeverity`, and `intent`. The helper
  `formatRegenTelemetry()` can construct a richer `chat.pre_stream_regen` metric, but **has no live caller** as of
  2026-09-26; do not query it or claim specificity/latency deltas from production until it is actually persisted.
  Implementation and deployment are proven; the production *repair win rate* is not yet. Evidence-gate enforcement remains
  a separate question: its shadow cohort was not a promote signal on 2026-09-23, so do not conflate the new quality repair
  selector with promoting the evidence gate itself.

## Since 2026-09-17 — W12, and the things that cost a session time to learn

Shipped in #2381-#2386, all DEPLOYED-VERIFIED. Full detail in `docs/RECONCILIATION.md`;
only what changes how you WORK is repeated here.

- **`GET /api/version` is the deploy-truth endpoint, and it is PUBLIC.** It returns
  `build.commit` (full SHA), `commitShort`, `branch`, `environment`, `deploymentId`.
  **`/api/health` is operator-gated and answers 401 unauthenticated** — reaching for it
  first cost a session a cycle. SHA-equality deploy verification is therefore possible
  and is now the standard, rather than "Railway said SUCCESS".
- **Tool selection changed behaviour.** `pruneTools` tier 4 now orders keyword-family
  candidates by semantic similarity instead of alphabetically, because the 24-slot budget
  truncates on ~73% of turns and the old `.sort()` meant the cut was made by SPELLING.
  Ordering only — membership is unchanged and asserted so. ⚠ **NOT yet proven in
  production**: the check is whether the first-letter means of ALLOWED vs BUDGETED_OUT
  converge (baseline 5.28 vs 11.78), and it needs ~100 post-deploy turns.
- **`pruneTools` is NOT the surfacing path — `prepareTools` is.** It re-attaches the
  `searchTools`/`invokeTool` recovery lane unconditionally AFTER pruning, plus operator
  `alwaysOnTools`, the action-intent tool and the web-search pair. Any question of the
  form "is this tool reachable?" must be answered there, not in the pruner.
- **A broken instrument now says so, by name.** Failures report through
  `instrumentScope(...)` → `errorLog` → `system.instrumentFailures`, surfaced on the tool
  census panel. ⚠ It detects instruments that FAILED, never ones that NEVER RAN — a
  deleted call site logs nothing and looks identical to a healthy one.
- **`recordMetricStrict` vs `recordMetric`.** Use the strict one wherever the WRITE IS THE
  MEASUREMENT; it propagates and returns a receipt. `recordMetric` is fail-soft and can
  never reject, which made one instrument's error branch dead code. The receipt type makes
  the fail-soft writer unassignable to an instrument's deps.
- **The evidence gate readout exists** (`system.evidenceGateCalibration`, rendered by
  `EvidenceGatePanel`). The 2026-09-17 verdict was "DO NOT PROMOTE, n=12 against a floor
  of 40". **Re-read 2026-09-23 02:26Z (Neon, read-only, the reader's own filter replayed):**
  after-fix cohort n=119, 52 would block (verdict `block` 27 + `repair` 25) = 43.7%;
  before-fix 34 of 91 = 37.4%. The sample is SUFFICIENT and the rate did not fall, so the
  answer is still do not promote, now on evidence rather than on a thin sample. The
  buffer-shadow half of the same panel restarted with #2560 (2026-09-23): only shadows
  stamped `toolsExpectedSource: "routing"` count, every earlier row (128) is legacy and
  excluded, so it reads "rate withheld" until 40 routing-sourced turns exist. The panel is
  the live source; do not compute a rate from counts it withholds.
- **Contextual recall reaches the model now (fixed 2026-09-23: #2577 plus the region move).**
  `buildBrainContext` races `getContextualMemories` at 3 s. Before, the lane ran its stages
  one after another and the "Context Memories" block landed on 4 of 89 chat turns since 09-18.
  #2577 runs the independent stages concurrently (3 of 5 turns landed on `us-west2`); moving
  statenour-web next to Neon (next bullet) made it 3 of 3 at 1.4-2.6 s. The lexical lane was
  skipped on 2 of the first 3 `us-east4` turns (its SQL passed the 900 ms `statement_timeout`
  under the turn's query burst) - see RECONCILIATION W16c. `pnpm eval:recall` calls the lane
  directly and cannot see the race.
- **statenour-web runs in Railway `us-east4-eqdc4a` (Virginia) since 2026-09-23 12:32Z**, next
  to its Neon database (`aws-us-east-1`); nickstire's `MAINnicks-tire-auto` joined it at 13:20Z,
  next to TiDB (`us-east-1`). Until then both ran in `us-west2` (California) and every query
  crossed the country (~60-70 ms per round trip). statenour-worker, Redis, perplexica and searxng
  are still in `us-west2`; they reach statenour-web over its public domain or the private
  network, which works across regions. Latency measured before 12:32Z (statenour) or 13:20Z
  (nickstire) on 09-23 is not comparable with later.
  The Neon compute (`ep-quiet-wave-am320eo1`) autoscales 0.5-2 CU since 12:48Z 09-23 (was
  0.25-2, raised on the operator's approval so the chat turn's query burst meets more CPU).
- **Scratch debris is gated repo-wide** by `scripts/agent-os/scratchDebris.test.mjs`
  (agent-policy workflow, every PR). Temp probes are welcome; committing them is not.
- **The overnight operating doctrine is version-controlled** at repo-root
  `OVERNIGHT-MANDATE.md`.

## Since 2026-09-02 — observability is deployed

- **Langfuse tracing is LIVE in production — confirmed 2026-09-02 by reading a
  planted trace back out.** Every AI SDK model-call site uses the shared
  `langfuseTelemetry()` helper; private-mode turns are excluded, only AI SDK
  spans are exported, and keys/bearer tokens are masked.
  It was DEAD for hours first: `Sentry.init()` claimed the global OpenTelemetry
  tracer provider, `@opentelemetry/api` silently refused Langfuse's second
  registration, and every span went to Sentry's provider while `/api/version`
  reported `langfuse: true` and the boot log said `langfuse_started`.
  **Receipt** (`a1d51cf`, 2026-09-02T17:43:48Z): trace
  `d3eebaac74d030dc2aea911b83ace1bb` — `environment: production`,
  `userId: operator`, `tags: ["probe"]`, `release: a1d51cf09…`,
  `model: deepseek-v4-flash:0731`, plus the planted `metadata.probeId`;
  `resourceAttributes.service.namespace: sentry` confirms it rides Sentry's
  provider. Reproduce with `POST /api/system/observability-probe`.
  **KNOWN GAP: token usage and cost came back 0** — that provider reported no
  usage on the call, so cost attribution is unproven.
  **A `configured` badge is a presence check, never a receipt.**
- **Sentry error monitoring is configured in production.** Client, server, edge,
  request-error, and router-transition hooks are deployed; `/api/version` reports
  `sentry: true`. Default PII capture is off and performance tracing is disabled.
- **Receipt boundary:** this proves deployed configuration, not a Sentry event
  receipt. The last authenticated Langfuse API check succeeded but returned zero
  traces at that time; verify a real non-private model call by reading it back.

## Since 2026-07-20 (verified 2026-07-28 — headline deltas)

- **Inngest fleet repaired + drift-proofed**: ~16 scheduled functions were unregistered (briefing_log had NEVER filled); re-synced, then boot-time self-sync (now verifying `res.ok` + response shape), a heartbeat self-row, and a worker-scheduled out-of-band liveness check were added. Definitive per-capability proof = the artifacts themselves (briefing_log row, drain counts), not invocation.
- **Post-turn outbox**: frozen payload before deferred work; drain replays orphans — now including rows stranded at `processing` (stale-claim reclaim), honoring `nextAttemptAt`, with loud enqueue/finish failures.
- **Loud-failure phase 2**: 29 defect-hiding silent catches converted (write-losses, content parses, watchdog heartbeats).
- **Suite truth**: 390 files / 4,419 passed / exit 0 — the "passes but exits 1" era is over; a non-zero exit is real.
- **verify:hard** gained auth-scan (check:get-auth) and a dependency gate that can actually fail (CRITICALs).
- **Home** simplified around four questions; canonical chat consolidation landed. Follow-up dismissals are DURABLE — `agendaDismissFollowUp` writes to `agenda_items` (`lib/trpc/routers/operator.ts`) and `components/home/follow-ups-list.tsx` reads it; the localStorage era is over. (This line previously said the opposite, two lines above the evening-waves entry that records the fix.)

- **Evening waves (same day):** durable Home agenda (FOLLOW_UP in agenda_items; localStorage dismissals dead) · memory commit gateway observing in SHADOW (review ~08-04) · alerts have resolve/mute lifecycle · chat command console (control sheet, authority strip, Context & Evidence, typed tool cards) · `getFleetTruth`/`getTopDecisions`/`fetchVideoTranscript` chat tools · execute-before-prose split (attempt-tense + receipt-backed completion messages) · intelligence_outcomes ledger live on Neon with two producers · /system/fleet + /system/chat-states pages · PR #1152 engine-lock wrapper merged.

## Since 2026-08-16 — knowledge/intelligence: three severed joints, not missing capability

- **★★★ `/knowledge` is RETIRED and now redirects to `/brain`.** Its loader
  resolved `process.cwd()/../..` to a NOUR-OS vault layout that stopped existing
  at the monorepo import, so it rendered ZERO files in prod and locally, always,
  with no test coverage. Deleted with `lib/mastery/knowledge.ts`, the 3 tRPC
  procedures, `lib/ai/knowledge-compiler.ts` and `scripts/refresh-digest.ts`.
  `KnowledgeRefreshPanel` is UNRELATED and survived — it moved to `/system/crons`
  and is still the only manual trigger for the ingest fan-out + prompt-cache flush.
- **★★★ The outcome ledger had zero deciders.** `recordDecision`/`recordOutcome`
  had NO callers anywhere, so `decision` was NULL on every IntelligenceOutcome row
  and `outcomesNeedingReview()` always returned empty — that is why the recall-eval
  corpus never grew, and why `scripts/data-census.ts` records "corrections: 0/200".
  Not low volume: a missing writer. `recordDecisionByContent()` joins on the
  indexed `contentHash`; wired on nudge dismissal and the new Discover verdicts.
- **★★★ Gateway Phase-2 is LIVE BY DEFAULT** — kill-switch
  `NICK_MEMORY_GATEWAY_PHASE2=0`. ★ It was flipped on by explicit operator
  instruction ("we can take the risk"), NOT by the 7-day shadow review that
  graduated Phase-1 — accepted risk, not measured safety. If writes look
  wrong, throw the kill-switch FIRST, then run
  `scripts/probe-gateway-agrees.ts`. Honors `update` (content, no bump) and
  `review_required` ONLY for `reasonCode: "weaker_evidence"`. `unknown_category`
  still falls through on purpose — it is the larger slice of the 349/wk, and
  parking it would freeze whole categories of automation writes.
- **★★ Recall renders PROVENANCE, not a confidence percentage.**
  `[category · you stated · seen 4x]` replaced `[category] (NN%)`. ★ An
  unrecognized source renders **"unclassified", never "unverified"** — the
  first cut said "unverified" and the ladder matches operator sources by EXACT
  equality, so `source: "operator"` and the operator's own `pin:chat` rows
  would have been announced to the model as untrusted. That percentage
  was never certainty: confidence is `0.5 + 0.1 × (sightings − 1)`, i.e. the
  sighting count restated. Labels come from the commit gateway's evidence ladder —
  one vocabulary, not a fourth taxonomy.
- **★★★ Confidence is a FREQUENCY COUNT and recall sorted by it** — so surprise,
  being low-frequency, structurally lost every ranking contest. `NICK_NOVELTY_RECALL`
  (**LIVE by default**, kill-switch `=0`; also operator-authorized without an
  eval win) adds a 0.95–1.18 novelty term AFTER
  the reranker, because rerank overwrites `hybrid` for the top 25 and discards
  every post-fusion multiplier — `importanceMultiplier` still has that hole.
- **`research_claim_candidate` is NOW actually quarantined from chat recall.**
  Two comments claimed it for months; `RECALL_EXCLUDE_CATEGORIES` never contained
  it, and candidates mint at confidence 0.3 against recall's `gte: 0.3` floor —
  passing exactly, not narrowly. Pinned by `tests/brain/recall-quarantine.test.ts`.
- **"source_supported" means cosine ≥ 0.75 against OUR OWN MEMORY, not source
  verification.** The stored enum is unchanged (indexed column, 2 exact-literal
  query filters; a rename needs a prod backfill + ALTER DEFAULT and fails SILENTLY
  if code ships first). `describeGroundingStatus()` tells the truth at the only
  boundary where the value reaches a human or a model. Real thresholds are
  **0.75 / 0.55** — `docs/research-lab.md` said 0.80, and a false-green test
  re-implemented that wrong number inline instead of importing the module.
- **New surfaces:** `/brain` → **Discover** (the four nightly creative categories,
  ordered by recency, each labelled INFERRED/SPECULATIVE, with
  investigate / already-knew / noise verdicts that write the ledger) and ONE Home
  contradiction slot that renders `null` on measured zero and deep-links to the
  EXISTING resolution panel. The ticker's contradiction item now carries
  `?resolve=<key>` — the receiving panel had always read it; only the sender was missing.

## Since 2026-08-16 — chat quality: it was a token budget, not the model

- **`maxOutputTokens` was truncating every substantive answer.** Standard mode
  allowed **2000**; the pinned THINKING model (`minimax-m3`) needs **3000-3600**
  completion tokens to finish one. Measured, 12 calls
  (`scripts/probe-empty-responses.ts`): the 8 that completed used 3013-3611; 4 hit
  `finish_reason="length"`, one returning a 500-char fragment and one returning
  **content=0 with completion_tokens=4000** — a full budget generated, none
  delivered. Now **6000 standard / 10000 deep** (#1590).
- **`provider.garbage ... chars=0` means BUDGET EXHAUSTION, not a dead upstream.**
  `completion_tokens=4000` on an empty response proves the model generated a full
  budget. Check `finish_reason` + `completion_tokens` before concluding anything
  about an empty response.
- **The client stall abort is the ONLY deadline in the system** — `maxDuration` is
  inert on Railway, the server has none — and its clock starts at SUBMIT. It is
  now **180s** (was 90s), because it is coupled to the token ceiling above: at
  13.2 ms/token measured, 6000 tokens = 79s mean / 97s worst and 10000 = 132s /
  161s, both past 90s before the ~40k system prompt and tool round-trips (#1591).
  The extreme deep tail can still reach 180s.
- **Chat had no failover.** Prod: `provider.all_failed tried=["ollama"]` with FIVE
  provider keys configured and idle — `TASK_ROUTING_PREFERENCES` keeps openrouter
  2nd "so a cooldown never dead-ends a turn", and the cost firewall filters the
  very list the failover loop iterates. Last-resort rescue tail added, **OFF by
  default**, `NICK_FAILOVER_RESCUE=1` (#1589; operator enabled it 2026-08-15).
- **The chat permission picker was FAKE and is gone.** `draft` and `execute` were
  the same code path — `"execute"` never appears server-side as a permission
  value; only `=== "read"` branches. "Draft only — nothing runs" was false.
  Server-side read-mode enforcement (`stripMutatingTools`) is untouched and still
  covered by `tests/security/agentic-redteam.test.ts`.
- **Web search runs on Tavily alone.** `searxng-perplexica` returns ZERO healthy
  responses (116 CAPTCHA across duckduckgo/wikipedia/startpage/brave/google-cse);
  `perplexica` returns ZERO completed searches (`400 invalid_request_error` —
  **not** a retired model id; `gpt-oss:120b` is alive). The primary cap is now 6s
  with a 3-miss/10-min breaker (was a hardcoded 30s tax on every search).
- **Model pins: `minimax-m3` is correct.** With the de-confounded bake-off it is
  the only model in the catalog that **reframes**. `deepseek-v4-pro` is DEAD
  (retired upstream mid-session), `kimi-k3` is HTTP 402 (outside the flat plan),
  `deepseek-v3.1:671b` is long gone (410) — **do not recommend it**.
- **REFUTED, do not re-propose:** wrong model pinned · tool overload (the pruner
  caps exposure at 24, `NICK_TOOL_BUDGET`) · prompt/context bloat
  (`PROMPT-AB-2026-08-12`+`12b` — incumbent 4 / compact 3, below the
  pre-registered ≥3 lead → abandoned as noise) · stale pin · persona stance
  (`PERSONA-AB-2026-08-16-clean`: A=3.50 / B=3.08, lead −0.42, inside ±0.75 on
  both runs → abandoned per its frozen pre-registration).

## 2026-08-25 — VideoDB RETIRED (superseding the 2026-08-14 section below)

- **VideoDB is gone from the codebase** (chat-stack wave, PR pending): client, integrations wrapper, media-upload / media-transcript / videodb-sessions routes, the two session-recall tools (`searchSessionRecordings`, `recallFromSession` — catalog 181→179), the transcript pane, the video upload lane, both probes and the env key. Rationale: **zero successful uses ever** — the 2026-08-14 findings below (client never worked, then $0 account) were terminal, and no operator credit was ever added.
- **What replaced what actually worked-adjacent:** audio transcription runs on OpenAI whisper-1 everywhere (it was already the mic path's primary; the file-drop route now uses it too, with `verbose_json` timed segments). **Video attach is refused at attach time with the reason** (no storage backend) — the pre-BDN-319 stance restored honestly. FFmpeg/whisper.cpp/Vidstack were NOT added: nothing depended on the video lane, and the repo rule is replacement only where something depends on it.

## Since 2026-08-14 — Nick media workspace + VideoDB (BDN-301..321) — SUPERSEDED 2026-08-25, see above

- **★★★ The VideoDB client had NEVER worked.** Four bugs, all found by live probe (BDN-321): paths are SINGULAR (`/collection`, `/video`, `/index` — the plural forms 404); every response is enveloped `{data, success}` and the client read the top level; upload is a THREE-STEP PRESIGNED flow (`GET upload_url` → `POST` bytes → `POST /upload {url}`), not a multipart POST (which 500s); and **VideoDB signals refusal INSIDE HTTP 200** (`{"success":false,"error_code":"low_credit"}` — `res.ok` is true). Corroboration: the collection holds ZERO videos, so audio-drop-to-chat has been dead since v10.0.349. `assertVideoDbSuccess()` now checks `success===false` in one place before unwrap.
- **★★★ BLOCKED, NOT ON CODE: the VideoDB account balance is $0.00.** Video attach and transcripts cannot work until credit exists. The "50 free uploads" the client's error hint advertises are not available on this account. Probes: `scripts/probe-videodb-transcript.ts` (read-only) · `scripts/probe-videodb-upload.ts` (writes — operator-authorized only).
- **`getTranscript` was discarding every timing the API returns** (BDN-318). It read `json.transcript ?? json.text` — `transcript` is not even a key this endpoint returns — and threw away `word_timestamps`. Now returns `{ text, segments, segmentsUnavailable }`, sentence-segmented. This is what made clickable transcripts / chapters look like a backend limitation; it was ours.
- **Media workspace shipped (8 items)**: universal file-part renderer with URL-scheme gating · persistent dock (native `<video>`, no player dependency) · clickable timestamp seek with a token-based `requestSeek` · media-as-evidence adapter over the incumbent `claims.ts` · composer accepts audio + PDFs with one shared intake gate for picker/paste/drop (video routes to the upload lane, never base64) · desktop focus panel + transcript pane · explicit save-a-moment to BrainMemory (never automatic) · UI-token integrity guard.
- **Persona work (BDN-301/302)**: `CONFIDENCE_CUES` split into `ESTIMATIVE_LIKELIHOOD` (ODNI seven-point scale) + `ANALYTIC_CONFIDENCE`; the old rule stays exported but is NO LONGER INJECTED. Per-lane persona census over stored `reply_judgment` rows. Verbalized-Sampling SPAR variant behind `NICK_SPAR_VS` (default off).
- **BDN-307 prompt trim REFUTED by measurement**, not deferred: Layer 1 is 13,274 chars / ~3,319 tokens against a 40,000-char guard. `scripts/measure-static-layer.ts` measures it offline (the live `measure-prompt-size.ts` is gated as a prod lane).
- **BDN-310 memory supersession: APPLIED to prod Neon 2026-08-14** via `prisma migrate deploy`. `brain_memories` now carries `valid_from` / `valid_until` / `last_verified_at` / `superseded_by_id`, the self-FK (`ON DELETE SET NULL`), and three indexes. Verified after apply: 4/4 columns, FK and all 3 indexes present · **25,381 rows unchanged** · **pgvector still installed** · `migrate status` = "Database schema is up to date!". ★ The first draft of that migration targeted `"BrainMemory"` — the Prisma model carries `@@map("brain_memories")`, so every statement would have FAILED against prod. A read-only preflight (`scripts/probe-bdn310-preflight.ts`) caught it before any DDL ran. **Readers exist since 2026-08-19 (contextual-recall, cold-memory, the brain tools) and the as-of recall reads them since 2026-09-08 (`validityWhere`)** — but the 2026-09-08 production probe found **0 of 40,889 live rows carrying `valid_from`, `valid_until` or `superseded_by_id`**: the write path never sets them (`NICK_MEMORY_SUPERSESSION` is default-off), the `contradiction` category holds 0 rows, so no resolution has ever stamped one. Temporal recall is code-live and data-empty; Wave 2 of the Brain plan sets validity at write.
  **CONFIRMED 2026-08-23** against `origin/main`: `validFrom` / `validUntil` are present in
  `prisma/schema.prisma:1682-1683` (mapped `valid_from` / `valid_until`) with an index on
  `validUntil:1724`. Re-check with
  `git grep -n 'valid_until' -- apps/statenour/prisma/schema.prisma` rather than trusting this line.
- **Unwired instruments (self-audit, honest status):** `summarizePersonaByLane` and `summarizeEstimativeCompliance` have no in-app caller; `scripts/report-nick-instruments.ts` is the read-only runner. `toEvidenceRef` / `canSupportAlone` / `reopenTargetFromKey` have NO caller outside tests — media does not actually mint evidence yet, despite the PR wording. `taskClass` has no producer anywhere, so the census refuses to call an all-unknown comparison comparable.

## Where this runs

- **App location:** `apps/statenour/` inside the monorepo **`nourdean22/MAINnicks-tire-autoNEW`**.
- **Production deploy:** branch **`main`** → **Railway** (service `statenour-web`) → **https://bdnick.info**. Pushing `main` auto-deploys via per-service watch paths.
- **Companion app:** `apps/nickstire/` (Railway → nickstire.org) — a separate ring; see `docs/REPO-MAP.md`.

## Retired — do NOT treat as current (these are the landmines)

- **Vercel** — **retired** for Statenour production. There is no `vercel.json` crons block; scheduled jobs run via the Inngest mega fan-out.
- `codex/ollama-local` and `statenour-master` branches — **retired**. Never push there; never claim either is the production branch.
- Standalone `nourdean22/statenour-os` repo — **retired** for production. Statenour now lives only in the monorepo above. (As of 2026-07-25 the repo still exists on GitHub and is NOT yet archived there; `config/repos.ts` marks it `stale` pending the actual archive flag.)
- Local path `C:\Users\nourd\NOUR-OS` — **retired**. Canonical checkout is `C:\Users\nourd\NOURCITY`.
- `scripts/pre-push-check.sh` — **retired** Vercel-era artifact (references the retired branches). It is NOT the active hook; the active hook is the repo-root `lefthook.yml` `pre-push` (turbo build --affected); Husky is not used.

## Source-of-truth hierarchy (highest first)

1. `apps/statenour/AGENTS.md` — where we are, how we work, active backlog.
2. `apps/statenour/docs/RECONCILIATION.md` — verified ship-by-ship log (top entry = latest).
3. `apps/statenour/docs/RUNBOOK.md` — operational procedures.
4. `apps/statenour/docs/REPO-MAP.md` — cross-ring repo layout.
5. `apps/statenour/docs/AGENT-CONTRACT.md` — AI agent contract.
6. `apps/statenour/config/repos.ts` — typed repo manifest (mirrors REPO-MAP).
7. `apps/statenour/config/crons.ts` — typed cron manifest (single source; `pnpm check:crons`).
8. **Live code, tests, scripts, git history** — beats any doc on a factual conflict.
9. Archived docs (`docs/archive/**`) — **historical context only, never active instructions.**

## Truth lives in code, not prose (don't hardcode these in docs)

- **Provider / model:** read `lib/ai/provider.ts` (the `AI_PROVIDER` env selects `ollama`|`gemini`|`openai`|`anthropic`; model ids are env-driven) and `lib/ai/domain-routing.ts`. Do **not** assert a model name (e.g. a specific Venice/GLM/Ollama model) as "current" in prose — it drifts; point to the file.
- **Crons:** `config/crons.ts` is the manifest; `pnpm check:crons` verifies it against the filesystem and the Inngest fan-out (`lib/inngest/jobs.ts`).
- **Repos:** `config/repos.ts` + `docs/REPO-MAP.md`.
- **Tailwind colour utilities:** this app is **Tailwind v4** (no `tailwind.config`; `postcss.config.mjs` + `@import "tailwindcss"`). A colour utility exists **only** if its token is registered in the `@theme inline` bridge in `app/styles/tokens.css`. A bare `--primary:` custom property in `:root` does **not** create `bg-primary` — the class silently emits **zero CSS**, with no error, no warning and no visual clue. This shipped: the full shadcn palette was authored in `:root` but never bridged, so `bg-primary` / `border-border` / `text-muted-foreground` were dead app-wide, and the weekly-recurrence weekday picker rendered its selected state identically to unselected — the operator reported the buttons as broken when the click handler was fine (#972/#973, 2026-07-20). All 18 used tokens are now bridged and pinned by `__tests__/theme-token-utilities.test.ts`. **Before styling with a new colour token, check the bridge — do not assume a `:root` variable is enough.**
- **Migrations:** column-first, hand-applied. See `docs/DB-MIGRATION-POLICY.md`, the schema sentinel (`lib/db/schema-sentinel.ts`), and the migration `scripts/`. A migration is "applied to prod" only when run via the guarded `apply-pending-migration` endpoint **and** verified (`prisma migrate status`) — never claim applied otherwise. Never `--accept-data-loss` (drops pgvector/tsvector).

## Active vs historical docs

- **Active:** `AGENTS.md`, `CURRENT-TRUTH.md` (this file), `docs/RECONCILIATION.md`, `docs/RUNBOOK.md`, `docs/REPO-MAP.md`, `docs/AGENT-CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/runbooks/**`. There is **no** separate "active plan" doc — `RECONCILIATION.md` (ship log) + `AGENTS.md` (backlog) are the live sources; a plan doc that stops being reconciled is historical (see below).
- **Historical (do not paste into agents as current):** `docs/archive/**`, `docs/project/V10-PLAN.md` (v10 control-layer plan, last reconciled 2026-05-08 — HISTORICAL per audit #22), `docs/project/MASTER-CONTEXT.md` (v7-alpha, quarantined), `docs/project/UPGRADE-PLAN.md` (v8.x, quarantined), `docs/UPGRADE-PLAN-V6.md`, dated snapshots (`cohort-*`, `state-of-autonicks-*`, `session-handoff-*`), `adr/*`, `audits/*`.

## Stale-doc guard

`pnpm check:stale-docs` scans active (non-archive) docs + agent-facing files for retired deploy/provider terms used as current instructions. Critical terms (Vercel-as-prod, the retired branches, the standalone repo URL, the retired local path) hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn. A line is exempt if it contains a safe-context word: `historical`, `retired`, `archived`, `do-not-execute`, `obsolete`, `not current`. **Never paste an archived doc into an agent as current context** — quote `CURRENT-TRUTH.md` or live code instead.

## See also

- `docs/runbooks/index.md` — agent operating runbooks (how to work safely here). Guard: `pnpm check:runbooks`.
- `lib/evals/` + `pnpm eval:memory` — the truth scoreboard that checks Nick remembers this file.
- `lib/ai/receipts/action-receipt.ts` — the action-honesty receipt contract (`canClaimDone`).
- `lib/knowledge/action-converter.ts` — knowledge→action suggestions (suggestion-only).
