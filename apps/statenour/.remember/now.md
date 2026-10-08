# Session ledger — statenour

**Updated: 2026-10-03 ET** (Sentry sweep + cron hygiene · #2904 `91fd5fb` + #2906 `eb36d6d` merged)

## 2026-10-03 · chat em-dash 500, duplicate cron runs, brief compose bound

- Thinking engine first run VERIFIED: `think` success 03:04Z 10-03; 8 contradictions, 4 causal_chains, 1 identity_snapshot; #2894 live on bdnick.info.
- #2904: `toHeaderValue` in response-shape.ts (Sentry JAVASCRIPT-REACT-13).
- #2906: fan-out ceiling = 202 not retry; healer skips fan-out siblings + dormant crons; daily-brief narrative bounded per lane (100s reason, 25s fast), step 140s.
- Cron audit 48h: 67 jobs, 0 failures; 34 active crons all on schedule.
- **Not bugs:** morning brief 35 min = deliberate combine-window sleep; ollama-model-liveness 5x on 09-28 = one healer re-run + 4 hand checks during the retired-model repair.

**Verify next:** after #2906 deploys: no duplicate `think`/dossier/brain-intelligence rows on the next nights; no `brief_compose_failed_degrading`.
**Flagged:** `morning_brief_audio` never saved (CARTESIA_API_KEY likely unset); no daily brief 09-29; Langfuse unswept (no connector).



## 2026-10-02 · connection census — follow-ups on, thinking engine revived, camera self-heal

**Verify next:**
- the first mega-evening run of `/api/cron/think`: a cron_job_logs row, plus new rows in `contradictions` / `identity_snapshots` / `causal_chains`;
- the first delivered agent follow-up (an assistant message in its origin thread);
- that #2894 deployed (`/api/version` ancestry).

**NicksMax** is on `main` (clean). The supervisor runs from `camera-bridge/scripts/nicksmax/` through the `data\` shim; its ledger is `data\.nicksmax-supervisor-state.json`; its log is `logs\nicksmax-camera-supervisor.log` (grep ESCALATE). The office worker task now has WorkingDirectory = `NOURCITY\camera-bridge`.

**Pending operator decision:** ~~office "watch" - A (cloud VLM stills, own switch) or B (on-box detection only).~~ Closed 2026-10-07: both shipped 2026-10-02 (#2898 A, #2901 B); this line outlived the decision. The open operator decisions now are in `docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md` section 14 (disk reclaim, desktop agents off NicksMax, decoder revert, the two pending migrations).

**Findings not fixed:**
- `tool_telemetry` stale 50h: suspect the alternate chat paths skip `recordToolInvocation`;
- `bridge_call_logs`: rejections are not persisted;
- `device_events` `frigate` `vehicle_detected`: last row 10-01 14:43Z, at a normal volume of 1-6 rows/day; trace the edge's posting path if it stays silent;
- owner panel `action_attempts` can show a false clear when RAILWAY_WEBHOOK_TOKEN is unset;
- dead tables: `pattern_detections`, `goal_stats`, `mission_links`, `content_studio_projects`, `prompt_versions` (ask before deleting).

**Updated: 2026-10-02 ET** (full-circle bug hunt #2888 · MERGED `f3051532` · DEPLOYED Railway `c84db7d0` 16:03Z · prod DDL applied with operator yes: result_ref index + reality_event_envelope)

## 2026-10-02 · bug hunt — 20 fixes + the reality ledger restored

#2888: chat cap floor 6,000; ledger fixes (dated summaries, newest-row decide, no resultRef on dismissals, chip-id keys, 6-day forecast window, two-tab advisory lock); control plane (mega aliases, per-run kill decision, kill does not page, diagnose skips declared degradation, run-now on Inngest crons, disabled capability respected); SQL (`deleted_at`, Date bind, error-rate attribution); UI/read models. Prod: `intelligence_outcomes_result_ref_idx` valid; `reality_event_envelope` applied 15:54Z (it was never applied; `/api/sync/evidence` failed 38x since 09-30). Verify: next evidence sync writes reality_events row 333 and no `event_version` error after 15:55Z. Telegram webhook is healthy (wave 4 claim was wrong). #2890 (open): graph anchors + dangling-link requeue + Obsidian lazy prisma + note-path claimer. NattyNour: stale Neon password replaced in the root .env (backups kept), OBSIDIAN_VAULT_PATH / REST_URL / REST_TOKEN set, bridge task re-enabled, launcher exports the DB vars, prod obsidian_engine row healthy at 16:34Z. **After #2890 merges, on NattyNour:** the three branch files (lib/obsidian/engine-config.ts, lib/obsidian/note-writer.ts, scripts/export-brain-to-obsidian.ts) are staged there - unstage them (git restore --staged), restore HEAD content by redirecting git show HEAD:<path> into each via cmd /c, then git pull --ff-only origin main and restart the bridge task. Decisions still unlinked after that are genuinely ungrounded (semantic-link covers BrainMemory only).

**Updated: 2026-10-02 ET** (full-circle wave 4 · `statenour/full-circle-e-census-close` · both censuses closed for code: E5/E6/E11/E12 + five settings items · prod measured · FOUND Telegram webhook silent since ≥09-25 · PR open · wave 3 #2886 DEPLOYED `1bcffea6` / Railway `6f46ff0c`, no rows yet)

## 2026-10-02 · full-circle wave 4 — the outcome-ledger census closes

Operator decisions: E5 (a) band hit, E6 delete, E11 fold. `resolveForecastPredictions` runs in the weekly digest before the new forecast is written; `projectedRevenue` stored on the row (null when empty); digest prints HIT / MISS / not-scored-because. `getTopDecisions` writes no ledger row; `decision_surface` out of `OutcomeKind`. Chips ledgered (`nick-suggestions:<kind>`, `chip: <label>`, `chat-chips`) with `ledgerId`; `recordSuggestionSignal` decides via `recordDecisionFromEvidence`. Found: harvest/odometer tap counter read `action`, writer stores `event` — fixed. Self-review caught a $0–$0 band MISS and window starvation — fixed + pinned. Gates: tsc 0 · eslint 0 · vitest 267 files / 3,233 + 33 after fixes · static gates all 0. Second pass (operator: "are you sure"): E12 fixed (one morning row; hand-off writer + dead fallback step deleted; backstop Telegram fallback rateable); settings: auto Default Mode via null, AI-config REST twin validated, Journal bounds shared, autopilot map = adhd_operating_rhythm only, stale push/ticker copy + 4 dead push helpers, mutation lock liftable (red-teamed). Prod (read-only): push 160/0 labelled, brief 114/0, suggestion 77/10, prediction 13/0; zero /api/telegram/webhook requests since ≥09-25 (positive control /api/version) — operator must check /system/health's Telegram line after deploy and re-register the webhook if it points elsewhere. After deploy: verify #2886 rows (`operator-brief:*`, `missions-deck:*`, `journal:next-action`) and wave 4 rows (`nick-suggestions:*`); first scored forecast on the next Sunday digest.

**Updated: 2026-10-02 ET** (full-circle wave 3 · `statenour/full-circle-d-ledger-joins` · Home lead + Missions deck + Journal next action + nudge ledgered · CORRECTION_WHERE single owner · odometer read · brief surface truthful · PR #2886 open, 2 code commits · wave 2 #2884 MERGED `b008b801` DEPLOYED `9c6bee2e`)

## 2026-10-02 · full-circle wave 3 — Lane D ledger joins

Home lead and deck pick are ledgered (`recordShownBounded`, 400 ms) with `ledgerId` in both payloads; `operator.recordRecommendationDecision` (accepted on CTA/Start with `task:<id>`, dismissed on alternative/pick-different); `checkTask` closes by `resultRef` (`recordOutcomeByResultRef`); contract written in `outcome-ledger.ts`; `outcomeStats.unlabelled` on `/system/fleet`. Gates: tsc 0 · eslint 0 · vitest 68 files / 587 · static gates green. Second commit (same PR, per "minimal merges"): E10 Journal (`journal.receipt` ledgers unpromoted nextAction as `journal:next-action`; promote → `accepted` + `task:<id>`), E8 (`brain.acceptNudge` on nudge tap), E3 (`CORRECTION_WHERE` single owner + source test), E9 (`edited` gone, schema comment = contract), E4 (`deliveryStats.odometer` from `eval_run:corpus-odometer` → `/system/fleet`), E2 (`handed-off-to-combine` + backstop `setShownSurface`). Gates: tsc 0 · eslint 0 on 16 files · vitest 65 files / 502 · mutations:strict, raw-sql, get-auth, anti-slop, crons, runbooks, scripts, stale-docs strict all 0 · prisma validate valid. Left as census items: E5/E6/E11 (product decisions, not joins). After deploy: one Home render → `operator-brief:*` row; one /missions render → `missions-deck:*` row; first CTA → `decision`. Wave 2 (#2884) merged `b008b801`; verify its deploy (settings 3 domains, /system/health digest line, /system/crons runbook links, errorRateByRoute 200) and record LIVE + VERIFIED.

**Updated: 2026-10-02 ET** (full-circle wave 2 · `statenour/full-circle-c-settings-system` · Settings/System recomposition + Inngest kill switch + Home WaitingLine + rateable daily brief · PR #2884 open · wave 1 #2883 MERGED ba792990 + DEPLOYED 59bc223f, receipt path unproven until the next guardian failure)

## 2026-10-02 · full-circle wave 2 — Settings keeps configuration, System owns operations

Two censuses (settings controls; outcome ledger) are in `docs/design/*-2026-10-02.md` with an "Applied" section each. Settings: 17 blocks → 8 (3 domains); SystemOpsHub / HQErrorsCard / SystemInfoCard / CommandSpinePulse deleted as duplicates; health digest + data cards → `/system/health`; DeployChip → `/system` header (monorepo link, `build · unknown` on failure); memory of the day → `/brain`; cron panel deleted, runbook links + `role=switch` ported to `/system/crons`; Speed Ribbon toggle + orphan hook deleted; `/api/settings/crons*` + `listScheduledCrons` + `triggerCronByName` deleted (`system.runCron` → manifest). Kill switch now gates Inngest crons in `CronLifecycleMiddleware.wrapFunctionHandler` (skip shape, 30 s cache, fail-open). Home rail: `WaitingLine` over `operator.waitingSummary`. Lane D: `intelligence-brief` keeps the ledger id; push + Telegram fallback carry the rating affordance (`lib/services/outcome-rating-affordance.ts`, also consumed by morning-brief + proactive-pushes). Gates: tsc 0 · eslint 0 err · vitest 86 files / 691 · anti-slop, stale-docs strict, crons, get-auth, raw-sql, mutations, runbooks, parity all green · build in PR body. After deploy: check `/settings` (3 domains), `/system/health` (digest line present), `/system/crons` (runbook links), Home rail; review the killed-cron list once (killed Inngest crons now stop).

**Updated: 2026-10-02 ET** (full-circle wave 1 · `statenour/full-circle-a-exception-coverage` · Lane A owner-exception coverage + Lane B WaitingSummary · PR #2883 open)

## 2026-10-02 · full-circle wave 1 — the Owner Panel can see a failing capability and a degraded brief; WaitingSummary says who waits on whom

Guardian terminal failures now leave a durable receipt in the incumbent `integrations` table (type `capability`; degraded after 3 consecutive; first success resets; 750 ms bounded wait; no DATABASE_URL → no-op) and the Owner Panel projects them as `capability_degraded`. A job output that declares degradation settles `partial` with a prefixed reason (`cron-status.ts` DECLARED_DEGRADATION_PREFIX); the daily brief's compose fallback now does that via `briefRunOutcome`; the panel pages `cron_degraded` only on the prefix (plain fan-out partials are diagnose-cron-failure's). Receipts: tsc 0 · eslint 0 errors · vitest 189 + 105 across the referencing set · anti-slop 0 · stale-docs 0 · parity 142/0 · check:crons clean · cleared-cache build exit 0. State: BUILT + TESTED; merge/deploy on the PR. Lesson: a durable write added to a hot failure path needs a bound and a "no database" no-op, or every unmocked test of that path hangs on a connection attempt (four 20 s timeouts on the first cut). Lane B: `lib/home/waiting-summary.ts` + `-data.ts` + tRPC `operator.waitingSummary` — me / others / system over approvals, attempts, commitments, tasks.waitingOn and the Nick's Tire bridge (callbacks_pending, leads_urgent); count null when a feeding read failed; `{ error: "No DB" }` inside a 200 is a failed read; 12/12 tests; no UI yet. Next: Settings control census (read-only, agent output under docs/design/), then the Settings/System UI wave consuming both. Mission brief: `docs/agent-os/FULL-CIRCLE-MISSION.md`.

**Updated: 2026-10-02 ET** (UI v2 PR 4 · `statenour/ui-v2-backlog` · backlog closed · self-audit second commit)

## 2026-10-02 · UI v2 PR 4 — backlog closed

card.tsx deleted → GlassCard everywhere; `.neural-glass*` + `.ui-material` moved to `@layer components` (eight call sites had utilities that never painted); `cn` extends tailwind-merge with v2 radius/shadow; brain inline buttons 44px floor; voice orb → solid state disc + one pulse-live ring; rounded-md/lg/sm + bare rounded + slate sweep; features/chat-v2 converted (the last unscoped slice). Code diff 139 files, +708 / −660 before the 16 screenshots; one commit. Receipts: `tsc --noEmit` exit 0 · eslint 0 errors on the 130 changed TS/TSX files · vitest 136 files / 1,587 passed, exit 0 (every test referencing a changed file + grammar, nav-shell, anti-slop, mobile-a11y, mount-graph, palette-root, modal contracts) · `tests/lib/cn-v2-tokens.test.ts` 4/4 with the stock-merger positive control · anti-slop 0 · stale-docs strict 0 · parity 142/0 · `next build` with `.next/cache` cleared exit 0 (full route table). Hostile review of the diff: 12 findings, all fixed (dialog gold glow from the layer move was the HIGH). Lessons: an unlayered component class silently eats caller utilities — the GlassCard tint bug hid for months; `features/` is a scope people forget. **Self-audit, second commit:** 243 control labels in 90 files sentence-cased by a brace-aware scanner (33 test-pinned strings skipped; two non-label catches reverted; 7 ternaries by hand; a second diff scan reverted 7 count/unit nodes capitalised mid-sentence after an expression), 5 radius misfires → `rounded-control`, voice-overlay aliases → tokens, dead-var gate widened to features/hooks/lib; ~60 11px mono micro-readouts kept mono on purpose. Receipts: tsc 0 · eslint 0 errors / 95 files · vitest 142 files / 1,639 · anti-slop 0 · stale-docs 0 · parity 142/0 · cleared-cache `next build` exit 0. Note: the cloud container has no git hooks installed, so lefthook's pre-push build never runs there; CI is the remote gate.

**Updated: 2026-10-02 ET** (UI v2 PR 3 · `statenour/ui-v2-delete-v1-lane` · `?ui=v1` lane, STATENOUR_UI flag, particle canvas and CommandDialog wrappers deleted)

## 2026-10-02 · UI v2 PR 3 — the lane comes out

9 files +29/−209: ui-version lib + test + switch, layout cookie/data-ui stamp, tokens/base v1 blocks, type-floor gate, STATENOUR_UI flag entry, neural-background canvas + mount, command.tsx wrappers. Grammar test flipped to "lane is gone" with a recorded positive control. Rollback = `git revert`. Receipts: tsc 0 · eslint 0 · vitest 38 files / 354 · anti-slop 0 · stale-docs 0 · parity OK · build exit 0 (full route table). Remaining UI v2 backlog (PLAN §13): card.tsx importers, 24px brain buttons, voice orb, rounded-md sweep, after-shots.

**Updated: 2026-10-02 ET** (UI v2 PR 2 · `statenour/ui-v2-surfaces` · every operator surface on the cockpit grammar)

## 2026-10-02 · UI v2 PR 2 — every operator surface on the grammar

285 files (+4,969 / −4,747) across 13 scoped parallel agents + orchestrator work; strict legacy census ~1,990 → 0 unsanctioned. Found: the ⌘K Resolver threw on open (no cmdk root; fixed + pinned by `tests/components/command-palette-cmdk-root.test.tsx`); ten dead custom properties painting elements transparent (fixed; grammar test now gates it with a positive control); a hostile review of the first push found an emptied class, two 3:1 chips, an invisible toggle track, gold on the palette input and five doc overclaims (all fixed). Receipts: tsc 0 · eslint 0 errors · vitest 393 files / 5,067 · anti-slop 0 · stale-docs 0 · parity OK · `next build` cleared-cache exit 0 (full route table, 111 s compile). One PR, one squash merge; deploy receipt on the PR. Lessons: an agent's "class-only" claim needs a reviewer; the bracket-syntax canary does not see dead vars; a label-casing sweep must skip bare JSX expressions (tsc caught three). Next: PR 3 deletes the v1 lane + `CommandDialog` wrappers; after-shots need a bigger box.

**Updated: 2026-10-01 night ET** (UI v2 Precision Material Cockpit · #2871 MERGED `18bf9ebc` · Railway `754fae93` SUCCESS · LIVE + PROVEN on bdnick.info)

## 2026-10-01 · UI v2 cockpit — merged, deploy-verified

Tokens / base / effects rewritten (warm near-black surfaces, Geist sentence case, one gold signal per surface, material only on rail + composer), icon-led spine, activity summary + tool receipt in chat, missions/home de-golded, particle canvas off. Three hostile reviewers over the first push found 7 P1 cascade defects (unregistered `border-edge-default`, unlayered `h1/h2/h3` beating utilities, legacy `!important` gold focus ring, `bg-surface` ≠ `--surface`, pruned-but-live `.animate-fade-in-scale`, …) — all fixed and pinned by `tests/repo/ui-v2-grammar.test.ts` (positive control: 11/12 fail on 4016737b, 5/5 second-pass tests fail on 49592699). The `?ui=v1` lane did not work in the first push (constant imported from a `"use client"` file → client reference on the server); fixed in `lib/ui-version.ts`. Dev-server traps in the cloud container: webpack `next dev` needs a 12GB heap and dies silently (exit 0) after ~8 route compiles — capture ≤4 routes per server life; `next start` ignores `AUTH_FORCE_MOCK` (prod mode), so screenshots need `next dev`. Receipts: tsc 0 · eslint 0 errors · 22 files / 146 tests · anti-slop 0 · stale-docs 0 · `next build` exit 0. Spec: `docs/design/ui-v2/{README,SYSTEM,SURFACES,PLAN}.md`. CI went red twice after the second pass because Tailwind's auto-source scanner minted a bracketed var() class spelled in PLAN.md prose (asterisk, then ellipsis); the grammar test now has a canary for it, and a warm `.next/cache` makes a local build a false green — clear it first. Live receipts: served CSS carries the v2 tokens and none of the removed rules; `?ui=v1` stamps v1 on production. Next: PR 2 (journal / brain / people / stats / system / palette / ticker onto the grammar), then delete the v1 lane.

**Updated: 2026-09-28 night ET** (Graphify code-intelligence governance on follow-up branch above Toolsmith + exception consolidation; not merged/live)

## 2026-09-28 · governed code intelligence — follow-up branch truth

Graphify remains the canonical developer code-graph snapshot; no runtime graph DB and no bulk BrainMemory ingest were added. The existing scheduled sync now runs the existing propose-only importer-death necropsy when enough snapshots exist and writes a compact GRAPH_RECEIPT.json with source SHA, HEAD/origin-main freshness, node/edge/community shape, label provenance, architecture delta, report hash, Graphify version, and necropsy count. Session-start reads only the receipt beside the exact selected report and ignores mismatched receipts. Local proof on the current tracked graph exposed it honestly as 313 commits behind this branch and 308 behind locally observed origin/main. Verification: governance self-test green, necropsy self-test green, both PowerShell scripts parse, repo contract tests 4/4 green, session-context live execution green, diff check green. Durable receipt: docs/00-current-truth/nouros-code-intelligence-governance-2026-09-28.md.

**Updated: 2026-09-28 night ET** (Owner Panel exception consolidation on follow-up branch above Toolsmith; not merged/live)

## 2026-09-28 · exception consolidation — follow-up branch truth

The existing Q-24 Owner Panel remains the one owner exception surface. It now also projects the canonical post-turn dead-letter queue plus generic ActionAttempt uncertainty/failure without creating another inbox: dead outbox rows roll up once; WAITING_APPROVAL joins decisions; UNKNOWN and recent FAILED surface as rose exceptions; EXECUTING older than 30 minutes surfaces amber; fresh execution stays quiet; deploy-alert attempts remain on the existing specialized path to prevent duplicates. Read failures remain UNKNOWN, never empty. The pure hard-failure vocabulary was split from DB-heavy cron-control into `lib/services/cron-status.ts` while cron-control re-exports the same API. Local receipt: 53/53 focused tests green; changed-file ESLint + diff check green. Durable receipt: `docs/00-current-truth/nouros-exception-consolidation-2026-09-28.md`.

**Updated: 2026-09-28 night ET** (capability lifecycle / Toolsmith on follow-up branch above merged #2756; not merged or live)

## 2026-09-28 · Toolsmith capability lifecycle — follow-up branch truth

The existing Tool Registry, Tool Policy, Tool Gap telemetry and ActionAttempt receipts are now joined by an append-only capability lifecycle over RealityEvent. Gap classes route to incumbent repair vs new-capability investigation; Toolsmith has proposal/lifecycle authority only and cannot install/activate tools. Lifecycle is `PROPOSED → APPROVED → IMPLEMENTED_UNVERIFIED → VERIFIED → RETIRED`, with explicit implementation + verification references required before stronger claims. 11/11 focused lifecycle + Tool Gap tests green; changed-file ESLint + diff check green. Durable receipt: `docs/00-current-truth/nouros-capability-lifecycle-2026-09-28.md`.

**Updated: 2026-09-28 late evening ET** (Decision Plane + Replay Lab merged as #2756; production shadow receipts still pending)

## 2026-09-28 · NourOS Decision Plane — merged repo truth

**Merged repo truth.** PR #2756 squash-merged to `main` as `e2622a514d8576da1beb1aab4ae9d17e3555ed68`, adding the vendor-neutral probabilistic Decision Plane, deterministic sampled shadow execution through existing Inngest, strict private/external endpoint policy, RealityEvent Decision Episodes, calibration math, Replay Lab outcome labeling, and the `/system/tools` report. The incumbent router remains authoritative; the candidate lane has zero production authority.

**Safety boundary.** `NICK_DECISION_PLANE_SHADOW` defaults OFF. Private-mode and obvious-PII turns are rejected before enqueue. Public backends additionally require explicit `NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE=1`. Incumbent agreement is a regression baseline only; it is not correctness and can never set `promotionReady`.

**Merge receipt.** Decision Plane + Replay Lab had 22/22 focused local tests green before push. On final head `271e40225`, GitHub Turbo affected verify, StateNour E2E, Completion Authority, Secret Scanning, Agent Policy, Adoption gates, and admin diagnostic all passed; #2756 then squash-merged as `e2622a514`. Replay reuses the same Episode lineage: explicit operator outcome labels append to the existing `episodeId`, unlabeled candidates stay unscored, and the panel reports label coverage/Brier/log-loss/ECE while `promotionReady` remains false. Durable receipt: `docs/00-current-truth/nouros-decision-plane-2026-09-28.md`.

**Updated: 2026-09-28 evening ET** (NourOS intelligence foundation merged as #2755; production proof remains feature-specific)

## 2026-09-28 · NourOS intelligence foundation — merged repo truth

**Merged repo truth.** PR #2755 merged to `main` as `a37a9f02c`, carrying the tested foundation slice over existing `RealityEvent`, `Mission`, Inngest, `ToolSelectionTurn`/`ToolGateDecision`, verified regen, and E2B rather than adding parallel substrates. Pre-merge receipts were 45/45 focused tests, StateNour typecheck, changed-file ESLint, diff check, and staged secret scan green.

**What is built, not yet live-proven:** typed Episode envelopes over the Reality Ledger; feature-gated bounded durable mission execution; a /system/tools tool-gap readout over existing routing telemetry; persistence for `chat.pre_stream_regen`; explicit E2B `allowInternetAccess:false` with a regression test. `NICK_DURABLE_MISSIONS` defaults OFF. No E2B key is being provisioned in this slice.

**Do not overclaim.** The Jev/TypeSafe-style probabilistic Decision Plane is **not** in this slice. Vendor-neutral typed probability backends, shadow calibration, and outcome-based promotion remain the next separate workstream. Durable receipt: `docs/00-current-truth/nouros-foundation-2026-09-28.md`.

**Updated: 2026-09-28** (original-plan execution reconciled through #2726; zero open PRs at this receipt)

## 2026-09-28 · original-plan infrastructure + observability closeout

**Repo truth.** `main` = `18db7de13af5fe0f6f4f2fb62456e371db3dd698` (#2726). PR #2724 merged the evidence-backed 24-slice ledger and Railway source-of-truth hardening. PR #2725 merged the Obsidian rollup performance fix. PR #2726 merged the private-worker observability repair. GitHub was rechecked after those merges: **0 open PRs**.

**Live infrastructure receipts.** StateNour worker is SUCCESS on exact #2726 commit `18db7de13`, in `us-east4-eqdc4a`, with no public Railway domain and private web target `http://statenour-web.railway.internal:8080`. Nick + worker negated watch-path rules are live. Redis still exists internally, but its public TCP proxy is removed; full service/volume/REDIS_URL retirement remains blocked by Railway dashboard 2FA. Wait-for-CI remains a Railway dashboard toggle; project webhook creation remains open because the existing hidden token cannot be interpolated by the API without revealing/rotating it.

**Neon receipt.** `pg_stat_statements` v1.11 was rehearsed on a temporary branch, explicitly approved, applied to production, and verified. It immediately exposed the default Obsidian rollup as a high-volume reader. #2725 now keeps the same newest-100/category contract but fetches full payloads for only **3,632** current rows instead of all **36,042** eligible rows (~89.9% fewer full-row payloads). The complete individual export and archive backup paths remain unchanged. StateNour web SUCCESS on #2725 is deployment `bdfe33a5-0a80-48e0-b992-b9662ae42079`.

**#2726 live boundary.** Worker deployment `aa4db42e-5b0e-4611-a461-2338d3d7f12c` and StateNour web deployment `f14abc77-e0cb-4e90-915a-250a21bdee0a` are both SUCCESS on exact #2726 commit `18db7de13af5fe0f6f4f2fb62456e371db3dd698`. A live NicksMax probe of `https://bdnick.info/api/system/heartbeat` returned `status: ok`, DB latency 5 ms, and `worker.status: fresh` with age 12 minutes. The worker-freshness lookup itself was production-benchmarked at ~0.076 ms warm via the existing `cron_job_logs_jobName_status_createdAt_idx`.

**Scope correction.** The earlier “reconciled code backlog = exhausted” statement applied to the stale-branch portfolio reconciliation only. It did **not** mean the broader §15 operator/infrastructure plan was complete. Durable slice ledger: `docs/research/2026-09-28-original-plan-reconciliation.md`.

## 2026-09-28 · Ollama liveness + worker freshness closeout

**What the cron found.** #2726 did not change the Ollama liveness route/resolver/registration. A real production call to `/api/cron/ollama-model-liveness` proved the cron was functioning and correctly flagged only the fast lane: chat `minimax-m3` 200, fast `deepseek-v4-flash:0731` **410 retired**, vision `gemma4:31b` 200. Recent `CronJobLog` failures were meaningful outage receipts, not cron breakage; no `cron_control` override row exists, so the job is enabled by default.

**Repair.** Live strict-JSON classify/extract/summary bake-off on the production Ollama account selected `glm-5.3-flash` (6/6 valid JSON, ~1.1 s avg, zero length stops) over `deepseek-v4.1-flash` (5/6 valid JSON, one length stop), `minimax-m3` (~2.5 s) and `glm-5.2`. Railway web fast pin is now `glm-5.3-flash`.

**Hard post-repair receipt.** Exact deployed cron route: chat `minimax-m3` alive/200, fast `glm-5.3-flash` alive/200, vision `gemma4:31b` alive/200, overall `data.ok=true`. Production DB latest liveness row = 2026-09-28T03:22:51.032Z, `success`, no error, 649 ms. `/api/system/heartbeat` simultaneously returned HTTP 200 with worker `fresh`, age 8 minutes.

**Worker boundary.** `apps/worker/src` has zero AI/model-call sites. It forwards cron HTTP calls to StateNour web and also runs the in-process `processVideoRenders()` Remotion render/upload loop. Its old `OLLAMA_MODEL=deepseek-v3.1:671b` was unused AI config debris, not a hidden worker model-serving outage; the worker env was aligned to `minimax-m3` for hygiene. Durable receipt: `docs/00-current-truth/ollama-liveness-repair-2026-09-28.md`.

**Updated: 2026-09-27 21:17 ET** (final connection-hardening closeout merged as #2721)

## 2026-09-27 · final connection-hardening merge receipt

**Final receipt.** PR #2721 squash-merged to `main` as `1ab0063f523e0761d5e9e2c4f02ed12d8966b41d` after the corrected head passed affected CI, authenticated StateNour E2E, Completion Authority, Adoption gates, Agent Policy, Admin diagnostic, Secret Scanning, and security checks. The four earlier review findings were fixed and formally resolved before merge. This was documentation/memory-only; it does not imply a new Nick production deploy beyond #2720. Remaining work is intentionally external/operator-gated: office Eufy real-event/control/media/PTZ/home commissioning, provider-accepted real degradation + recovery owner delivery, NicksMax guarded reboot + consumer ESU enrollment, and Resend DNS verification. Durable receipt: `docs/00-current-truth/connection-hardening-2026-09-27.md`.

**Updated: 2026-09-27 evening ET** (connection hardening truth persisted; production verified through #2720)

## 2026-09-27 · connection hardening closeout

**Current truth.** Core connection reconciliation is closed: Nick production is healthy on source-code deploy #2720 (`a3b3555e43e755f0a90b12fc6962be2340e21503`), TiDB is no longer blocking, and Tailscale establishes direct shop-PC connectivity after normal DERP fallback. Camera-health detection/claim/retry and persisted state recovery are live, but provider-accepted real degradation + recovery owner delivery remains open. Office Eufy remains uncommissioned until a real motion/person event plus control/media/PTZ-notify/home receipts exist. NicksMax still needs Microsoft-account ESU enrollment plus its intentionally guarded reboot; Resend still needs DNS records at the authoritative Global Domain Group provider. See `docs/00-current-truth/connection-hardening-2026-09-27.md` for receipts and boundaries.

**Updated: 2026-09-27 afternoon ET** (recovery closeout; #2712 merged; 0 open PRs)

## 2026-09-27 · recovery closeout

**Final repo checkpoint for this thread.** `main` = `93f0f66ca285600831ca50df87fb79f0497e3ed2` after #2712 squash-merged. The two P1 threads that had blocked Completion Authority were outdated against the current head: hardcoded Resend token copies were already removed, and discoverable behavioral coverage existed in `test_resend_smoke.py`. Both threads were formally resolved; Completion Authority reran green. Final #2712 head `bc02816e00fed586c5a7195b65a3dd5e8a800646` had green E2E, affected CI, Secret Scanning, local-agent, Adoption, Admin, Agent Policy, and Completion Authority.

**Open PRs after merge: 0.** Durable context-loss recovery artifact: `docs/00-current-truth/session-recovery-2026-09-27.md`. If visible chat truncates again, reconstruct from GitHub/repo/live receipts first.

**Updated: 2026-09-27 afternoon ET** (session-trail recovery; current repo state re-derived from GitHub after visible chat context loss)

## 2026-09-27 · recovery snapshot after chat/context loss

**Why this exists.** The visible conversation stopped showing a large portion of completed work. Do not use the remaining transcript as a progress ledger. The recovery sweep re-derived truth from GitHub and wrote `docs/00-current-truth/session-recovery-2026-09-27.md`.

**Repo truth at recovery.** `main` = `a01abc97eb6ee4bd5c9f8519f48d49c3fb2545e3` (#2711). Fourteen later PRs after #2696 are confirmed merged: #2697, #2698, #2699, #2700, #2701, #2702, #2703, #2704, #2705, #2706, #2707, #2708, #2710, #2711. #2709 closed unmerged. #2662 remains closed/superseded.

**Only open PR at the snapshot: #2712.** Head `bc02816e00fed586c5a7195b65a3dd5e8a800646`. E2E, affected CI, Secret Scanning, local-agent, Adoption, Admin, and Agent Policy are green. Completion Authority is red only because the review gate sees two unresolved P1 threads: (1) remove all remaining hardcoded Resend-token copies — PR follow-up says the current head fixed the remaining copies, but the thread was still unresolved; (2) add behavioral coverage for the smoke-test guards because `test-resend.py` is not discovered by the workflow's `test_*.py` pattern. Do not merge until review state + Completion Authority are green.

**Recovery procedure.** If context disappears again: read both app `.remember/now.md` files + CURRENT-TRUTH + RECONCILIATION + the recovery snapshot, then query current main/open PRs/review threads/workflow runs. Treat old worktrees and branch ancestry as hints only after squash merges.

**Updated: 2026-09-27** (portfolio reconciliation closed; 0 open PRs; safe redundant-worktree cleanup completed; operator-only remainder kept separate)


## 2026-09-27 — portfolio reconciliation / stale-worktree trap

**REPO TRUTH AT SNAPSHOT** · `main` reached `72083648c` on the weekly prerender refresh; the last substantive code commit beneath it is #2697 `c6db7bd35`. #2696 dependency refresh is merged as `6704ca49b63dbaa0997c57efb689e4b618e4f19a`; the actual squash patch is stable-patch-id identical to reviewed head `301392c325c0c0b34e7ef68c6d4bef9ccdd37ea0` and changed exactly 10 dependency/lock files. #2662 is closed as superseded. CI/build proof on the reviewed SHA was green, including affected CI + authenticated StateNour E2E; fresh Agent Policy source-citation + canaries also passed after the PR body was corrected. **Do not infer Railway/live runtime from this repo receipt.**

**RUN-TO-EMPTY RESULT** · Q49 (#2684), Q37, Q35, Nour runtime, and Q51 were reconciled against current `main`, not branch ancestry. Q49's dirty predecessor would restore a dead batch VIN API and break partial admin VIN lookup; Q37's dirty review branch would restore the obsolete OpenWeather env gate; Q35's complete touched-file tree is already identical to `main`; `8f0de2f4d` is patch-equivalent to `main`; Q51's dirty review branch removes newer scheduler ordering and regresses weather alert-delivery throttling. Treat those old worktrees as historical evidence, not TODOs.

**CONCURRENCY / OWNERSHIP** · newly-created camera/Eufy, office-wake, Q12 receiver, migration-0134, conversation-cockpit and similar worktrees are separate active workstreams unless explicitly handed off. No blind cleanup, reset, cherry-pick, or merge. `git branch --no-merged` is not a backlog list in this repo; use current tree equivalence, PR history, tests and production receipts.

**CLOSEOUT RECEIPT** · follow-up GitHub check: **0 open PRs**. Safe local cleanup removed `deps-dev-minor-current`, `nour-intelligence-runtime-20260926`, and `portfolio-truth-20260927` plus their obsolete local branches. Dirty Q35/Q37/Q49/Q51 predecessors were deliberately preserved because they contain uncommitted/divergent historical evidence; they are not backlog. Camera/Eufy/Q12 worktrees remain untouched under sibling-session ownership. **Reconciled code backlog = exhausted.** Remaining issue #2628 work is operator/vendor/infrastructure configuration and decisions, not unfinished code.

## 2026-09-25/26 — Nick operator runtime + one-shot self-repair

**CURRENT REPO / DEPLOY TRUTH** · repo `main` advanced to #2681 `36961a342` after this wave, but
`statenour-web` is intentionally still the #2680 app build because #2681 touched only Agent OS files and
Railway marked its StateNour deployment SKIPPED. Live app receipt: #2680 squash
`2b021632bf2806c95e7e275ba56b7c64117ba8b6` → Railway deployment
`99ab4bda-931f-4dce-ba0d-807b91b8d9ec` SUCCESS. Fresh post-merge push CI on that exact commit passed
StateNour affected verify, authenticated e2e, Agent Policy, Adoption gates, Lighthouse, Secret Scanning, and
deploy drift.

**WHAT SHIPPED** · #2673 `2b0783ea` made the Prompt V2 chat kernel solution/principle-first, proactive,
truth-seeking, useful-creative, finish-and-verify oriented, and operator-deferential without yes-manning.
#2680 closes the defect found in production where a critic could say `REGEN_CANDIDATE` after the answer was
already effectively accepted, or the regen path could throw away a partially better second draft because it
wasn't perfectly clean. `pre-stream-regen.ts` now evaluates both candidates with the critic + response contract,
does exactly one targeted repair containing the measured failure reasons, and ships the better candidate using:
cleaner → lower severity → higher overall → higher specificity. Gated intents: factual, decision, creative,
instructional, procedural, analytical. Casual/emotional/reflective remain flow-first. The second answer may win
while still imperfect; a worse answer never wins.

**OPERATOR CONTRACT** · facts/mechanisms/options/consequences toward Nour's stated objective, not the model's
own preference/values/taste. Seek disconfirming evidence; distinguish FACT / INFERENCE / UNKNOWN; correct a
conflicting premise once with evidence. Give a recommendation when Nour explicitly asks for one, optimized for
his objective + constraints. Existing mutation confirmation, fencing, injection surfacing, and execution
safeguards remain.

**WHY #2680 WAS NECESSARY (PRE-REPAIR PROD SAMPLE)** · 27 completed assistant turns on the #2673 deployment:
critic avg 91.3/100; 12 perfect 100s; reply-gate clean 21/27; median 167 words. Yet evidence-shadow verdicts were
14 pass / 9 repair / 4 block and critic regen candidates could still reach the user unchanged. This proves the
detector was seeing real defects; it did NOT prove the separate evidence gate was ready for enforcement.

**NEXT PROOF — DO NOT SKIP** · after enough real weak drafts occur on #2680, read the live
`verified_regen_path` event and compare `regenAttempted`, `regenFired`, `regenWasBetter`,
`selectionReason`, first/regen overall, first/regen severity, and `intent`. Those are the fields actually emitted.
`formatRegenTelemetry()` is UNWIRED today, so `chat.pre_stream_regen`, specificity deltas and regen latency/cost
are not collectible production proof yet; wire and prove that writer before using them. Implementation/tests/deploy
are PROVEN; real production repair win-rate is NOT YET PROVEN. Evidence-gate promotion remains a separate
calibration decision.

**CONCURRENCY TRAP** · sibling sessions are active. Before any edit/merge, refresh `main`, open PRs, and
overlapping files. A squash-merged feature branch will look diverged afterward; verify the squash commit on
`main` rather than treating branch divergence as lost work.

## W16c (2026-09-22/23) — the receipt layer, the review sweep, the edge-vector drain, the lexical lane · 21 MERGED

**REPO SHA** · `origin/main` = `053b8ff91`; production Railway SUCCESS on `9de481ecc` 02:10:57Z and `292f8f2b2` 02:13:31Z; `8b96066de` building at 02:20Z - verify by ancestry. #2517 `d4db73b8b` · #2521 `df482e60c` (PRODUCTION-PROVEN + DRAIN APPLIED + BENCHMARK RE-RUN) · #2522 `5b8f00779` · #2525 `4b2511547` · #2528 `586c6d86f` · #2533 `7971309dc` · #2536 `812da40f7` · #2539 `bd7ec6a4f` · #2540 `a6b12bd2b` · #2542 `5d00e8003` · #2544 `03bf36610` · #2546 `d72823e41` · #2548 `557046692` (capability ledger) · #2549 `79cbb1a6e` (REINDEX APPLIED) · #2556 `054a2c784` · #2553 `a20f788bc` (stored tsvector, migration 20260923000000_brain_content_tsv APPLIED 00:23Z) · #2558 `4531bee53` (the token budget charges rendered chars, not content.length — the composition lever) · #2560 `9de481ecc` (E3 shadow replays the routing-time toolsExpected; legacy shadows excluded from every rate; panel fixture defect caught in self-review) · #2562 `292f8f2b2` (KnowledgeCandidateSchema content <= 32,000 chars, reject never truncate; ingest scripts pre-check) · #2564 `8b96066de` (0007 brain_fts expression index retired: recorded DROP migration + registry pruned + exact-key canary + rollback.sql) · #2567 `053b8ff91` (comment-only: lexical-lane timeout / counter comments carry the measured story). Full entry: docs/RECONCILIATION.md → W16c.

**PROVEN / MEASURED** · dense pool fills 50/50 (was 9-28), still 50/50 after the drain (190-348 ms) · 58,950 semantic_edge vectors drained with backup `_bak_vector_embeddings_edge_drain_20260922` (restore = INSERT … SELECT back) · benchmark re-run 23:27Z 09-22: dense 41.1% on positives = 09-18 exactly (fill changed, ranking did not), hybrid 22% on positives (first valid reading) · REINDEX CONCURRENTLY: 1536 index 509 → 295 MB (96.1 s), legacy vec index 519 → 295 MB (58.9 s), 42% of each was tombstoned graph · proof script post-REINDEX (00:11Z 09-23): four seeds fill 50/50 in 158-612 ms, 0 quarantined categories in the pool; the exact pool statement via the Neon connector: 50/50, 80 HNSW candidates walked, 2.15 ms server-side warm (679 ms first cold touch). · the lexical lane's 84-of-89 hybrid timeouts were 99% ts_rank re-parsing content (prod EXPLAIN: 1,902 ms with the rank, 8 ms without) → stored content_tsv + GIN, rehearsed on a Neon branch (ALTER 28.6 s exclusive lock, GIN 5.9 s), APPLIED to prod in ~40 s, lane query 25.6 ms on prod · post-fix `pnpm eval:recall` (00:29-00:32Z 09-23, 89 cases): lexical timeouts 0 of 89 (was 84), lexical lane median 162 ms / p90 194 (was ~1,020 / 1,072), whole hybrid pipeline median 2,446 -> 1,536 ms and p90 3,176 -> 2,053 ms (inside the 3 s chat race); precision@5 vector 0.226 / lexical 0.057 / hybrid 0.113 raw (dense 38.0%, hybrid 19.0% on positives) vs 0.245 / 0.057 / 0.132 - unchanged within noise (the untouched vector lane moved by the same -0.019); `budgetDropped` rose (0-drop queries 15 -> 4, relevant per turn 5.9 -> 4.5): the now-live lexical candidates eat the token budget - the composition is the next lever. · the 49 stale `started` rows were duplicate births of successful mega-fanout runs · Prod census 6 min after the deploy (2026-09-22 ~23:11Z): the 49 stale `started` rows are `duplicate`, 0 `interrupted`, 0 stale started remain; of 694 daily successes 691 still carry `resultCount = null` (pre-deploy rows), 1 carries 0 and 2 carry a count - the first count-bearing success since the deploy wrote 0, not null.

**NEXT (evidence in hand)** · ★ DONE #2577 + statenour-web moved to Railway us-east4-eqdc4a (operator-approved; serving 12:32:13Z 09-23): "Context Memories" landed on 3 of 3 full turns at 1,424-2,603 ms (3 of 5 on us-west2 after #2577; 4 of 89 before) and "Hybrid Recall" 3 of 3 · ★ READ the receipts for #2588 (the intent router no longer holds a fixed-mode turn: before it, the prompt build started 4.8-8.3 s after the request) and for the Neon floor 0.25 -> 0.5 CU (12:48:41Z; the lexical lane was skipped on 2 of the first 3 us-east4 turns) · the lexical SQL itself: 681 ms standalone for a broad OR query - rank a capped candidate set (code) · the adversarial critic never completes (8 s x2 after every reply) · DONE `[brain-recall]` receipt 10:59:05Z: lexicalSkipPctCum 0, lexical 814 ms (the exact lane SQL on prod = 623 ms cold / 29.5 ms warm) · rollback.sql for the 0007 index DROP PROVEN on Neon branch br-soft-cake-amvn3q9w (valid, byte-identical, used by a pre-#2553 reader; branch left for the operator to delete) · mega-fanout rows-per-run OBSERVED (not guaranteed): 03:02Z and 09:00Z runs = 1 row each vs 5-6 before (receipt on #2525); the dedupe is findFirst + create with no unique key, so concurrent onRunStart can still double-insert - atomic fix = partial unique index (jobName, runId) WHERE status='started' + a concurrent-start canary (migration, operator) · the buffer-shadow readout restarts from 0 routing-sourced shadows after #2560 - nothing to decide until 40 exist; the evidence-gate cohort itself is sufficient (after-fix 52/119 = 43.7% would block vs 34/91 = 37.4% before, Neon 02:26Z 09-23) and is NOT a promote signal · recall COMPOSITION: the now-live lexical candidates (long OR-matched texts) eat the 4,000-token budget and displace dense hits (budgetDropped 0-drop queries 15 → 4, relevant/turn 5.9 → 4.5) — test length-normalised ts_rank (normalization 2 or 32) or a per-lane budget share with pnpm eval:recall (embedding spend — operator) · DONE 01:3xZ 09-23 (operator-approved): old expression index DROPPED via recorded migration 20260923013000 + registry pruned in #2564, Neon rehearsal branch DELETED, _bak_ table DROPPED (brain_memories 275 → 216 MB) · DONE #2562 writer-side content bound · DONE #2560 routing-time toolsExpected in the persist path · the typed outcome column migration (operator) · HF inference credits or retire bge-rerank (operator) · one row per mega-fanout run: observed on 2 of 2 runs, not yet atomic (see above).

**TRAPS (this batch)** · group by run id before naming a row-count shape · a merged PR is not a closed review (sweep Codex threads) · Codex P1/P2 threads block via the completion-authority review gate; rerun with gh run rerun --failed after resolving · a bare squash merge uses title + PR body → the body must end with the exact Co-Authored-By trailer · vi.mock factories hoist above consts → vi.hoisted · a chain must gate the commit on the test step's PIPESTATUS[0], never a | head pipeline's exit · verify a deploy by ancestry when merges land seconds apart · a validator must be run against its own default · the Bash tool decodes backslashes (node -e, sed \&\&, heredoc \$) — scripts go in files · a precision mean over abstention cases is not comparable across corpora — normalise to positives · never write a wall-clock time from memory (every '09-23 0X:XXZ' of this batch was 09-22 by server time) · stopping a background task kills the wrapper only, and a wrapper can die while the work lives — audit Win32_Process by CommandLine before concluding either way · a rate-limited CLI poll goes LAST in a wait loop · a PR with ZERO reported checks is not 'nothing pending' · a CONFLICTING PR dispatches zero workflow runs — merge main into the branch · an expression index serves the predicate, never the rank — histogram a 'slow tail' before believing it · rehearse a table rewrite on a Neon branch and report the lock in seconds · a 'do not merge until' body needs a DRAFT, not a merge-intent file · a fixture typed Record<string, unknown> cast into a mock is invisible to tsc — run the consumer's test file · a schema bound is half a fix until every caller that would now throw is named · the cloud git proxy pushes but cannot delete a ref (403) — hand deletes to the Windows side · the 'hold the merge while node/e2e is in flight' rule did not bind tonight (three merges landed mid-run and the runs completed) — keep the hold, don't cite it as a mechanism.

## Session F (2026-09-22) — measure before enforce · execution ledger

**CURRENT OBJECTIVE** · make Nick measurably more truthful/reliable by fixing the instruments a
promotion decision would rest on, before optimizing what they measure (mandate: "fix instrumentation
before optimizing metrics whose measurements cannot be trusted").

**CURRENT REPO SHA** · `origin/main` = `b43fccd4a` (#2483, the verifier→receipt join). Production
`/api/version` = `b43fccd`, `startedAt 2026-09-22T16:22:47.464Z`, uptime DROP 2044s→164s —
DEPLOY-VERIFIED. All of #2467-#2483 LIVE. (Was `77266ec81`/`cb323d151` at the start of the session.)

**WHAT WAS VERIFIED (production evidence, read-only)**
- `AutomationPolicy` 166 → 168 rows; `cron.device-heartbeat-sentinel` FIRED at 13:45:01Z with
  `fireRows=1` — the seed is PRODUCTION-PROVEN. `cron.agent-followups` is DORMANT by design
  (`config/crons.ts:568`), its `lastFired=NEVER` is correct.
- `action_receipts` table = **3 rows**, all 2026-06-27, all `SMS_BROADCAST`/nhtsa. The in-memory
  `ActionReceipt` contract (`lib/ai/receipts/action-receipt.ts`) is wired at 2 chat sites and
  persists NOTHING; the durable table has one non-chat writer. Receipts are BIFURCATED, not missing.
- Strict-Done shadow (`action.done.shadow`) = **1 row in its life** (2026-09-19), against 253 assistant
  turns / 14d, **0 instrument failures logged**. Sibling metrics on the same path: `tool.surfaced` 294,
  `tool.chosen` 113, `operation.integrity_shadow` 1. Verdict: LIVE + UNDERMEASURED. The path runs at
  turn cadence; consequential mutations happen on ~1/253 chat turns. Strict-Done can be neither
  enforced nor rejected from this — n=1.
- Operator repair signals: 2,795 operator messages / 400d → 108 candidates (2 strong · 32 medium ·
  74 weak). First draft precision ~44% strong / ~20% medium by hand-reading 19; after fixes ~100% /
  ~93%. "try again" is the operator's characteristic repair phrase; 1 genuine repetition complaint.
- External claims (two pasted packets): GPT-6 Astra 2026-09-03 (OpenAI's own domain — a later packet
  RETRACTED it; the retraction was wrong), Gemini 3.8 Flash (price DOUBLES 2027-01-01), DeepSeek V4.1
  Flash, OpenAI Agents API, MCP spec 2026-07-28 = Current. MCP SDK v2 refuted a THIRD time (no 2.x on
  npm). Hindsight 0.10.1 (2026-09-21) — verdict already on file, packet had read the superseded row.

**WHAT CHANGED**
- #2478 `633f11969` · seed-policies.ts could not run (same `server-only` defect the gate had) → fixed.
- #2480 `827dfef4f` · `pnpm harvest:repairs` — mines operator corrections; 6th eval lane, the only
  one not the-system-grading-itself. READ-ONLY, gitignored output, self-test gates every harvest.
- #2481 `4a7ef2e6e` · UPSTREAMS.md: Hindsight bump, MCP spec-vs-SDK split, Sept-2026 releases row as
  INVALIDATION TRIGGER for the minimax-m3 pin (verdict: re-run bakeoff, not pin X).
- branch `statenour/instrument-liveness` `9239c8d08` · `lib/observability/
  instrument-liveness.ts` — HEALTHY/UNDERPOWERED/STALE/NEVER_RAN/FAILING per KNOWN_INSTRUMENT with
  the assistant-turn denominator; `trpc.system.instrumentHealth`; census panel renders `attention`.

**TESTS RUN** · harvester 15/15 + self-test 41/41 (21 fire, 20 abstain) + mutation canary fails exactly
one test · liveness 12/12 (+1 unit-label test pending re-run) · siblings 49/49 · `tsc --noEmit` exit 0 ·
eslint exit 0 · `check:scripts` 44 vs baseline 44.

**PRODUCTION VERIFICATION** · live `buildInstrumentHealth(336h)` reproduced every hand-measured number
(shadow 1/253 UNDERPOWERED[conditional], surfaced 294 HEALTHY, chosen 113 HEALTHY, integrity 1
UNDERPOWERED[conditional], tool_invocation 8 tools touched UNDERPOWERED, selection_turn 294 HEALTHY).

**OPEN HYPOTHESES** · (H1) strict-Done gap rate is low — UNTESTABLE at n=1; needs either more
consequential chat turns or replay of historical mutation turns. (H2) `skipped_no_claim` vs dead-arm
is now inferable from sibling cadence but not persisted; an attempt counter would make it direct.
(H3) `detectActionClaims` may be narrow — 1 claim in 253 turns is plausible for a conversational
operator but unverified against the text.

**FAILED APPROACHES** · flat regex over repair phrases (sign-flipped: "keep going" = satisfied) ·
`i told you` without an adverb (narration) · bare `same X again` (self-narration) · errorLog `source`
column (does not exist — instrument name is inside `message` as `[instrument.<name>]`) ·
heterogeneous `Promise.all` spread (widens the tuple; split into two awaits) · piping a prod probe
through `grep` (masks the crash — run unmasked or capture `$?` separately).

**KNOWN BLOCKERS** · pre-push `build:affected` red in every junctioned worktree (Turbopack cannot
follow the NTFS junction) → push from the hook-free bare clone in the session scratchpad, never
`--no-verify`. #2479 is a SIBLING session's nickstire PR (completion-authority FAILURE) — do not touch.
Merges of #2478/#2481 held while #2480's `node` run is in flight (AGENTS.md hold rule).

**UPDATE (later 2026-09-22)** · #2482 MERGED `a0c4b610b` (instrument health). **#2483 OPEN** `4477189f4`
— verifier→receipt join: `environment-verifier.ts` read tasks back but `persist-assistant-message`
built receipts from `{toolName, ok}` BEFORE the verifier ran, so the one real createTask (09-19) was
read back AND recorded PROVIDER_ACCEPTED. Verifier was FAIL-OPEN (`verified: true` when no verifier)
→ tri-state; query failure = null + warn (false would stamp a fabrication banner over a DB hiccup).
Canary by mutation: each guard fails exactly one named test. 94/94 · tsc 0 · eslint 0.
**Branch `statenour/persist-turn-receipts`** (this ledger's commit): `tokenUsage.toolReceipts` persisted
per tool turn (minimal projection, no args/results) + `lib/observability/claim-done-calibration.ts`
reader + `trpc.system.claimDoneCalibration`. Live probe reproduced the hand count exactly:
beforeJoin turns=2 consequential=1 gap=1 offenders={createTask:PROVIDER_ACCEPTED:1}; afterJoin 0;
sufficient=false (MIN_SAMPLE 40 over CONSEQUENTIAL turns). `JOIN_COHORT_SINCE` is a conservative
2026-09-23T00:00Z — tighten to #2483's actual deploy time.
**MEASURED, CLOSES A DOOR:** `parts` NEVER carried tool evidence, BY DESIGN (message-parts.ts:35) —
2,692 assistant messages since April, zero tool parts. Historical replay of strict-Done is
impossible on old data; `toolReceipts` is the replay foundation going forward.
**DEPLOY VERIFIED:** a0c4b610b (instrument health) LIVE — `/api/version` a0c4b61, startedAt 15:14:07Z, uptime DROP 1184s→102s, deployment d25426da. The earlier 8ebf35a read at ~15:14 raced the container swap (Railway build SUCCESS 15:09, cutover 15:14) — not a cache. Read again after a swap, never once.

**UPDATE (2026-09-22 · part 2 · review closures)**
- **#2483 MERGED `b43fccd4a` 16:17:50Z → DEPLOYED 16:22:47Z** (SHA equality + uptime drop). Its P1
  review was right: the join promoted receipts by a Set of tool NAMES, so `createTask × 3` with one
  confirmed read-back marked all three VERIFIED → `receiptsWithReadBack()` pairs BY INDEX, fails
  closed on a length mismatch, and the verifier returns ONE result per call in input order (a `null`
  entry when a call carried nothing to look up — before, those calls produced NO entry and shifted
  every later result).
- **#2487 (repair scenarios)** · reply-side regex fixed (`954b9e77c`: "search IS available" matched
  the unavailability pattern; 3 of 13 NO_TOOL hits were availability statements). **`requires-tools`**
  (`11efe9c9b`): 8 of the 12 repair scenarios have a dominant criterion that IS a tool action and
  `eval:live` replays through `aiChat`, which has NO tools → tagged, skipped BEFORE calling Nick with
  a stated reason (`report.skipped[]`, `summary.skipped`, never an exit-code input); drafts of
  FALSE_COMPLETION/NO_TOOL/WRONG_TOOL/STALE_DATA are born tagged; corpus invariant 8/50. **Runner tier
  fault** (`9a5424682`): the runner passed `buildSystemPromptUncached("lite", …)` since 2026-05-23 —
  not a TopicTier; an unknown tier fails `wantsKnowledge`, so EVERY live replay ran WITHOUT the
  business-knowledge layer. Now `detectTopicTier(userContent)` (the route's own classifier). ★ tests/
  is excluded from tsc — a targeted `tsc -p <temp tsconfig>` over tests/eval found it in one run.
  ★★ Live eval reports before 9a5424682 graded a THINNER prompt than production's — not comparable.
- **#2485 (novelty shadow)** `8ca2be807` · three review findings, all real: (P1) the shadow runs
  AFTER persist and the prior scan did not exclude the reply's own row → every name the draft used
  was its own "repeat" — `loadPriorRecommendations({ excludeMessageId })`, recorder passes
  `createdAssistantId`; (P2) the outbox REPLAYS deferred work → `alreadyRecorded(traceId)` required
  dep, one indexed read on system_metrics, `skipped_already_recorded`; (P2) `Promise<unknown>` let the
  fail-soft writer type-check → `Promise<MetricWriteReceipt>` (the compiler is the enforcement).
  Live wiring pinned by a comment-stripped source test with a mutation canary per pattern.
- **This branch** · `buildClaimDoneCalibration` capped 2,000 rows over ALL assistant turns, then
  dropped the ~131/132 without `claimDoneShadow` → ~15 samples, MIN_SAMPLE 40 unreachable forever
  → filters on the JSON key (`path: ["claimDoneShadow"], not: DbNull`). `JOIN_COHORT_SINCE` =
  the observed deploy `2026-09-22T16:22:47.464Z`. Merged origin/main (`2d3fd14e9`) so the persisted
  `toolReceipts` projection maps the JOINED receipts (VERIFIED can now persist).
- **CI truths this session** · a `completion-authority` FAILURE re-evaluates only on rerun — resolve
  the thread, then `gh run rerun <id> --failed` · `warm-routes.test.mjs` "holder must be listening"
  (curl exit 7) is a runner flake, rerun once · a `gh pr view --json mergeable` can read `UNKNOWN`
  for a few seconds after a push — re-read, do not hold on it.

**UPDATE (2026-09-22 · part 3 · landed + proven)**
- **#2487 `e1b699945` · #2485 `686e0b888` · #2484 `d680320a0` MERGED 16:57Z** (in that order, each
  only after every sibling's node/e2e had finished; branches deleted). **Production = `d680320`,
  startedAt 17:04:24Z** — DEPLOY-VERIFIED (SHA equality + fresh uptime; Railway REMOVED the two
  intermediate builds; the sibling camera commit `6eabe456d` was SKIPPED by its path filter).
- **Read-only prod probe (~16:50Z):** the calibration reader's JSON-key filter selected 2 rows over
  14d and a JS check over all 256 assistant turns found 2 — `path`+`not: DbNull` semantics CONFIRMED
  on production, not assumed from the precedent. Since the #2483 join deployed: 1 assistant turn,
  0 tool-bearing turns → the join is DEPLOYED, not PRODUCTION-PROVEN; the first tool turn is the
  proof (`trpc.system.claimDoneCalibration` → `afterJoin`).
- **Post-merge Codex reviews on #2478/#2480 (posted after those PRs merged) → three follow-ups:**
  #2496 harvester fixtures quoted the operator's PRIVATE messages verbatim (relationship, health,
  family narration) — every such line is now a synthetic stand-in that keeps the trigger phrase /
  person / tense, and `--out` on the harvester AND the drafter is bounded to `eval-datasets/`
  (`resolveOutPath`, refusals tested); #2498 a behavioural canary for `seed-policies.ts --dry-run`
  (measured first: exit 0, 101 inputs, no DB) with a control that must still trip on `server-only`;
  #2495 the `warm-routes` port-holder canary polls (≤15s) instead of `sleep 2` — it flaked on two of
  my PRs in one day (curl exit 7). ⚠ a `;`-chained `git commit` that never ran let the chain post
  "fixed in <merge sha>" — corrections posted; gate every step on the commit, not the push.
- W16 RECONCILIATION entry + AGENTS.md stamp: this docs PR.

**UPDATE (2026-09-22 · part 4 · the follow-ups landed)** · #2495 `2a503aa26` · #2496 `d9d46392e` ·
#2498 `67904d50a` · #2499 `8c2889b5c` · #2501 `84260a1c2` (Done-shadow traceId dedupe through the shared
`metricRecordedForTrace`) MERGED 17:48-17:50Z; main = `84260a1c2`. Live readout 17:16Z through the
app's own readers: 13 assistant turns/24h · `recommendation.novelty` NEVER_RAN (deployed 17:04Z, 3 turns
since) · `action.done.shadow` STALE since 09-19 · 0 duplicate traceIds lifetime. **This branch (H2):**
`chat.deferred_turn` — one heartbeat row per deferred-path turn, deduped by traceId, strict writer,
literal scope; the health reader uses it as the conditional shadows' denominator, so a conditional zero
reads UNDERPOWERED ("ran on N turns, condition did not occur") when the path ran and STALE ("the whole
path did not run") when it did not — the skip-vs-dead gap is now direct, not inferred.

**Tool-capable eval runner (#2508 `statenour/eval-tool-replay`, open):** `pnpm eval:live -- --tools` routes
the 8 `requires-tools` scenarios through `generateText` + the real `nourTools` catalog with executions
STUBBED (every call recorded, nothing fires, `stopWhen: stepCountIs(4)`), and the judge sees the recorded
trace ahead of the reply. Skips stay the default; the run is operator-only spend. Never route an eval
through `prepareTools` — it writes `tool.surfaced` telemetry.

**E3 pre-flush shadow · MEASURED on prod 2026-09-22 (read-only probe, then the app's own reader):** 139
assistant turns since 09-15 · 128 carry `evidenceGate.turnRisk` · 84 would buffer (65.6%) · 44 would
stream · 7 verifier-banner turns → 6 would have buffered, 1 streamed, 0 unshadowed. Reasons over the 84:
"factual lookup with no tool expected to fire" 77 · "invites a specific figure" 13 · health 9+9 ·
commitment 2. **The 6 buffered banner turns all sit under the 77.** The classifier's own reasons do NOT
separate banner turns from the rest (unimodal — the camera lot-count shape again), and the ask-side
features do not either at n=7 (ask 34–562 chars, no action verb 7/7, register coaching 7/7). So "narrow
the predicate to the banner turns' reasons" is not available from this signal. **This branch:**
`assembleBufferShadow` in `lib/observability/evidence-gate-calibration.ts` + a block in the gate panel —
COST (buffer rate over shadowed turns) vs BENEFIT (banner recall) per reason, two independent floors
(the recall denominator is banner turns at ~7/week, so 6/7 is stated as "6 of 7", never 85.7%), banner
detection reused from L2 (`isVerifierRewritten`), cohort at the shadow's first write `8e3a4a14a`
(2026-09-15T17:29Z). Flipping `NICK_EVIDENCE_PREFLUSH` today = ~66% of turns stop streaming to catch
~6 of 7 banner turns a week.

**#2509 MERGED `073697106` (buffer-shadow reader) · #2508 MERGED `10673c575` (tool-replay runner), both
deploy-verified via `/api/version` (`10673c5` 19:08:43Z · `0736971` pending at write time).**

**Reply-side hold — REFUTED (read-only, 60 days, 1,246 turns, 52 banner turns):** the fabricated claim
sits a median 432 chars into the reply (p90 1,770, max 2,219) while Nick's first sentence is p50 24 chars;
hold-first-sentence catches 6/52 banners, 120 chars 13/52, 480 chars 22/52, 800 chars 28/52 — half the
banners need most of the reply held, which is the pre-flush lane again. ★★★ **A FABRICATED ACTION CLAIM
IS BURIED MID-REPLY, NOT AN OPENER.**

**L2 BANNER PRECISION — the finding under every enforcement plan (read-only, L2's own diagnostic line per
banner turn):** 52 banners in 60 days = 9 known-truth (separate guard) + 43 action-claim. `pinned` raised
15 (3 real: "Pinned.", "All entries pinned.", "the pattern is pinned so it surfaces"; 12 adjectives,
labels, metaphors — "pinned tab", "pinned posts", "[Pinned by Nour]", "pinned between"). Bare `sent`
raised 10 (0 real — "Mo sent a text", "the coach texted me", "3 DMs sent", "Sent $1,000 to Hamda" = the
USER's action). `set reminder` 3 (all offers/promises: "Want me to set a 6pm reminder?", "I'll log it and
set the reminder"). ★★★ **THE VERIFIER BANNER WAS MOSTLY FALSE, AND A FALSE BANNER IS NOT COSMETIC: L3
REPLACES THAT TURN IN HISTORY, ERASING A LEGITIMATE REPLY; L5 TELLS THE OPERATOR NICK FABRICATED WHEN IT
DESCRIBED.** **This branch (`statenour/action-claim-precision`):** `pinned` and `sent (bare)` edge
patterns require the VERB shape (terminator / pronoun / verb continuation after `pinned`; first person
with ≤2 adverbs, or a sentence-opening confirmation into a message-like object, for `sent`); `send-comm`
gets `claimNeedsFirstPerson`; "pinned" leaves `memory-write`'s past list; hedges gain bare "want me to"
and up to three words after "I'll". 25 production-shape canaries (names swapped) + 11 positive controls:
**unfixed 25f/43p → fixed all green.** Real-binary receipt over the same 52 banner originals: **43 → 17
still flagged** (task-added 5 · pinned 4 = the 3 real + "Story highlights pinned to the shop" · task-
complete 4 · memory-write 2 · data-sync 1 · priority-set 1); bare `sent` **10 → 0**; all 1,246 turns
**46 → 21** flagged, nothing new fires. Not classified: the 17 survivors (task-added/-complete may be
tool-name mismatches, not fabrications) and the 9 known-truth banners. ⚠ the repair harvester's
`reclassifyByReply` keys FALSE_COMPLETION on the banner — its 9 FALSE_COMPLETION candidates inherit this
precision and need re-reading.

**#2512 MERGED `d171b1b9a` + DEPLOY-VERIFIED** (live 19:41:14Z, uptime dropped to 16s). **Follow-up (this branch `statenour/action-claim-precision-2`):**
task-complete / memory-write / data-sync get `claimNeedsFirstPerson` + the new `claimAcceptsSentenceOpening`
(terse confirmation opening the sentence; NOT for link/move), plus a negated-participle hedge. 8 production-shape
canaries unfixed 8f/78p → fixed 9 files 173 passed; real-binary on the same 52 banner originals **17 → 10 still
flagged** (task-added 5 · pinned 4 · priority-set 1 — the 3 real pinned + the residual + "Bumped the priority" +
5 unknowable "Task created" confirmations), task-complete 4 → 0, memory-write 2 → 0, data-sync 1 → 0, all-turn
flags 21 → 14. ⚠ a canary can pass for the WRONG reason: the negation case was quiet because its "want me to?"
tail tripped the offer hedge — rewritten without the tail. ⚠ pre-2026-09-22 rows carry NO tool evidence, so the
5 "Task created" banners cannot be audited against a receipt; the join is what makes future audits possible.

**#2513 MERGED `55e08e18a`.** **Sentence-granular pre-flush gate — MEASURED, NOT BUILT:** sentences p50 41 chars /
p90 104 (the held unit is cheap) but after the precision fixes the detector fires on 14/1,246 turns (1.1%): a
per-sentence hold on every turn to intercept ~1 turn/week is not the lever; the post-persist banner + L3 cover it.

**EVIDENCE GATE (L6) SHADOW READ BY HAND — 52 post-fix blocks (43.7% of 119 turns):** named-claim ~27 = ~8 real
(venue/platform lists asserted "verified" with no tool) + ~19 of Nick's OWN bold labels, imperative steps,
comparisons, prices and recalled PEOPLE; fact-check ~24 = mostly coaching/plans/promises flagged as unverified,
4 on verifier-bannered text; length 1. ★★★ **THE GATE'S 43.7% WAS ~25-30% PRECISION — ENFORCING IT WOULD HAVE
REWRITTEN ROUGHLY A THIRD OF ALL TURNS WRONGLY.** This answers AGENTS.md §4 L6's open question. **This branch
(`statenour/named-claim-title-shapes`):** `isResourceTitle` rules 6–12 + punctuation-insensitive stopword trim;
16 canaries unfixed 16f/28p → 7 files 118 passed; real extractor over the 24 blocking turns: names 87 → 47, turns
24 → 15 (6 real · 4 people · 3 geography · 2 residual), named-claim precision ≈25% → ≈40%. Prior-operator-text
evidence measured and REJECTED (receipted 2 of 49). STILL SHADOW — nothing promoted.

**NEXT HIGHEST-LEVERAGE TASK** · the people class: real people from the operator's life recalled without a
receipt are the largest remaining named-claim false positive — measure how many unreceipted names match the
people/relationship table (read-only), then add that table as receipt evidence at the two call sites
(persist-assistant-turn.ts, alternate-paths.ts) → audit the fact-check driver the same way (its ~24 blocks
look worse than named-claim) → only then revisit L6 promotion, with the calibration panel's rate as the
receipt. Chat volume (13 turns/24h) is the binding constraint on every instrument; the heartbeat is still
unexercised (0 turns since 18:43Z).

## Session E (tool routing) — 5 MERGED + DEPLOYED, 1 in CI

**All five merged PRs are LIVE.** Deployed SHA `f1f7718b20d5` (`environment: production`),
verified by **SHA equality on the head plus git ancestry for the rest** — equality alone covers
only the head, ancestry alone never proves what is running.

| PR | SHA | what |
|---|---|---|
| #2467 | `094736674` | repair the tool failure that is actually still happening |
| #2468 | `fa45b1d50` | rank tool tiers together instead of filling by arrival order |
| #2469 | `10edcd431` | docs · the stale-denominator defect shape |
| #2470 | `167d596b6` | make a successful tool-input salvage observable |
| #2471 | `f1f7718b2` | stop drafting rewrites for tools surfaced by POLICY |
| #2472 | in CI | make the always-on audit re-runnable instead of a number |

Deploy chain observed: `b0668294c` → `094736674` → `fa45b1d50` → `167d596b6` → `f1f7718b2`.
**Every step verified by an uptime DROP, never an absolute uptime.**

⚠⚠ **DEPLOYED IS NOT PROVEN.** At 00:11Z there were **0 post-deploy chat turns**, so every
"no errors" reading is NO DATA. Proof recipe and watermarks are in agent memory
(`statenour-budget-cliff-alphabet-2026-09-16.md`, section W14p).

**MISSION:** stop guessing which tool-routing defect is real, and fix the ones that are.

**#2467 — the repair was aimed at the class that stopped happening**

`lib/ai/chat/repair-tool-call.ts` repaired hallucinated tool NAMES and declined argument
failures with a confident design note: *"a different failure mode we deliberately leave to the
SDK."* Nobody had counted. `scripts/tool-input-failure-census.ts` (new) counted:

| class | sampled | LIVE (error <=14d) |
|---|---|---|
| argument | 24/33 | **11** |
| name | 9/33 | **0** |

Every live tool-call failure is `searchMemories` receiving 2-3 JSON objects glued into one
arguments string. `lib/ai/chat/salvage-tool-input.ts` takes the FIRST complete object — each
concatenated object is a separate call the model intended, and merging `{"query":"A"}` with
`{"query":"B"}` has no honest result.

★★★ **A DESIGN NOTE EXPLAINING A DECLINE IS NOT EVIDENCE THE DECLINE IS RIGHT.** Read one as an
untested hypothesis.

★★★ **A CAVEAT IS A FACTUAL CLAIM.** The census shipped saying "the rows carry no per-error
time." They do — `lastErrors` is `{ message, at }[]` at `lib/ai/tool-telemetry.ts:348`, 33/33
entries populate `at`. I parsed the field without reading its type. The caveat hedged in the
RIGHT direction, which is exactly why nobody re-checked it. Fixed in `c433a4b`; it moved the
answer from argument 11 / name 1 to argument 11 / **name 0**.

**#2468 — the semantic tier was a leftovers tier**

Selection was ONE pass: every tier called `addIfSpace`, which stopped at `TOOL_BUDGET`. Tier 5
ran last AND was gated on `selectedNames.size < TOOL_BUDGET`, so it was skipped on 73.2% of prod
turns — the turns that truncate are the turns ranking is FOR. Now two-stage: stage 1 gathers from
every tier and drops nothing; stage 2 seats INTENT (tiers 1/2/3/7) then ranks tiers 4/5/6
together before cutting.

★★★ **A RESERVE ALLOCATES BEFORE IT KNOWS; TWO-STAGE RANKS AFTER.** The reserve attempt was
reverted because it bound even when nothing truncated. Two-stage holds
`MEMBERSHIP IS UNCHANGED when the budget does not truncate` *structurally*, not by a test.

★★★ **THE TWO TIERS WERE NEVER INCOMPARABLE, JUST NEVER COMPARED** — tier 4 and tier 5 already
call the same cosine metric on the same embedding.

**DEFECTS IN MY OWN WORK, all self-caught**
1. Headline test RED first: fixture scored 4 of 12 family tools, so partial-coverage disabled
   ranking and it tested the FALLBACK while claiming to test the fix.
2. Mutation test silently did not mutate — 16/16 green read as "canary survived." **`grep -c` the
   mutated token before trusting the result.**
3. First draft exempted `guaranteed` tiers from the budget. A budget that does not bind on its
   highest-priority input is not a budget.
4. The false caveat above.

**TRAPS**
- `pruneTools` fires telemetry via `void import(...).then(...)`, never awaited, and only when
  `opts.turnId` is set. Without both, telemetry assertions read `undefined` — which is NOT
  `false`. Use `await vi.waitFor(...)`.
- `check:policy-coverage` is RED on a clean tree (`lib/ai/budget.ts:9` imports `server-only`,
  which throws under plain `tsx`). Pre-existing — reproduce before blaming a diff.
- `git -C <main-checkout> status/checkout -- apps/...` operates on the MAIN checkout, not on the
  worktree you are standing in.

**OPEN**
- **NO PR IS PROD-PROVEN.** #2467 IS deploy-verified (SHA equality on public `GET /api/version`
  = `094736674edc`, uptime DROP 3136s -> 36s) — deployed is not proven. Route: re-run
  `scripts/tool-reachability-census.ts` and `tool-input-failure-census.ts`; both refuse to
  conclude below their floors. **Read `semantic tier SKIPPED` (73.2% -> should approach 0), NOT
  `budget truncated`** — two-stage moved that metric denominator, so it RISES, and the rise is
  the instrument seeing candidates the single pass never recorded.
- ⚠⚠ **`lib/ai/tool-description-rewrite.ts` is ACTIVE, not latent — I measured only ONE of its
  TWO trigger paths and called it quiet.** The failure path does have 0 candidates; the
  `surfaced_never_chosen` path fired **6 drafts in 2 days**, and **3 of 6** are 100% POLICY-
  surfaced, MEASURED from `ToolGateDecision.tier`: `rankNextActions` 259/259 t1, `createTask`
  259/259 t2, `completeTask` 259/259 t2. ⚠ I first said 4 of 6, putting `findCustomer` in that
  bucket because it appears in the tier-6 defaults LIST IN THE SOURCE — measured it is 11%
  policy (t4=76 t3=40 t6=15), i.e. genuinely keyword-surfaced, and the cron is RIGHT to draft
  it. `getHabitRevenueCorrelation` and `getMasteryScores` are 0% policy. **Code-grep is not
  evidence; the tier telemetry is.** Gate is `surfacedCount/turns >= 0.20`; tiers 1/2 are ~100%
  by construction. **A gate with two independent predicates needs BOTH measured before it is quiet.**
  FIX QUEUED: export CORE_TOOLS/ACTION_CORE from `chat-mode.ts` as ONE list (never a copy),
  exclude them. Blocked on #2468 touching that file.
- `NICK_TOOL_RANK_MERGED=0` reverts two-stage to arrival order via a Railway env edit, no deploy.

---

## Session D (recall measurability) — branch `statenour/paraphrase-arm-2026-09-18` — PR #2443

**MISSION:** make retrieval precision measurable. It was recorded as blocked in #2426 on a
`server-only` guard. That was true AND it was the smaller of two blockers.

**THE HEADLINE, MEASURED ON PROD 2026-09-18**

| | before | after |
|---|---|---|
| total corpus cases | 40 | 107 |
| POSITIVE (scorable) cases | **1** | **68** |
| categories represented | 1 | 13 |
| blocked paraphrase arm exit code | **0** | 1, with the reason |

**WHAT WAS ACTUALLY WRONG (the second blocker, found while verifying the first)**

`caseFromDurableFact` had 2,412 eligible rows available and the harvest produced ONE case.
`orderBy updatedAt desc, take 75` let `customer_preference` — the WORST category in the curated
set, 3 eligible of 283, machine-written customer records with numeric keys and ~42-char content —
consume 100% of the sample because it is churned constantly and therefore wins on recency.

★★★ **A LIMIT APPLIED BEFORE A DIVERSITY REQUIREMENT IS WON BY WHATEVER CHURNS MOST.** Identical
class to the error-ranking defect fixed 2026-09-17 (five families sharing one `last_at` read as
five bugs, not one outage). Re-rank BEFORE the LIMIT.

⚠ An earlier pass THE SAME DAY had already swapped `confidence: desc` (which surfaced machine
categories) for `updatedAt: desc`, under a comment asserting *"Recency gives a spread of real,
current operator facts across the curated categories."* That claim was never measured and was
FALSE. **Both sorts carried the same bug; only the winning category changed.** Fixing an instance
without naming the class leaves the class alive.

**FIX:** one query per category + flat quota (`DURABLE_FACT_PER_CATEGORY = 6`) +
`selectBalancedDurableFactRows()`. Flat NOT volume-weighted — weighting hands the corpus to
`insight` (45% of all eligible) and measures one category again. Viability is tested with
`caseFromDurableFact` ITSELF, never a copy: a second predicate drifts, the quota fills with rows
the builder then rejects, and the arm starves SILENTLY.

**Per-category eligibility (prod, for whoever grows this next):** insight 1079 · nick_advice 454 ·
wisdom 367 · concern 166 · decision_log 137 · emotional_state 104 · win 45 · business_event 26 ·
blind_spot 11 · preference 11 · friction 7 · customer_preference 3 · prediction_lesson 2 ·
learning_journal 0.

**THE server-only BLOCKER WAS REAL — and measured, not trusted.** A/B probe, ONE CONTROL PER
PROCESS: without stub it throws `This module cannot be imported from a Client Component module.`;
with the `Module._load` stub it resolves and `getModel` is a function. ⚠ One control per process
because **a module that throws during ESM evaluation is cached as errored and re-throws on later
imports without re-evaluating** — both controls in one process manufacture a false negative.

**SECOND DEFECT FIXED:** a blocked paraphrase printed a warning and **exited 0**. Same shape as the
cron-manager defect this week: a failure rendered for a human and hidden from the exit code.
`paraphraseVerdict()` is now the ONE predicate; banner and exit code read the same object.
`scorable` and `failedRequest` are deliberately SEPARATE — a plain `pnpm harvest:evals` is also
unscorable and must still exit 0.

**PROOF LADDER:** paraphrase arm is EXERCISED (`COMPLETE - all 68 eligible paraphrased`,
`scorable: yes`, exit 0; 68/68 queries changed, 0 identical, all marked in provenance).
`pnpm eval:recall` on the paraphrased corpus was still RUNNING at handoff — **no precision figure
exists yet; do not quote one.**

**TRAPS FOR THE NEXT SESSION**
- ⚠⚠ **NO `.env` EXISTS IN ANY CHECKOUT** — not the worktree, not primary; only `.env.example`.
  Every statenour script needs `railway run -s statenour-web -- <cmd>`. `railway whoami` works;
  never export `RAILWAY_TOKEN` (the stored one is dead and shadows the session).
- ⚠ `eval-datasets/` is gitignored and holds REAL operator content. `eval:recall` reads
  `eval-datasets/recall-corpus.json`; the harvest's `--out` defaults there.
- ⚠ 12 scripts face `server-only` via TWO competing mechanisms: 9 use `Module._load`, 3 use
  `Module._resolveFilename` -> `scripts/.server-only-noop.js`. The minority resolves that path
  against `process.cwd()`, so those 3 BREAK when run from the repo root. Not fixed here.
- ⚠ `harvest-eval-corpus.ts`'s header claims read-only is "pinned by a source-scan test". It is
  NOT — `tests/brain/recall-corpus-builder.test.ts` mocks a prisma object carrying only
  `findMany`, so a write throws on `undefined`. Incidental structural pin, not the scan promised.
- ⚠ statenour's recall corpus has **NO holdout of any kind** — `runRecallEval` scores every case
  every run, no tiers. The `HOLDOUT_EPISODES_B64` mechanism is **nickstire's Playwright episodes**,
  a different system. Do not describe statenour as having a sealed eval boundary.
- ⚠ pre-push `build:affected` fails on `@statenour/web#build` with `Symlink
  [project]/apps/statenour/node_modules is invalid, it points out of the filesystem root`
  (Turbopack + NTFS junction). Resolution, not compilation. Push from a hook-free `git clone
  --local`; never `--no-verify`.
- ⚠ harvest logs 4 `slow_query` warnings at 773-874ms.

### Session D · final state (full detail: agent-memory `statenour-recall-measurability-2026-09-18`)

**MERGED + DEPLOYED, live `18cd753`:** #2442 `57dc3b217` (situation_log derivation) ·
#2443 `18cd75352` (five instrument fixes) · #2446 (frozen manifest + convergence).
**OPEN:** #2449 (lexical lane counters).

★★★ **TWO INDEPENDENT CORPORA CONVERGE.** 2026-08-27 dense hit@5 = **39%** (28 cases,
hand-labelled, verbatim queries) vs 2026-09-18 vector precision@5 = **0.368** (76 scored,
auto-harvested, paraphrased). Opposite construction, 2.7x size apart, 3 weeks apart, within
~2 points — neither built to confirm the other. Comparable ONLY because
`precisionAtK = hit / min(k, relevant.length)` makes a 1-key case identical to hit@5, and all
68 harvested cases are 1-key (verified). Record as "hit@5 for 89% of the corpus".

**Corpus FROZEN:** `data/recall-corpus.manifest.json` = 121 cases, sha256 `bbcc62558397`
(COMMITTED; the corpus itself stays gitignored). `eval:recall` now prints `corpus frozen ✓`
or `corpus CHANGED`. ⚠ The paraphrase arm is NON-DETERMINISTIC, so the corpus is NOT
reproducible from the repo — the manifest says "which corpus produced this row", never
"run this to reproduce it".

⚠⚠ **THE HYBRID NUMBER IS UNOBTAINABLE FROM THIS WORKTREE — declared BLOCKED after 3
attempts, 3 failure modes** (SIGTERM · `Connection terminated` · `Query read timeout` at
`connection_limit=1`). Root cause: `DATABASE_URL` points at Neon's `-pooler` but carries NO
`connection_limit`, so every script process opens a default pool (`cpus*2+1`) and contends
with the live app. **Neon connection exhaustion is THE limiting factor on all measurement
here.** The hybrid figure stays RETRACTED, not restated. Anything wanting a complete
121-case hybrid number must solve the connection story first.

**Lexical lane: alarm raised then WITHDRAWN.** 48% skip was confounded by my own eval load;
sequential/unloaded re-measure = **9 of 25 over budget (36%)**, matching 2026-08-27 exactly.
No degradation. ⚠ That re-probe had its own flaw (8 of 25 were connection-pool failures at
~10s, not the 900ms statement timeout; its labels miscounted them) — the 36% stands, the
skip/empty split does not.

⚠ **`HF_API_KEY` gates TWO consumers**, not one: bge-rerank AND embedding fallback #4
(`provider.ts:1689`). Credits DEPLETED (402 live). The embedding chain's tail is now two dead
providers (HF #4 + the known-bad OpenAI `sk-proj-` #5). Not biting — providers 1-3 healthy —
but it is a latent total-failure path for `semanticSearch`.

★ **MY OWN TEST WAS THE DEFECT.** `computeLexicalSkipRate` first read module state, so it
could not be driven without a DB; the test I wrote computed arithmetic on its own local
objects and asserted it equalled itself — it would have passed with the function DELETED.
**The impossibility of testing it was the signal the design was wrong.** Cure: pure predicate,
stats passed in.

**UNLOCKED, NOT ATTEMPTED:** RETRIEVAL-BASELINE-2026-08-27 gated weighted RRF fusion on
">=50 labelled pairs". There are now **68**.

**Live baseline for verifying #2442** (captured 15:29:30Z on `18cd753`): situation_logs **0**
(never held a row) · reflections 217 · decision_replays 9 · brain_dumps 1450. A `/dump` about
OTHER PEOPLE'S MOVES should write the first situation_logs row ever.

## Session C (overnight capability hardening) — branch `statenour/overnight-capability-hardening`

**MISSION:** make StateNour materially more useful/reliable/measurable. Choose the highest-leverage
move continuously; fix foundations before layering intelligence.

**BASELINE (measured, not assumed):** origin/main `a4d0f14b8` was **RED** — 843 files, 4 failed
tests in 2 files, `exit=1`. Now **844 files / 8,467 tests, exit 0**.

**COMPLETED + PROVEN**
- `f1ac75990` — suite red→green. Two causes, both "a test that cannot fail for its stated reason":
  (a) obsidian probe used an absolute Windows path as an `import()` specifier — Node reads `C:` as a
  URL scheme; `.split("\\").join("/")` fixed separators, not the scheme. `pathToFileURL` is correct
  on both platforms. The failing arm was the file's own POSITIVE CONTROL, so it could not
  discriminate shimmed from unshimmed. (b) `brain-engines-smoke` mocks only `@/lib/prisma` and calls
  its subjects "100% DB-dominated"; `findTeachingMoments` reaches the **nickstire bridge over HTTP**
  (`recentShopJobs`/`recentShopLeads` → `queryNick`), so its verdict depended on network
  reachability — green in CI, red where the bridge answers. Mutation-verified non-vacuous.
- `57f6ddbc1` — `compareActionDoneShadow` now has a production call site. It shipped with tests and
  ZERO callers, so `legacyStrictGap` had never been observed. Extracted to
  `lib/ai/receipts/action-done-shadow-recorder.ts` (injectable → testable; its only caller is a
  ~700-line untested function). Writes `action.done.shadow` to `system_metrics` with the
  disagreement CLASSES. 7 tests, mutation-verified.

- `<browser slice>` — **browser capability was UNREACHABLE from chat and is now reachable.**
  MEASURED from the census (first read since #2359 unblinded it): in **467 turns the browser was
  used ZERO times**. Both BROWSERBASE creds PRESENT, 6 tools built; `browser_navigate/act/observe/
  extract` all in `neverSurfaced`, `browseAndDo` surfaced 9/467 (1.9%) and chosen 0. An episode
  against the real `pruneTools` surfaced NO browser tool for six unambiguous prompts in either
  mode ("go to monro.com…", a literal URL, "log into…"). Cause, both in `chat-mode.ts:285`:
  (a) the trigger wanted "scrape"/"automate the browser"/"browser act" — not how anyone speaks;
  (b) `/browser_/` **cannot match `browseAndDo`**, the entry point meta.ts:298 says to PREFER, so
  even on a hit it offered the surgical tools and skipped the recommended one. Fixed with a
  natural-intent trigger + a high-level/low-level split (4 surgical tools now cost slots only when
  named). All 6 prompts now surface `browseAndDo, browser_do`.
- ★★ **The census's other headline: 8.4 of every turn's 24 tool slots go to a tool NEVER ONCE
  CHOSEN** — 3,911 wasted slot-impressions / 101 tools / 467 turns. Worst: `getMasteryScores` (57%
  of turns), `getHabitRevenueCorrelation` (50%), `findCustomer` (49%), `getCommitments` (49%),
  `createCommitment` (48%). NOT acted on — pruning needs a per-tool judgement, and "zero calls" has
  five different diagnoses. This is the best-evidenced backlog item in the app.
- ★ `createMissionPlan`: 150 surfaces, 4 calls, **25% success** — a real quality defect invisible to
  the `highFailure` bucket, which needs ≥10 calls. `getRepoMap`: 1 call, 0% ok.

- `<rewrite-queue slice>` — **the description-rewrite cron was drafting against an EMPTY queue.**
  It filters `totalCalls >= 10 && success < 60%` (the `highFailure` bucket) — measured at **0**. So
  it ran nightly and produced nothing, while the bucket the census itself calls "the actionable
  prune list" held 101 tools costing 8.4 slots/turn. A never-called tool has no telemetry row, so
  `getToolStats` structurally could not see it. Added a second evidence kind
  (`surfaced_never_chosen`) with its OWN prompt — there are no errors to learn from, so it asks for
  discriminative clarity and explicitly allows "this tool is redundant" as a valid answer.
  Failures draft first; never-chosen fills the remainder, so the original queue cannot be starved.
  Still DRAFT-ONLY (human carries it into code). Dry-run against prod: would draft
  `getMasteryScores` (266/467 = 57%), `getHabitRevenueCorrelation` (50%), `findCustomer` (49%).
  ★ `getMasteryScores`'s description is **33 chars** ("Get current mastery domain scores") — no
  hint of when to use it, shown in 57% of turns, never chosen. Hypothesis well-supported.
  ⚠ PROVEN: selection (10 tests + prod dry run). NOT EXERCISED: the LLM draft + upsert, which
  would spend tokens and write prod rows — not authorised here.

- `<gate-calibration slice>` — **the evidence-gate promotion decision is now computable.**
  AGENTS.md §4 L6 defers enforcement "once the shadow false-positive rate is known". Verdicts have
  been persisted at `tokenUsage.evidenceGate` since 2026-09-10 and **nothing read them** — no
  `build*`, no digest procedure, no panel. Added
  `lib/observability/evidence-gate-calibration.ts` + `system.evidenceGateCalibration`.
  ⚠⚠ **I got this measurement WRONG first and the module encodes the fix.** A naive pass over ALL
  verdicts gave 36.9% would-block with a sample full of itinerary/advice FPs — but
  `isResourceTitle()` (5 rules targeting exactly those) shipped in `8ee86eb3b` at **2026-09-16
  08:56**, and most of that sample predates it. The number measured the FIX'S ABSENCE.
  Live readout now: before-fix 91 turns / 37.4% / named_claim 21 · after-fix 12 turns /
  **rate WITHHELD** / named_claim 1, fact_check 3. Three rules: cohort at the last precision
  change · state NO rate below n=40 · split by driver (named vs fact-check vs **length**, which is
  not an evidence signal at all). 15 tests.
  ★ Residual post-fix FP: `"TEE and Manny"` — two people's names in conversation still trip the
  named-claim rule. ★ The dominant blocker CHANGED: fact-check, not named claims.
  **DO NOT PROMOTE YET — n=12.** Re-read the readout once ~40 turns accumulate.

- `<reachability guard>` — ★★ **the browser was one instance of a CLASS.** A sweep of 8
  capabilities against the real selector found **3 with no plain-language path at all**:
  `searchSkills`, `solveMath`, `getCameraIntelligence` — none credential-gated in the catalog, so
  all unreachable BY ACCIDENT. Deliberately NOT blanket-fixed: surfacing a capability that returns
  nothing is worse than leaving it dark (`solveMath` is plausibly redundant — the never-chosen
  rewrite queue will now draft exactly that verdict; `getCameraIntelligence` is pre-G3 with no live
  data; `searchSkills` is the best candidate IF the skills store has content — CHECK FIRST).
  Added a MUST_BE_REACHABLE table to `tests/ai/chat-mode-browser-reachability.test.ts`: a narrowed
  keyword family now fails at commit time instead of showing up in the census a month later.
- Removed the DEAD `canClaimDone` from `chat/action-result-verifier.ts` — zero callers anywhere,
  while its docstring said "Wired directly into the live chat-finalize loop". The live one is a
  DIFFERENT function of the same name in `receipts/action-receipt.ts`. Anyone hardening the honesty
  gate would have found the corpse first and shipped nothing.

- `<telemetry evidence>` — ★★★ **stored tool errors kept the INPUT and threw away the REASON.**
  `recordToolInvocation` did `errorMessage.slice(0, 200)` — a HEAD truncation. AI SDK validation
  errors are shaped `…Value: {big json}. Error message: <REASON>`, so the reason is at the TAIL and
  was always cut. Measured: all three `createMissionPlan` failures were EXACTLY 200 chars, each cut
  mid-payload — a tool known to fail 75% of the time and not one row said why.
  ⚠ It COMPOUNDS: `tool-description-rewrite.ts` feeds `lastErrors` to an LLM as failure evidence on
  the premise that one pass over recent failures fixes the description. Evidence with no reason
  cannot. The rewriter was reading input fragments and guessing. Fixed with head+tail
  (`condenseToolError`, 140+300, states how much was elided). 6 tests, mutation-verified.

- `<budget-cliff slice>` — ★★★ **the pruner truncated by ALPHABET, and that is the mechanism behind
  the 8.4-wasted-slots headline above.** Tier 4 ordered candidates with `Array.from(m).sort()`;
  `addIfSpace` stops at TOOL_BUDGET, so that order IS the selection policy past slot 24. Tier 5
  (semantic rank) is gated on `selectedNames.size < TOOL_BUDGET`, so it is skipped on exactly the
  turns that truncate. Measured over 192 turns / 5,227 gate decisions:
  **72.9% of turns hit the cliff · 70.3% skipped the semantic tier · tier-4 ALLOWED averaged
  first-letter index 5.28 ("f") vs BUDGETED_OUT 11.78 ("l") · 65.3% of tier-4 ALLOWED impressions
  went to NEVER-CHOSEN tools.** A 6.5-letter gap across 5,227 decisions is not relevance correlating
  with spelling. `searchWebVerified` cut 52x, `githubRecentCommits` 53x — and **5 of 13 recorded
  searchTools recoveries were for a web-search tool the keyword family HAD matched and truncation
  had dropped**, costing a whole extra generation step each time.
  Fixed with `orderKeywordCandidates` (pure, exported, 11 tests, mutation kills 5 of 11).
  ⚠ SCOPE DISCIPLINE: **ordering only — membership is asserted unchanged**, so no tool becomes
  reachable that a keyword family had not already matched; this cannot widen authority. Cold cache
  falls back to alphabetical rather than ranking on partial data.
  ★ Also populated `ToolGateDecision.rank`/`score`, which existed since the table shipped with **no
  producer** — the diagnosis above had to be reconstructed from first letters because of it.
  **NOT YET MEASURED IN PROD:** re-read the alphabetical skew after ~100 post-deploy turns; if the
  fix works the two means converge. That is the promotion evidence, and it does not exist yet.

- `<enum-legend slice>` — ★★ **a 2026-09-03 fix landed on 1 of SIX call sites, and only a mechanical
  sweep found the other five.** Prod `tool_telemetry`: `createTask` failed 7x because `effort` and
  `context` are CODE enums with no `.describe()` — the model answered `{"effort":"30 min"}`,
  `{"context":"Newsletter creation"}`, and twice put a whole task description / journal reflection
  in `context`. Fixed in `tasks.ts` on 2026-09-03 — **inline, in that one block**. `missions.ts`
  kept two byte-identical bare copies, so `createMissionPlan` was STILL failing two months later at
  4 calls / 1 ok (25%), stored failure `{"context":"Shop Operat…` — identical shape.
  ⚠ I started to re-fix `createTask` before reading its source and finding it ALREADY FIXED; its 7
  failures are historical (their own payloads carry July 2026 dueDates). Second near-miss of this
  kind this session — measuring a fix's ABSENCE and calling it a defect.
  Wrote `tests/ai/tool-enum-legends.test.ts`, which walks every AI-facing `inputSchema` via zod
  introspection. It immediately found THREE more I had not: `updateTask.loopKind`,
  `logSituation.context`, `scheduleFollowUp.effort`. Legends now live in ONE module
  (`lib/ai/tools/task-field-legends.ts`) — six copies of a string is *why* one fix reached one site.
  ★ `logSituation.context` is a DIFFERENT `context` (situation KIND, not location) — same field
  name, different vocabulary, one model. Now says so explicitly.
  ⚠⚠ **The sweep's shape-rule does NOT catch `context`** — its values (DESK/PHONE/SHOP/…) are plain
  English, so nothing looks cryptic. The defect was the misleading field NAME, not the vocabulary.
  Proven by mutation: dropping `contextField`'s describe leaves the opaque-code test GREEN and only
  the by-name rule red. Both rules are load-bearing; deleting either halves the file.
  ★ Rewrote `tool-example-validity.test.ts`'s createTask regression from a SOURCE-TEXT assertion to
  a built-schema one. It had coupled a claim about the schema to a fact about file layout and went
  red on a refactor that *extended* the property it names.
  Receipts: 212 files / 2,689 tests exit 0 · tsc exit 0 · contract-drift snapshot flagged exactly
  the 6 intended tools and nothing else.

- `<repair-lane slice>` — **a pruned-out tool is now recoverable; a hallucinated one still is not.**
  `buildRepairToolCall` shipped with ZERO direct tests and a docstring promising it only ever maps
  "to a tool that actually exists in the live set" — which was also its ceiling: steps 1 and 2 both
  require `target in toolSet`, so the pruner-dropped case (the larger half of the 6 measured
  "Model tried to call unavailable tool" failures) could never be rescued. Step 3 routes it through
  `invokeTool`, which IS on every turn. ★ The boundary cuts both ways and is tested both ways:
  `getRepoMap` (real, pruned) is rescued; **`getGoals` is NOT IN THE CATALOG AT ALL** — a
  hallucination, and repairing it would invent a capability.
  ★ Authority is deliberately NOT re-decided in the repair: `invokeTool` already enforces
  read-safety + circuit-breaker + operator `disabledTools`, and a second copy of that gate could
  drift from the one the approval flow depends on. A write tool routed there is refused BY NAME —
  strictly better than today's dead end, which teaches the model to say "I don't have that
  capability" when the tool exists and was merely unloaded (an L1-L6 fabrication, from the harness).
  11 tests, mutation kills 4 of 11 while the 7 boundary/preservation tests stay green.

- `<review-P1s slice>` — ★★★ **Codex review found TWO REAL P1s in my own shadow wiring, and both were
  the exact defect classes I spent this session hunting. Verified against source before acting.**
  (a) **The instrument could not report its own failure.** I injected `lib/services/metrics.ts`'s
  `recordMetric`, whose body ends `.catch(() => {})`. So the await could NEVER reject,
  `recordActionDoneShadow` always returned `"recorded"`, and the "NOT a silent catch" branch I wrote
  was DEAD CODE in prod. My test passed only because the injected mock rejected where the real
  dependency cannot — **a test agreeing with its own double.** Fix: `recordMetricStrict` returning a
  `MetricWriteReceipt`; `recordMetric` now delegates to it (ONE insert definition). ★ The deps type
  demands the receipt, so `Promise<void>` is **unassignable** — a fail-soft writer can never be
  wired to an instrument again without a COMPILE ERROR. A type where a comment would have been.
  (b) **The denominator excluded the exact case it was built to measure.** My call sat inside
  `if (actions.length > 0)`, so a completion claim with NO action block — the phantom
  ("Done — both profiles created", nothing attempted) — never recorded, while the module docstring
  claimed "a row for EVERY turn whose prose claimed completion". Fix: a zero-action arm passing
  `compareActionDoneShadow([], cleanedText)`. ⚠ SEPARATE call site, not a hoist: `withErrorCapture`
  is **not awaited**, so `results` does not exist yet — one hoisted call would race it.
  ⚠ The recorder tests could not have caught (b) — they test the recorder, which was always willing.
  Added an explicit WIRING guard (2 call expressions on COMMENT-STRIPPED source, per the repo's own
  remedy) and labelled it as a wiring guard, not a behaviour guard. Mutation: removing the
  zero-action arm reddens it; swallowing in `recordMetricStrict` reddens the propagation test.
  ★ `completion-authority` CI was failing SOLELY on these two unresolved threads — one root cause,
  three symptoms.

- `<instrument-failures slice>` — ★★★ **I applied my own enum-legend lesson to my own P1 fix and
  found THREE more siblings.** The review P1 was one instrument wired to the swallowing
  `recordMetric`; sweeping the class found `tool.surfaced` (THE census instrument — its comment read
  *"Fire-and-forget: recordMetric already swallows its own failures"*, the defect stated as a
  feature, double-swallowed with a `.catch(() => {})` on top), `operation.integrity_shadow`, and —
  found by the new wiring guard, not by reading — `recordToolInvocation`, the writer behind
  `tool_telemetry` (census invoked/high-failure buckets AND the `lastErrors` the rewrite cron reads).
  ⚠ These are HOT PATH and non-blocking by design, so "await strict everywhere" would trade a silent
  instrument for latency. Fix = keep fire-and-forget, change only the FAILURE CHANNEL:
  `logError(instrumentScope(name))` → persisted `errorLog` → `buildInstrumentFailures()` reader on
  `system.digest`, deliberately next to the census whose zeros it disambiguates.
  ★★ `getSelectionTelemetryHealth()` had ZERO callers and its own docstring claimed "the panel reads
  that". Worse than unread: the counters are **lambda-instance scoped**, so a tRPC query answers from
  a different instance and reads its own zeros — they *cannot* answer a cross-instance question, so
  no panel could ever have been wired correctly. errorLog persists; that is why the reader uses it.
  ⚠ HONESTY BOUND, stated in the payload: this detects instruments that FAILED, never ones that
  NEVER RAN. A deleted call site logs nothing and looks healthy — only a wiring test sees that.
  ⚠⚠ **A defect I introduced and a test caught:** first cut reached `instrumentScope` via
  `Promise.all([import(metrics), import(instrument-failures)])` — and `instrument-failures` imports
  prisma, so the chat hot path was loading the DB client for a STRING HELPER. Split into a
  prisma-free `instrument-scope.ts`. Symptom was a test whose fire-and-forget writes landed one `it`
  block late.
  ⚠⚠⚠ **`tool-telemetry-operation-state.test.ts` was passing on a LEAKED call**: `mock.calls[0]`
  read the PREVIOUS test's shadow write (both used `convId: "c1"`), so its `legacySdkSuccesses` /
  `operations` assertions had never checked the turn they name. Replaced with a `shadowCallFor(convId)`
  selector — order-independent, and 8x faster (1019ms → 128ms).
  ⚠ Two MORE hand-written partial `vi.mock`s of `@/lib/services/metrics` broke on the new export —
  4th and 5th this session. ★ `importOriginal()` spread is the usual cure but is WRONG here: the real
  metrics module imports prisma, so spreading made the hot-path test RACE. Kept synthetic+fast and
  covered the drift at SOURCE level via the wiring guard instead. **The cure has a cost; name it.**

**DELIBERATELY NOT DONE (scope discipline, not oversight)**
- **Do NOT merge tier 4 and tier 5 into one ranked pool yet.** It is the natural completion of the
  budget-cliff fix — rank keyword + semantic candidates together and take the top 24, which would
  also reach the ~35 `neverSurfaced` tools. But it changes tier PRIORITY semantics, and the tier-4
  ordering fix it builds on is NOT YET PROVEN IN PROD. Verification first.

**CORRECTIONS THIS SESSION (I was wrong, twice, and checked)**
- The recovery lane is NOT unreachable. `pruneTools` never offers `searchTools`/`invokeTool` (no
  CORE_TOOLS entry, no keyword family) — but `prepare-tools.ts:184-194` **re-attaches both
  unconditionally after pruning**. I probed the pruner alone and nearly filed a false finding.
  Prod confirms it works: **13/192 turns fired searchTools, 6 reached invokeTool.**
  Lesson: `pruneTools` is not the surfacing path; `prepareTools` is.
- `.remember/now.md` is BOTH: the `.remember/` **directory** matches a .gitignore rule, AND this
  file is already **tracked** (it is in `12802d7c1`). So `git status` shows it as modified and it
  commits normally, but a plain `git add <path>` is REFUSED and needs `-f`. `git check-ignore` on
  the file returns "not ignored", which is why an earlier note recorded only half of this.

**OPEN / NEXT (evidence in hand, not acted on)**
- `createMissionPlan` 150 surfaces / 4 calls / **25% ok**. Real cause now visible: the model sends
  free text where an enum is required (`context: "Shop Operations"` vs `DESK|PHONE|SHOP|CAR|HOME|
  ANYWHERE`) and one call sent `tasks: []`. The enum fields carry NO `.describe()` while
  `nextPhysicalAction` does. Below the rewrite cron's ≥10-call floor, so nothing else will surface
  it. Candidate fix: describe() the enums + consider `.catch(default)` so one bad enum does not
  lose the whole mission plan.
- ★★ **6 tools failed with "Model tried to call unavailable tool"** — `arsenal.webSearch`,
  `person.update`, `getGoals`, `memory.remember`, `getRepoMap`. Note the DOT NOTATION: the catalog
  is camelCase (`arsenalWebSearch`) but action-blocks use dots (`task.create`), so **two naming
  conventions coexist and the model mixes them**. One entry is a whole call expression plus a stray
  `</arg_value>` XML fragment stored AS the tool name — a tool-call parsing leak worth its own look.

**IMPORTANT DISCOVERIES**
- ★★ **"The full pruneTools() has a require()/path-alias issue in vitest" is STALE.**
  `tests/ai/chat-mode-keyword-families.test.ts` mirrors regexes by hand because of that claim, so
  its tests lock a COPY and cannot fail when the source narrows. `pruneTools` imports and runs
  cleanly in vitest (11 tests, 103ms) — `tests/ai/chat-mode-browser-reachability.test.ts` now
  asserts the REAL selector. Other families could be migrated the same way.
- ★★ **The primary checkout `C:\Users\nourd\NOURCITY` is on `statenour/nextjs-critical-rce-advisory`,
  160 commits BEHIND origin/main.** Reading source there is reading stale code — it cost me one wrong
  conclusion. Work from a worktree at origin/main. (The RCE fix itself IS on main: `next ^16.3.4`.)
- ★★ Two different functions are named `canClaimDone`. `receipts/action-receipt.ts` is WIRED (2 call
  sites). `chat/action-result-verifier.ts` has **zero callers** and its docstring still says "Wired
  directly into the live chat-finalize loop". Not dead — it wraps the shadow comparator — but the
  docstring is false and the name collision is a trap for anyone hardening the honesty gate.
- ★ `recentShopJobs`'s comment claimed "no bridge query exposes recent jobs; returns empty" — false;
  it calls `recent_invoices` and returns live data. That stale comment is why the smoke test's
  prisma-only mock looked sufficient. Corrected.
- ★ **L6 evidence gate also runs in SHADOW** (`evidence_gate_shadow`, `tokenUsage.evidenceGate`);
  AGENTS.md says enforcement waits "once the shadow false-positive rate is known". Unmeasured.
- The tool-surfacing census (#2359) was fixed TODAY after 3 weeks blind; **456 rows of
  `tool.surfaced` data (2026-08-25..09-16) exist and nobody has read them yet.**

**NEXT BEST MOVES** (re-evaluate; do not treat as a fixed list)
1. Read the tool census from prod — 3 weeks of just-unlocked data → real surfaced-never-chosen /
   never-surfaced diagnoses (the mandate's tool-catalog rule).
2. Measure the L6 evidence-gate shadow's false-positive rate; that is the stated gate on promotion.
3. Fix the false "Wired directly into the live chat-finalize loop" docstring + the `canClaimDone`
   name collision.
4. `CURRENT-TRUTH.md` says "Last verified 2026-09-02" — 14 days of waves since.

**RISKS / NOTES**
- Test runs from this worktree can reach the **live nickstire bridge** (observed: real invoice data
  with no `DATABASE_URL` set). Reads only, but it is a real network dependency in "unit" tests.
- Worktree needed `apps/statenour` + `packages/*` node_modules junctions (was nickstire-only).

**Updated:** 2026-09-16 (Session B: counter reconcile #2348 SHIPPED + DEPLOYED-VERIFIED `ef52c8e38`, prod reconcile DONE 10:28Z; Visible Transformation + honest-counter repair W8 open on `claude/statenour-ui-architecture-intmaf` — sixth PR #2349; Session A: execution truth + Dream-to-Proof #2335–#2345 all SHIPPED + DEPLOYED-VERIFIED, last `6f5059b7c`)

## (Session B) Honest-counter repair W8 (2026-09-16; same branch, on top of the Visible Transformation slices)
**Operator:** fact-check the research, repair reality, keep shipping. **Re-measured on prod FIRST** (Neon,
read-only) rather than trusting any number in a comment or an audit: 20 live profiles · 7 ever logged · 13 at
zero · max `interaction_count` 4 · `>= 3` matches 2 · `trustScore` 0.3–0.9.
**Shipped (5 commits):** writer guard — `RESERVED_LEDGER_METADATA_KEYS` + `assertWritableMetadata` in the
`recordInteraction` seam + a zod `superRefine` on `task.logLedger` · trust scale — `unstableAlliances` compared a
0–1 Float to `50` (vacuously true for everyone) while its other half `>= 10` was unreachable; now `< 0.4` AND one
logged contact · reader contamination — all 16 ledger reads classified, 13 filtered through `contactRowsOnly`, 3
allowlisted with a reason, `changes-since.ts` moved `count` → fetch-then-filter · counter consumers — 4 bare
`orderBy: { interactionCount: "desc" }` now lead with `lastInteraction` NULLS LAST, Greene law_16's
`"interactionCount > 20"` trigger replaced with the observable SHAPE (and the schema doc that taught it), the
neglect predicate de-duplicated into `lib/services/people/neglect.ts` at `>= 1` · W7 gate fallout —
`components/ui/{input-group,section-header}.tsx` deleted, anti-slop waiver canary repointed onto its own fixture.
**Traps measured, all worth keeping:**
· **A canary that cannot fail is not a canary.** The ledger scan's first cut tested
  `src.includes("contactRowsOnly")` — the IMPORT line alone satisfies that, and mutation proved it stayed GREEN
  after the call was deleted. Tightened to a real call shape it immediately caught a REAL miss in the same diff.
· **A detector fires on its own documentation.** Both new source scans flagged the comment explaining the bug they
  fix. The score-scale one strips comments AND strings (its subject is code); the threshold one strips comments and
  KEEPS strings (its subject is prose an LLM reads). Mirror images, and each needs the "does not fire on a comment"
  arm or the next fix is un-documentable.
· **A threshold authored against a broken counter survives the fix.** `>= 3` was not dead, it was MIS-SCALED, and
  it dropped the worst cases first. Re-measure every threshold downstream of a data repair, not just the ones that
  went to zero.
· **`git commit` commits the INDEX, not your pathspec.** A `git rm` staged earlier swept 256 lines of deletion into
  an unrelated slice. Caught by reading `git show --stat`; fixed with `reset --soft` while nothing was pushed.
**Environmental, NOT this branch (do not chase):** `obsidian-ingest-server-only` + `generate-pwa-icons-sharp` both
spawn `npx tsx -e`, and in this Linux container a spawned `tsx -e` dynamic import collapses every module namespace
to `default` — reproduced on untouched `lib/db/soft-delete.ts` WITHOUT the shim. `check:env` fails for want of
provider keys (never export real keys into the test shell).
**Next:** W9 nickstire public FCFS vs "SCHEDULE DROP-OFF" — HOLD, a sibling session is doing GSC/SEO work in those
same files (`Home.tsx`, `FocusedServicePage.tsx`, `InternalLinks.tsx`, `SiteFooter.tsx`); coordinate before touching.

## (Session B) Visible Transformation wave (2026-09-16; same branch, sixth PR, after #2348 shipped `ef52c8e38`)
**Operator:** the workbench substrate shipped but the pages "still look 85–95% like before"; new bar: old vs new
side-by-side from six feet away must be unmistakable, and *visual similarity to the pre-workbench screenshots is
now a failure condition*. This reverses spec §2 correction 5 (no rail, no cosmetic pass) — recorded in the spec.
**Shipped:** the bar as a test — `tests/e2e/visible-transformation.spec.ts` renders 5 pages × 2 viewports on the
hermetic stack and fails under 0.35 REGISTERED INK-MASS distance from the committed PRE-wave baselines
(`tests/e2e/visible-transformation.spec.ts-snapshots/`, never regenerate casually) · desktop spine (4.5rem at
≥1280px, `--spine-w`, `<main>` pads) + workset strip + ruled bottom chrome + intent resolver restyle · Home
(display verdict, gold-rule lead, ruled command line, `empty:hidden` rail) · Missions (NEXT MOVE hero across the
page, capture / decide / board as ruled sections, mission cards → ruled list with display titles, WAITING + DONE
rail, nested-button hydration error in the card header fixed) · People (NEEDS ATTENTION verdict from the totals,
the list always visible as hairline rows, gold-ruled Person Workspace; the `browse all` <details> is gone) ·
System (Control Tower: `lib/system/control-tower.ts` — ALL SYSTEMS NOMINAL / N REQUIRE ATTENTION, exceptions
only, vitals as one mono line; unknown is never nominal) · Brain (nine tabs grouped into five lenses with five
layout archetypes in `PageTabs lenses=`; every `?tab=` deep link unchanged).
**Traps measured:** a pixel-share distance is capped by ink — the house palette is 2.5–10% ink, so a 30% bar was
unreachable and a 64px slide scored 82–91% of ink pixels "changed"; the fix is a 48px-cell ink-mass grid,
relative L1, minimised over ±2 cells (shift proxies 11–26%, recomposed pages ≥0.36, same-tree noise 0.000;
canary `tests/repo/visual-distance-metric.test.ts`, red under two mutants) · a capture taken mid-load measures
skeletons — the gate now waits for `[data-skeleton]` / `aria-busy` / `.animate-pulse` to leave (cap 20s) and
gives a cold `next dev` compile 60s · the cloud container restarts kill background Postgres + `next dev`; every
e2e run re-checks both first · `pkill -f <pattern>` matches the shell running it.
**Next:** the secondary pages (Stats glass/purple, Journal, Intelligence, Content, Photo, Pins, Settings, Links,
Learn) · Brain phone hydration mismatch (pre-existing, ignored by the gate on purpose) · `make_interval(days =>
bigint)` raw-query error on plain PG16 · the eight unfiltered ledger readers (#2348 §7).

## (Session B) Counter reconcile wave (2026-09-16; same branch, PR #2348, after #2346 shipped + deployed `e0f0275bd`)
**Operator:** "counter recon". **Measured (Neon, read-only):** 27 profiles, `interaction_count` sum 200 vs 15 contact
rows (23 minus 8 synthetic); 20 with zero rows; worst 69 vs 4 (last 09-12 vs 06-04). **Shipped in #2348:** contact-row
predicate (`contact-rows.ts`: not synthetic, not status_flip) · `deriveCounters` / `computeCounterDeltas` · delete side
recomputes both counters behind the person lock · creation starts 0 / null · six `nulls: "last"` orderings + a
source-scan canary · power-dynamics NULL = unknown · `scripts/reconcile-person-counters.ts` (dry-run default,
`--apply` snapshots to `_bak_person_profiles_counter_recon_<yyyymmdd>`). **Sequence:** merge → deploy-verify →
reconcile prod with the script's SQL (snapshot + per-person locked recompute in one transaction) → residual-drift
SELECT = 0 → receipts into the RECONCILIATION entry. **Traps:** no `DATABASE_URL` in the cloud container (the write
path is Neon MCP; the script is the repo record) · Neon PITR is 6 h (`history_retention_seconds`), so the `_bak_`
table is the rollback · a bare DESC on a nullable column sorts NULLs FIRST in Postgres — the codebase knew
(`autoPriority` uses `nulls: "last"` in 10 places) but never for `lastInteraction`. **Next:** the eight unfiltered
ledger readers (#2348 §7) · cadences on /people · the first Telegram `/log` is the live receipt for the seam.

## (Session B) Relationship ledger wave (2026-09-16; same branch, restarted by merging main `fc631eccc`)
**Finding:** the ledger had no live writer worth the name — 23 rows ever, last 2026-07-10, the 8 "chat" rows a
synthetic 05-29 backfill, 0 outreach/gmail/calendar/telegram rows ever — while `interaction_count` (sum 191) and
`last_interaction` kept moving from chat MENTIONS, `person.update` edits and profile creation. **Shipped:** ONE
writer `lib/services/people/record-interaction.ts` (row + both counters in one transaction, forward-only
timestamp by predicate, embed + XP after commit; `recordInteractionOnce` = per-person advisory lock every writer takes, one row per person per
window) fed by the modal / ⌘K, the picks button, Telegram `/log`, Nick's `person.logInteraction`, and the digest
(model returns `interacted` per person; a mention writes nothing). `person.update` no longer bumps counters.
**Left alone on purpose:** the historical counter drift (a prod write + a behaviour change — operator's call) ·
cameras/devices (operator: "leave the cameras for now"). **Traps measured:** the repo clone is shallow (82
commits from 2026-09-10) — `git log -S` cannot see May; prod metadata (`synthetic: true`) told the story instead ·
`information_schema` needs the `@@map` name (`cron_job_logs`, `chat_conversations`), and cron-log columns keep
Prisma's camelCase (`"jobName"`, `"createdAt"`) · a `vi.waitFor` is the only honest way to assert a
fire-and-forget hook fired.
**Next:** decide the counter reconcile (`interaction_count := ledger count`, `last_interaction := max(ledger)`) —
one dry-run-first script, operator-run · the `/people` line's "went overdue" stays silent until a cadence is set.

## Execution truth + Dream-to-Proof, waves 2-3 + follow-ups (Session A, 2026-09-15/16)
**Objective:** close both "StateNour reset" audits in-session. **Done:** truthful Telegram + durable
`ActionAttempt` (`action_attempts` table APPLIED to prod; reclaim is a compare-and-swap pinned to id +
attemptNo + state + holdUntil; `ledgerState` stamped only after a confirmed settle) · ledger producer
ceilings + lineage + recursive PII · exact-id recall lane · `check:scripts` ratchet (44 errors baselined,
5 dead imports fixed; `sharp` resolves via `next`) · Repo Time Machine (`lib/services/proof-timeline.ts`,
`GET /api/proof/timeline`, `/proof` section, grouped on the commit the site SERVED). **Last decision:** the
hidden holdout lives outside the tree (secret `HOLDOUT_EPISODES_B64`, six episodes, three from real
incidents) and posts `proof.holdout` every run — `unmeasured` when absent. **Blocker (operator):**
`EVIDENCE_LEDGER_KEY` still not created (the proof lane posts through the bridge key); Night Shift needs
the machine GitHub account + classic `repo` token (agents may not create accounts). **Next:** when a
`proof.holdout` ever fails while the visible run passes, that is the overfitting signal — read
`/proof`'s Time Machine before touching an episode. Traps: the StateNour domain-boundary gate rejects
"nickstire.org" / "Nick's Tire" in any StateNour prose outside a link-out; vitest's `NODE_PATH` makes bare
specifiers resolve in-process (resolution tests must spawn a child); a `node` job "runner shutdown signal"
minutes after a main merge is merge ordering, not code (root AGENTS.md merge recipe now checks first).

## (Session B) UI workbench — previous header: **Updated:** 2026-09-15 (UI workbench #2337 shipped + deployed-verified; wave 3 on the same branch name, second PR)

## UI workbench wave 3 (2026-09-15; branch `claude/statenour-ui-architecture-intmaf` restarted by merging main — force-push is policy-blocked)
**Shipped this wave:** `tool` inspector + inspectable `/system/tools` rows · ChangeSet primitive
(`lib/ui/change-cursor.ts`, `hooks/use-change-cursor.ts`, `components/ui/change-set-line.tsx`; Home refactored,
Brain `changesSince` second consumer) · `tests/e2e/selection-grammar.spec.ts` on `/system/ui-lab` fixture rows
(4/4 green in Chromium against a hermetic Postgres + pgvector — both P1s mutated red first) ·
`execution-panel.tsx` on the shared snooze presets. **Refuted:** "type floor still open" (CSS block since 09-08).
**Traps measured:** `next dev` appends a `nextjs-agent-rules` block to `AGENTS.md` and rewrites `next-env.d.ts`
— revert before committing · the repo pins @playwright/test 1.63 but the container ships Chromium 1194: run
Playwright with a scratch config under `.next/` pointing `launchOptions.executablePath` at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` · the grammar's document listener attaches a commit after
the layout hydrates; wait on `html[data-selection-grammar="1"]`, not on the tab bar.
**Wave 3.6 (same branch, same PR):** React catalog floor `^19.3.0` (lock 19.3.0 for BOTH apps) ·
`@types/react(-dom)` ON the catalog (statenour, nickstire, reel-engine, social-assets) · Base UI `^1.8.0` ·
`<ViewTransition>` on the inspector only (`inspector-host.tsx`; keyframes + reduced-motion pin in `effects.css`;
instrument `tests/e2e/inspector-view-transition.spec.ts` counts `document.startViewTransition`).
**Traps measured:** bumping ONE app's `@types/react` leaves two copies in the tree and every peer on the old one —
four `Key` TS2322 errors in files the diff never touched; the fix is the catalog, never a per-app pin ·
`next build` wipes `.next/`, so a scratch Playwright config under it must be rewritten before each e2e run ·
Next 16.3.4 already vendors the stable `ViewTransition` (no `viewTransition` config flag exists in 16.3.4).
**Wave 4 (2026-09-16, follow-ups; same branch, restarted by merging main — `35f9a904f`):** `agentRules: false`
(next.config.ts; the appended block is gone for good) · `/people` ChangeSet line (`task.peopleChangesSince`,
`components/relationships/people-change-line.tsx`) — SILENT in prod by measurement (0 cadences, ledger last
written 2026-07-10), which is the honest render, not a bug · `device` renderer BLOCKED: no device surface
(`/system/devices` pruned, `G D` dangles) and the bridge heartbeats stopped 2026-09-11 — spec §5 has the
receipts; needs an operator decision on restoring a device list.
**Next:** whatever the operator decides on devices · retire/retarget `G D` + the hub's `/system/devices` link.

## UI workbench slices 1 + 2 (2026-09-15; #2337 merged 19:27Z, live 19:32Z)
**Objective:** gate a pasted 38-section UI plan against live code, correct it, build the substrate as vertical
slices. Spec + verdict: `docs/design/ui-workbench-2026-09-15.md` (read THAT before proposing any inspector,
drawer, selection or "spatial" work). Ship entry: RECONCILIATION top.
**What now exists:** `?inspect=<kind>:<id>` opens ONE inspector for memory / task / person / alert / cron
from any page (`components/inspector/inspector-host.tsx`, mounted in the layout; registry in
`inspector-registry.tsx`); rows with `data-entity` inside a `[data-selection-scope]` get j/k/Space/Enter/x
(Brain Changed, Missions, People, /system/alerts, /system/crons); ⌘K leads with the focused object's actions;
a workset shelf; Reality Mode (⌘K → Modes) renders provenance inline; `/proof` is in NAV; the chat bridge
reads `?inspect=`; the task inspector shows the scorer's per-term breakdown (`task.byId` →
`priorityBreakdown`) and runs the Missions board's complete / snooze through page-lent actions
(`useRegisterInspectorActions`); `/system/ui-lab` is the primitives gallery (frozen clock). Slice-1 hostile
review: 18 findings, all fixed in `ba227588a` — spec §3.8 lists them; read it before touching the hook.
**Next (in order, spec §5):** `tool` inspector (`/system/tools` registry) · ChangeSet with Brain's Changed
view as the second consumer · Base UI 1.8 + React 19.3 dependency PR, then `<ViewTransition>` on row →
inspector only · the §5.1 type floor on `bottom-tab-bar.tsx` / `more-sheet.tsx` with the chat-states
baselines re-cut in the same PR · `execution-panel.tsx` → `lib/missions/snooze-presets.ts` · a Playwright
case for route-change reset + one-Esc-one-layer (DOM code the Node lane cannot see).
**Not this branch's, reproduced on `origin/main` in the container:** `tests/repo/obsidian-ingest-server-only`
("chain moved: persistKnowledgeCandidate missing") and `check:policy-coverage` (`server-only` under plain tsx
at `lib/ai/budget.ts:9`). CI was green on the same code (#2334); if CI is red on these here, it is the
environment, not the diff.
**Sibling session (PR #2335, execution truth):** backend only; the only shared file is `docs/UPSTREAMS.md`
(my rows at the top of the table, theirs at the bottom). Ownership map: spec §4.

## Camera vision wave 0 (2026-09-08; superseded stamp)
**Updated:** 2026-09-08 (camera vision wave 0 on top of the design pass + Brain plan/Wave 0-1)

## Camera vision wave 0 (2026-09-08; PRs #2221 nickstire, #2222 statenour, #2223 docs; edge PR pending)
**Objective:** make the #315 Arrival Intelligence pipeline receive its first real event and hand the operator an
implementation-grade plan: `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` + ADR-0017.
**Finding:** every `[id]` device route resolved the cuid while the bridge sends `platformDeviceId`, so every event
and heartbeat answered 404; prod `device_events` = 2 rows, both the June test device. Fixed in #2222 with a route
test proven red first. The edge (camera-bridge) was pinned to Frigate 0.13.2 with a 0.14+ config; rewrite lands on
`chore/camera-bridge-v2`. The cameras are Anyka `Hw_HsAKQQXG_WIFI_20230421` exposing only TCP 8800/9800; the
SD-card `ceshi.ini` unlock is the documented path (plan section 3.3), PoE cameras for LPR.
**Next:** merge #2221 -> #2222 -> #2223 -> edge PR on green; operator runs the unlock on SHOPSIGN and orders the
PoE overview camera; Phase 1 = Frigate 0.17.2 + visitd on the laptop as a lab with the recorded replay fixture;
`NICK_ARRIVAL_INTELLIGENCE` stays off until gate G3. Still open: `analyzeCameraData` has no scheduler;
`local-agent/v380_agent.py` is a delete after edge heartbeats are live.
**Objective this wave:** independently inspect, stress-test and repair bdnick.info, then hand the
operator a prioritized program. Program doc: `docs/research/2026-09-07-statenour-quality-power-program.md`
(read THAT before re-auditing anything here). Full wave entry: RECONCILIATION top.

## The finding that mattered
**Production had been stuck on `b3bebde` (2026-09-04 12:08Z) for three days.** Both Railway
services showed `Deploy failed`; the build log ended with `COPY apps/statenour/patches … not
found`. #2096 deleted the only file in that directory, git dropped the directory, and both
Dockerfiles failed at the deps stage on every push after 12:34Z. The previous ledger entry said
#2096 "shipped" — it was merged, not deployed. Merged and deployed are different claims.

## Shipped 2026-09-08, evening (details: RECONCILIATION top; the Brain plan is the current roadmap)
- **#2202 `PR head d237929f1`** design pass §5.3/5.4/5.8 · **#2204 `9f879de113bf`** chat badge + starters · **#2213 `this PR, head 8b7d7f113`**
  Brain plan (`docs/research/2026-09-08-statenour-brain-intelligence-upgrade-plan.md`) + Wave 0/1.
- **Next for the Brain (in order):** Wave 2 = `validFrom` at write + supersession flip after a shadow week +
  retrieval arbiter behind `NICK_RECALL_ARBITER` + writer migration batch 1 (journal_brain, conversation_analysis,
  belief-harvester, distillation, the Drive/Calendar/Reviews intake through the quarantine door). Then Wave 3
  (allocator + placement + context receipt + deterministic query planner), Wave 4 (tool funnel 24→16→12).
- **Operator-run:** `railway run --service statenour-web -- pnpm tsx scripts/drain-brain-embeddings.ts` (2,460
  unembedded personal rows) · `pnpm eval:recall -- --write-manifest` where the 28-case corpus lives · decide the
  paused `data-cleanup` cron · AGENTS.md 44 vs 48px · HSTS preload · phone composer check.

## Shipped 2026-09-08, backlog wave (deployed-verified; details: RECONCILIATION top)
- **#2193 `008afcf20`** cost truth: aiChat records every call · one price table · lane caps = deterministic
  stops · thumbs → Langfuse scores · model prices registered in Langfuse (5/5, via `railway run`).
- **#2196 `e2d4ea2d2f14`** nickstire Market admin section (`/admin/market`, `market.*` → marketing.manage) + public
  cached ribbon counts (D14). **#2195 `26b4b382eb2b`** approval windows (env override) + the deferred-automation
  list (press-and-hold Approve) · /market retired → redirect · image-flag prerequisites · HSTS preload-ready.
- **#2198 `bfccff82c636`** as-of recall (`validityWhere`, `searchMemories.asOf`) · sink policy (fence taints the
  turn → external side effects need a human) · intent playbooks (tier 7) · copy voice · phone type floor.
- Outside git: Neon `production` branch protected · Railway `IMAGES_REQUIRE_SIGNATURE=1` set on
  statenour-web and verified on the redeployed container (raw image id without a session -> 401, a
  signed URL passes auth, a bogus signature -> 403; prod holds no `generated_image` audit rows today,
  the orchestrator GC removes them after 90 days, so the probe used a synthetic id) · Langfuse model
  prices registered (5/5) by `scripts/langfuse-register-models.ts` under `railway run`, keys never printed.
- Blocked on the operator: Sentry project split (MCP tool rejects the call; one-liner in RECONCILIATION) ·
  HSTS preload submission. Not started: §5.3/5.4/5.8 design pass (needs screenshots).

## Shipped 2026-09-08 (all deployed-verified via `/api/version` ancestry; details: RECONCILIATION top)
- **#2180 `b531b203f`** deploy-drift observer (GitHub workflow, canaries) · inbound-crm header-only · read-mode
  contract · NICK FAB lane · Sentry app tag. **#2186 `87e5d3bfe`** fixed its SIGPIPE; plain run PASSED, stale canary FAILED.
- **#2181 `e4e88d5d1`** approvals expire (authorization, not obligations; 409 before execution) · devices classified,
  retire marks RETIRED. **#2183 `989345d28`** signed image URLs behind `IMAGES_REQUIRE_SIGNATURE` (unset = today).
- **#2185 `851b597e7`** resume record on park · `tests/e2e/floating-collision.spec.ts` (first run red on real
  collisions → NICK pill docked into the More sheet on phones, 7rem lane) · Brain nav 4→9.
- **#2188 `d3a760d68`** middleware.ts → proxy.ts. **#2189 `66b79cc17`** violet AI accent retired, `--status-ai` deleted.
- Operator decisions open: flip `IMAGES_REQUIRE_SIGNATURE`; approval windows; `/market` MOVE/RETIRE; Sentry split;
  HSTS preload; Neon branch protection. Do not relaunch review workflows here unasked (usage).

## Shipped 2026-09-07
- **#2175 `71e7cf14`** (operator-merged 21:58:41Z; deployed 22:02:50Z; runtime-verified 23:54Z
  via `/api/version` ancestry, worker `/health`, live headers, anonymous 401, `sw.js` v11) —
  dead COPY removed from both Dockerfiles + `tests/repo/dockerfile-copy-sources.test.ts`;
  `/api/brain/pinned` anonymous 500 → 401; `--font-mono`/`--font-sans` bridged (Geist Mono had
  never rendered); `/save` keeps similar-but-different statements instead of discarding them;
  `sw.js` same-origin `/_next/static/` only (v11); journal-brief plain headings; `X-Robots-Tag
  noindex` + sign-in robots meta; lint baseline re-snapshotted; soft-delete allowlist with reason;
  SECURITY.md CSP section rewritten to what production serves.
- **#2177 (open)** — pinned guard preserves the auth-guard's 503 and sanitizes unexpected errors;
  `/save` identity decided BEFORE any embedding call, embedding outage still saves (`embedded:
  false`, embed-backfill indexes later); near-duplicate pairs queued into the EXISTING
  contradiction review (`signal: near_duplicate`); `resolveContradiction` writes `supersededById`
  + `validUntil` on the loser (the columns every recall lane already filters on — the earlier
  "no readers" line was wrong); `.github/workflows/docker-context-gate.yml` builds the real deps
  stage of both Dockerfiles with a canary. Full suite 708 files / 7,482 tests, exit 0.

## Toolchain trap (still true)
The shared `node_modules` predate `@sentry/nextjs` (#2074): in every junctioned worktree
`typecheck` shows TS2307 phantoms, tests importing `next.config` fail to load unless they mock
`@sentry/nextjs/config`, and the pre-push build cannot run. Both PRs were pushed from a hookless
sparse scratch clone (the path `statenour-verify` documents); CI was the gate. The operator
declined a `railway deployment list` call after the merge — verify deploys via `/api/version`
ancestry + worker `/health`.

## Open — operator decisions (details in the program §2/§13)
- Independent deploy observer (not an in-worker cron); classify the 20 "offline" cameras by
  intended lifecycle; expire approval AUTHORIZATION without fabricating a decline.
- Signed URLs for `/api/images/[id]` (consumers: chat markdown, /content publish,
  social-actions, photo-improver); inbound-crm `?secret=` removal; read-mode contract (strict vs
  "no autonomous changes"); NICK FAB overlap on /journal + /missions; `middleware.ts` → `proxy.ts`.
- Neon: PITR 6 h, daily 30 d / weekly 35 d snapshots, `production` branch unprotected, org MFA
  not required → restore drill with outbound effects disabled + branch protection.
- `/market`, "Check Business Dashboard", shop-flavoured chat starters: MOVE or RETIRE (R7).
- nickstire PhotoRibbon → StateNour's Sentry project (chip spawned); Sentry project split.

## Carried forward — the 2026-09-02 observability arc (still true)

**The finding that shaped the whole arc.** Adding Sentry (#2074) silently killed Langfuse.
`Sentry.init()` registers the global OpenTelemetry tracer provider; `@opentelemetry/api`'s
`registerGlobal` refuses a SECOND registration, logs it through a no-op diag logger, and keeps the
FIRST. `instrumentation.ts` imported the Sentry config before `initLangfuseTracing()`, so every AI
SDK span went to Sentry's provider and was dropped — while the boot log said `langfuse_started` and
`/api/version` said `langfuse: true`. Measured, not inferred: `/api/public/traces` returned
`totalItems: 0` all-time against the live project with valid keys.

**Shipped:** #2073 `863ce4c47` (one `langfuseTelemetry()` helper, 22 sites) · #2080 `5e9a510f0`
(provider handover, recording self-check, `app/global-error.tsx`, shared secret mask,
`POST /api/system/observability-probe`) · #2082 `a1d51cf09` (sample the ROOT) · #2083
`e4f1a6bb2` (the receipt). #2079 CLOSED, not merged (real key material in its first commit;
history NOT rewritten).

**Receipts:** Langfuse trace `d3eebaac74d030dc2aea911b83ace1bb` (2026-09-02T17:43:48Z, `a1d51cf`,
environment production, planted `metadata.probeId`, `service.namespace: sentry`) · Sentry issue
`JAVASCRIPT-REACT-Y` with the SAME probe id. Reproduce with the probe route.

**Open / known gaps:** token usage and cost are 0 (provider reported no usage) · only the probe
has exercised the Langfuse path · Langfuse keys are in `main` history from #2073 — operator
declined rotation 2026-09-02, do NOT re-raise.

**Traps:** two SDKs cannot both own OpenTelemetry by accident · Sentry's `tracesSampler` sees
ROOT spans only · `lib/observability/sentry.ts` reaches the BROWSER bundle · Langfuse names
observations `<functionId>:<span>` and `/api/public/v2/observations` is a thin projection.


## 2026-09-29 Carousel checkpoint · Q-25
- **Q-25 BUILT, not merged:** canonical RealityEvent registry, eventVersion/retentionClass enforcement, occurredAt + correlation/causation lineage, Episode lineage, Nick evidence-envelope support, RealityEvent adapter into the EXISTING DomainEventEnvelope projection, and focused refusal/lineage tests.
- Additive schema remains **pending/operator-gated** at `prisma/migrations-pending/20260929123500_reality_event_envelope/migration.sql`. Do not claim production columns exist until operator apply + read-back.
- The implementation reuses the existing bridge-receipt/idempotency transaction; no second event spine was introduced.
- Recovery details and next steps: `docs/research/2026-09-29-carousel-q25-q27-checkpoint.md`. Active branch: `feat/nouros-carousel-q25-q27-20260929`. Re-anchor onto latest main before PR; main is moving.


## 2026-09-29 · authoritative Q-31 recovery
- Q-25 RealityEvent envelope is **MERGED** via #2784 (`bee3abc5...`); its production migration remains a separate operator-applied/read-back concern.
- Hidden Q-31 work was recovered from GitHub onto `feat/nouros-resilience-q28-q32-current-20260929` without rewriting the sibling-owned source branch. Current recovered scope includes inferred-writer admission, Guardian quarantine for Drive/Calendar/Google Reviews, trust-tier materialization, a bitemporal kernel/test fixture, and pending migration `20260929150500_brain_memory_transaction_time`.
- Truth correction: Q-31 is BUILT-IN-PART, not complete. `transaction_expired_at` is modeled but is not yet guaranteed to be written before every real supersession mutation. Complete that ordering + contradiction-shadow acceptance before promotion.
- Post-#2790 migration rule also applies: every parked migration must be registered statement-for-statement in the operator-only apply endpoint or explicitly classified operator-only. Q-31 registration is still pending.
- Q-32 Langfuse eval loop is next; reuse existing Langfuse, do not add a second eval platform.
- Durable checkpoint: `docs/research/2026-09-29-resilience-wave-current-checkpoint.md`.

## 2026-09-29 · final Q-31/Q-32 consolidation before PR
- Branch `feat/nouros-resilience-final-current-chatgpt-20260929` now combines deep Q-31 admission/history semantics with the row-locked explicit contradiction path; `cleanupResolvedContradiction()` is the single losing-memory mutation owner.
- Q-31 transaction migration `20260929150500_brain_memory_transaction_time` is registered but NOT applied; production columns remain unclaimed.
- Q-32 uses one deterministic `q32-regression.ts` owner + incumbent Langfuse queue/runtime/judge/optional experiment. The duplicate runtime selector import and fail-open unknown-family classifier were repaired during consolidation.
- Empirical Q-32 targets (>=50 labels; kappa >=0.6 on >=30 double labels) remain UNMEASURED.
- Full checkpoint: `docs/research/2026-09-29-resilience-final-consolidation-checkpoint.md`.

## 2026-09-29 · Q-31/Q-32 hardening on final resilience PR
- Q-32: experiment parser repaired; unknown model families are now rejected for independent judging; Venice/Ollama/custom hosts are not model families. The pinned Langfuse action owns its SDK install, so no extra app dependency was added.
- Q-31: transaction-column probing is single-owner in `memory-bitemporal.ts`. Failed prepared supersessions restore transaction + effective verification state, delete the provisional snapshot, and do not silently fall through to a legacy history-destroying overwrite.
- These are still branch truths until PR #2794 is exact-head green and merged. Production migration/application and empirical Q-32 acceptance remain separate.

## 2026-09-29 · #2794 merged — resilience/Q-31/Q-32 closeout
- **MERGED + UNIT-VERIFIED:** #2794 final head `79dbea91630f860f0a84bbd68b075df4a7697eea` passed Turbo affected verify, StateNour E2E, Completion Authority, Adoption Gates, Agent Policy, Secret Scanning, and Admin Diagnostic; guarded squash merge is `48ac53827eb7f4f5754ee2a41fe74789c5c36c89` on main.
- Q-31 remains production-gated by pending transaction-time migration `20260929150500_brain_memory_transaction_time`; do not claim those production columns exist until operator apply + read-back.
- Q-32 remains empirically gated: live label volume, double-label kappa, and cloud dataset read-back are not yet evidence.
- No Railway `PROCESS_ROLE` split, worker env deletion, or live mega fan-out proof was performed by #2794.

## 2026-09-29 · takeover closeout after Neon restore / #2795
- **StateNour DB-auth incident recovered.** Neon project `spring-art-47050555` now has default production branch `br-green-firefly-am8jubqi`, restored 2026-09-29 from snapshot `snap-twilight-unit-am86vhxd`; the familiar endpoint `ep-quiet-wave-am320eo1` is attached to that restored branch. Railway `DATABASE_URL` + `DIRECT_URL` were refreshed for `statenour-web` and `statenour-worker`; fresh deploys reached SUCCESS and `/api/system/heartbeat` returned 200 with DB healthy and worker fresh. No fresh `P1000` / SQLSTATE `28P01` errors appeared after recovery.
- **#2795 merged.** External-worker/cockpit/migration closeout squash commit is `9c2d96fc0002403ab2f93dc77f3d8f303b13c2e4`; exact-head CI including Node sweep + StateNour E2E passed. Both StateNour services deployed that merge successfully.
- **External-worker schema only:** repo-owned additive migration `20260929195500_external_worker_lane` was applied to restored production (`WorkItemType += AI_EXTERNAL_WORKER`, `WorkItem.resultPayload JSONB`) and then recorded with `prisma migrate resolve --applied`. Read-back confirmed the schema and ledger step.
- **RealityEvent restore gap is CURRENT LIVE TRUTH:** `20260929123500_reality_event_envelope` is absent from the restored production schema **and** absent from the Prisma applied ledger. Read-only probes found all five envelope columns absent. This lane is intentionally left to the separate restore/recovery owner; do not infer the pre-restore receipt still describes current production.
- **NattyNour recovery:** disposable pnpm/npm/uv and inactive `.next`/`.turbo` caches were cleaned without deleting worktrees or dependencies; C: free space reached ~20.6 GB. Local gateway `127.0.0.1:11436` is healthy with backend ready; Codex ChatGPT auth, Claude subscription auth, and Antigravity CLI are present.
- **External worker is NOT yet live on NattyNour.** A fresh `RUNNER_SHARED_SECRET` is staged server-side and the web service was redeployed successfully, but the local installer could not be completed through the current remote safety boundary that prevents moving the secret into the machine's persistent DPAPI store. No `StateNour-ExternalWorker-NattyNour` scheduled task exists yet; writes remain OFF by default. Do not claim runner heartbeat or queue/claim/complete receipts until that install is completed and verified.
- **ChatGPT/Desktop Commander continuity:** a connected Desktop Commander device is not bound to a ChatGPT conversation. New chats must explicitly recover `list_devices`, `get_recent_tool_calls`, `list_sessions`, repo/worktree state, and production state before acting. A reusable `nour-operator-takeover` ChatGPT skill was created for this recovery protocol.

