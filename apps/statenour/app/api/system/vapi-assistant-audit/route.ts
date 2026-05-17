/**
 * GET /api/system/vapi-assistant-audit · v10.0.524 · #5 voice tune
 *
 * Reads each assistant's current config from VAPI and emits a
 * latency-tune audit. Read-only.
 *
 * Returns:
 *   {
 *     count: number,
 *     assistants: [{
 *       id, name,
 *       stt: { provider, model, recommendation },
 *       tts: { provider, model, recommendation },
 *       llm: { provider, model, temp, recommendation },
 *       timing: { silenceTimeoutSeconds, responseDelaySeconds, ... },
 *       findings: string[],
 *       grade: "A" | "B" | "C" | "D" | "F"
 *     }, ...]
 *   }
 *
 * Owner-gated. Used by the operator's voice tune workflow before
 * applying PATCH via apply-vapi-latency-tune script.
 */

import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface VapiAssistant {
  id: string;
  name?: string | null;
  transcriber?: { provider?: string; model?: string };
  voice?: { provider?: string; voiceId?: string; model?: string };
  model?: { provider?: string; model?: string; temperature?: number };
  silenceTimeoutSeconds?: number;
  responseDelaySeconds?: number;
  llmRequestDelaySeconds?: number;
  numWordsToInterruptAssistant?: number;
}

async function vapiGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`VAPI ${path} → ${res.status}`);
  }
  return res.json();
}

interface AssistantAudit {
  id: string;
  name: string;
  stt: { provider: string; model: string; verdict: "ok" | "tune"; note: string };
  tts: { provider: string; model: string; verdict: "ok" | "tune"; note: string };
  llm: { provider: string; model: string; temp: number | null; verdict: "ok" | "tune"; note: string };
  timing: {
    silenceTimeoutSeconds: number | null;
    responseDelaySeconds: number | null;
    llmRequestDelaySeconds: number | null;
    numWordsToInterruptAssistant: number | null;
  };
  findings: string[];
  grade: "A" | "B" | "C" | "D" | "F";
}

