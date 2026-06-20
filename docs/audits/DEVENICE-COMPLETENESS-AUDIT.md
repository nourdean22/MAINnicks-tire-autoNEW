# Devenice Completeness Audit

This document records the results of the completeness sweep for Venice provider retirement across both the `statenour` and `nickstire` applications.

---

## [must-fix] Findings

These are active runtime configurations, services, or APIs that must be updated/removed to ensure no service disruption and to eliminate Venice references:

### `statenour` Application

1. **[apps/statenour/lib/env.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/env.ts#L48)**
   * **Finding:** `VENICE_API_KEY` is documented as a runtime secret (line 48) and included in the `aiKeys` array (line 125) which determines if at least one AI provider is configured.
   * **Recommendation:** Remove `VENICE_API_KEY` from `ENV_SPEC` and `aiKeys`. Update the `AI_PROVIDER` description (line 74) to omit `venice`.

2. **[apps/statenour/lib/integrations/registry.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/integrations/registry.ts#L55)**
   * **Finding:** Venice AI is registered inside the core `TOOLS` array.
   * **Recommendation:** Remove the Venice integration registry entry entirely.

3. **[apps/statenour/lib/services/tools-health.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/services/tools-health.ts#L77-L86)**
   * **Finding:** The `ai` category dependency check (line 86) checks `["VENICE_API_KEY"]` exclusively to assess AI health. If this key is missing/removed, the tool arsenal displays as degraded/down.
   * **Recommendation:** Update the dependency check to probe the active runtime providers (e.g. `process.env.GEMINI_API_KEY` or `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

4. **[apps/statenour/app/api/tools/health/route.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/api/tools/health/route.ts#L37-L41)**
   * **Finding:** The REST route for tool health also checks `["VENICE_API_KEY"]` exclusively for the `ai` category.
   * **Recommendation:** Update this in sync with the `tools-health` service.

5. **[apps/statenour/lib/ai/tools/meta.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/ai/tools/meta.ts#L131)**
   * **Finding:** The `toolHealth` execute method checks `!!process.env.VENICE_API_KEY`.
   * **Recommendation:** Remove the Venice check or replace it with the new active providers.

6. **[apps/statenour/lib/services/system-pages.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/services/system-pages.ts)**
   * **Finding:** 
     * Line 1141: `supportsTools` checks if the model is `"venice-uncensored"` to determine if it supports tools.
     * Line 1502: `DEPLOYMENT_SECRET_CHECKS` checks `VENICE_API_KEY` as a critical secret.
   * **Recommendation:** Remove `"venice-uncensored"` check and remove/de-escalate `VENICE_API_KEY` from `DEPLOYMENT_SECRET_CHECKS`.

7. **[apps/statenour/lib/services/system-data.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/services/system-data.ts#L293-L318)**
   * **Finding:** `probeVenice` actively queries `https://api.venice.ai/api/v1/api_keys/rate_limits`. `buildIntegrationQuotas` runs it in `Promise.all`.
   * **Recommendation:** Remove `probeVenice` from the probes list. Since it was the only checked metered integration, let `buildIntegrationQuotas` return an empty array or probe a different metered provider.

8. **[apps/statenour/lib/brain/knowledge-sync.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/brain/knowledge-sync.ts#L30-L102)**
   * **Finding:** Direct fetch integration to Venice via `callVeniceOnce` / `callVenice` which throws if `process.env.VENICE_API_KEY` is missing.
   * **Recommendation:** Migrate the knowledge extractor to use a supported provider (like Gemini, OpenAI, or Anthropic via the standard `aiChat` or a direct fetch wrapper to their respective endpoints).

9. **[apps/statenour/app/api/telegram/webhook/route.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/api/telegram/webhook/route.ts#L879-L925)**
   * **Finding:** The `/api/telegram/webhook` handler directly attempts to call the Venice vision model (`qwen3-vl-235b-a22b`) for multimodal photo inputs.
   * **Recommendation:** Remove the Venice block and fall back to Anthropic or Gemini (which natively support vision features).

### `nickstire` Application

10. **[apps/nickstire/server/lib/ai-gateway.ts](file:///C:/Users/nourd/NOURCITY/apps/nickstire/server/lib/ai-gateway.ts#L247)**
    * **Finding:** `dailyStats` retains a `venice` count field (lines 247, 268, 288-290). It is dead/never incremented but lingers in the type and serialization.
    * **Recommendation:** Clean up the `venice` field from `DailyStats` type definition and initialization.

---

## [nice] Findings

These are non-blocking items, scripts, utility files, or inline comments that mention Venice:

1. **[apps/statenour/scripts/probe-provider-health.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/probe-provider-health.ts)**
   * **Finding:** Checks and prints Venice key presence and quota exhaustion status.
   * **Recommendation:** Remove Venice references.
2. **[apps/statenour/scripts/probe-providers-direct.mjs](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/probe-providers-direct.mjs)**
   * **Finding:** Checks Venice direct API connections.
   * **Recommendation:** Remove Venice check block.
3. **[apps/statenour/scripts/probe-venice-suggestions.mjs](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/probe-venice-suggestions.mjs)**
   * **Finding:** Venice-specific suggestion testing utility.
   * **Recommendation:** Delete the file as it is fully obsolete.
4. **[apps/statenour/scripts/backfill-conversation-archives.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/backfill-conversation-archives.ts#L29)**
   * **Finding:** Mentions Venice in comment (line 29) and hardcodes `model: "venice-bge-m3"` (line 187) during `VectorEmbedding` creation.
   * **Recommendation:** Update the comment and write the correct active embedding model to the database.
5. **[apps/statenour/hooks/use-offline-queue.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/hooks/use-offline-queue.ts#L7)**
   * **Finding:** Comment references Venice timeout.
   * **Recommendation:** Change `Venice` to `the AI provider` or similar generic phrasing.
6. **[apps/statenour/hooks/use-stall-detection.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/hooks/use-stall-detection.ts#L6)**
   * **Finding:** Comment references Venice timeout.
   * **Recommendation:** Update comment.

---

## [exempt-archive] Findings

These files contain historical, retired, or archived information and are intentionally exempt from modifications:

1. **[apps/statenour/docs/archive/historical-v7/MASTER-CONTEXT-v7-alpha-HISTORICAL-DO-NOT-EXECUTE.md](file:///C:/Users/nourd/NOURCITY/apps/statenour/docs/archive/historical-v7/MASTER-CONTEXT-v7-alpha-HISTORICAL-DO-NOT-EXECUTE.md)**
   * Contains legacy context variables.
2. **[docs/MIGRATION_AUDIT.md](file:///C:/Users/nourd/NOURCITY/docs/MIGRATION_AUDIT.md)**, **[docs/MIGRATION_PLAN.md](file:///C:/Users/nourd/NOURCITY/docs/MIGRATION_PLAN.md)**, **[docs/WAVE-200-PLAN.md](file:///C:/Users/nourd/NOURCITY/docs/WAVE-200-PLAN.md)**
   * Architectural plans tracking past history.

---

## Design Validation Findings

We verified the Vercel AI SDK v6 specifications for `useChat` custom transports and provider overrides:

1. **Custom Transport Interception:** Intercepting headers using a wrapper in `DefaultChatTransport.fetch` matches the SDK-blessed pattern for custom stream preprocessing or header sniffing. Returning a custom `ReadableStream` from `fetch` is a standard way to parse SSE events before they hit the SDK's consumer layer.
2. **First-Class Provider Switch:** Vercel AI SDK v6 does not expose a first-class UI provider-switching API on the client. Our design using `forceProviderFirst` passed inside the request body represents the standard, robust way to drive routing decisions on the server.
3. **SSE Decode/Parse Error Handling:** Custom chunk decoding and SSE parsing match current standard stream consumption patterns. No new client-side SDK features replace this interception layer since `useChat` relies on a flat `Response` object returned from `fetch`.
