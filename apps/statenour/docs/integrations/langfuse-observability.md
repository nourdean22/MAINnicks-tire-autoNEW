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
| Per-turn telemetry | `app/api/ai/chat/build-stream-config.ts` | `experimental_telemetry` on the single `streamText` choke point (`lib/ai/stream-with-fallback.ts:290`), functionId `nick-chat`, metadata: mode · modelId · provider · sessionId(conversationId). |
| Privacy gate | `isLangfuseTelemetryEnabled(privateMode)` | **Private-mode turns are never traced** — spans carry prompt/completion content. Also false whenever the processor didn't actually start (no key-presence lies — the `isBraintrustActive()` bug class is pinned by test). |
| Status surface | `buildSystemHealth().langfuse.status` | `started · skipped · failed · uninitialized` — the real outcome, on /system health beside the braintrust slot. |
| Offline proof | `scripts/probe-langfuse-trace.ts` | Full pipeline to a local OTLP sink: 7/7 checks (POST `/api/public/otel/v1/traces`, Basic auth, span carries functionId + `ai.streamText`). Run anywhere deps are installed. |

Not wired yet, deliberately (each is a follow-up once traces are visibly landing):
prompt management, score/eval ingestion (`@langfuse/client`), `propagateAttributes`
session promotion, the two side chat surfaces (`page-insight`, `side-pane-chat`).

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
```

Next deploy: boot log shows `langfuse_started`, `/api/health` → `langfuse.status:
"started"`, and every non-private chat turn lands as a `nick-chat` trace.
Verification after keys: send one chat message, open Langfuse → Traces, confirm a
trace with metadata `mode`/`modelId` and the tool-call spans.

## Relationship to existing lanes

- `AgentTrace` + `/system/ai-cost` + `tool_telemetry` stay — they are product
  receipts, first-party and queryable in-app. Langfuse adds turn-level trace trees
  (prompt → tool calls → completion) none of them render.
- The OTel GenAI NDJSON export lane (`pnpm export:traces`) remains the
  content-free portable export; unchanged.
- `braintrust-wrap.ts` is superseded for tracing and was never live; the Braintrust
  eval-dataset scripts (`export-eval-datasets.ts`) are untouched by this PR.
