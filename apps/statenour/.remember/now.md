# Session ledger — statenour

Updated: 2026-09-02

**Updated:** 2026-09-02 (observability arc · #2080 provider conflict · #2082 root sampling · #2083 receipt)

**Objective:** wire Langfuse tracing properly, then wire Sentry — and prove both actually work
rather than trusting a `configured: true` badge.

**The finding that shaped the whole arc.** Adding Sentry (#2074) silently killed Langfuse.
`Sentry.init()` registers the global OpenTelemetry tracer provider; `@opentelemetry/api`'s
`registerGlobal` refuses a SECOND registration, logs it through a no-op diag logger, and keeps the
FIRST. `instrumentation.ts` imported the Sentry config before `initLangfuseTracing()`, so every AI
SDK span went to Sentry's provider and was dropped — while the boot log said `langfuse_started` and
`/api/version` said `langfuse: true`. Measured, not inferred: `/api/public/traces` returned
`totalItems: 0` all-time against the live project with valid keys.

**Shipped:**
- **#2073 `863ce4c47`** — every AI SDK call site traces through one `langfuseTelemetry()` helper
  (22 sites; 20 were bare), processor `environment`/`release`/`mask`, call-site gate with a
  mutation canary.
- **#2080 `5e9a510f0`** — the provider handover (`Sentry.init({ openTelemetrySpanProcessors })`),
  a recording self-check before reporting `started`, `app/global-error.tsx` (the App Router root
  boundary did not exist), one shared secret mask, and `POST /api/system/observability-probe`.
- **#2082 `a1d51cf09`** — sample the ROOT. Sentry consults `tracesSampler` for root spans ONLY
  (`if (!isRootSpan) return { decision: parentSampled ? … }`); children inherit verbatim, so the
  name-based sampler from #2080's review round starved every `ai.generateText` nested in a request.
- **#2083 `e4f1a6bb2`** — the receipt, and the readback trap that hid it.
- **#2079 CLOSED, not merged** — its first commit held real key material and `gitleaks` scans a
  PR's whole commit range, so it could never go green. Replaced by a clean branch; history was NOT
  rewritten.

**Receipts (the only acceptable evidence) — BOTH sinks, both read back:**
- **Langfuse:** trace `d3eebaac74d030dc2aea911b83ace1bb`, 2026-09-02T17:43:48Z on `a1d51cf` —
  `environment: production`, `userId: operator`, `tags: ["probe"]`, `release` = deploy SHA,
  `model: deepseek-v4-flash:0731`, planted `metadata.probeId`, and
  `resourceAttributes.service.namespace: sentry`.
- **Sentry:** issue `JAVASCRIPT-REACT-Y` (id 7707827946), message `observability-probe 2FERN8pP4A`,
  level info, culprit `POST /api/system/observability-probe`, 2026-09-02T17:43:49Z — the SAME
  probe id, read back out of Sentry. Real traffic lands independently too (`TRPCError` through 19:04Z).

Reproduce either with the probe route.

**Open / known gaps — do not report these as done:**
1. **Token usage and cost are 0.** The provider reported no usage on that call, so cost
   attribution is UNPROVEN. Everything else mapped.
2. **Only the probe has exercised the LANGFUSE path in production.** Zero `provider.success`
   lines since the deploy — a quiet period, not a fault (logs also show zero Langfuse errors).
   Sentry is receiving real traffic independently of the probe.
3. **Langfuse keys are in `main` history** from #2073 (my error). **Operator declined rotation
   2026-09-02: private repo, personal tracing project, risk accepted. Do NOT re-raise.**

**Traps worth carrying (full detail in agent memory):**
- Two SDKs cannot both own OpenTelemetry by accident; the second registration loses in silence.
- Sentry's `tracesSampler` sees ROOT spans only.
- `lib/observability/sentry.ts` reaches the BROWSER bundle via `sentry.client.config.ts` — never
  import a Node-only module from it (shared constants live in `span-names.ts`).
- Langfuse names observations `<functionId>:<span>`, and `/api/public/v2/observations` is a THIN
  projection; `metadata`/`userId`/`tags`/`release`/`model`/`input` live on
  `/api/public/traces/<traceId>`. A naive matcher reports a WORKING pipeline dead — it did once.
