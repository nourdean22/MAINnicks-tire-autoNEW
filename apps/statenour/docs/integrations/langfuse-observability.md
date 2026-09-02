# Langfuse observability — wiring, deployment options, activation

**Status (2026-08-25):** SDK wired end-to-end and proven offline; **dormant until the
operator sets keys** (an operator-side Railway env edit — protected operation, never
agent-initiated). One decision + three env vars activate it.

## Why Langfuse, and why now

- **There is no working LLM observability today.** `braintrust-wrap.ts` shipped
  2026-05-17 and has had **zero callers** ever since (grep receipt in PR #1837);
  `BRAINTRUST_API_KEY` sits set-but-unused in Railway. The eval corpus stands at
  3/200 scenarios with a hand-run harvest. The register's 2026-07-28 Langfuse
  REJECT assumed "native receipts + AgentTrace + trace pages cover the need" —
  the operator's 2026-08-25 directive states they do not.
- **License verified 2026-08-25:** "This repository is MIT licensed, except for the
  `ee` folders" (github.com/langfuse/langfuse). The SDK packages used here
  (`@langfuse/otel` 5.10.1) are MIT.
- **SDK generation matters:** JS SDK **v5** is current; v4 is deprecated and OSS-v4
  servers ingest with up to 15-minute delay (real-time OTel needs SDK ≥5.4 and, if
  self-hosted, server ≥3.63.0). This integration uses v5 (5.10.1).

## What is wired (PR #1837)

| Piece | Where | Behavior |
|---|---|---|
| Boot init | `instrumentation.ts` → `lib/observability/langfuse.ts` | Registers `LangfuseSpanProcessor` on the global OTel provider via `NodeSDK`. No keys → logged skip, zero overhead. Init throw → `failed`, chat unaffected. |
| Per-call telemetry (2026-09-02) | `lib/observability/langfuse.ts` → `langfuseTelemetry()` | **Every** AI SDK call builds its `experimental_telemetry` through one helper, so the keys Langfuse maps (`functionId` → trace name, `metadata.sessionId` / `userId` / `tags`) are spelled once. 22 call sites as of 2026-09-02: `nick-chat` (built in `build-stream-config.ts`, spread into `stream-with-fallback.ts`; tags `nick-chat` + mode, session = conversation id), `aiChat`/`aiStream` in `lib/ai/provider.ts` (default names `ai-chat-<task>` / `ai-stream-<task>`, callers may pass `opts.telemetry`), `tracedAiChat` (its AgentTrace label becomes the trace name, its source a tag, the AgentTrace id rides in metadata so the two ledgers join), and 18 direct sites (`page-insight`, `side-pane-chat`, `chat-alternate-path`, `chat-regenerate`, `weekly-review`, `telegram-ask`, `daily-executive-brief`, `intelligence-brief`, `extract-claims`, `score-claims`, `content-alpha`, `contextual-retrieval`, `google-search-ask`, `reasoning-tool-gather`, `structured-response`, `image-prompt-synth`, `image-prompt-regen`, `quality-bench`). `userId` is `operator` (single-operator app). |
| Call-site gate | `tests/observability/ai-sdk-telemetry-gate.test.ts` | Enumerates every `generateText` / `streamText` / `generateObject` / `streamObject` under `lib/` + `app/`; a bare one fails. Inverse check (the scanner must still see ≥ 20 sites), a two-entry allowlist that must match a real site (the `structured.ts` 1-token readiness ping; the `stream-with-fallback` spread whose block is pinned by `build-stream-config-telemetry.test.ts`), trace names must be kebab-case and unique, and a mutation canary (strip one block in memory → exactly that site goes bare). Positive control 2026-09-02: 20 of 22 sites were bare before this pass. |
| Environment + release | `LangfuseSpanProcessor({ environment, release })` | `LANGFUSE_TRACING_ENVIRONMENT` → `RAILWAY_ENVIRONMENT_NAME` → `NODE_ENV`, sanitised to Langfuse's `^(?!langfuse)[a-z0-9-_]+$` (≤ 40 chars; anything illegal collapses to `default` rather than dropping spans). Release: `LANGFUSE_RELEASE` → `RAILWAY_GIT_COMMIT_SHA`, so a regression pins to a deploy. Both derived on Railway with no extra env. |
| Masking | `maskLangfuseData()` as the processor `mask` | Every exported input / output / metadata attribute passes through it: `sk-…` / `pk-…` keys and bearer tokens are redacted before the span leaves the process. Belt-and-braces on top of the private-mode gate; pinned in `tests/lib/observability/langfuse-telemetry.test.ts`. |
| Privacy gate | `isLangfuseTelemetryEnabled(privateMode)` + `runAlternatePaths()` | **Private-mode turns are never traced and skip hidden alternate model paths** — those paths make extra model calls and their prompts/completions must stay in-process. Also false whenever the processor didn't actually start (no key-presence lies — the `isBraintrustActive()` bug class is pinned by test). |
| Status surface | `buildSystemHealth().langfuse.status` | `started · skipped · failed · uninitialized` — the real outcome, on /system health beside the braintrust slot. |
| Offline proof | `scripts/probe-langfuse-trace.ts` | Full pipeline to a local OTLP sink: 7/7 checks (POST `/api/public/otel/v1/traces`, Basic auth, span carries functionId + `ai.streamText`). Run anywhere deps are installed. |

Not wired, deliberately (each is a decision once traces are visibly landing, not a gap):
prompt management (prompts live in code; linking them via `langfusePrompt` is a
migration, see the `langfuse` skill's prompt-migration reference), score/eval
ingestion (`@langfuse/client` — the chat feedback controls would be the first
producer), and `propagateAttributes` (needs `@langfuse/tracing`; on the AI SDK
path every call sets its own attributes through the helper instead). The two
side chat surfaces were wired 2026-09-02.

## Deployment decision — proposal with costs (operator's call)

Measured volume: **764 chat requests / 14 days** (`ai_generations`, 2026-08-25) ≈
**1,640/mo**. A traced turn emits roughly 3–8 observations ("units"): ~5k–13k
units/mo.

| Option | Cost | Fit |
|---|---|---|
| **Langfuse Cloud — Hobby (recommended)** | **$0/mo** · 50k units included · 30-day retention · 2 users · no card | Current volume uses 10–26% of the free tier. US region endpoint: `https://us.cloud.langfuse.com`. |
| Langfuse Cloud — Core | $29/mo · 100k units + $8/100k · 90-day retention | Upgrade trigger: >50k units/mo (≈6–10× current chat volume) or needing >30d lookback. |
| Self-host (OSS, free license) | Railway containers: web + async worker + ClickHouse + Redis + S3-compatible store (Postgres exists — Neon). Realistic $30–60/mo infra + upgrade/ops burden | The register's 2026-07-28 sizing objection was correct and still is: this stack for one operator is not worth it at current volume. Reopen if data residency or retention economics change. |

**Recommendation: Cloud Hobby, US region.** Zero cost, zero infra, real-time
ingestion with SDK v5. The wiring is identical for all three options — only the
env vars differ.

## Activation (operator)

Set on Railway `statenour-web` (protected op — operator-only):

```
LANGFUSE_PUBLIC_KEY=pk-lf-…        # from the Langfuse project settings
LANGFUSE_SECRET_KEY=sk-lf-…
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
# optional — both default from Railway's own variables:
LANGFUSE_TRACING_ENVIRONMENT=production   # else RAILWAY_ENVIRONMENT_NAME, else NODE_ENV
LANGFUSE_RELEASE=<git sha>               # else RAILWAY_GIT_COMMIT_SHA
```

Locally the same three lines go in `apps/statenour/.env.local` (git-ignored; an
agent never writes that file — the repo hook blocks it, and a key that has been
pasted into a chat or a screenshot should be rotated in Langfuse before use).

Next deploy: boot log shows `langfuse_started`, `/api/health` → `langfuse.status:
"started"`, and every non-private model call lands as a trace named after its
call site (`nick-chat`, `weekly-review`, `telegram-ask`, …).

### Verification loop (the `langfuse` skill's required step, run once keys exist)

1. Trigger one traced call per surface you care about: a chat message
   (`nick-chat`, session = the conversation id), and one job (`weekly-review`
   or `daily-executive-brief`).
2. Pull the traces back with the CLI instead of eyeballing the UI. The CLI reads
   the keys from the shell env — export them from `.env.local` there, never type
   them into a transcript:

   ```
   export LANGFUSE_HOST="$LANGFUSE_BASE_URL"
   npx langfuse-cli api traces list --limit 10
   npx langfuse-cli api traces get <traceId>
   ```

3. Audit each trace against https://langfuse.com/docs/observability/best-practices
   — name is the call site (not `generateText`); `sessionId` present on chat
   turns; `userId` = `operator`; tags present and low-cardinality; `environment`
   is `production` (or the Railway env name) and `release` is the deploy SHA;
   the generation span carries model, token counts and a cost (a missing cost
   means Langfuse has no price for that model id — add it under Settings →
   Models); no key or bearer token anywhere in input/output (the mask).
4. Anything that is off is a code fix here, not a UI setting: the helper is the
   single place the keys are spelled.

Offline, without keys, `pnpm tsx scripts/probe-langfuse-trace.ts` still proves
the pipeline end to end (7/7 on 2026-09-02 with the environment / release /
mask options in place).

## Relationship to existing lanes

- `AgentTrace` + `/system/ai-cost` + `tool_telemetry` stay — they are product
  receipts, first-party and queryable in-app. Langfuse adds turn-level trace trees
  (prompt → tool calls → completion) none of them render.
- The OTel GenAI NDJSON export lane (`pnpm export:traces`) remains the
  content-free portable export; unchanged.
- `braintrust-wrap.ts` is superseded for tracing and was never live; the Braintrust
  eval-dataset scripts (`export-eval-datasets.ts`) are untouched by this PR.
