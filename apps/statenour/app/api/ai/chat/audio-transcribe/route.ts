/**
 * POST /api/ai/chat/audio-transcribe · v10.0.349 · audio drop → text via
 * VideoDB. Operator drops a voice memo / clip into chat; we upload it
 * to VideoDB, index spoken-words, poll for transcript, and return text.
 *
 * Body (multipart/form-data):
 *   · file?: File         — audio blob (mp3/wav/m4a/webm/ogg)
 *   · url?:  string       — alternative · publicly fetchable URL
 *
 * Response:
 *   · 200 { transcript, videoId, elapsedMs }   ← elapsedMs is the round-trip
 *     latency of this endpoint, NOT the media's duration. Renamed from
 *     `durationMs` 2026-08-14 · see lib/videodb/client.ts.
 *   · 400 if neither file nor url given · file too large (≥50MB)
 *   · 503 if VIDEO_DB_API_KEY missing (helpful message + sign-up link)
 *   · 500 with diagnostic on transcription failure
 *
 * Auth: requireSession (same as other chat endpoints).
 *
 * maxDuration 240 · transcription polling tops out at 120s · adds 60s
 * upload window + 60s buffer for pre/post processing on Vercel.
 */

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { aiRouteError } from "@/lib/utils/http-parse";
import { transcribeAudio } from "@/lib/videodb/client";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const maxDuration = 240;

export async function POST(req: NextRequest) {
  await requireSession(req);

  if (!process.env.VIDEO_DB_API_KEY) {
    return Response.json(
      {
        error: "VIDEO_DB_API_KEY not set",
        hint: "Get a free key (50 uploads, no credit card) at https://console.videodb.io · then drop into .env as VIDEO_DB_API_KEY",
      },
      { status: 503 },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const url = form.get("url");

    let result;
    if (file && file instanceof Blob) {
      if (file.size > MAX_BYTES) {
        return Response.json(
          { error: `Audio too large · max ${MAX_BYTES / 1024 / 1024}MB` },
          { status: 400 },
        );
      }
      const filename =
        file instanceof File ? file.name : `audio-${Date.now()}`;
      result = await transcribeAudio({ file, filename });
    } else if (typeof url === "string" && url.trim()) {
      result = await transcribeAudio({ url: url.trim() });
    } else {
      return Response.json(
        { error: "audio-transcribe: either file or url is required" },
        { status: 400 },
      );
    }

    return Response.json(result);
  } catch (err) {
    return aiRouteError(err, "ai/chat/audio-transcribe", "Audio transcribe failed");
  }
}
