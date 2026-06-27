export {};
/**
 * v10.0.524 · #5 voice latency tune · LIVE audit via VAPI API.
 *
 * Lists assistants on the operator's VAPI account, fetches "Nick"
 * config, and emits an audit report identifying latency-tune
 * candidates across the 5 layers (VAD / STT / LLM / TTS / audio).
 *
 * Read-only · does NOT patch the assistant. If the operator
 * approves, a sibling script `apply-vapi-latency-tune.ts` does
 * the actual PATCH via VAPI's REST API.
 *
 * Run: `pnpm tsx scripts/audit-vapi-assistant.ts`
 * Needs: VAPI_API_KEY env var (already set in prod per the
 *        provider-health probe).
 */

const VAPI_API_KEY = (process.env.VAPI_API_KEY ?? "").trim();
const VAPI_BASE = "https://api.vapi.ai";

if (!VAPI_API_KEY) {
  console.error("[!] VAPI_API_KEY not set. Aborting.");
  process.exit(1);
}

interface VapiAssistant {
  id: string;
  name?: string | null;
  transcriber?: { provider?: string; model?: string; language?: string };
  voice?: { provider?: string; voiceId?: string; model?: string };
  model?: { provider?: string; model?: string; temperature?: number };
  silenceTimeoutSeconds?: number;
  responseDelaySeconds?: number;
  llmRequestDelaySeconds?: number;
  numWordsToInterruptAssistant?: number;
  voicemailDetection?: unknown;
}

async function vapiGet(path: string): Promise<unknown> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`VAPI ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

async function main() {
  console.log("\n🔍 VAPI assistant audit · v10.0.524 #5 voice latency\n");

  const assistants = (await vapiGet("/assistant")) as VapiAssistant[];
  if (!Array.isArray(assistants) || assistants.length === 0) {
    console.error("[!] No assistants returned. Check VAPI_API_KEY.");
    process.exit(1);
  }

  console.log(`Found ${assistants.length} assistant${assistants.length === 1 ? "" : "s"}:\n`);
  for (const a of assistants) {
    console.log(`  · ${a.name ?? "(unnamed)"} · id=${a.id}`);
  }
  console.log("");

  // Audit each assistant.
  for (const stub of assistants) {
    const full = (await vapiGet(`/assistant/${stub.id}`)) as VapiAssistant;
    const name = full.name ?? "(unnamed)";
    console.log(`━━━ ${name} ━━━`);

    const findings: string[] = [];

    // 1. Transcriber (STT)
    const sttProv = full.transcriber?.provider ?? "unknown";
    const sttModel = full.transcriber?.model ?? "unknown";
    console.log(`STT  · ${sttProv} / ${sttModel}`);
    if (sttProv === "deepgram" && /nova-?3/i.test(sttModel)) {
      console.log(`     ✅ Deepgram Nova-3 (150-184ms TTFT · 54% lower WER vs Whisper)`);
    } else if (sttProv === "openai" || /whisper/i.test(sttModel)) {
      findings.push(`STT: switch ${sttProv}/${sttModel} → deepgram/nova-3 · expected -300ms TTFT`);
    } else {
      findings.push(`STT: review ${sttProv}/${sttModel} · target deepgram/nova-3 for <200ms TTFT`);
    }

    // 2. TTS (voice)
    const ttsProv = full.voice?.provider ?? "unknown";
    const ttsModel = full.voice?.model ?? "unknown";
    console.log(`TTS  · ${ttsProv} / ${ttsModel}`);
    if (ttsProv === "11labs" || ttsProv === "elevenlabs") {
      if (/flash.*v?2.?5|eleven_flash_v2_5/i.test(ttsModel)) {
        console.log(`     ✅ ElevenLabs Flash v2.5 (75ms TTFA · current best)`);
      } else {
        findings.push(
          `TTS: switch ${ttsModel} → eleven_flash_v2_5 · expected -150-300ms TTFA (biggest single win)`,
        );
      }
    } else if (ttsProv === "openai") {
      findings.push(
        `TTS: switch openai → 11labs/eleven_flash_v2_5 · expected -200ms TTFA (biggest single win)`,
      );
    } else if (ttsProv === "cartesia") {
      console.log(`     ⚠️  Cartesia · ~90ms TTFA · acceptable. Consider 11labs flash for emotional range.`);
    } else {
      findings.push(`TTS: review ${ttsProv}/${ttsModel} · target 11labs/eleven_flash_v2_5`);
    }

    // 3. LLM
    const llmProv = full.model?.provider ?? "unknown";
    const llmModel = full.model?.model ?? "unknown";
    const temp = full.model?.temperature;
    console.log(`LLM  · ${llmProv} / ${llmModel}${temp != null ? ` · temp=${temp}` : ""}`);
    if (llmProv === "groq") {
      console.log(`     ✅ Groq · fastest TTFT (~100ms)`);
    } else if (
      llmProv === "openai" &&
      (/gpt-4o-mini|gpt-4o-realtime/i.test(llmModel))
    ) {
      console.log(`     ✅ ${llmModel} · TTFT ~150-250ms · solid`);
    } else if (/gemini.*flash/i.test(llmModel)) {
      console.log(`     ✅ Gemini Flash · TTFT 150-300ms · acceptable`);
    } else {
      findings.push(
        `LLM: ${llmProv}/${llmModel} · consider groq llama-3.1-70b (100ms TTFT) or gpt-4o-mini (150ms)`,
      );
    }

    // 4. Response/silence timing
    const silenceTimeout = full.silenceTimeoutSeconds;
    const respDelay = full.responseDelaySeconds;
    const llmReqDelay = full.llmRequestDelaySeconds;
    const interruptThreshold = full.numWordsToInterruptAssistant;

    console.log(`Timing · silenceTimeout=${silenceTimeout}s · responseDelay=${respDelay}s · llmReqDelay=${llmReqDelay}s · interruptAt=${interruptThreshold}w`);

    if (typeof silenceTimeout === "number" && silenceTimeout > 0.5) {
      findings.push(
        `Timing: silenceTimeoutSeconds=${silenceTimeout} is too long for natural turn-taking · target 0.3-0.5s`,
      );
    }
    if (typeof respDelay === "number" && respDelay > 0.2) {
      findings.push(
        `Timing: responseDelaySeconds=${respDelay} adds ${(respDelay * 1000).toFixed(0)}ms before assistant speaks · target 0.0-0.2s`,
      );
    }

    console.log("");
    if (findings.length === 0) {
      console.log(`  🟢 No latency tune candidates · this assistant is well-configured.\n`);
    } else {
      console.log(`  ⚠️  ${findings.length} tune candidate${findings.length === 1 ? "" : "s"}:\n`);
      for (const f of findings) console.log(`  · ${f}`);
      console.log("");
    }
  }

  console.log("Read-only audit complete. To apply the recommended tunes,");
  console.log("run: pnpm tsx scripts/apply-vapi-latency-tune.ts <assistantId>");
  console.log("(operator review the diff first · the tune script will dry-run by default)\n");
}

main().catch((err) => {
  console.error("[!] Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
