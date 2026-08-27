/**
 * POST /api/ai/transcribe · v10.0.420
 *
 * Voice-to-text endpoint for the chat composer mic button.
 *
 * Why this exists · `hooks/use-voice-input.ts` has been POSTing here
 * since at least v8.28 (April 29) but the route never existed. The
 * hook's `try { … } catch {}` silently swallowed every 404, so
 * operator saw "transcribing…" spin then disappear with no text.
 * The 7-day audit's voice-input check caught it.
 *
 * Strategy · one provider (2026-08-25 · the VideoDB fallback was removed:
 * it never worked in prod — $0 account, zero lifetime uploads — so the
 * "fallback" was a silent hop to a dead lane):
 *
 *   1. OpenAI Whisper (whisper-1 · ~1-3s on 5-15s clips · best accuracy)
 *      Used when OPENAI_API_KEY is set. The operator's stack has it
 *      per scripts/probe-env-config.ts. A whisper failure is a loud 502.
 *
 * Body (multipart/form-data):
 *   · audio: File/Blob   (matches the hook's `form.append("audio", blob)`)
 *
 * Response:
 *   · 200 { text, source, ms }
 *   · 400 if no audio provided · audio too large (≥25MB · Whisper limit)
 *   · 503 if no provider available
 *   · 500 with diagnostic on transcription failure
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { transcribeAudio } from "@/lib/ai/stt";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25MB upstream cap (all lanes)

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  // v10.0.529.3 D-1 fix · whisper-1 is a metered service ·
  // 10/min/IP caps the cost-bomb path where a runaway mic capture pushes
  // a clip per ~6s.
  const rateLimit = checkAiRateLimit(req);
  if (rateLimit) return rateLimit;

  const startedAt = Date.now();
  let blob: Blob | null = null;
  let filename = "voice.webm";

  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "missing 'audio' field (multipart Blob)" },
        { status: 400 },
      );
    }
    blob = audio;
    if (audio instanceof File && audio.name) filename = audio.name;
  } catch (err) {
    return NextResponse.json(
      { error: `parse failed: ${err instanceof Error ? err.message.slice(0, 100) : "unknown"}` },
      { status: 400 },
    );
  }

  if (!blob) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  if (blob.size > WHISPER_MAX_BYTES) {
    return NextResponse.json(
      { error: `audio too large · max ${WHISPER_MAX_BYTES / 1024 / 1024}MB` },
      { status: 400 },
    );
  }
  if (blob.size < 800) {
    // Tap-and-release with no audio · don't waste a transcription call
    return NextResponse.json({ text: "", source: "skipped", ms: 0 });
  }

  // 2026-08-27 · OPENAI_API_KEY revoked in prod (live-probed 401) killed
  // the whisper-only lane. Free-first chain: groq (when its no-card key
  // is set) -> hf (key live, lane LIVE-PROVEN) -> openai (self-heals on
  // rotation). `source` names the lane that ACTUALLY transcribed;
  // `degraded` is true when an earlier configured lane failed first —
  // the client surfaces that instead of degrading silently.
  try {
    const result = await transcribeAudio(blob, filename);
    return NextResponse.json({
      text: result.text,
      source: result.engine,
      degraded: result.degraded,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    // Every configured lane failed (or none configured) — loud, with
    // per-lane reasons. Never a silent hop, never a fake success.
    return NextResponse.json(
      { error: `transcription failed: ${err instanceof Error ? err.message.slice(0, 300) : "unknown"}` },
      { status: 502 },
    );
  }
}

// Auth: handler above invokes requireSession on first line.
export const POST = withTracing(handler, { name: "/api/ai/transcribe" });
