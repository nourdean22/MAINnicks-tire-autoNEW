/**
 * POST /api/ai/chat/media-upload · BDN-319 (2026-08-14)
 *
 * The upload lane the composer has never had.
 *
 * WHY THIS EXISTS
 * Every chat attachment was inlined as a `data:` URL into the message
 * parts and persisted with the message. That is tolerable for a
 * screenshot and indefensible for video: ~+33% over the wire, held in
 * memory on both ends, stored forever in a conversation row that never
 * shrinks. BDN-314 therefore REFUSED video at intake and named this
 * missing route as the reason. This is that route.
 *
 * The media plan states the rule directly: "do not send huge base64
 * files through the chat message. Upload them first, then pass a secure
 * media URL plus metadata."
 *
 * WHY VIDEODB AND NOT A NEW BLOB STORE
 * VideoDB is already the media store for this app — audio-transcribe and
 * the operator session-capture route both upload to it, and its upload
 * response carries a playable `stream_url` (already mapped in
 * lib/integrations/videodb.ts). Standing up S3/R2 alongside it would
 * mean a second store, a second credential, and a second lifecycle for
 * the same asset class.
 *
 * Body (multipart/form-data):
 *   · file: File — video or audio
 *
 * Response:
 *   · 200 { videoId, url, mediaType, filename, elapsedMs }
 *       `url` is a playable stream URL suitable for a `file` message
 *       part. Absent `stream_url` is an ERROR, not an empty string —
 *       see below.
 *   · 400 no file · unsupported type · over the size ceiling
 *   · 503 VIDEO_DB_API_KEY missing (same shape as audio-transcribe)
 *   · 500 with diagnostic on upload failure
 *
 * Auth: requireSession, same as every other chat endpoint.
 */

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { aiRouteError } from "@/lib/utils/http-parse";
import { uploadMedia } from "@/lib/videodb/client";

/**
 * 500 MB, matching the operator session-capture route's ceiling for
 * screen recordings. Far above the base64 path's 8-10 MB caps precisely
 * because this lane does NOT inline the bytes.
 */
const MAX_BYTES = 500 * 1024 * 1024;

/** Only what a player can actually render. PDFs stay on the inline path. */
const ALLOWED_PREFIXES = ["video/", "audio/"];

export const maxDuration = 300;
export const runtime = "nodejs";

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

  const startedAt = Date.now();

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof Blob)) {
      return Response.json({ error: "media-upload: file is required" }, { status: 400 });
    }

    const filename = file instanceof File ? file.name : `media-${startedAt}`;
    const mediaType = file.type || "application/octet-stream";

    if (!ALLOWED_PREFIXES.some((p) => mediaType.toLowerCase().startsWith(p))) {
      return Response.json(
        {
          error: `media-upload: ${mediaType} is not uploadable here — video and audio only.`,
          hint: "Images and PDFs use the inline attachment path.",
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return Response.json(
        {
          error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
        },
        { status: 400 },
      );
    }

    if (file.size <= 0) {
      return Response.json(
        { error: "That file is empty (0 bytes) — nothing would be uploaded." },
        { status: 400 },
      );
    }

    const { videoId, rawResponse } = await uploadMedia({ file, filename });

    // The upload response carries the playable URL. If it is missing we
    // FAIL rather than returning a part with an empty `url`: the
    // renderer's isRenderableUrl would reject it and the operator would
    // see a file card for media that uploaded fine, with no way to tell
    // that the only thing missing was the link.
    const url = (rawResponse as { stream_url?: string }).stream_url;
    if (!url) {
      return Response.json(
        {
          error: "media-upload: VideoDB returned no stream_url",
          videoId,
          hint: "The asset uploaded, but there is no playable URL to attach. Check the collection's stream settings.",
        },
        { status: 500 },
      );
    }

    return Response.json({
      videoId,
      url,
      mediaType,
      filename,
      /** Round-trip latency of THIS endpoint — not the media's duration. */
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    return aiRouteError(err, "ai/chat/media-upload", "Media upload failed");
  }
}
