# StateNour Integration & Consolidation Blueprint

**Date:** 2026-07-28 (evening) · **Method:** repository-grounded audit — every
claim below carries a file receipt or a prod-measured number; nothing is
inferred from product descriptions. Executed as the answer to the external
"whole-repository audit before adding platforms" recommendation, which this
document both validates and completes.

**Raw inventory:** 43 pages · 373 API route files · 46 cron routes · 102
Prisma models · 24 Inngest function registrations (barrel-complete, all
served) · ~172 cataloged AI tools across 13 domain files · 4 background
dispatch classes (5 counting request-time).

---

## Pass 1 · Job-ownership census

Every background operation belongs to exactly one execution class:

| Class | Members | Receipt |
|---|---|---|
| Inngest-native scheduled | 17 manifest entries (heartbeat, briefs, sweeper, pruners…) | `config/crons.ts` `inngest: true` |
| Inngest event-driven | journalFanout, nickEventTriggers, researchOnDemand, nickActionApproved, socialPublishQueue, bulkSmsApproval | `lib/inngest/functions/index.ts` |
| Mega fan-out (morning 09:00 / evening 03:00 / weekly Sun-ET) | ~41 route refs | `lib/inngest/jobs.ts`, verifier check [5/7] |
| Worker node-cron (HTTP forward) | brain-bus-drain, outbox-drain, inngest-liveness + local video render | `apps/worker/src/scheduler.ts` |
| Request-time / post-turn | everything else, incl. the post-turn outbox inline drain | `lib/services/chat/post-turn-outbox.ts` |

**Flagship finding (F1, fixed in this PR):** Wave AE (2026-05-28) pruned the
`brain-bus-backfill` route but left **nine producers** publishing durable
events (tasks · goals · journal-reflect · journal-ingest · drift-engine ·
identity-snapshot · autonomous-engine · task-actions · cron-manager
failures). `pollAndProcess` — the only drain — had **zero callers** from
that day forward. Prod measurement (read-only, 2026-07-28): last `done`
event exactly 2026-05-28; **393 pending** events spanning 05-28 → 07-28
(task.completed 184 · brain_dump.finalized 161 · cron.failure 23 ·
score.logged 20 · drift.fired 3 · reflection.created 2). Because the bus is
durable and its handlers idempotent, the entire backlog is **replayable** —
fixed by reviving the drain (`/api/cron/brain-bus-drain`, worker-fired every
15 min, 50/run ⇒ backlog clears in ~2h), not by ripping nine producers.
Same recovery precedent as `refresh-identity` (2026-07-11).

**F2 (fixed):** the worker's `HIGH_FREQ_JOBS` snapshot kept 4 names whose
routes Wave AE deleted — two months of 404 forwards every 2–60 min
(~800/day), visible only in the worker's own console. Removed.

**F3 (fixed):** `check:crons` trusted `worker: true` without ever reading
the worker's list — the exact blind spot F2 lived in. New check [7/7]
validates both directions (worker name → route + manifest honesty; manifest
`worker: true` → present in worker list). Red-green proven: 4 failures on
the pre-edit list, 0 after.

**F4 (fixed):** the post-turn outbox's only backstop drain was nightly
(mega-evening 03:00) — a turn that crashed mid-work stranded its receipts
and completion message for up to 24h. Now also worker-fired every 15 min;
the claim is atomic first-claimant-wins so both paths coexist.

---

## Pass 2 · Chat integration matrix

Tool inventory per domain file (`lib/ai/tools/`): brain 38 · system 34 ·
tasks 29 · business 20 · meta 11 · content 10 · social 9 · goals 7 ·
missions 3 · calendar 3 · habits 3 · **finance 1 · health 1**.

