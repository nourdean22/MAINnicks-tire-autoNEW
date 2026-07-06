# Memory index (nickstire repo)

Read **`CLAUDE.md`** (repo root) for operating rules. Use this file as a **router**, not a duplicate of the business vision doc.

## Where things live

| Topic | Location |
|-------|-----------|
| Business constants (phone, address, hours, reviews display) | `shared/business.ts` |
| SEO page definitions | `shared/seo-pages.ts`, `shared/services.ts`, `shared/cities.ts`, `shared/intersections.ts` |
| API / tRPC | `server/routers/`, composed in `server/routers/index.ts` |
| Cron / background | `server/cron/scheduler.ts`, `server/cron/jobs/` |
| DB schema | `drizzle/schema.ts` |
| Declined work recovery | `server/services/declinedWorkRecovery.ts`, `dispatch.declinedLedger` / `markRecovered` / `recordDeclineOutreach` |
| Env reference | `.env.example` (canonical) |
| Site usage (URLs, admin paths) | `USAGE-MANUAL.md` |

## After substantive changes

1. Run `pnpm run check` and `pnpm test`.  
2. If SEO HTML changed, run `pnpm run prerender` before release.  
3. Bump `truth_os.md` if production behavior or env requirements changed.

## Voice / VAPI · operator-product context (read before evaluating call metrics)

**Tire calls REQUIRE a human transfer to confirm stock.** Stock verification
is a physical rack check, not a database lookup. The AI (Nick) cannot
truthfully tell a caller "yes we have your 205/55R16" without someone
walking the rack. So the designed inbound flow for tire calls is:

```
caller → Nick greets → Nick collects vehicle/size/new-or-used →
  if shop open  → live transfer (`escalate` tool · VAPI forwardingPhoneNumber)
                  → human picks up, confirms stock, books over the phone
  if shop closed → `checkTireStock` tool · creates urgency=5 lead +
                   Telegram alert + 15-min callback promise
```

**Implication for call-evaluation metrics:**

- **Escalation (`assistant-forwarded-call`) is NOT a failure mode for tire calls.**
  It is the success path during open hours. The metric that matters is
  *warm-transfer-connected-rate* (= forwarded calls where the human
  actually picked up + completed the call), not raw escalation count.
- **`outcome=booked` from `structuredData` undercounts real bookings.**
  Nick only marks `booked` when HE books via tool. Most tire bookings
  happen on the human side after warm transfer · those are invisible
  to the AI-side eval. Pair structuredData.outcome with downstream
  TiDB writes (work orders · invoices · phone-call → booking match)
  to compute true conversion.
- **`outcome=lost` is the real failure signal.** Silent line · drop ·
  incomplete info · Nick couldn't keep them on the line long enough
  to either book OR escalate.
- **The baseline at `docs/baselines/vapi-baseline-2026-05-26.md`
  initially framed escalation as a problem** · that framing was
  corrected (see file header) after this operator note. Use the same
  reframing on all future VAPI reports.

