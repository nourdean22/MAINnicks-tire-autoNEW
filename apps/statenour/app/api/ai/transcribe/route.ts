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
 * Strategy · two providers, fastest-first:
 *
 *   1. OpenAI Whisper (whisper-1 · ~1-3s on 5-15s clips · best accuracy)
 *      Used when OPENAI_API_KEY is set. The operator's stack has it
 *      per scripts/probe-env-config.ts.
 *
 *   2. VideoDB (transcribeAudio helper · 20-60s on short clips · the
 *      file-drop /api/ai/chat/audio-transcribe path is built on this)
 *      Fallback when OpenAI key missing or Whisper fails.
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
import { checkAiRateLimit } from "@/lib/rate-limit";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25MB OpenAI limit
const VIDEODB_MAX_BYTES = 50 * 1024 * 1024; // 50MB our internal cap

async function transcribeViaWhisper(
  blob: Blob,
  filename: string,
): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("no OPENAI_API_KEY");

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`whisper ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string };
  return { text: (data.text ?? "").trim() };
}

async function transcribeViaVideoDB(
  blob: Blob,
  filename: string,
): Promise<{ text: string }> {
  if (!process.env.VIDEO_DB_API_KEY) throw new Error("no VIDEO_DB_API_KEY");
  const { transcribeAudio } = await import("@/lib/videodb/client");
  const result = await transcribeAudio({ file: blob, filename });
  return { text: (result.transcript ?? "").trim() };
}

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  // v10.0.529.3 D-1 fix · whisper-1 + VideoDB are both metered services ·
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
  if (blob.size > VIDEODB_MAX_BYTES) {
    return NextResponse.json(
      { error: `audio too large · max ${VIDEODB_MAX_BYTES / 1024 / 1024}MB` },
      { status: 400 },
    );
  }
  if (blob.size < 800) {
    // Tap-and-release with no audio · don't waste a transcription call
    return NextResponse.json({ text: "", source: "skipped", ms: 0 });
  }

  // Try Whisper first if available + size fits (25MB limit) · much faster
  if (process.env.OPENAI_API_KEY && blob.size <= WHISPER_MAX_BYTES) {
    try {
      const { text } = await transcribeViaWhisper(blob, filename);
      return NextResponse.json({
        text,
        source: "whisper",
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      // Fall through to VideoDB · don't fail closed if Whisper hiccups
      if (process.env.NODE_ENV !== "production") {
        console.warn("[transcribe] whisper failed, falling back to videodb:", err);
      }
    }
  }

  // VideoDB fallback (slow but reliable)
  if (process.env.VIDEO_DB_API_KEY) {
    try {
      const { text } = await transcribeViaVideoDB(blob, filename);
      return NextResponse.json({
        text,
        source: "videodb",
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `transcribe failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    {
      error: "no transcription provider configured",
      hint: "set OPENAI_API_KEY (preferred · fast) or VIDEO_DB_API_KEY (slow fallback)",
    },
    { status: 503 },
  );
}

// Auth: handler above invokes requireSession on first line.
export const POST = withTracing(handler, { name: "/api/ai/transcribe" });
