# Session ledger — statenour

**Updated:** 2026-09-15 (UI workbench slice 1 on top of the camera vision wave 0)

## UI workbench slice 1 (2026-09-15; branch `claude/statenour-ui-architecture-intmaf`, PR pending)
**Objective:** gate a pasted 38-section UI plan against live code, correct it, build the substrate as vertical
slices. Spec + verdict: `docs/design/ui-workbench-2026-09-15.md` (read THAT before proposing any inspector,
drawer, selection or "spatial" work). Ship entry: RECONCILIATION top.
**What now exists:** `?inspect=<kind>:<id>` opens ONE inspector for memory / task / person from any page
(`components/inspector/inspector-host.tsx`, mounted in the layout); rows with `data-entity` inside a
`[data-selection-scope]` get j/k/Space/Enter/x; ⌘K leads with the focused object's actions; a workset shelf;
Reality Mode (⌘K → Modes) renders provenance inline; `/proof` is in NAV; the chat bridge reads `?inspect=`.
**Next (in order, spec §5):** alert/cron/tool inspectors (System flagship, each a by-id read away) · task
mutations in the inspector via a shared dispatch extracted from `useMissionDispatch` · ChangeSet with Brain's
Changed view as the second consumer · priority breakdown (`scoreTaskPriority` per-term) · Base UI 1.8 + React
19.3 dependency PR, then `<ViewTransition>` on row → inspector only · the §5.1 type floor on
`bottom-tab-bar.tsx` / `more-sheet.tsx` (9px → 11px, still open).
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
