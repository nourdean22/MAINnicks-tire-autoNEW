/**
 * POST /api/system/vapi-assistant-tune · v10.0.524 · #5 voice tune APPLY
 *
 * Applies the 3 high-impact latency tunes identified by the audit:
 *   1. TTS model → eleven_flash_v2_5 (-200ms TTFA)
 *   2. LLM model gpt-4o → gpt-4o-mini (-150ms TTFT)
 *   3. responseDelaySeconds → 0 (-250ms)
 *
 * Body:
 *   { dryRun?: boolean (default true), assistantIds?: string[] (default all) }
 *
 * Returns:
 *   { results: [{ id, name, before, after, applied: boolean, error? }] }
 *
 * Owner-gated. Idempotent — re-running PATCH with the same values
 * is a no-op on VAPI's side.
 *
 * Safety: dryRun default is TRUE. Operator must explicitly pass
 * dryRun=false to commit.
 */

import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface VapiAssistant {
  id: string;
  name?: string | null;
  voice?: { provider?: string; voiceId?: string; model?: string };
  model?: { provider?: string; model?: string; temperature?: number };
  responseDelaySeconds?: number;
}

interface TuneResult {
  id: string;
  name: string;
  before: { ttsModel: string | null; llmModel: string | null; responseDelay: number | null };
  after: { ttsModel: string | null; llmModel: string | null; responseDelay: number | null };
  diff: string[];
  applied: boolean;
  dryRun: boolean;
  error?: string;
}

async function vapiGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`VAPI GET ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

async function vapiPatch(path: string, body: unknown, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`VAPI PATCH ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

interface ApplyBody {
  dryRun?: boolean;
  assistantIds?: string[];
}

export const POST = apiHandler(
  async (req) => {
    const apiKey = (process.env.VAPI_API_KEY ?? "").trim();
    if (!apiKey) {
      return { ok: false, error: "VAPI_API_KEY not configured", results: [] };
    }

    let body: ApplyBody = {};
    try {
      body = (await req.json()) as ApplyBody;
    } catch {
      body = {};
    }
    const dryRun = body.dryRun !== false; // default TRUE for safety
    const filter = body.assistantIds && body.assistantIds.length > 0 ? new Set(body.assistantIds) : null;

    const list = (await vapiGet("/assistant", apiKey)) as VapiAssistant[];
    const targets = list.filter((a) => !filter || filter.has(a.id));

    const results: TuneResult[] = [];

    for (const stub of targets) {
      try {
        const full = (await vapiGet(`/assistant/${stub.id}`, apiKey)) as VapiAssistant;

        const beforeTts = full.voice?.model ?? null;
        const beforeLlm = full.model?.model ?? null;
        const beforeDelay = full.responseDelaySeconds ?? null;

        // Build the PATCH payload — only include fields that change.
        const patchVoice: Record<string, unknown> = {};
        const patchModel: Record<string, unknown> = {};
        const diff: string[] = [];

        // 1. TTS · target eleven_flash_v2_5
        if (
          beforeTts &&
          /^eleven_(multilingual_v2|turbo_v2_5|monolingual_v1|english_sts_v2|v2|v2_5)$/i.test(beforeTts) &&
          beforeTts !== "eleven_flash_v2_5"
        ) {
          patchVoice.provider = full.voice?.provider ?? "11labs";
          patchVoice.voiceId = full.voice?.voiceId;
          patchVoice.model = "eleven_flash_v2_5";
          diff.push(`voice.model: ${beforeTts} → eleven_flash_v2_5`);
        }

        // 2. LLM · gpt-4o → gpt-4o-mini
        if (beforeLlm === "gpt-4o") {
          patchModel.provider = full.model?.provider ?? "openai";
          patchModel.model = "gpt-4o-mini";
          if (full.model?.temperature != null) patchModel.temperature = full.model.temperature;
          diff.push(`model.model: gpt-4o → gpt-4o-mini`);
        }

        // 3. responseDelaySeconds · 0.25 → 0
        const patchBody: Record<string, unknown> = {};
        if (typeof beforeDelay === "number" && beforeDelay > 0) {
          patchBody.responseDelaySeconds = 0;
          diff.push(`responseDelaySeconds: ${beforeDelay} → 0`);
        }
        if (Object.keys(patchVoice).length > 0) patchBody.voice = patchVoice;
        if (Object.keys(patchModel).length > 0) patchBody.model = patchModel;

        if (diff.length === 0) {
          results.push({
            id: stub.id,
            name: stub.name ?? "(unnamed)",
            before: { ttsModel: beforeTts, llmModel: beforeLlm, responseDelay: beforeDelay },
            after: { ttsModel: beforeTts, llmModel: beforeLlm, responseDelay: beforeDelay },
            diff: [],
            applied: false,
            dryRun,
          });
          continue;
        }

        if (dryRun) {
          // Compute the would-be after state for display.
          results.push({
            id: stub.id,
            name: stub.name ?? "(unnamed)",
            before: { ttsModel: beforeTts, llmModel: beforeLlm, responseDelay: beforeDelay },
            after: {
              ttsModel: (patchVoice.model as string | undefined) ?? beforeTts,
              llmModel: (patchModel.model as string | undefined) ?? beforeLlm,
              responseDelay: (patchBody.responseDelaySeconds as number | undefined) ?? beforeDelay,
            },
            diff,
            applied: false,
            dryRun: true,
          });
          continue;
        }

        // LIVE PATCH
        const patched = (await vapiPatch(`/assistant/${stub.id}`, patchBody, apiKey)) as VapiAssistant;
        results.push({
          id: stub.id,
          name: stub.name ?? "(unnamed)",
          before: { ttsModel: beforeTts, llmModel: beforeLlm, responseDelay: beforeDelay },
          after: {
            ttsModel: patched.voice?.model ?? beforeTts,
            llmModel: patched.model?.model ?? beforeLlm,
            responseDelay: patched.responseDelaySeconds ?? beforeDelay,
          },
          diff,
          applied: true,
          dryRun: false,
        });
      } catch (err) {
        results.push({
          id: stub.id,
          name: stub.name ?? "(unnamed)",
          before: { ttsModel: null, llmModel: null, responseDelay: null },
          after: { ttsModel: null, llmModel: null, responseDelay: null },
          diff: [],
          applied: false,
          dryRun,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      dryRun,
      count: results.length,
      results,
    };
  },
  { auth: "owner" },
);
