# CURRENT-TRUTH.md — Statenour



## 2026-10-02 - Agent follow-ups deliver; the thinking engine runs nightly again; NicksMax cameras self-heal (#2892, #2894, #2896)

- **Agent follow-ups: LIVE + PROVEN.** All three switches are on, and the 17:45Z run went through with no skip.
- **Thinking engine: BUILT + WIRED, waiting on its first mega-evening run.** `/api/cron/think` (mega-evening, detached) writes `contradictions`, `identity_snapshots` and `causal_chains` again. identityDelta and the shop brief now age-gate those reads.
- **NicksMax supervisor: LIVE.** It restarts the office conversation worker and the Eufy bridge/agent, and logs ESCALATE when restarts do not converge. **Corrected 2026-10-07:** its restart primitive ended only the PowerShell wrapper and orphaned the node/python children (Eufy-bridge restart storm, two Eufy agents on `:3601`, two `office` heartbeat owners); fixed in PR #2920, live on NicksMax only after a `git pull` there.
- **Office camera:** listens (audio to transcript) AND watches (stills to a cloud vision model, "Saw:" line, Right/Wrong review) since #2898 and #2901 (2026-10-02). The 2026-10-02 line here saying "does not watch" was stale the day it was written. **Measured 2026-10-07:** it listened about 8 % of the business day after the 2026-10-03 switch to `large-v3-turbo` (transcription ran longer than capture, serial worker); PR #2920 decouples capture from transcription and reports a 60-minute listening coverage in the heartbeat (`conversationListeningCoverage60m`, shop-side column 0144).
- **Vehicle lane (device_events): hardened 2026-10-07 (PR #2920), indexes applied 2026-10-08.** The ingest writes the row before it pages (a crash between the two no longer pages twice on the edge's retry), catches the P2002 of a per-device unique `eventId` index, and keeps a visit for 7 days instead of 12 hours. `20261007120000_device_events_identity_indexes` was applied to prod Neon on 2026-10-08 (operator-approved; the read-only preflight found the duplicate eventIds first and they were resolved before the unique index was built), promoted to `prisma/migrations/`, added to `lib/db/migration-manifest.ts`, and recorded in `_prisma_migrations`; `/system/health` should now read the index as present. `prisma migrate status` was not run from the applying session (no port 5432 from that container) -- the ledger row is the receipt until a local session confirms it.

Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - Brain graph links grounded entries to out-of-window anchors; the Obsidian bridge reports to production again (#2890)

**BUILT + TESTED (PR #2890); the Obsidian half is LIVE on NattyNour (the branch's exact files are checked out there until a `main` pull replaces them).** The Home graph loads a grounded entry's mission/goal even outside the top-N window, and the mastery-xp sweep re-grounds rows whose goal/mission was deleted (the status no longer claims a link that does not exist). The local Obsidian engine writes its status row to prod (`local_sync_log` module `obsidian_engine`: health `healthy`, 0 issues at 16:34Z), the watch daemon no longer crashes on start, and the export no longer loops on same-second reflections. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - Bug hunt over the full-circle waves; the reality ledger takes writes again (#2888 DEPLOYED)

**DEPLOYED 2026-10-02 16:03Z (#2888 squash-merged as `f3051532`; Railway `statenour-web` `c84db7d0` SUCCESS; `/api/version` serves that commit).** Chat output caps never fall below 6,000 tokens on a shaped turn (empty "factual" answers were the thinking model starved). Ledger: brief and push summaries are dated; decide-by-content takes the newest row; dismissals carry no `resultRef` and the closer closes accepted rows only; chip rows key on chip id; the forecast window is 6 days; `recordShown` inserts under a per-hash advisory lock, so two tabs write one row. `intelligence_outcomes_result_ref_idx` exists in prod. **`reality_events` had been unwritable since 2026-09-29** (migration `20260929123500_reality_event_envelope` was committed but never applied; `/api/sync/evidence` failed 38 times on `event_version`). Applied 2026-10-02 15:54Z with operator approval and recorded in `_prisma_migrations`; LIVE + UNPROVEN until the next evidence sync writes row 333. Every repo migration is now in the prod ledger. **Correction:** the Telegram webhook is registered and receiving; the wave 4 "zero webhook requests" finding was a log-filter error. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - The Owner Panel has durable sources for failing capabilities and degraded briefs (#2883 DEPLOYED)

**DEPLOYED 2026-10-02 12:46Z; the receipt path is LIVE + UNPROVEN.** #2883 squash-merged as `ba792990`; Railway `statenour-web` `59bc223f` SUCCESS; `/api/version` serves that commit (ancestry-checked). Guardian terminal failures now write a durable receipt into `integrations` (`type="capability"`, degraded after 3 consecutive, reset by the first success, 750 ms bounded, no-op without `DATABASE_URL`); the Owner Panel projects `capability_degraded` and declared-degraded cron runs (`degraded · ` prefix); `operator.waitingSummary` answers who waits on whom. No `guardian_call_failed` and no Firecrawl call appeared in Railway logs between the deploy and 13:20Z, so no `capability_receipt_written` line exists yet — the instrument has had nothing to record. This entry flips to LIVE + VERIFIED when that line (expected from the 10:15 UTC brief while Firecrawl credits stay exhausted) and the `/system` row are observed.

## 2026-10-02 - Forecasts are scored against actuals; chat chips are ledgered recommendations; the chat decision-surface producer is gone

**DEPLOYED 2026-10-02 15:14Z (#2887 `d66a5047`, Railway `b4b487f2`); LIVE + UNPROVEN until the first scored forecast and chip rows.** The weekly digest scores last week's revenue-side forecast before writing this week's: `outcomeUseful` = the actual landed inside the band, `resultRef week:<start>:actual:<n>`, and the email says HIT, MISS, or why it could not score (the bridge gave no number, or the forecast was UNAVAILABLE) — a missing actual is never a miss. Each chat suggestion chip is a `suggestion` row (`nick-suggestions:<kind>`, `chip: <label>`, surface `chat-chips`); tapping decides it `accepted`, X decides it `dismissed`, and a chip about one task closes when that task is rated. `getTopDecisions` no longer writes `decision_surface` rows (the decision is made in nickstire, so the row could never be decided here). The harvest odometer's "suggestion verdicts" now counts real taps (it read a metadata key the writer never stored and had been 0). One morning brief is one ledger row (the hand-off writer that doubled it is gone), and the Telegram fallback carries rating buttons. Settings: "auto" Default Mode is reachable, the AI-config REST twin validates its body, Journal sliders use the server's bounds, the autopilot map holds only the key the runtime reads, push and ticker copy describe real behaviour, and `NICK_MUTATION_LOCK` can be lifted from the flags board (only lifted). ~~Open, operator: Telegram updates have not reached this app~~ — corrected in the #2888 entry: the webhook is healthy. `/system/health` shows where it points. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - The Home lead, the Missions deck pick, the Journal next action and the Brain nudge are ledgered recommendations; one correction predicate; the odometer row is read back

**DEPLOYED 2026-10-02 14:38Z (#2886 squash-merged as `1bcffea6`; Railway `statenour-web` `6f46ff0c` SUCCESS; `/api/version` serves that commit). LIVE + UNPROVEN: no `operator-brief:*` / `missions-deck:*` / `journal:next-action` row yet at 14:45Z — nothing rendered those surfaces since the deploy.** `IntelligenceOutcome` now receives a `suggestion` row for the Home brief's lead (`sourceEngine operator-brief:<kind>`, summary `"<headline>: <cta label>"`) and for the Missions deck's pick (`missions-deck:start|resume`, summary `next move: <title>` / `resume: <title>`); both read models carry the row id, `operator.recordRecommendationDecision` records `accepted` (CTA / Start, `resultRef task:<id>`) or `dismissed` (alternative / pick-different), and `checkTask` closes accepted rows by `resultRef` from the completion rating. Semantic contract (in the service header): `decision` = what the operator did, `outcomeUseful` = did it help, a rating never writes a decision; `outcomeStats.unlabelled` (both null) is shown on `/system/fleet` beside `undecided`. Same PR, second commit: the Journal `receipt` read ledgers an unpromoted next action (`journal:next-action`) and promoting it records `accepted` with `resultRef task:<id>`; `brain.acceptNudge` records a tapped nudge as `accepted`; the correction predicate (`dismissed` OR `outcomeUseful = false`) has exactly one owner, `CORRECTION_WHERE`, gated by a source test; `edited` is gone from the decision vocabulary and the schema comment says no TTL sweep writes `ignored`; `/system/fleet` reads the harvest cron's `eval_run:corpus-odometer` row (or names it missing); the daily brief's ledger row says `handed-off-to-combine` until the standalone backstop actually sends, then `web-push` / `telegram-fallback`. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - Settings owns durable configuration; System owns operations; the cron kill switch governs Inngest crons too

**DEPLOYED 2026-10-02 13:48Z (#2884 squash-merged as `b008b801`; Railway `statenour-web` `9c6bee2e` SUCCESS; `/api/version` serves that commit, ancestry-checked; `/settings`, `/system/health`, `/system/crons` answer; no `sanitized_error` or kill-switch warning in the deploy log since). LIVE + VERIFIED lands here once a signed-in read shows the three Settings domains, the digest line on `/system/health` and the first measured `errorRateByRoute`.** `/settings` is three configuration domains (identity · cognitive · notifications) and nothing else — the ownership test from `docs/design/settings-census-2026-10-02.md`: a block belongs on Settings only when it writes a preference the runtime reads back. Machine health, errors, crons and the deploy identity live on `/system`, `/system/health` and `/system/crons`; memory of the day on `/brain`. The `cron_control` kill switch is honoured by BOTH dispatch paths: `cronHandler` for `/api/cron/*` routes (as before) and `CronLifecycleMiddleware.wrapFunctionHandler` for the 19 Inngest-native crons (new; a killed cron settles `success` with `skipReason "disabled via settings"`, 30 s read cache, fail-open). The `/api/settings/crons` REST twins are gone (they read a `vercel.json` that no longer exists); `/system/crons` + `systemAutomation.{cronDeck,setCronEnabled,runManifestCron}` are the surface. Home's rail carries "Waiting on others" from `operator.waitingSummary`. The combined daily brief carries 👍/👎 rating actions on its web push and buttons on its Telegram fallback (`lib/services/outcome-rating-affordance.ts`), so a `daily_brief` ledger row can be labelled from the surface it arrives on. The per-route error-rate read (`system.errorRateByRoute`, its REST twin, and the task-timing predictor's history read) bound a timestamp window as text and had failed on every call since it shipped (SQLSTATE 42883); all three bind a Date now, so the `/system/health` error-rate card measures for the first time. **Operator note after deploy:** rows that were "killed" on `/system/crons` for Inngest-native crons now actually stop those crons — review the killed list once. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - UI v2 PR 4: backlog closed (card.tsx gone, GlassCard + ui-material layered, cn merges v2 scales, orb gone, radius/slate sweep, chat-v2 converted)

**LIVE + VERIFIED 2026-10-02 12:10Z.** #2880 squash-merged as `f93469b7`; Railway `statenour-web` deployment `388b693f` SUCCESS; `GET /api/version` reports that commit and `git merge-base --is-ancestor` confirms it; the served stylesheet has `.neural-glass` inside `@layer components` and zero occurrences of the dialog's gold glow. One `.rounded-md` rule remained in the bundle from `components/brain-dump-modal.tsx`, converted in the full-circle wave 1 PR.

`components/ui/card.tsx` is deleted; `GlassCard` is the only card and its `.neural-glass*` rules (and `.ui-material`) sit in `@layer components`, so className utilities a caller passes now apply. `cn` (`lib/utils.ts`) extends tailwind-merge with the v2 radius / shadow scales. The realtime voice overlay renders a solid state disc with one `pulse-live` ring while working. `rounded-md|lg|sm`, bare `rounded` and `slate-*` are swept onto the v2 names/tokens across `app/`, `components/` and `features/chat-v2` (the last unconverted slice). Brain inline edit buttons meet the 44px touch floor below `sm`. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - UI v2 PR 3: the `?ui=v1` comparison lane and the CommandDialog wrappers are deleted

There is no longer a per-browser or env switch back to the pre-v2 grammar: `lib/ui-version.ts`, `components/ui/ui-version-switch.tsx`, the `data-ui` stamp in `app/layout.tsx`, the `:root[data-ui="v1"]` blocks in `tokens.css` / `base.css`, the `STATENOUR_UI` flag-registry entry and the decorative particle canvas (`components/hud/neural-background.tsx`) are gone; the v2 type floor applies unconditionally. `components/ui/command.tsx` exports only the five primitives the ⌘K Resolver uses. Rollback of the grammar is `git revert`. Pinned by `tests/repo/ui-v2-grammar.test.ts` ("the v1 comparison lane is gone"). Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-02 - UI v2 PR 2: every operator surface is on the cockpit grammar; the ⌘K palette works again

All of `app/(mastery)` and `components/` (journal, brain + graph controls, people, stats, 17 system pages + 19 panels, chat, shell, hud, home, missions, goals, actions, operator, inspector, workset, ultron, power-atlas, settings, relationships, content, mastery chrome, the `components/ui` primitives, `PageNick`, `PageTabs`, the ⌘K Resolver, the bottom ticker, the remaining route pages and sign-in) use the v2 grammar from `docs/design/ui-v2/SYSTEM.md`: 13px Geist controls, accent underline / `border-accent` / `bg-accent-soft` for selected, mono 11px eyebrows as the only uppercase, `bg-content` cards, one gold primary per page, `pulse-live` only while working. Strict legacy census: ~1,990 hits → 0 unsanctioned. The Resolver had been throwing on open (`CommandDialog` mounts no cmdk root); it now owns its `CommandPrimitive` root (`tests/components/command-palette-cmdk-root.test.tsx`). `tests/repo/ui-v2-grammar.test.ts` now also fails on any custom property a `.tsx` reads that nothing defines (ten were found painting elements transparent). Still pending (PR 3): delete the `?ui=v1` lane and the unconsumed `CommandDialog` wrappers. Ship record: `docs/RECONCILIATION.md` top entry.

## 2026-10-01 - UI v2 Precision Material Cockpit is the live frontend grammar (#2871 merged, deploy-verified)

bdnick.info renders the v2 grammar since `18bf9ebc` (Railway statenour-web `754fae93` SUCCESS): warm near-black surface steps, Geist sentence-case headings, one gold signal per surface, translucent material only on the desktop rail and the composer, Activity Summary + Tool Receipt in chat, no particle canvas. Spec and receipts: `docs/design/ui-v2/`. `?ui=v1` (cookie `statenour_ui`) restored the previous colour/type system for comparison until PR 3 (2026-10-02) deleted the lane. Utility trap recorded in SYSTEM.md: `bg-surface` is the legacy alias of `--surface-interactive`; the content-card role is `bg-content`. Journal / brain / people / stats / system / palette / ticker were converted in PR 2 (2026-10-02 entry above). `tests/repo/ui-v2-grammar.test.ts` pins the grammar and refuses bracketed var() class spellings in scanned docs (Tailwind v4 auto-source reads Markdown; two CI reds on 2026-10-01 came from prose).

## 2026-10-01 - NOUR Gateway OpenAI tool-call transport (branch + isolated-live proof; 11436 cutover pending)

- **What changed:** the logical NOUR models now advertise OpenAI-compatible `tools` / `tool_choice` support. When a client supplies tools, the gateway serializes the tool schemas + prior tool results into a strict reasoning envelope, validates the selected tool name against the caller's allowlist, and returns standard `message.tool_calls` / streaming `delta.tool_calls`.
- **Authority boundary is unchanged:** the external worker/subscription lanes remain read-only. The gateway never executes the requested shell/file tool itself; execution stays with the caller (OpenCode in the canary). `tool_choice=none` stays on the ordinary chat path, and an unknown model-selected tool name is never forwarded as a tool call.
- **Real end-to-end proof:** isolated gateway `127.0.0.1:11437` + isolated OpenCode 1.18.34 server `127.0.0.1:4098` completed `user -> NOUR Auto -> bash(git status --short) -> OpenCode tool execution -> tool result -> NOUR Auto -> final answer`. OpenCode persisted a completed `tool` part with `exit=0` and the exact two modified files.
- **Failover proof:** the direct Codex lane reported subscription quota exhaustion; the same request through `nour-auto` failed over to Claude Code and still returned a valid `bash` tool call.
- **Regression proof:** 66/66 Windows local-agent tests green, including 16 gateway tests; Python compile, Node syntax, 17/17 ChatGPT-plan bridge self-tests, and `git diff --check` are green.
- **Tool results are fenced (post-merge audit, 2026-10-01):** as merged in #2861, a tool result entered the flattened `ROLE:` prompt unfenced. So a file, command output or web page containing a `USER:` line forged a second user turn that could steer the model into a `bash` call OpenCode then runs. Each tool result now sits in one `<tool_data tool="..." source="tool_result">` fence, the same pattern ADR 0014 uses everywhere else. Forged fence tags are stripped, turn and section header lines inside the result are neutralised, and the tool protocol states that fenced text is data. Pinned by `local-agent/test_nour_gateway_tool_fencing.py`. **Promote this fix with #2861, never #2861 alone.**
- **Not claimed yet:** the production local gateway on `127.0.0.1:11436` still runs the prior bytes until this branch passes PR/CI and is promoted. The OpenWebUI cockpit bridge/run ledger is separate follow-on work. This change creates no bdnick.info Mission/Task rows and does not enable worker writes.

## 2026-09-29 — live Railway topology supersedes older worker-region/domain notes

- **Read-only Railway read-back:** production project `natural-appreciation` currently has exactly four services: `MAINnicks-tire-auto` (`a6234c8d-1ff4-478f-9085-654954b54e97`), `statenour-web` (`c68ce7f7-63b1-47bf-9e9e-2d7dfe717d4e`), `statenour-worker` (`5441c378-3bab-4bb7-958f-36961159f5fe`), and `Redis` (`ee90ba3b-7dc4-44da-b892-bc6152226b75`).
- **Regions now:** Nick, StateNour web, and StateNour worker each run one replica in `us-east4-eqdc4a`; Redis alone remains one replica in `us-west2`. Any older section below saying the worker is still west2 is historical and superseded by this read-back.
- **Worker is private:** live Railway lists no worker service/custom domains and no cron schedule. Worker-owned activity is its four node-cron HTTP forwards plus the in-process approved-video render loop; Q-36 removes the vestigial inbound `POST /cron/mega*` routes.
- **Worker data boundary:** `apps/worker/src` has no DB client and does not read `DATABASE_URL`, `DIRECT_URL`, or `GITHUB_TOKEN`. It talks to StateNour web over authenticated HTTP. Cross-app Nick ↔ StateNour data continues through the explicit signed bridge endpoints, not through the worker.
- **Still unverified here:** whether Inngest morning/evening mega fan-out is currently firing in production. `INNGEST_MEGA_V2` exists in Railway config but its value is redacted by the connector; obtain a `CronJobLog`/Inngest receipt before calling that cutover live.


## 2026-09-29 - PR #2795 external worker + cockpit/eval closeout (OPEN; not production-live yet)

- **Remote save:** PR #2795 contains a pushed checkpoint of this workstream on `statenour/reality-envelope-prod-closeout-20260929`. This section describes branch/local proof until the PR is merged and Railway is verified on the merge SHA.
- **One worker plane, no duplicate agent runtime:** the existing WorkItem/RunnerNode queue now accepts an explicit external-worker envelope and exposes the same lane state through system tools + cockpit. NattyNour adapters cover Codex subscription, Claude Code subscription, Antigravity, and local Qwen.
- **Cost boundary is executable:** worker subprocesses scrub metered API-key env vars. AUTO/read-only fallback can move only across the approved candidate list; a live smoke proved Codex subscription credit exhaustion -> Claude Code -> `FALLBACK_OK`. Write jobs never auto-fallback after execution begins.
- **False-success hardening:** exact Codex `workspace is out of credits` is classified as exhausted; Antigravity exit-0 with empty response/denied actions is failure. Worker + installer Python suites are 15/15 green.
- **Cockpit truth repair:** existing observability now reads real 7d AI cost/duration, TTFT, chat feedback, recent AgentTrace rows, recent-memory attention, Mission counts/receipts, system health, external worker state, and latest persisted eval. Prompt-version/run feedback attribution has no writer today and renders unknown instead of fabricated zero.
- **Eval hardening:** the incumbent eval corpus is 58 scenarios; four operator cases cover truth-before-completion, exact-lane continuation, reuse-before-rebuild, and AUTO-never-silent-paid. Promptfoo is only a thin oracle around incumbent `selectEligibleLanes()`; its six routing/privacy canaries passed 6/6 locally.
- **NattyNour local inference:** `127.0.0.1:11436` is healthy with backend-ready Qwen 3.5 4B. OpenWebUI default + pinned model now both equal `qwen35-4b-local`; the stale removed MiMo pin was backed up before the exact config edit.
- **Durable Windows install is built, not installed:** `local-agent/install-external-worker.ps1` copies the worker outside the dev worktree, stores `RUNNER_SHARED_SECRET` with current-user DPAPI, registers an outbound-only restartable task, scrubs API-key envs, and leaves writes OFF by default.
- **Not yet proven/live:** new external-worker schema migration is not yet applied to production; the scheduled worker task is not yet installed/started; PR CI/merge + Railway deployment/read-back are pending; a real production heartbeat/claim/complete receipt is pending; Neon isolated restore drill remains pending and must resolve the project ID without guessing.


## 2026-09-29 - NOUR AI supercomputer recovery + durable mission production proof

- Slices 2-3 merged: PR #2793 squash commit `223079d33407b9a6091e34a55032ea935d788e9e`; capability/cost routing + MCP v2. Required CI was green.
- Slice 4 is LIVE + VERIFIED: the existing Inngest durable mission runner completed a harmless checkpoint in production and persisted RealityEvent episode receipts end-to-end.
- Schema drift found and repaired: the first live run exposed missing `reality_events.event_version`. The repo-owned additive `20260929123500_reality_event_envelope` migration was applied to production (364-row / 440-kB table), verified, promoted to canonical migrations, and marked applied in Prisma history.
- Promotion: `NICK_DURABLE_MISSIONS` is ON through the existing DB feature-flag override only after the live receipt. A second run through normal `queueDurableMissionExecution()` persisted `queued -> started -> step_started -> step_completed -> completed`.
- No authority inflation: durable execution remains bounded to checkpoint/research steps and never auto-completes Mission lifecycle state.
- Durable receipt: `docs/00-current-truth/nour-ai-supercomputer-2026-09-29.md`.

## 2026-09-28 night — #2757 governance wave merge receipt

- **Merged:** PR #2757 squash-merged to `main` as `3178a894ff1d39d402837b214d060ce7b61b3a55`.
- **Final PR head:** `bed19035637dc2ba0bd1e9482c373403bce7db1d`.
- **Merge integrity:** squash-merge tree SHA exactly matched the final PR-head tree SHA; no file content was dropped or rewritten by the merge.
- **Final CI:** Turbo affected verify, StateNour E2E, Completion Authority, Secret Scanning, Agent Policy, Adoption gates, and Admin completion diagnostic all completed successfully.
- **Scope now on main:** Toolsmith capability lifecycle, unified Owner Panel exceptions, and Graphify governance/freshness receipts.
- **Still not claimed:** live production exercise of Toolsmith/exception flows, or a governed scheduled Graphify run after merge.

## 2026-09-28 night — Graphify code-intelligence governance (merged repo truth; scheduled-run proof pending)

- Graphify stays a developer snapshot; this slice adds no second graph store and does not bulk-ingest Graphify into BrainMemory.
- The existing sync now runs existing graphify-necropsy propose-only drift analysis when two snapshots exist, then writes ignored runtime GRAPH_RECEIPT.json with source SHA, report hash/time, Graphify version, label provenance, graph shape, HEAD/origin-main commit relation, previous-snapshot delta, and necropsy count.
- Session-start trusts a receipt only when receipt.report.sourceCommit exactly matches the Built from commit in the selected GRAPH_REPORT.md; missing/malformed/mismatched receipts are named and ignored without suppressing the graph briefing.
- Local proof: tracked graph source 9c4f30f4; 63,099 nodes; 115,045 edges; 3,401 communities; 313 commits behind this branch; 308 behind locally observed origin/main.
- Verification: Node syntax + governance self-test green; existing necropsy self-test green; both PowerShell scripts parse; repo contract tests 4/4 green; live session-context execution green; git diff --check green.
- Durable receipt: docs/00-current-truth/nouros-code-intelligence-governance-2026-09-28.md.

## 2026-09-28 night — Owner Panel exception consolidation (merged repo truth; production exercise pending)

- **No new exception queue:** the existing Q-24 Owner Panel on `/system` remains the single owner attention surface.
- **New projections from canonical stores:** dead `post_turn_outbox`; generic `action_attempts` WAITING_APPROVAL / UNKNOWN / recent FAILED / stale EXECUTING.
- **No duplication:** `railway.deploy_alert` attempts stay on the pre-existing deploy-page path; dead-letter redrive remains `redriveDeadOutboxRows()`; approvals retain their current source tables.
- **Truth rules:** UNKNOWN never retries blindly; a failed source read is unreadable/UNKNOWN, not a clear; fresh EXECUTING stays quiet; stale is 30m+.
- **Pure dependency repair:** cron hard-failure classification now lives in DB-free `lib/services/cron-status.ts`; `cron-control.ts` re-exports the same names for API compatibility.
- **Verification:** 53/53 focused Owner Panel + outbox + ActionAttempt tests were green locally; final #2757 head passed Turbo affected verify and StateNour E2E.
- Durable receipt: `docs/00-current-truth/nouros-exception-consolidation-2026-09-28.md`.

## 2026-09-28 night — capability lifecycle / Toolsmith (merged repo truth; operator-gated production usage)

- **Reuses incumbents:** Tool Registry + Tool Policy + ToolSelectionTurn/ToolGateDecision + Tool Gap + ActionAttempt remain canonical.
- **Gap response is explicit:** discoverability → fix discoverability; routing → fix routing; external-service → repair integration; only unresolved gaps enter new-capability investigation.
- **Append-only lifecycle:** `PROPOSED → APPROVED → IMPLEMENTED_UNVERIFIED → VERIFIED → RETIRED`; rejection is allowed before verification.
- **Authority boundary:** Toolsmith can propose/track only. It cannot install code, activate a registry entry, or execute a newly proposed capability. Implementation requires an external artifact reference; verification requires a receipt.
- **Operator surface:** existing `system.tools` tRPC + Tool Gap panel expose lifecycle report/mutations and proposal counts; no new auth surface.
- **Verification:** capability lifecycle regression coverage includes old unresolved proposals remaining visible beyond the telemetry window; final #2757 head passed Turbo affected verify and the complete PR CI suite.
- Durable receipt: `docs/00-current-truth/nouros-capability-lifecycle-2026-09-28.md`.

## 2026-09-28 late evening — Decision Plane shadow/calibration (merged repo truth; production shadow still off)

- **Merged as #2756 (`e2622a514`):** vendor-neutral typed decision contracts; strict private/external System-One-compatible HTTP adapter; deterministic sampled shadow evaluation through existing Inngest; Decision Episodes through the existing Reality Ledger; multiclass Brier/log-loss/ECE calibration primitives; Replay Lab outcome labeling; operator report + `/system/tools` panel.
- **Zero authority change:** the incumbent StateNour router still owns production. `NICK_DECISION_PLANE_SHADOW` defaults OFF; the report hard-codes `promotionReady=false`.
- **Privacy/egress boundary:** private-mode and obvious-PII turns never enqueue. Public backends require explicit `NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE=1`; an API key alone is insufficient.
- **Honest comparison:** candidate decisions are compared only against incumbent-owned fields. `needsBackgroundMission` has no fabricated incumbent label. Incumbent agreement is not correctness or calibration.
- **Replay Lab now reuses the same Episode lineage:** operator-observed labels append as `episode.decision.outcome_observed` on the candidate `episodeId`; corrections stay append-only; unlabeled Episodes remain visible and unscored; the panel reports label coverage, Brier, log loss and categorical ECE. Existing `DecisionReplay`/`MasteryDecision` remain the human decision journal rather than being duplicated.
- **Verification:** 22/22 focused Decision Plane + Replay Lab tests locally; final head `271e40225` passed Turbo affected verify, StateNour E2E, Completion Authority, Secret Scanning, Agent Policy, Adoption gates, and admin diagnostic before squash merge.
- **Not yet proven:** live shadow receipts, representative real outcome labels, or any candidate promotion. `NICK_DECISION_PLANE_SHADOW` still defaults OFF.
- Durable receipt: `docs/00-current-truth/nouros-decision-plane-2026-09-28.md`.

## 2026-09-28 evening — NourOS intelligence foundation (merged repo truth; feature-specific production proof remains)

- **Merged as #2755 (`a37a9f02c`):** the foundation is now repo truth on `main`; `4e628f0db` was only the branch starting point. Camera work remained a separate sibling workstream.
- **Merged foundation contents:** typed Episode envelopes over the existing Reality Ledger; bounded Inngest mission execution over existing Mission rows; tool-gap intelligence over existing `ToolSelectionTurn`/`ToolGateDecision`; persistence for verified-regen telemetry; explicit E2B deny-egress.
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

## 2026-09-29 — resilience/Q-31/Q-32 consolidation (pre-PR truth)

- Integration branch `feat/nouros-resilience-final-current-chatgpt-20260929` incorporates current main through `223079d33407b9a6091e34a55032ea935d788e9e` (#2793) via merge commit `80e031ac88d0b35443f1986e8dc05ad5faab97ae`; intervening #2789/#2793 had zero file overlap with the resilience diff.
- Q-28 cron grouping/inhibition, Q-34 process ownership, Q-36 worker hygiene, deep Q-31 admission/bitemporal/history + atomic explicit contradiction resolution, and Q-32 Langfuse evaluation mechanics are BUILT on the branch. They are not called merged/deployed/live until the consolidated PR passes exact-head CI and is merged.
- Q-31 pending migration `20260929150500_brain_memory_transaction_time` is operator-gated and **not applied** by this workstream.
- Q-32 production evidence remains intentionally incomplete: live label count, double-label kappa, and cloud dataset read-back are UNMEASURED. The optional cloud experiment stays config-gated.
- Durable implementation checkpoint: `docs/research/2026-09-29-resilience-final-consolidation-checkpoint.md`.

## 2026-09-29 — final resilience hardening before #2794 acceptance
- Q-32 independent judging is now fail-closed for unknown model families. Hosting providers are not accepted as model-family substitutes. The optional Langfuse experiment script parser defect was repaired, and the pinned experiment action was verified to supply its JS SDK and `dataset_version` input.
- Q-31 transaction-column availability has one shared probe/cache. Prepared canonical replacements now compensate transaction time, effective validity/verification state, and provisional snapshot on failure; history mode does not fall through to a legacy overwrite after a failed prepared replacement.
- These statements describe branch implementation only until exact-head CI and merge. No production Q-31 migration application or Q-32 empirical threshold is claimed.

## 2026-09-29 — #2794 merged; production claims remain gated
This supersedes the pre-PR status notes immediately above while preserving them as historical execution context.

- PR **#2794** final head `79dbea91630f860f0a84bbd68b075df4a7697eea` passed Turbo affected verify, StateNour E2E, Completion Authority, Adoption Gates, Agent Policy, Secret Scanning, and Admin Diagnostic, then guarded-squash-merged as `48ac53827eb7f4f5754ee2a41fe74789c5c36c89`; that commit was read back as `main`.
- Q-28, Q-31, Q-32, Q-34, and Q-36 are now **merged + unit-verified** in the machine capability ledger. Exposure remains disabled because merge/test evidence is not production evidence.
- Q-31 transaction-time migration `20260929150500_brain_memory_transaction_time` remains operator-gated and unapplied by this workstream. The app deliberately tolerates both schemas until apply + read-back.
- Q-32 live acceptance remains unmeasured: >=50 labels in 30 days, >=30 double-labeled items, Cohen's kappa >=0.6, and cloud Langfuse dataset/config read-back are still required for operational promotion.
- Q-34 default stays `PROCESS_ROLE=all`; no live web/jobs service split was performed.
- Q-36 has no claimed live mega morning/evening receipt; Q-28 has no claimed post-deploy Telegram grouping/recovery receipt yet.

## 2026-09-29 · takeover closeout after Neon restore / #2795
- **StateNour DB-auth incident recovered.** Neon project `spring-art-47050555` now has default production branch `br-green-firefly-am8jubqi`, restored 2026-09-29 from snapshot `snap-twilight-unit-am86vhxd`; the familiar endpoint `ep-quiet-wave-am320eo1` is attached to that restored branch. Railway `DATABASE_URL` + `DIRECT_URL` were refreshed for `statenour-web` and `statenour-worker`; fresh deploys reached SUCCESS and `/api/system/heartbeat` returned 200 with DB healthy and worker fresh. No fresh `P1000` / SQLSTATE `28P01` errors appeared after recovery.
- **#2795 merged.** External-worker/cockpit/migration closeout squash commit is `9c2d96fc0002403ab2f93dc77f3d8f303b13c2e4`; exact-head CI including Node sweep + StateNour E2E passed. Both StateNour services deployed that merge successfully.
- **External-worker schema only:** repo-owned additive migration `20260929195500_external_worker_lane` was applied to restored production (`WorkItemType += AI_EXTERNAL_WORKER`, `WorkItem.resultPayload JSONB`) and then recorded with `prisma migrate resolve --applied`. Read-back confirmed the schema and ledger step.
- **RealityEvent restore gap is CURRENT LIVE TRUTH:** `20260929123500_reality_event_envelope` is absent from the restored production schema **and** absent from the Prisma applied ledger. Read-only probes found all five envelope columns absent. This lane is intentionally left to the separate restore/recovery owner; do not infer the pre-restore receipt still describes current production.
- **NattyNour recovery:** disposable pnpm/npm/uv and inactive `.next`/`.turbo` caches were cleaned without deleting worktrees or dependencies; C: free space reached ~20.6 GB. Local gateway `127.0.0.1:11436` is healthy with backend ready; Codex ChatGPT auth, Claude subscription auth, and Antigravity CLI are present.
- **External worker is NOT yet live on NattyNour.** A fresh `RUNNER_SHARED_SECRET` is staged server-side and the web service was redeployed successfully, but the local installer could not be completed through the current remote safety boundary that prevents moving the secret into the machine's persistent DPAPI store. No `StateNour-ExternalWorker-NattyNour` scheduled task exists yet; writes remain OFF by default. Do not claim runner heartbeat or queue/claim/complete receipts until that install is completed and verified.
- **ChatGPT/Desktop Commander continuity:** a connected Desktop Commander device is not bound to a ChatGPT conversation. New chats must explicitly recover `list_devices`, `get_recent_tool_calls`, `list_sessions`, repo/worktree state, and production state before acting. A reusable `nour-operator-takeover` ChatGPT skill was created for this recovery protocol.


## 2026-10-01 — NattyNour NOUR Gateway tool execution + OpenWebUI cockpit checkpoint

- **Gateway tool calling is MERGED + LIVE + VERIFIED locally on NattyNour.** PR **#2861** squash-merged as `27f4d7a72ca5901b665d3e2b33a037cc0674f875`. The exact merged `apps/statenour/local-agent/nour-local-gateway.js` blob was verified byte-for-byte when copied to `C:\\Users\\nourd\\bin\\nour-local-gateway.js`; live `127.0.0.1:11436` now advertises `function_calling=true` plus `tools` / `tool_choice`.
- **Real OpenCode execution is proven against the live gateway.** OpenCode Desktop/CLI/headless are aligned at **1.18.34**. A disposable repo canary caused NOUR Auto to emit a real `bash` tool call for `git status --short`; OpenCode persisted the tool part, matched the `git status*` permission rule, executed it with exit 0, returned `?? scratch.txt`, and the follow-up model turn returned that result. This is execution evidence, not prompt inference.
- **The OpenWebUI cockpit bridge is LOCAL-LIVE + TESTED, not merged yet.** Branch/worktree `statenour/cockpit-bridge-20261001` serves a loopback-only OpenAPI bridge at `127.0.0.1:4101`; `/health` reports cockpit ready, OpenCode 1.18.34 healthy, and `mission_task_writes=false`. Current tests: cockpit **6/6**, gateway **16/16**, Python compile clean, Node syntax clean, `git diff --check` clean.
- **CockpitRun is deliberately separate from bdnick Mission/Task.** Each machine-work run gets an isolated Git worktree + OpenCode session + machine-local JSON state under `%USERPROFILE%\\AI\\cockpit\\runs`; current canaries have `mission_id=null`. Read-only canary completed without modifying files. Writable canary created only `COCKPIT_CANARY.txt`, stopped for shell approval, resumed after explicit owner approval, verified the change, and did **not** commit or push.
- **Safety boundary:** external directories and `.env*` reads are denied; shell defaults to approval; only narrow single-command read/test prefixes can auto-approve; shell metacharacters/chaining are excluded from auto-approval. Commit/push/PR/deploy/destructive/external actions remain owner-gated.
- **Still unfinished at this checkpoint:** bridge PR/CI/merge, startup persistence, OpenWebUI native tool-server registration, and end-to-end chat UX verification. Do not claim those until their receipts exist.


## 2026-10-01 — NOUR Cockpit default model + restart lifecycle checkpoint

- OpenWebUI custom model **`nour-cockpit`** is persisted as a profile over **`nour-auto`** with **`meta.toolIds=["direct_server:nour-cockpit"]`**. It is the OpenWebUI default and pinned first; the raw `nour-auto` lane remains available underneath rather than being mutated.
- OpenWebUI **v0.11.4** restarted after the lifecycle fix and logged **`Initialized 1 tool server(s)`** at 09:33:14. The UI also requested the `nour-cockpit` profile image immediately after fetching `/api/models`, proving the running server loaded the custom model.
- The restart bug is fixed: the old `Stop-WebUIOwned` predicate matched every process whose executable lived under the OpenWebUI Python directory, which killed the Cockpit bridge because it intentionally reuses that embedded Python. The filter now matches actual OpenWebUI/OpenTerminal command lines only. Controlled proof: OpenWebUI stopped, **4101 stayed healthy**, `mission_task_writes=false`, then the normal launcher restarted OpenWebUI and the server initialized one tool server.
- Machine-local cockpit/runtime helpers are now copied into repo source-of-record under `apps/statenour/local-agent/`: `launch-nour-ai.ps1`, `start-nour-cockpit.ps1`, and `ensure_openwebui_cockpit.py`. The helper is idempotent: after repair, a second run reported `changed:false`.
- **Still unfinished at this checkpoint:** model/tool naming and menu simplification, natural-language OpenWebUI → Cockpit → OpenCode end-to-end canary, bridge PR/CI/merge, and refreshed known-good snapshot.


## 2026-10-01 — Chat Controls UX target clarified before UI patch

- The user clarified that the cluttered surface is the **top-right per-chat Controls panel** in OpenWebUI, not the model picker. Do not conflate these surfaces again.
- Current NOUR Cockpit profile remains the correct default model wrapper over `nour-auto`; that model/default/toolkit work is separate from this UI cleanup.
- Current OpenWebUI admin settings show `tool_approval_mode=full`. The NOUR Cockpit workspace model currently has no sampling params forced in its model `params`, which is desirable because requests may route across multiple providers with non-identical parameter semantics.
- The visible Controls panel includes System Prompt plus a long Advanced Params list such as Stream Chat Response, Stream Delta Chunk Size, Context Compaction Threshold, Function Calling, Reasoning Tags, Seed, Stop Sequence, Temperature, Reasoning Effort, logit_bias, max_tokens, top_k, top_p and related provider-specific knobs.
- OpenWebUI model capability flags gate tool/file features but do **not** natively provide per-parameter visibility control for the sampling-knob list. Therefore the intended implementation path is a small, upgrade-resilient customization via OpenWebUI''s supported `custom.css` / `loader.js` static surface, not editing minified application bundles.
- UX objective: for NOUR Cockpit, keep useful power but reduce normal-path clutter and accidental misconfiguration. Preserve access to deeper parameters only through an explicit advanced/reveal path if required; do not globally cripple other models.
- No Controls-panel UI patch has been applied yet at this checkpoint.


## 2026-10-01 — NOUR Cockpit Chat Controls optimizer verified

- The top-right OpenWebUI **Controls** panel is now optimized specifically for **NOUR Cockpit** through OpenWebUI''s supported `/static/loader.js` + `/static/custom.css` extension surface. No minified app bundle was edited.
- Scope is model-specific: the patch activates only when `#model-selector-model-button` reports **Selected model: NOUR Cockpit** and only inside `#controls-container`.
- For NOUR Cockpit, **33 raw Advanced Params rows** are hidden by default and replaced by a concise status card explaining that routing/tools/provider params are automatic. **Show raw overrides** restores every original row; the change is presentation-only and writes no model values.
- Isolation canary: switching to `qwen35-4b-local` produced `data-nour-controls-mode=standard`, no NOUR summary, **0 hidden rows**, and Temperature remained visible.
- This matches gateway truth: live `nour-auto` advertises `supported_parameters=["tools","tool_choice"]`; generic sampling/Ollama knobs are therefore misleading in the normal routed-model path.
- The UI patch is self-healed by `ensure_openwebui_cockpit.py`, which preserves native OpenWebUI static content and replaces only the managed NOUR block.
- **Still unfinished at this checkpoint:** real natural-language OpenWebUI → Cockpit → OpenCode canary, bridge PR/CI/merge, merged-runtime promotion, and known-good snapshot refresh.


## 2026-10-01 — first full OpenWebUI → Cockpit canary exposed a last-mile gap

- A real headless OpenWebUI chat canary ran with **Selected model: NOUR Cockpit** and submitted marker `UI_E2E_CANARY_20261001_0951`, explicitly asking the Cockpit to start a read-only isolated run.
- **It did not create a CockpitRun.** No new machine-local run JSON appeared and the marker was absent from existing CockpitRun state.
- Gateway receipt for the corresponding turn: `nour-auto` started at **14:17:27**, routed through the normal candidate set, Codex reported quota exhaustion, Claude Code completed at **14:18:12**, and the gateway logged **`toolCalls=0`**.
- Therefore the natural-language OpenWebUI → Cockpit execution path is **NOT YET VERIFIED**. Do not regress the already-proven lower layers: direct live gateway function calling, OpenCode execution, Cockpit bridge/worktree isolation, approval gating, one-button startup, and the NOUR-Cockpit-specific Controls optimizer all remain separately verified.
- Next step is payload-level diagnosis: capture the actual OpenWebUI chat request to determine whether model `meta.toolIds=["direct_server:nour-cockpit"]` is being materialized into the per-chat direct-tool-server/tool schema or whether the tool was present and the routed model declined to call it.


## 2026-10-01 — OpenWebUI direct-tool selection payload root cause pinned

- Intercepted the real `/api/chat/completions` request from the disposable headless UI. **`model_item.info.meta.toolIds` correctly contains `["direct_server:nour-cockpit"]`, but the actual request sends `tool_servers: []`.** This is the definitive last-mile failure.
- Switching from NOUR Cockpit to another model and back does not materialize the server; the request still sends `tool_servers: []` while `modelToolIds` remains correct.
- Backend middleware confirms `tool_servers` expects fully materialized direct-server objects with OpenAPI specs, not synthetic IDs. Do not inject `direct_server:nour-cockpit` as a string into that field.
- The live **Integrations** menu currently shows top-level **Tools 1**, Web Search, and Code Interpreter. The next diagnostic step is opening **Tools 1** to capture the exact canonical direct-server selection shape OpenWebUI itself emits when selected manually.


## 2026-10-01 — exact OpenWebUI 0.11.4 direct-server default-selection bug found

- Installed frontend code in `DUmjoMyK.js` proves the bug: model initialization reads `rs.info.meta.toolIds` but filters those IDs against the **native Workspace Tools store**. `direct_server:nour-cockpit` is held in the separate direct-server/tool-server store, so it is discarded before chat.
- The later request builder is otherwise correct: it splits selected tool IDs into ordinary `tool_ids` and `direct_server:*` IDs, then materializes matching direct servers into `tool_servers`. Our direct ID simply never survives the earlier initialization filter.
- This fully explains the intercepted payload: the model metadata contains `direct_server:nour-cockpit`, while the outgoing chat request has `tool_servers: []`.
- Preferred fix: **do not fork the minified frontend bundle.** Create a native OpenWebUI Workspace Tool wrapper around the loopback NOUR Cockpit bridge and attach that native tool ID to the NOUR Cockpit model. Native Workspace Tool IDs are already auto-selected by the code path above. Keep the direct OpenAPI server registered as a separately usable integration.


## 2026-10-01 — native Workspace Tool wrapper selected as final OpenWebUI fix

- OpenWebUI 0.11.4''s model initialization path filters `meta.toolIds` against **native Workspace Tools**. This is why `direct_server:nour-cockpit` is dropped even though the direct-server request builder itself is correct.
- Final integration design: keep the direct OpenAPI Cockpit server registered as a separate integration, and create a **native OpenWebUI Workspace Tool** wrapper around the same loopback Cockpit bridge on `127.0.0.1:4101`.
- The native tool will expose the same simple cockpit actions and remain only a transport wrapper. Execution authority still lives in `nour_cockpit_bridge.py`: isolated worktrees, shell approval policy, no automatic commit/push/deploy, and `mission_task_writes=false` remain unchanged.
- The NOUR Cockpit model will point `meta.toolIds` at the native tool ID so OpenWebUI''s existing model-load path auto-selects it correctly.
- No native Workspace Tool has been installed yet at this checkpoint.


## 2026-10-01 — OpenWebUI direct-tool last-mile wiring fixed and browser-verified

- Payload capture identified the exact OpenWebUI 0.11.4 gap: the `nour-cockpit` model item correctly carried `meta.toolIds=["direct_server:nour-cockpit"]`, but the real `POST /api/chat/completions` request sent **`tool_servers: []`**. Switching models away/back did not change this. Even manually toggling the NOUR Cockpit tool entry to `aria-pressed=true` / `aria-checked=true` still produced an empty `tool_servers` payload and no `tool_ids` field.
- The fix stays in the supported customization/runtime layer rather than forking minified OpenWebUI bundles. `ensure_openwebui_cockpit.py` now fetches the live Cockpit OpenAPI and materializes exactly six user-facing operations into **`/static/nour-cockpit-tool-server.json`**: start, check, continue, approve, cancel, recent.
- `openwebui-nour-cockpit-loader.js` now wraps only same-origin `POST /api/chat/completions` and injects that fully materialized direct server only when the selected model is `nour-cockpit`, its model metadata contains `direct_server:nour-cockpit`, and OpenWebUI would otherwise send an empty tool-server list.
- Browser payload proof after the fix: `toolServerCount=1`, `serverId=nour-cockpit`, `serverUrl=http://127.0.0.1:4101`, and **6 specs** with the expected operation names. The loader also recorded its injection receipt in `window.__NOUR_COCKPIT_LAST_INJECTION__`.
- Browser direct-tool execution reachability is also fixed. The Cockpit bridge now allows CORS **only** from `http://127.0.0.1:8080` and `http://localhost:8080`, while continuing to require a loopback Host. A real browser-origin GET `/health` returned 200 and browser-origin JSON POST `/runs/status` passed preflight and returned the expected 404 for a deliberately missing run.
- **Still unfinished at this checkpoint:** rerun the natural-language OpenWebUI → CockpitRun → OpenCode canary with the fixed tool injection, then PR/CI/merge, merged-runtime promotion, final doctor, and known-good snapshot.


## 2026-10-01 — direct-tool injection works; executor lookup is the final E2E gap

- Fresh browser canary `UI_E2E_CANARY_20261001_DIRECTFIX_1` proved the loader injection is active: `window.__NOUR_COCKPIT_LAST_INJECTION__` recorded model `nour-cockpit`, server `nour-cockpit`, and the six expected operation names.
- The model **did call Cockpit tools**. The UI showed attempted `start_cockpit_run` and `check_cockpit_run` tool calls.
- Both tool calls returned exactly **`{"error":"Tool Server Not Found"}`**. No CockpitRun state file was created and the marker never reached the bridge.
- This narrows the remaining defect to OpenWebUI''s **direct-tool executor server lookup/resolution**. Model routing, gateway tool-calling transport, tool-schema injection, browser CORS reachability, and the Cockpit bridge remain independently verified.
- Next action: locate the literal error emitter and align the injected server identifier with the executor''s expected ID/index/store representation. Do not retry the canary until that lookup mismatch is corrected.


## 2026-10-01 — final executor lookup root cause pinned to per-user toolServers settings

- The literal **`Tool Server Not Found`** emitter is in OpenWebUI''s browser-side `execute:tool` handler. It takes `e.server.url` and resolves it through the current user''s **`settings.toolServers`** list first, with terminal-server fallbacks.
- The admin user''s persisted settings currently contain ordinary `ui` preferences but **no `toolServers` entry at all**.
- That exactly explains the latest canary: the six Cockpit function specs were injected, the model invoked `start_cockpit_run` and `check_cockpit_run`, but the browser executor could not resolve `http://127.0.0.1:4101` to a local server record and returned `{"error":"Tool Server Not Found"}` before the bridge received anything.
- OpenWebUI exposes a supported field-level settings patch path via `Users.update_user_settings_by_id(...)`; the next fix is to persist the NOUR Cockpit server into the admin user''s UI `toolServers` setting and make that part of the self-healer. Do not patch the minified executor.


## 2026-10-01 — NOUR Cockpit natural-language E2E VERIFIED

- **OpenWebUI → NOUR Cockpit → browser direct tool executor → Cockpit bridge → OpenCode → isolated worktree → result back to OpenWebUI chat is now VERIFIED.**
- Natural-language OpenWebUI chat invoked `start_cockpit_run`; the browser issued `POST http://127.0.0.1:4101/runs/start`, received **HTTP 200**, and created `cr_20261001_112711_fc4e81` with `mission_id=null` in a linked isolated worktree.
- OpenCode completed the read-only task. Independent machine verification after completion: `git status --porcelain --untracked-files=all` returned **exit 0 + empty output**; worktree HEAD exactly equals base commit `664c6ffc73c60630f78ab2e44b0fa35e951d7732`; `git diff --check` returned 0; diff stat is empty; linked worktree git-dir/common-dir resolve correctly.
- A second natural-language OpenWebUI chat explicitly called `check_cockpit_run` for the same run. The browser issued `POST /runs/status` and received **HTTP 200**. The persisted OpenWebUI chat stores the final assistant response with a real `check_cockpit_run` source, reporting `status=ready`, no pending approvals, `mission_linked=false`, and `diff=[]`.
- The browser-executor registration bug is resolved by persisting the Cockpit direct server into the admin user''s `ui.toolServers` settings in addition to the global tool-server connection.
- The startup self-healer idempotence regression is fixed by normalizing `admin_user.settings` through `model_dump()` when OpenWebUI returns a Pydantic-style settings object. Two consecutive ensure runs now both report `changed=false` and `user_tool_server_changed=false`.
- **Mission/Task boundary remains intact:** Cockpit machine work stays in CockpitRun state/worktrees and does not write StateNour Mission/Task records by default.