| Module | Readable | Actionable | Renderable (typed card) | Linkable | Verdict |
|---|---|---|---|---|---|
| Brain / memory | ✓ (38) | ✓ | — | ✓ evidence panel | rich |
| Tasks / agenda | ✓ | ✓ | — | ✓ | rich |
| System / fleet / decisions | ✓ | ✓ | ✓ FleetTruthCard + TopDecisionsCard | ✓ trace links | rich (renderers born 07-28) |
| Business (nickstire bridge) | ✓ (20) | gated via approvals | — | ✓ | rich |
| Content / social | ✓ | ✓ | — | — | good |
| Goals / mastery | ✓ | ✓ | — | — | good |
| Missions | thin (3) | thin | — | — | **thin** |
| Money / finance | **1 tool** | ✗ | — | — | **thin** |
| Health / habits / calendar | thin | thin | — | — | thin |
| Intelligence OS | partial (brief read) | ✗ | — | push deep-link | partial |
| Journal | via brain dump | ✓ capture | — | — | indirect |
| Knowledge · Learn · Photo-improver · Links · Research · Warroom | ✗ | ✗ | ✗ | ✗ | **disconnected from Nick** |

---

## Pass 3 · Route & navigation classification (all 43 pages)

Nav model: single source (`components/layout/nav-items.ts`) feeding bottom
tabs + MORE sheet + ⌘K — no drift possible between the three. `/system`
children ride the hub grid.

| Classification | Pages |
|---|---|
| **Canonical** (nav tier 1–2) | home, chat, missions, journal, stats, voice, pins, content, market, knowledge, learn, photo-improver, links, brain, people, money, business, system, settings (19) |
| **Canonical system children** (hub-carded) | actions, ai-cost, alerts, calibration, camera, cockpit-observability, crons, health, inbox, logs, proactive-preview, tools, fleet (13) |
| **Restored to reachability in this PR** | system/schema-history (documented canonical in 5 docs, URL-only since Wave AD) · system/chat-states (orphaned the night it shipped) · intelligence/brief + ledger (push-only entry before) |
| **Healthy redirect stubs** | goals → /stats#goals · scoreboard → /stats |
| **Deep-linked supporting** | decisions/[id] · auth/sign-in |
| **Disconnected — operator decision required (WP-5)** | **warroom** (spatial OS phase 1, desktop-only, zero inbound links) · **research** (NotebookLM cockpit, zero inbound links; Telegram `/research` triggers the *pipeline*, not this page) · **missions/simulator** (real feature component, zero links) |

---

## Pass 4 · Domain map (102 models → owners)

Clusters: Execution 10 · Brain/memory 14 · Chat 6 · Autonomy/governance 10 ·
Intelligence OS 9 · Ops/observability 16 · People 4 · Goals/mastery 6 ·
Journal 4 · Devices 5 · Business/commerce + settings ~18.

**Competing-concept verdicts:**

- **Task-like containers (5):** `Task` (canonical execution unit) ·
  `AgendaItem` (canonical operator agenda — owns follow-ups since Spine-4)
  · `CaptureInboxItem` (pre-triage inlet, janitor-swept) · `Commitment`
  (promise ledger — distinct semantics, keep) · `WorkItem` — **ownership
  unclear, WP-6 decides merge-or-retire.**
- **Event models (8, no shared envelope):** TaskEvent · GoalEvent ·
  DeviceEvent · AutonomousEvent · VisionEvent · BrainBusEvent · AuditEvent
  · EntityAudit. The external audit's "Universal Timeline" is **not
  buildable today** — correlation exists only where traceId flows (chat
  lanes). `packages/utils` contracts cover the cross-app bridge, not
  intra-app events. WP-7.
