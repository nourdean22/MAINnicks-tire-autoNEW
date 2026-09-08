# Session ledger — statenour

**Updated:** 2026-09-08 (quality + power Phases 1–2 shipped and deployed; docs closure)

**Objective this wave:** independently inspect, stress-test and repair bdnick.info, then hand the
operator a prioritized program. Program doc: `docs/research/2026-09-07-statenour-quality-power-program.md`
(read THAT before re-auditing anything here). Full wave entry: RECONCILIATION top.

## The finding that mattered
**Production had been stuck on `b3bebde` (2026-09-04 12:08Z) for three days.** Both Railway
services showed `Deploy failed`; the build log ended with `COPY apps/statenour/patches … not
found`. #2096 deleted the only file in that directory, git dropped the directory, and both
Dockerfiles failed at the deps stage on every push after 12:34Z. The previous ledger entry said
#2096 "shipped" — it was merged, not deployed. Merged and deployed are different claims.

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
