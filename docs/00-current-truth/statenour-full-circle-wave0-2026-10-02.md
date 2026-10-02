# StateNour full-circle reconstruction · Pre-Implementation Truth Report

**Date:** 2026-10-02 ET  
**Scope:** Wave 0 read-only reconciliation before semantic/runtime implementation  
**Base inspected:** `main@ce28b7a40b052e9d41c5a6f4c12b31e900415848`  
**Concurrent work:** draft PR #2880 (`statenour/ui-v2-backlog`) is active and edits broad client/UI scope. This report intentionally makes no UI code changes.

## A. Current production state

- Railway project `natural-appreciation`, production environment.
- `statenour-web` latest inspected deployment: **SUCCESS** at commit `ce28b7a40...`.
- `statenour-worker` latest inspected deployment: **SUCCESS** at the same commit.
- `bdnick.info` is the custom domain bound to `statenour-web`.
- Current HTTP logs show live 200 traffic on `bdnick.info` for device/sync routes and active Inngest traffic.
- This session did **not** visually authenticate and exercise the private operator UI, so page-level UX is not marked production-verified from screenshots here.
- Neon could not be directly queried in this session because the connected Neon action requires a project id and the Railway OAuth connection exposes only variable names, not the DATABASE_URL value/project id.

### Live production anomalies observed

Recent Railway logs include:

1. repeated `guardian_call_failed` for `firecrawl-scrape` due insufficient Firecrawl credits;
2. `brief_compose_failed_degrading` — intelligence brief compose timed out after 90s;
3. slow reads around ~1s for cron-job-log and error-log queries;
4. one malformed identity-history row skipped by `brain.identity-snapshot`.

These are current operational signals, not historical audit claims.

## B. Current Git state

### Live UI v2

- PR #2878 merged the cockpit grammar broadly.
- PR #2879 removed the v1 comparison lane, particle canvas and obsolete command wrappers.
- Current production commit inspected: `ce28b7a40...`.
- PR #2880 is a **draft, open, mergeable** UI-v2 backlog wave. It edits System pages, MoreSheet, chat, Brain, Missions UI, shared UI primitives, CSS and many related components. Avoid collisions.

### NourOS foundation

- PR #2755 **MERGED** 2026-09-29 as `a37a9f02...`.
- Existing substrate includes Episode envelopes over RealityEvent, bounded durable mission execution, Tool Gap reporting and related tests.
- Current truth later records a live durable-mission receipt and promotion of `NICK_DURABLE_MISSIONS` through the existing feature-flag override after the production migration repair.
- Therefore: do not create a second mission runtime or event-history substrate.

### Decision Plane

- The Sept. 28 receipt saying branch-only is historical.
- PR #2756 **MERGED** 2026-09-29 as `e2622a514...`.
- Current architecture remains shadow/advisory; promotion is hard-coded false.
- Production shadow remains described as off in current truth.
- Classification: **MERGED + WIRED, production calibration/shadow proof still pending**.

### Capability Lifecycle / Toolsmith + exceptions

- PR #2757 **MERGED** 2026-09-29 as `3178a894...`.
- Capability lifecycle exists over the incumbent Tool Registry/Policy/Tool Gap/ActionAttempt stack.
- Owner-level exception consolidation also exists in the same wave.
- Production lifecycle-event proof remains incomplete.
- Do not build another capability registry or another exception database.

### RealityEvent envelope migration

- Current truth records that the first live durable-mission run exposed missing `reality_events.event_version`.
- Migration `20260929123500_reality_event_envelope` was then applied, verified, marked in Prisma history, and followed by a successful normal durable-mission run.
- PR #2788 later added the operator-controlled migration application route.
- Direct Neon schema re-read was not possible in this session, so treat the current-truth receipt as strong but not independently re-probed database evidence.

## C. Which operator audits remain true

### CONFIRMED CURRENT

- Settings still explicitly behaves as an ops console: the current page says "Settings — the operator's live ops console" and describes "system ops · automation · ai · scoring · preferences".
- System is simultaneously a large first-class operational surface.
- This is a real IA ownership conflict, not cosmetic polish.
- Canonical navigation still has separate `System`, `Proof`, `Brain`, `Stats` and `Settings` entries in one registry.
- Missions already has blocked/waiting semantics but does not yet establish a product-wide distinction between "waiting on me" and "waiting on others".
- Current operational failures can exist outside the Owner Panel's canonical exception sources.

