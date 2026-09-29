# Ollama liveness repair + worker freshness receipt — 2026-09-28

## Scope

This receipt closes the question raised after the Instagram/Admin merges: did the static Instagram hotfix or the later StateNour worker merge damage the Ollama model-liveness cron?

**Answer: no.** The liveness cron code path was not changed by PR #2727 or PR #2726. The cron was healthy and exposed a real upstream retirement in the fast lane. The production model pin was then repaired and re-proved through the exact deployed route.

## Repository / deployment boundary

- PR #2727 (Nick static Instagram output-budget hotfix) merged as `904f82bdaebeaa5bf3fefc0c00149c21bf76fa91`.
- PR #2726 (private-worker freshness / deploy-drift observability) merged as `18db7de13af5fe0f6f4f2fb62456e371db3dd698`.
- Neither merge changed:
  - `apps/statenour/app/api/cron/ollama-model-liveness/route.ts`
  - `apps/statenour/lib/ai/model-liveness.ts`
  - `apps/statenour/config/crons.ts` liveness row
  - `apps/statenour/lib/inngest/jobs.ts` liveness registration
  - `apps/statenour/lib/services/cron-control.ts`
- #2726's reviewed head passed StateNour E2E, affected CI, Secret Scanning, Completion Authority, Admin diagnostic, Adoption gates and Agent Policy with no unresolved review threads.
- StateNour web and worker both deployed #2726 successfully on Railway before the final liveness receipt below.

## What the existing cron actually proved

The deployed route `GET /api/cron/ollama-model-liveness`, authenticated with the production `CRON_SECRET`, was called directly after #2726.

Pre-repair live result:

| Lane | Resolved model | Result |
|---|---|---|
| chat | `minimax-m3` | 200 / alive |
| fast | `deepseek-v4-flash:0731` | **410 / retired** |
| vision | `gemma4:31b` | 200 / alive |

The route returned HTTP 200 with `data.ok=false`, exactly as designed for a lane failure, and wrote a failed `CronJobLog` receipt. Recent production history already contained repeated failed `ollama-model-liveness` rows on Sep 25–27. The `cron_control` row for `ollama-model-liveness` is absent, which means the existing kill-switch service leaves it enabled by default.

This is important: the cron was not broken. It was **correctly detecting a dead upstream model**.

## Replacement selection

A live bake-off was run through the production StateNour Ollama account against tasks that match the fast lane's actual contract: strict JSON classification, extraction and terse structured summary.

Two repetitions per task:

| Candidate | HTTP success | Valid JSON | Avg latency | Length stops |
|---|---:|---:|---:|---:|
| `glm-5.3-flash` | 6/6 | **6/6** | **~1.1 s** | 0 |
| `deepseek-v4.1-flash` | 6/6 | 5/6 | ~1.3 s | 1 |
| `minimax-m3` | 6/6 | 6/6 | ~2.5 s | 0 |
| `glm-5.2` | 6/6 | lower reliability in this run | slower | 0 |

`glm-5.3-flash` therefore replaced the retired fast-lane pin instead of blindly falling back to an older model.

## Production mutation

Applied through Railway production configuration:

- `statenour-web`: `OLLAMA_FAST_MODEL=glm-5.3-flash`
- `statenour-worker`: `OLLAMA_FAST_MODEL=glm-5.3-flash`

A subsequent environment read found `statenour-worker` still carried the historical retired chat pin `OLLAMA_MODEL=deepseek-v3.1:671b`. Source inspection confirmed `apps/worker/src` has **zero AI/model-call sites**. The service forwards cron HTTP calls to StateNour web and also runs the in-process `processVideoRenders()` Remotion render/upload loop, so the stale Ollama pin was unused AI configuration debris rather than an active worker model-serving outage. It was nevertheless aligned to `minimax-m3` for hygiene.

Final observed env on both services:

- chat: `minimax-m3`
- fast: `glm-5.3-flash`
- vision: `gemma4:31b`

Do not infer from the worker env that the worker serves AI traffic. It does not.

## Post-repair production receipt

After both Railway services were healthy, the exact deployed liveness route was called again.

Result:

| Lane | Resolved model | HTTP | State | Latency |
|---|---|---:|---|---:|
| chat | `minimax-m3` | 200 | alive | 648 ms |
| fast | `glm-5.3-flash` | 200 | alive | 365 ms |
| vision | `gemma4:31b` | 200 | alive | 368 ms |

Route envelope: `ok=true`, `data.ok=true`.

A production DB read after the final trigger showed the latest `ollama-model-liveness` `CronJobLog` row at 2026-09-28T03:22:51.032Z with `status=success`, no error and 649 ms duration.

The #2726 public heartbeat surface was checked at the same time:

- `/api/system/heartbeat` → HTTP 200
- DB latency: 7 ms
- worker: `status=fresh`
- worker receipt age: 8 minutes

## Architecture boundary

There are two distinct health surfaces:

1. **StateNour web AI runtime**
   - `/api/cron/ollama-model-liveness`
   - probes the resolved chat / fast / vision model IDs through the same model resolver used by real web AI calls
   - writes `CronJobLog`
   - alerts on non-200, with 410 treated as permanent retirement

2. **Private worker**
   - no AI SDK / Ollama call sites
   - forwards cron HTTP calls to StateNour web
   - also runs the in-process `processVideoRenders()` Remotion render/upload loop
   - monitored through persisted worker-freshness receipts surfaced by `/api/system/heartbeat`
   - model env vars on the worker are not proof of an AI lane

Do not add a duplicate worker-side Ollama liveness system unless the worker later acquires real AI call sites.

## Remaining boundary

This repair proves the three current StateNour **web AI lanes** are alive now. It cannot guarantee Ollama Cloud will never retire another model. The durable protection is the existing liveness cron plus its production receipt and alerting contract; when a future lane returns 410, replace the resolved pin using a measured live bake-off rather than a stale historical recommendation.