**Open observability gap (task #3 + queue):** We do not currently track
warm-transfer-connection success. The `voice_call_states` table records
`forwarded` events but nothing confirms whether the human side picked
up. The right next eval-cron metric is `warm_transfer_connect_rate_14d`
· numerator = forwards followed by a logged human-call activity ·
denominator = all forwards.

## Self-improving loops (VAPI + GSC · shipped 2026-07-06)

Both acquisition systems now close LEARN→ACT→VERIFY. Prod-truth detail: `truth_os.md` (2026-07-06 block). Design + verified hooks: agent memory `nickstire-self-improving-loops`. Router pointers:

- **VAPI (LIVE):** `vapi-call-eval` cron → per-intent `type:'lesson'` memories (`source:'vapi_eval_cron'`, conf 0.6, only when an intent misses ≥2×/run) → top-3 lessons ≥0.65 conf appended to the receptionist prompt ONLY on the manual **Push Latest Config** (`vapi.ts` `updateAssistant`). No auto caller; a single bad call can't leak (must reinforce past 0.65 first).
- **GSC (code-complete, DORMANT):** buried-page + SEO-win `type:'pattern'` memories inside `runGscPipeline`; `seoFixDrafts` = draft-only (`shopSettings` KV `seo_fix_drafts`, zero live meta writes). Only verified trigger is the env-gated `gsc-pipeline` cron (`GOOGLE_SEARCH_CONSOLE_KEY` unset → skipped) → won't run until GSC auth is set. **No ungated 12h `gsc-data` job exists in `scheduler.ts`** (prior "ungated 12h" note was wrong).
- **Honest metrics:** misdial reclassification (`vapiCallClassifier.ts:125`) makes `abandoned_before_connect` mean a real lost caller; `receptionistRoi` tile = hard-conversions × avg paid invoice × 40–70% band.
- **SEO STOPPED (operator, 2026-07-06):** Ahrefs free DR = **0** for nickstire.org vs 66–94 for page-1 chains → head-term SEO unwinnable; operator chose no further SEO build. Don't reopen unprompted.

## Recent waves (2026-05-24 → 05-26)

## Recent waves (2026-05-24 → 05-26)

| Wave / commit | What landed |
|---|---|
| **hotfix-3** · fc4dff16 | `@nour/utils` ESM `.js` extensions · Node ESM at runtime needs explicit extensions · tsc `moduleResolution:Bundler` emits bare specifiers · Dockerfile pre-built dist committed |
| **hotfix-2** · d16efacd | `packages/lenses/node_modules` COPY added to statenour build stage · `tsc` binary missing in Docker build context |
| **hotfix-1** · dc13532f | `packages/lenses` wired into statenour Dockerfile · 10 consecutive statenour deploys fixed |
| **Wave AN** · 99f5697f | Activation · Transformers.js Spanish auto-detect live on `ChatWidget.tsx` · `sessionStorage` toast guard · silent-catch fallback · `@xenova/transformers 2.17.2` in nickstire package.json |
| **Wave AM** · 84c1408a | Framework docs · B7 `searchfit-seo.md` + B9 `operator-writing-discipline.md` |
| **Wave AL** · 99003fd1 | Transformers.js browser-side AI scaffold · `client/src/lib/transformers/lazy-load.ts` + `language-detect.ts` · Cat 9 completes all 12 HF categories |
| **Wave AK** · c1fcf778 | Bulk Whisper re-transcribe script · closes audit #321 eval corpus gap |
| **Wave AJ** · 8a8910c3 | Replicate FLUX backend · `apps/statenour/lib/ai/replicate-flux.ts` · 12-20× cheaper than gpt-image-1 · NEEDS `REPLICATE_API_KEY` + operator Replicate account |
| **Wave AZ** · c05e3909 | Photo-damage MMS pipeline · `vision-analyzer.ts` + `photo-assess-pipeline.ts` · Twilio + SmsGateway webhooks wired · Replicate Qwen2-VL-72B + HF LLaVA fallback · NEEDS `REPLICATE_API_KEY` |
| **Wave AI** · c8a298f4 | XTTS-v2 voice clone client · `voice-clone.ts` · Replicate + Modal backends · NEEDS `REPLICATE_API_KEY` + operator voice sample |
| **Wave AH** · 8569e6b9 | HF Inference embedding backend · `apps/statenour/lib/ai/hf-embeddings.ts` · `intfloat/multilingual-e5-large` · inserted as chain position #4 in `provider.ts` · LIVE (requires `HF_API_KEY`) |
| **Wave AG** · 1f324023 | BGE rerank backend · `apps/statenour/lib/brain/bge-rerank.ts` + `rerank.ts` orchestrator · `contextual-recall.ts` consumer rewired · 5000× cheaper than Cohere · LIVE (requires `BGE_RERANK=true` + `HF_API_KEY`) |
| **Wave AF** · 6b10d520 | HF classifier service · `classifiers.ts` · `screenPromptInjection()` (deberta-v3 prompt-injection screen) + `classifyIntent()` (zeroshot 11-label) · LIVE (requires `HF_API_KEY`) |
| **Wave AE** · cefcb9e1 | NickGPT fine-tune scaffolding · `scripts/export-sms-corpus.ts` + `nickgpt-client.ts` + `docs/runbooks/nickgpt-finetune.md` · DB feature-flag gated (`nickgpt_drafter_enabled`) · NEEDS Modal account |
| **Wave AD** · dd5ed253 | 3 framework docs · `security-audit.md` + `data-visualization.md` + `enterprise-search.md` |
| **Wave AC** · ea8b91e5 | HF model strategy doc · `huggingface-model-strategy.md` · 12-category map + deployment matrix + NickGPT moat |
| **Wave AB** · f8d50407 | 3 framework docs · `task-intelligence.md` + `code-craft-review.md` + `deep-research.md` |

## New files (HF stack, 2026-05-26)

| File | Purpose |
|---|---|
| `server/services/classifiers.ts` | HF prompt-injection screen + 11-label intent classifier (LIVE) |
| `server/services/nickgpt-client.ts` | NickGPT SMS drafter · Ollama → Claude/Venice fallback (DB-gated, needs Modal) |
| `server/services/voice-clone.ts` | XTTS-v2 voice clone client (Replicate + Modal, needs keys) |
| `server/services/vision-analyzer.ts` | Photo-damage vision analysis · Replicate Qwen2-VL + HF LLaVA fallback |
| `server/services/photo-assess-pipeline.ts` | MMS → vision → reply pipeline (needs `REPLICATE_API_KEY`) |
| `client/src/lib/transformers/lazy-load.ts` | Transformers.js pipeline factory with IDB cache (LIVE) |
| `client/src/lib/transformers/language-detect.ts` | Browser-side language detect → Spanish toast trigger (LIVE) |
| `scripts/export-sms-corpus.ts` | JSONL SMS corpus export for NickGPT LoRA fine-tune |
| `docs/runbooks/nickgpt-finetune.md` | LoRA fine-tune runbook (Modal A10G, 4-bit quant, SFTTrainer) |
| `docs/eval-rubrics/huggingface-model-strategy.md` | 12-category HF deployment strategy |
| `docs/eval-rubrics/task-intelligence.md` + 7 others | Skill-audit framework doc ports (Waves AB–AM) |