### ALREADY FIXED / ALREADY EXISTS

- One canonical nav registry: `components/layout/nav-items.ts`.
- Home server-side attention budget: `ATTENTION_CAP = 7`.
- Home already rolls approvals into one judgment row and separates live vs expired approvals.
- Unknown reads are already treated as unknown in several critical paths, not coerced to zero.
- Owner Panel already consolidates cron, deploy, approval, commitment, lane-budget, post-turn dead-letter and ActionAttempt exceptions.
- Durable mission execution substrate already exists and has a live receipt in current truth.
- Decision Plane already exists and is merged.
- Capability lifecycle already exists and is merged.
- Tool-result/action approval UI primitives already exist.
- RealityEvent is already the correct event/provenance substrate.

### PARTIALLY FIXED

- Exception-first System: Owner Panel is strong, but recent live `guardian_call_failed` and intelligence-brief degradation are not obviously sourced into it.
- Waiting: Missions has `waitingOn`, but owner-versus-other semantics are not canonical across Home/Missions/notifications.
- System/Proof separation: both exist, but evidence/observability panels create conceptual adjacency that needs a route-ownership census before consolidation.
- More: component engineering is mature; taxonomy and destination count remain the likely issue.
- Settings: newer SettingsConsole structure exists, but its job definition remains operational rather than configuration-only.

### UNKNOWN / requires authenticated product exercise or data census

- Whether current Home and Missions select contradictory "next moves" in production today.
- Actual route visit frequencies, More usage, command-palette usage and deep-link traffic.
- Actual duplicate Journal ingest rate and how much it inflates downstream analytics.
- Current canonical habit duplication rate.
- Current task/mission child-count inflation.
- Current embedding-coverage shape by category.
- Whether each visible Settings control has a real runtime consumer.
- Whether the current Proof route is independently valuable enough to remain top-level.

## D. Semantic collision matrix

| Concept | Current incumbent(s) | Collision / gap | Disposition |
|---|---|---|---|
| Decisions / approvals | Home `operator.brief`; Owner Panel; `/system/actions` | same family presented through multiple projections; not yet one explicit semantic contract | build a read-model contract, not a table |
| Exceptions | Owner Panel over existing canonical sources | missing coverage for some runtime degradation classes | extend Owner Panel inputs; do not add exception DB |
| Waiting | Missions task `waitingOn`; approvals/commitments elsewhere | no canonical waiting-on-me vs waiting-on-others distinction | normalize as projection over existing objects first |
| Today | Missions deck + Home horizon/lead | no single verified TodayPlan read model found in this pass | build shared read model over incumbent task/calendar data |
| Next move | Home deterministic lead; Missions scoring/deck | potentially different ranking systems | document intended differences or converge through attention candidates |
| System health | control tower, Owner Panel, diagnostics, System subpages | multiple status vocabularies possible | define one status lattice + freshness contract |
| Evidence / Proof | RealityEvent/receipts; `/proof`; System evidence panels | epistemic truth vs machine health can blur | keep semantic distinction; census UI duplication |
| Settings/Ops | SettingsConsole + System | direct ownership contradiction | supersede ADR-0016; migrate Ops out of Settings deliberately |
| Memory quality | Brain panels + recall infrastructure | volume metrics can compete with utility/quality | prefer retrieval/duplicate/stale/contradiction/outcome signals |

## E. Canonical ontology map

Reuse existing persistence. Introduce semantic contracts/read models before new tables.

- **Capture** — raw recorded input, no obligation.
- **Proposal** — suggested change/obligation, not accepted.
- **Decision** — operator/system judgment choosing a disposition.
- **Commitment** — accepted obligation.
- **Mission** — multi-step outcome.
- **Task** — executable work item; child of mission when applicable.
- **Approval** — authority grant for bounded action.
- **ActionAttempt / Receipt** — execution lifecycle and evidence.
- **RealityEvent / Episode** — append-only lineage, evidence and replay substrate.
- **Exception** — projection of abnormal conditions from canonical operational sources; not a new database.
- **Outcome** — observed result after action.
- **Lesson / Memory** — retained update/context after evidence, not raw capture volume.

## F. Lifecycle map

### Durable mission execution
Existing and live-receipted in current truth. Keep bounded authority; do not auto-complete Mission lifecycle from runner events.

