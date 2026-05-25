# Transformers.js · In-Browser AI

**Skill-port:** Category 9 of `apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md`
**Status:** scaffold ready · `@xenova/transformers` NOT yet in package.json (operator opts in)
**Wave:** AL
**Runbook:** `docs/runbooks/transformers-js-activation.md`

## What this is

ONNX-converted HF models that run in the customer's browser via `@xenova/transformers`. Zero server cost, instant UX, works offline-after-first-load.

Three browser-side wins documented:

1. **Language auto-detect** · pre-classify chat-widget input · auto-switch to Spanish replies
2. **Sentiment-tag contact form** · operator sees "this lead is frustrated" tag before they reply
3. **Tire-size OCR from photo upload** · "225/65R17" extracted in-browser before server roundtrip

This directory holds the **lazy-load utility** + **one example module** (language-detect). The other two are documented in the runbook · operator wires when ready.

## Activation order

1. **Read `docs/runbooks/transformers-js-activation.md`** · bundle size + UX tradeoffs
2. **Install** `pnpm --filter @nickstire/nickstire add @xenova/transformers` (only if you're activating · adds ~250KB to client lazy-bundle, not main)
3. **Wire** the example module in a single surface · validate UX is sub-100ms
4. **Roll out** to other surfaces as needed

## Files

- `lazy-load.ts` · dynamic import + first-use cache · all callers use this
- `language-detect.ts` · Spanish/English detector · 170MB model · loads once, caches forever
- (planned) `sentiment.ts` · frustration/positive detector on contact form
- (planned) `tire-size-ocr.ts` · OCR on tire-sidewall photos