function auditOne(full: VapiAssistant): AssistantAudit {
  const findings: string[] = [];

  // STT
  const sttProv = (full.transcriber?.provider ?? "unknown").toLowerCase();
  const sttModel = full.transcriber?.model ?? "unknown";
  let stt: AssistantAudit["stt"] = {
    provider: sttProv,
    model: sttModel,
    verdict: "ok",
    note: "",
  };
  if (sttProv === "deepgram" && /nova-?3/i.test(sttModel)) {
    stt.note = "Deepgram Nova-3 · 150-184ms TTFT · 54% lower WER vs Whisper.";
  } else if (sttProv === "openai" || /whisper/i.test(sttModel)) {
    stt.verdict = "tune";
    stt.note = "Whisper is slow (500ms+ TTFT). Switch to deepgram/nova-3 (-300ms).";
    findings.push(`STT: ${sttProv}/${sttModel} → deepgram/nova-3 (-300ms)`);
  } else {
    stt.verdict = "tune";
    stt.note = `Review ${sttProv}/${sttModel}. Target deepgram/nova-3 for <200ms TTFT.`;
    findings.push(`STT: review ${sttProv}/${sttModel}`);
  }

  // TTS
  const ttsProv = (full.voice?.provider ?? "unknown").toLowerCase();
  const ttsModel = full.voice?.model ?? "unknown";
  let tts: AssistantAudit["tts"] = {
    provider: ttsProv,
    model: ttsModel,
    verdict: "ok",
    note: "",
  };
  if ((ttsProv === "11labs" || ttsProv === "elevenlabs")) {
    if (/flash.*v?2.?5|eleven_flash_v2_5/i.test(ttsModel)) {
      tts.note = "ElevenLabs Flash v2.5 · 75ms TTFA · current best.";
    } else {
      tts.verdict = "tune";
      tts.note = `Switch ${ttsModel} → eleven_flash_v2_5 (-150-300ms TTFA · biggest single win).`;
      findings.push(`TTS: ${ttsModel} → eleven_flash_v2_5 (-200ms)`);
    }
  } else if (ttsProv === "openai") {
    tts.verdict = "tune";
    tts.note = "Switch openai → 11labs/eleven_flash_v2_5 (-200ms · biggest single win).";
    findings.push(`TTS: openai → 11labs/eleven_flash_v2_5 (-200ms)`);
  } else if (ttsProv === "cartesia") {
    tts.note = "Cartesia · ~90ms TTFA · acceptable. ElevenLabs flash gives emotional range.";
  } else {
    tts.verdict = "tune";
    tts.note = `Review ${ttsProv}/${ttsModel}. Target 11labs/eleven_flash_v2_5.`;
    findings.push(`TTS: review ${ttsProv}/${ttsModel}`);
  }

  // LLM
  const llmProv = (full.model?.provider ?? "unknown").toLowerCase();
  const llmModel = full.model?.model ?? "unknown";
  const temp = full.model?.temperature ?? null;
  let llm: AssistantAudit["llm"] = {
    provider: llmProv,
    model: llmModel,
    temp,
    verdict: "ok",
    note: "",
  };
  if (llmProv === "groq") {
    llm.note = "Groq · fastest TTFT (~100ms).";
  } else if (llmProv === "openai" && /gpt-4o-mini|gpt-4o-realtime/i.test(llmModel)) {
    llm.note = `${llmModel} · TTFT ~150-250ms · solid.`;
  } else if (/gemini.*flash/i.test(llmModel)) {
    llm.note = "Gemini Flash · TTFT 150-300ms · acceptable.";
  } else {
    llm.verdict = "tune";
    llm.note = `${llmProv}/${llmModel} · consider groq llama-3.1-70b (100ms) or gpt-4o-mini (150ms).`;
    findings.push(`LLM: ${llmProv}/${llmModel} · consider faster TTFT model`);
  }

  // Timing
  const timing = {
    silenceTimeoutSeconds: full.silenceTimeoutSeconds ?? null,
    responseDelaySeconds: full.responseDelaySeconds ?? null,
    llmRequestDelaySeconds: full.llmRequestDelaySeconds ?? null,
    numWordsToInterruptAssistant: full.numWordsToInterruptAssistant ?? null,
  };
  if (timing.silenceTimeoutSeconds != null && timing.silenceTimeoutSeconds > 0.5) {
    findings.push(
      `Timing: silenceTimeoutSeconds=${timing.silenceTimeoutSeconds} > 0.5 · target 0.3-0.5s for natural turn-taking`,
    );
  }
  if (timing.responseDelaySeconds != null && timing.responseDelaySeconds > 0.2) {
    findings.push(
      `Timing: responseDelaySeconds=${timing.responseDelaySeconds} adds ${(timing.responseDelaySeconds * 1000).toFixed(0)}ms · target ≤ 0.2s`,
    );
  }

  // Grade
  let grade: AssistantAudit["grade"] = "A";
  if (findings.length === 1) grade = "B";
  else if (findings.length === 2) grade = "C";
  else if (findings.length === 3) grade = "D";
  else if (findings.length >= 4) grade = "F";

  return {
    id: full.id,
    name: full.name ?? "(unnamed)",
    stt,
    tts,
    llm,
    timing,
    findings,
    grade,
  };
}

export const GET = apiHandler(
  async () => {
    const apiKey = (process.env.VAPI_API_KEY ?? "").trim();
    if (!apiKey) {
      return {
        ok: false,
        error: "VAPI_API_KEY not configured in env",
        assistants: [],
        count: 0,
      };
    }

    const list = (await vapiGet("/assistant", apiKey)) as VapiAssistant[];
    if (!Array.isArray(list)) {
      return { ok: false, error: "VAPI list returned non-array", assistants: [], count: 0 };
    }

    // For each assistant fetch the full config and audit it.
    const results: AssistantAudit[] = [];
    for (const stub of list) {
      try {
        const full = (await vapiGet(`/assistant/${stub.id}`, apiKey)) as VapiAssistant;
        results.push(auditOne(full));
      } catch (err) {
        results.push({
          id: stub.id,
          name: stub.name ?? "(unnamed)",
          stt: { provider: "unknown", model: "unknown", verdict: "tune", note: `fetch failed: ${err instanceof Error ? err.message : String(err)}` },
          tts: { provider: "unknown", model: "unknown", verdict: "tune", note: "" },
          llm: { provider: "unknown", model: "unknown", temp: null, verdict: "tune", note: "" },
          timing: { silenceTimeoutSeconds: null, responseDelaySeconds: null, llmRequestDelaySeconds: null, numWordsToInterruptAssistant: null },
          findings: ["Fetch failed"],
          grade: "F",
        });
      }
    }

    return {
      ok: true,
      count: results.length,
      assistants: results,
    };
  },
  { auth: "owner" },
);