- **Decision records (4):** MasteryDecision (operator ritual) ·
  DecisionReplay (retro) · AutonomousAction (Nick's queue) ·
  IntelligenceOutcome.decision (recommendation acceptance, born 07-28).
  Distinct lifecycles — coexistence is correct; vocabulary unification via
  contracts is the only work worth doing.
- **People:** PersonProfile (canonical) vs Contact (commerce/booking side)
  — document the boundary, don't merge (different privacy surfaces).

---

## Pass 5 · Event substrate per lane

| Lane | Dedupe/idempotency | Retry | DLQ | Reclaim | Receipts | Correlation |
|---|---|---|---|---|---|---|
| Chat turn | message ids | n/a | n/a | outbox | ✓ ActionReceipt + auditEvent | ✓ traceId (unified 07-28) |
| Post-turn outbox | ✓ findFirst-before-create | ✓ ≤3 attempts | **✗ no dead state** (WP-8) | ✓ 30-min lease (07-28) | ✓ loud finishes | ✓ traceId |
| Inngest | per-fn varies | ✓ retries: 2 + onFailure | Inngest-side | n/a | ✓ heartbeat self-row | fn run ids |
| Brain-bus | ✓ dedupeKey | ✓ attempts → dead | ✓ dead status + escalation | ✓ 5-min stale reclaim | health snapshot | event ids |
| Bridge (nickstire) | ✓ | ✓ | n/a | n/a | ✓ envelope (contracts) | ✓ |
| Audit | append-only | n/a | n/a | n/a | ✓ | entity ids |

The irony worth recording: **the lane with the best substrate (brain-bus)
was the one lying dead end-to-end** — substrate quality guarantees nothing
without a scheduled consumer; that's what check [7/7] + fleet-truth
artifact probes now watch structurally.

---

## Pass 6 · Security enforcement points

| Control | Enforced where | Verdict |
|---|---|---|
| Approval queue (autonomous + bulk actions) | server — ApprovalRequest gate; ⏸ GATED receipts with approvalId | **hard** |
| Tool governance | server — withGuardian policy gate + quota breakers + aiConfig disabledTools blocklist (`prepare-tools.ts`) | **hard** |
| Private mode | server — earliest-fork boundary (#1035) | **hard** |
| Cron auth | server — CRON_SECRET bearer; Inngest HMAC signing | **hard** |
| `actionPermission: "read"` | prompt contract (`finalize-system-prompt.ts:380`) + suppression of force-added action tools (`build-stream-config.ts:213,246`) — **no execution-layer strip of mutating tools** (`gate.ts` parses; nothing downstream removes them) | **advisory — WP-1** |

The external audit's suspicion ("verify these are enforced server-side and
not merely reflected in client state") is **confirmed for read-mode** and
refuted for the other four controls.

---

## Fixed in this PR

1. Brain-bus drain revived — route + worker schedule + manifest entry (F1).
2. Worker ghost jobs removed (F2).
3. `check:crons` [7/7] worker-list validation, red-green proven (F3).
4. Outbox drain 24h → 15 min (F4).
5. Reachability restored: schema-history, chat-states, intelligence hub cards.
6. Chat-v2 parity ledger reconciled (6 rows "Pending QA" → verified with evidence).

## Work packages

**Closed later the same night (kernel batch — WP-13/14/15/16):** WP-1
shipped as the capability registry's read-mode strip
(`lib/ai/capability-registry.ts` + `prepare-tools.ts`, fail-closed on
three tripwires + unknown-tool, 5 pinned tests). WP-6's answer is the
Commitment lifecycle (WP-13): the competing task-like containers become
commitment views over time, starting with journal nextActions (WP-16
closed the June-10 C7 loop — proposals now await the operator's verdict
on Home). WP-7 is partially served by WP-15's execution-class vocabulary
in the contracts registry. Next-audit standard adopted: per-subsystem
scorecard with a disposition verdict (KEEP / COMPLETE / MERGE / REBUILD /
HIDE / DEPRECATE / DELETE / EXTERNALIZE) — richer than wired/not-wired.

- **WP-1 · Hard-enforce read-mode:** ~~classify mutating tools, strip in
  prepare-tools~~ **DONE 2026-07-28 late** (see above).
- **WP-2 · Bus retire-list:** after the backlog drains, decide whether all
  9 producer topics still earn their BrainMemory writes (cron.failure
  duplicates diagnose-cron-failure's alerting; score.logged may be noise).
  Evidence: 2 weeks of drained-event value.
- **WP-3 · Thin-module tools:** money/finance (1 tool) and missions (3) are
  the two modules the operator touches daily with the least Nick coverage.
- **WP-4 · Bus health into fleet-truth:** `getDurableBusHealth` exists,
  nothing reads it; add as a STATENOUR_ARTIFACT_PROBE so a dead drain
  surfaces in `/system/fleet` instead of a future audit.
- **WP-5 · Disconnected surfaces:** warroom / research / missions-simulator
  — operator picks per surface: nav entry, deliberate URL-only (document
  it), or deletion. No code default is correct here.
- **WP-6 · WorkItem:** trace consumers; merge into Task or retire.
- **WP-7 · Event vocabulary:** extend contracts registry to intra-app event
  types (8 models) — prerequisite for any timeline surface. Schema
  unification NOT required; a read-side projection is enough.
- **WP-8 · Outbox dead state:** after 3 failed attempts a row just stops —
  add `dead` status + surfacing (mirror brain-bus semantics).

## Build-vs-buy (standing decisions, receipts in #1173 + tonight)

> **2026-07-29:** this table graduated into the repo-wide
> [`docs/UPSTREAMS.md`](../../../docs/UPSTREAMS.md) disposition
> register — every adopt/reject/watch verdict with receipts and reopen
> triggers lives THERE now; check it before proposing any platform.

| Platform | Verdict | Why |
|---|---|---|
| Trigger.dev / n8n-as-runtime | **NO** | 4 dispatch classes already; a 5th job system is the disease this blueprint treats |
| Langfuse | **NO** (self-host = web+worker+PG+ClickHouse+Redis+S3) | native receipts/traces + AgentTrace cover the need |
| assistant-ui | **NO** | typed renderer registry shipped natively (#1176) |
| yt-dlp | **DONE** native, policy-guarded (#1173) |
| Plausible / PostHog | **DEFER** | outcome ledger (07-28) must accrue before analytics tooling means anything |
| Cal.com | **DEFER** | no booking-volume evidence yet |

## Pass 7 · Internal wiring (added same night — the declared gap, closed)

Method: mechanical cross-reference of every client-side data call against
what serves it, plus verification of the externally-pasted 8-item wiring
wave against runtime callers.

| Lane | Coverage guarantee | Result |
|---|---|---|
| tRPC (269 client call-sites, 14 routers) | **the TypeScript compiler** — typed end-to-end; a missing procedure is a build failure, and tonight's `tsc` is green | wired by construction (a crude static parser "convicted" 92 — all parser artifacts from spread-composed routers; discarded) |
| Raw `fetch("/api/…")` (49 distinct endpoints) | nothing — untyped strings | **2 real corpses** (below) + 1 scanner false-positive (greene-sidebar template literal — route exists) |
| localStorage (19 keys) | n/a | 17 benign UI prefs (sort keys, collapse state); `nour:pinned-convos` + `nour:lastReview` are device-local state with server-side siblings — WP-10 candidates, not defects |

**The corpses — the Money page's two tabs, dead five weeks:** the
2026-06-21 schema purge removed the FinancialTransaction + portfolio
models, deleted `GET/PATCH /api/finance` and all of `/api/wealth/*`, and
stubbed `syncTransactions` to return `{imported: 0, skipped: N}` — which
the UI rendered as **"Successfully synced!"** over a void. Fixed
2026-07-28: honest retired-state on both tabs, stub now throws loudly.
Rebuild-vs-remove = **WP-9** (operator call; shop money lives in Business).

**The pasted 8-item wave, gated against runtime callers:**

| # | Item | Verdict |
|---|---|---|
| 1 | Connect response contracts to the live chat route | **ALREADY WIRED** — `buildResponseContract` runs in `derive-turn-signals.ts:136`; its directive lands in the system prompt (`finalize-system-prompt.ts:244`) |
| 2 | Connect contract-aware reply gate to persistence | **ALREADY WIRED** — `runReplyGateWithContract` executes in `persist-assistant-turn.ts:347` and its decision flows into the persisted message |
| 3 | Run known-truth guard on real responses | **ALREADY RUNNING** (telemetry mode); `NICK_KNOWN_TRUTH_BANNER` flag (experimental, OFF) gates promotion to correction banners — a flag decision, not wiring |
| 4 | Persist quality/verification results | Largely done (gate/critic/verifier land in message metadata + AgentTrace); coverage audit folded into WP-11 |
| 5 | Surface those results in the evidence panel | **REAL GAP → WP-11** — Context & Evidence shows recall + contradictions, not the reply's own gate/critic/verifier verdicts |
| 6 | Execution receipts for every mutation | Chat-tool mutations ✓ (ActionReceipt, 07-28); tRPC operator mutations partial (EntityAudit on some) → WP-12 coverage count first |
| 7 | Standardize event/correlation IDs | = WP-7 (already in this blueprint) |
| 8 | Remove/merge duplicate paths | Money-tab corpses handled above; warroom/research/simulator = WP-5 |

Items 1–2 are the **fifth and sixth already-built incumbents** external
audits have prescribed today — the pattern holds: verify runtime callers
before accepting any "connect X" recommendation.

- **WP-9 · Money tabs:** rebuild personal finance/wealth on fresh models,
  or delete both tabs and the dead flows. Until decided, honest
  retired-state ships.
- **WP-10 · Device-local state with server siblings:** `nour:pinned-convos`
  (vs server conversations), `nour:lastReview` (vs ReviewLog) — decide
  which is authoritative per key.
- **WP-11 · Reply-quality surfacing:** add the last assistant turn's gate
  decision + critic score + verifier verdict to the Context & Evidence
  panel (data already persists server-side; needs payload plumb + panel
  section). Acceptance: a gated/rewritten reply shows WHY in the panel.
- **WP-12 · Mutation-receipt coverage count:** enumerate tRPC mutations vs
  EntityAudit/auditEvent writers; close the uncovered set or document why.
- **WP-17 · ToolMeta `status` field** — **CLOSED AS ALREADY EXISTING**
  (2026-07-29, 13th incumbent catch — against my own plan this time):
  `system.getTools` already returns per-tool `health` + `missingEnv`
  from `getToolHealthSummary()`, which IS the measured env-derived
  status; /system/tools renders it. A manual override field with no
  data would be the ceremony the original note warned against.
- **WP-18 · Artifact-honesty eval scenarios** — **DONE 2026-07-29**:
  known-truth-guard STATUS_CLAIM extended with artifact claims ("video
  has been created") + browser-action claims ("submitted the form");
  evals #21-24 pin flag/no-flag both directions (honest "can't do that
  yet" and claim-with-artifact-id both pass clean). Red-green earned
  its keep: #21 caught my own too-loose "saved to X" evidence marker
  ("saved to your library" read as proof) before it shipped.
- **WP-19 · Business cash-flow forecasting** (audit-#10 keeper, reframed
  from its finance-lab): nickstire cash-flow forecast beside the
  existing weekly pricing-advisory — business finance, not personal
  trading; read-only artifacts.
- **WP-20 · OTel GenAI field mapping** (audit-#12): rename/mirror
  AgentTrace + ai-cost fields to `gen_ai.*` semconv names — standards
  alignment, zero new infra, no raw-prompt logging.
- **WP-21 · Braintrust eval-dataset spine** (audit-#12; dep verified
  live): recall failures, claim warnings, and operator accept/dismiss
  verdicts become versioned datasets; smoke evals on PRs, local
  no-send first. Extends Spine-8 + WP-18, replaces nothing.
- **WP-22 · nickstire search-conversion data spine** (audit-#12): GBP
  Performance API ingestion (publisher is posting-only today) + the
  GSC×GA4×leads join + LHCI/CrUX budgets — read-only, feeds the
  existing GSC pipeline and SEO cockpit; subsumes the GSC ranked-merge
  deferral.
- **WP-23 · NHTSA vehicle enrichment** (audit-#12): vPIC VIN/YMM
  normalization + recall-aware lead enrichment; read-only advisor
  framing, cached, source-labeled.

## Honestly not audited (scope declared, not hidden)

The UI-system pass (design tokens, spacing, a11y, empty/error states
beyond tonight's loud-failure work) — large, lowest-stakes, deferred.
Per-feature end-to-end wiring beyond the lanes sampled here. Measurement
baselines: the metrics the external audit demands are now *instrumentable*
(outcome ledger, fleet-truth, receipts) but have hours of data, not
baselines — first honest review ~Aug 4.
