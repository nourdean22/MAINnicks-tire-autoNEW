/**
 * Speech-to-text with a free-first provider chain — the OPENAI_API_KEY
 * revocation (2026-08-27, live-probed: whisper 401) killed the mic and
 * audio-drop lanes, and the operator's standing rule is "free with no
 * card on file beats everything."
 *
 * Chain, in order:
 *   1. groq — whisper-large-v3-turbo. No-card free tier: 20 req/min,
 *      2,000 req/day, 8h audio/day (vs the mic's 5-15s clips). BEST
 *      quality + latency; OpenAI-compatible endpoint. Activates the
 *      moment GROQ_API_KEY lands in the env — dormant until then.
 *   2. hf — HuggingFace serverless whisper-large-v3. Key already in
 *      prod; LIVE-PROVEN 2026-08-27: perfect transcript of a known
 *      sample in 1,323ms. Monthly credit quota unmeasured — which is
 *      why groq outranks it once configured.
 *   3. openai — whisper-1. Key currently REVOKED (fails fast, 401);
 *      kept last so the lane self-heals if a key is ever rotated in.
 *
 * KEY PRESENCE IS NOT KEY VALIDITY (the finding that created this
 * file): a lane is skipped only when its key is ABSENT; a present-but-
 * dead key fails at call time, logs, and falls through to the next
 * lane. `engine` in the result names who actually transcribed —
 * the same honesty contract as the TTS x-tts-engine header.
 */

export interface SttSegment {
  start: number;
  end: number;
  text: string;
}

export interface SttResult {
  text: string;
  /** Which lane actually transcribed — never inferred, never silent. */
  engine: "groq" | "hf" | "openai";
  /** Timed segments when the lane provides them (groq/openai verbose_json). */
  segments: SttSegment[] | null;
  /** True when a lane EARLIER in the configured chain failed first. */
  degraded: boolean;
  /** Failure detail per attempted lane, for the 502 path and logs. */
  failures: string[];
}

const cleanKey = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

interface WhisperVerboseResponse {
  text?: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
}

function parseSegments(data: WhisperVerboseResponse): SttSegment[] | null {
  if (!Array.isArray(data.segments)) return null;
  const segments = data.segments
    .map((s) => ({
      start: typeof s.start === "number" ? s.start : 0,
      end: typeof s.end === "number" ? s.end : 0,
      text: typeof s.text === "string" ? s.text.trim() : "",
    }))
    .filter((s) => s.text);
  return segments.length > 0 ? segments : null;
}

/** groq + openai share the OpenAI wire format — one adapter, two hosts. */
async function transcribeOpenAiCompatible(args: {
  url: string;
  apiKey: string;
  model: string;
  blob: Blob;
  filename: string;
}): Promise<{ text: string; segments: SttSegment[] | null }> {
  const form = new FormData();
  form.append("file", args.blob, args.filename);
  form.append("model", args.model);
  form.append("response_format", "verbose_json");
  const res = await fetch(args.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as WhisperVerboseResponse;
  return { text: (data.text ?? "").trim(), segments: parseSegments(data) };
}

async function transcribeHf(blob: Blob): Promise<{ text: string; segments: null }> {
  const apiKey = cleanKey(process.env.HF_API_KEY) ?? cleanKey(process.env.HUGGINGFACE_API_KEY);
  if (!apiKey) throw new Error("no HF key");
  const res = await fetch(
    "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": blob.type || "audio/mpeg",
      },
      body: blob,
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as { text?: string };
  return { text: (data.text ?? "").trim(), segments: null };
}

type LaneName = SttResult["engine"];

interface Lane {
  name: LaneName;
  /** Absent key = lane not configured = skipped silently (that IS the config). */
  configured: () => boolean;
  run: (blob: Blob, filename: string) => Promise<{ text: string; segments: SttSegment[] | null }>;
}

const LANES: Lane[] = [
  {
    name: "groq",
    configured: () => Boolean(cleanKey(process.env.GROQ_API_KEY)),
    run: (blob, filename) =>
      transcribeOpenAiCompatible({
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        apiKey: cleanKey(process.env.GROQ_API_KEY)!,
        model: "whisper-large-v3-turbo",
        blob,
        filename,
      }),
  },
  {
    name: "hf",
    configured: () =>
      Boolean(cleanKey(process.env.HF_API_KEY) ?? cleanKey(process.env.HUGGINGFACE_API_KEY)),
    run: (blob) => transcribeHf(blob),
  },
  {
    name: "openai",
    configured: () => Boolean(cleanKey(process.env.OPENAI_API_KEY)),
    run: (blob, filename) =>
      transcribeOpenAiCompatible({
        url: "https://api.openai.com/v1/audio/transcriptions",
        apiKey: cleanKey(process.env.OPENAI_API_KEY)!,
        model: "whisper-1",
        blob,
        filename,
      }),
  },
];

/**
 * Transcribe through the chain. Resolves with the first lane that
 * produces text; throws only when EVERY configured lane failed (the
 * error message carries per-lane detail so the 502 names each reason).
 */
export async function transcribeAudio(blob: Blob, filename: string): Promise<SttResult> {
  const failures: string[] = [];
  let attempted = 0;
  for (const lane of LANES) {
    if (!lane.configured()) continue;
    attempted++;
    try {
      const { text, segments } = await lane.run(blob, filename);
      return {
        text,
        engine: lane.name,
        segments,
        degraded: failures.length > 0,
        failures,
      };
    } catch (err) {
      const detail = `${lane.name}: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`;
      console.warn(`[stt] lane failed · ${detail}`);
      failures.push(detail);
    }
  }
  throw new Error(
    attempted === 0
      ? "no STT lane configured (set GROQ_API_KEY, HF_API_KEY, or OPENAI_API_KEY)"
      : `all STT lanes failed · ${failures.join(" · ")}`,
  );
}
