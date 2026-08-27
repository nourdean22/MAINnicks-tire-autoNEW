/**
 * POST /api/ai/speak — text-to-speech for chat narration.
 *
 * One sanitized speech span in, one mp3 out. The client's streaming
 * narration pipeline (features/chat-v2/lib/speech/) calls this per
 * sentence/segment as the assistant reply streams, so the operator
 * hears the first sentence while the rest is still generating.
 *
 * Two server-side adapters behind one contract (2026-08-27 bake-off):
 *   · openai — gpt-4o-mini-tts (~$0.015/min). Official, metered, key
 *     already funds Whisper/Realtime/embeddings. DEFAULT.
 *   · edge   — Microsoft Edge neural voices via edge-tts-universal.
 *     $0, but an UNOFFICIAL endpoint: zero marginal price is not
 *     guaranteed infrastructure — the 2026-08-27 bake-off proved it
 *     (@bestcodes/edge-tts 3.0.1 got a hard 403 from a residential
 *     IP; edge-tts-universal 1.4.0 worked, TTFA ~2.9s). The adapter
 *     isolates the protocol so when Microsoft changes it again,
 *     this file changes, not the UI.
 *
 * The requested/default engine is tried first, the other is the
 * fallback; `x-tts-engine` reports who ACTUALLY synthesized (never a
 * silent substitution). Client-side Web Speech remains the final
 * fallback when this route fails entirely.
 *
 * Body: { text: string (≤ MAX_TEXT_CHARS), engine?: "openai" | "edge" }
 * 200: audio/mpeg + x-tts-engine header · 400 bad input · 429 rate ·
 * 502 both adapters failed (diagnostic JSON, named per adapter)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Segments arrive per-sentence; anything huge is a client bug, reject loudly. */
const MAX_TEXT_CHARS = 1500;
/** Sentence-level narration needs headroom over RATE_LIMITS.ai (10/min):
 *  a long brief is 15+ segments. 60/min caps the cost-bomb path at
 *  ~$0.06/min worst case on the metered adapter. */
const SPEAK_RATE_LIMIT = { windowMs: 60_000, max: 60 };

type EngineName = "openai" | "edge";

const OPENAI_VOICE = process.env.TTS_OPENAI_VOICE || "ash";
const EDGE_VOICE = process.env.TTS_EDGE_VOICE || "en-US-AndrewMultilingualNeural";
const VOICE_INSTRUCTIONS =
  "Calm, direct, operator-briefing tone. Confident and efficient, like a trusted chief of staff reading a status update aloud.";

function defaultEngine(): EngineName {
  return process.env.TTS_ENGINE === "edge" ? "edge" : "openai";
}

async function synthOpenAI(text: string): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("no OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: OPENAI_VOICE,
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`openai tts ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.arrayBuffer();
}

async function synthEdge(text: string): Promise<ArrayBuffer> {
  // Dynamic import keeps the unofficial-protocol module out of the
  // route's cold-start path when the openai lane serves everything.
  const { Communicate } = await import("edge-tts-universal");
  const communicate = new Communicate(text, { voice: EDGE_VOICE });
  const chunks: Uint8Array[] = [];
  for await (const chunk of communicate.stream()) {
    if (chunk.type === "audio" && chunk.data) chunks.push(new Uint8Array(chunk.data));
  }
  if (chunks.length === 0) throw new Error("edge tts returned no audio");
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

const ADAPTERS: Record<EngineName, (text: string) => Promise<ArrayBuffer>> = {
  openai: synthOpenAI,
  edge: synthEdge,
};

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = checkRateLimit(`/api/ai/speak:${getClientIp(req)}`, SPEAK_RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "speak rate limit exceeded — try again in a minute" },
      { status: 429 },
    );
  }

  let text = "";
  let requested: EngineName | undefined;
  try {
    const body = (await req.json()) as { text?: unknown; engine?: unknown };
    if (typeof body.text === "string") text = body.text.trim();
    if (body.engine === "openai" || body.engine === "edge") requested = body.engine;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!text) return NextResponse.json({ error: "missing 'text'" }, { status: 400 });
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `text too long · max ${MAX_TEXT_CHARS} chars per segment` },
      { status: 400 },
    );
  }

  const primary = requested ?? defaultEngine();
  const order: EngineName[] = primary === "openai" ? ["openai", "edge"] : ["edge", "openai"];

  const failures: string[] = [];
  for (const engine of order) {
    try {
      const audio = await ADAPTERS[engine](text);
      return new Response(audio, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "cache-control": "no-store",
          "x-tts-engine": engine,
        },
      });
    } catch (err) {
      const detail = `${engine}: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`;
      // A single-adapter failure is invisible in a 200 fallback response —
      // the header names the substitute, this line names the reason.
      console.warn(`[tts] adapter failed · ${detail}`);
      failures.push(detail);
    }
  }

  return NextResponse.json(
    { error: "all TTS adapters failed", detail: failures },
    { status: 502 },
  );
}