### Decision Plane
Merged, shadow/advisory, promotion false. Next work is representative outcome labeling/calibration, not a new scorer.

### Capability lifecycle
`PROPOSED → APPROVED → IMPLEMENTED_UNVERIFIED → VERIFIED → RETIRED`, with REJECTED exits. Production lifecycle evidence still needed.

### ActionAttempt
Already carries approval/executing/succeeded/failed/unknown-style execution truth. Reuse for agent/tool UI state instead of inventing a third lifecycle.

### Commitment/task
Existing state is richer than a single boolean but still needs a full lifecycle census before any schema change. Do not impose a new machine until current transitions are mapped.

## G. Page responsibility contracts

- **Home:** compiled operator attention. Does not own raw administration or diagnostics.
- **Missions:** execution of intentionally accepted work. Does not own capture analysis or machine health.
- **Chat:** reasoning, conversation and command execution. Does not own dashboard duplication.
- **Journal:** capture, digestion, reflection and lessons. Does not auto-create commitments.
- **System:** health and operation of the machine; exception-first control tower.
- **Proof:** epistemic evidence, provenance, receipts and outcome support; not generic health.
- **Settings:** durable configuration with real runtime consumers.
- **More:** launcher/search/recent destinations; not a taxonomy museum.

## H. Duplicate-data findings

Confirmed architectural duplication:
- Settings vs System operational ownership.
- Decision/approval facts projected independently across Home/System/actions without an explicit shared summary type.
- System and Proof have adjacent evidence/health responsibilities that require a component-level census.

Not yet proven:
- duplicate Journal inputs in live data;
- duplicate habit identities;
- task/mission double counting;
- memory duplicate rates.

Do not claim those until production data is measured.

## I. Existing systems that already solve proposed work

Reuse aggressively:

- `operator.brief` + attention cap;
- Missions deck/scoring/waiting semantics;
- `nav-items.ts`;
- MoreSheet search/recent/Smart Now/capture;
- RealityEvent/Episode substrate;
- ActionAttempt/ActionReceipt;
- Owner Panel exception consolidation;
- control tower/System hub;
- Tool Registry + Tool Policy + Tool Gap;
- capability lifecycle / Toolsmith;
- Decision Plane + Replay Lab;
- durable mission execution + Inngest;
- chat typed-tool/tool-result infrastructure;
- existing fabrication defense and security gates.

## J. Systems built but not fully live/proven

- Decision Plane representative production shadow/calibration: merged, but production shadow remains off.
- Capability lifecycle: merged; live lifecycle events still needed for proof.
- Exception consolidation: merged; receipt says real dead-letter/UNKNOWN/stalled production exercise was pending.
- Some runtime-degradation classes are live in logs but not yet proven to surface canonically as owner exceptions.

## K. Past ADR conflicts

ADR-0016 explicitly made Settings the canonical OPS entry based on the 2026-05 operator decision and then-current UI.

Current operator intent reverses that: Settings should stop being Ops.

Disposition: **supersede deliberately**, preserve deep links, move ownership after census. See proposed ADR-0024 on this branch.

## L. External pattern research

Mechanisms worth adapting, not products to clone:

- **Healthchecks.io:** expected heartbeat + schedule + grace time; use as the model for cron dead-man semantics. Existing cron receipts should likely implement this without another monitoring product.
- **Plane:** cycles/time-boxes, module/work hierarchy and explicit state; useful for commitment admission/capacity and mission hierarchy, not visual cloning.
- **assistant-ui:** explicit tool lifecycle, human interruption/approval and settled receipts; useful as a reference for one unified tool UI state contract.
- **AG-UI:** event-based run/message/tool/state/activity lifecycle; useful vocabulary for frontend-agent synchronization if the existing StateNour event contract lacks an equivalent. Do not adopt a protocol solely for fashion.
- **OpenTelemetry:** correlation/causation across signals via context propagation; map the idea to existing RealityEvent correlation/causation instead of deploying redundant infrastructure.
- **XState discipline:** explicit legal transitions for complex lifecycles; use the state-machine discipline before adding the dependency.
- **Memos / SilverBullet / AppFlowy:** capture stays cheap; knowledge becomes queryable without forcing every capture into a commitment.

## M. Proposed deletions / moves

Before deleting code, run a consumer census.

Highest-confidence dispositions:

- **MOVE:** operational diagnostics/SystemOpsHub content out of Settings to System.
- **KEEP:** Settings only controls with real storage + runtime readers.
- **KEEP:** System Owner Panel as the exception incumbent.
- **KEEP:** `nav-items.ts` as the only nav registry.
- **KEEP:** `operator.brief` architecture.
- **KEEP:** `/proof` until usage/deep-link evidence supports nesting.
- **DELETE/MERGE candidates:** duplicate status/health cards, duplicate evidence panels, dead/write-only settings and duplicate decision counts after the collision census proves them.
- **DO NOT BUILD:** second event store, second mission runtime, second Decision Plane, second tool registry, second exception DB, second nav registry.

## N. Proposed architecture

### 1. Semantic contract layer (read models, not storage-first)

Create typed projections with explicit owner/source/freshness:

- `DecisionSummary`
- `AttentionCandidate[]`
- `TodayPlan`
- `WaitingSummary`
- `SystemVerdict`
- `OpenLoops`
- `CommitmentPressure`
- `ClosureDebt`

Each projection must declare:
source, scope, time window, filters, measuredAt, freshness, failedSources, actionable semantics.

### 2. Attention selection

Home and Missions may present different views, but they should consume a shared attention-candidate vocabulary. Operator-facing priority must explain consequence, deadline/person waiting, unblock leverage, effort and freshness rather than expose a magic scalar.

### 3. Exception extension

Keep Owner Panel canonical. Add adapters/projections for material runtime degradation classes only when an owner consequence exists. First concrete gap to investigate: intelligence-brief and external-tool/guardian failures currently visible in live logs.

### 4. Closed loop

Use existing RealityEvent/ActionAttempt/mission/task/commitment substrates to connect:
capture → proposal → decision → commitment → task/mission → action receipt → outcome → lesson.

Do not add persistence until a missing relationship cannot be represented safely with incumbent ids/events.

## O. Migration risks

1. **Concurrent UI collision:** PR #2880 touches broad shared client surfaces. No visual/UI migration should overlap it.
2. **Semantic migration before data census:** new status fields/tables could duplicate existing state.
3. **Database truth:** direct Neon read was unavailable in this session; any schema migration must re-establish DB ground truth first.
4. **ADR drift:** moving Settings/System without superseding ADR-0016 would leave contradictory authority.
5. **Deep links/agent hints:** route deletion can break bookmarks, chat-generated links and command palette routing.
6. **Unknown-as-clear regression:** any new summary must preserve failed-source truth.
7. **Notification noise:** do not surface every runtime warning as an owner exception; require consequence + actionability.

## P. PR / wave plan

Keep the number of CI-heavy PRs small and isolate schema risk.

### PR A — semantic foundation, server/read-only
After reconciling current services:
- typed `DecisionSummary`, `TodayPlan`, `WaitingSummary`, `SystemVerdict` contracts;
- adapters over incumbent queries;
- freshness/failed-source semantics;
- tests proving unknown != zero and no double counting.
No UI. No schema unless proven necessary.

### PR B — execution + closure
- waiting-on-me vs waiting-on-others projection;
- blocked owner/unblock action;
- mission child hierarchy/next physical action where current models support it;
- commitment pressure/closure-debt read models;
- outcome linkage using existing receipts/events.

### PR C — surface recomposition, after #2880
- Home consumes canonical summaries;
- Missions consumes Today/Waiting;
- Settings loses Ops;
- System becomes exception-first;
- Proof ownership clarified;
- More taxonomy reduced.
This is where ADR-0024 becomes ACCEPTED if implementation validates it.

### PR D — learning/calibration + production proof
- ignored/dismissed recommendation telemetry;
- outcome-value tracking;
- Decision Plane representative shadow labels;
- production scenario tests;
- before/after action-path benchmarks;
- update CURRENT-TRUTH/RECONCILIATION only after live receipts.

## Immediate next implementation target

Before touching UI, implement the server-side semantic collision census / summary contracts and test them against incumbent sources.

The first bug-sized candidate is the exception-coverage gap: determine whether material `guardian_call_failed` and `brief_compose_failed_degrading` events have a durable canonical source that Owner Panel can safely project. If yes, extend the incumbent. If no, add the smallest durable receipt at the failure boundary — not a parallel exception store.
