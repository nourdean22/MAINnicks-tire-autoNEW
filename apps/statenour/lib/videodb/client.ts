/**
 * VideoDB REST client · v10.0.349 · thin wrapper for chat audio
 * transcription · Phase 1 of the VideoDB integration.
 *
 * Why REST direct (not Python SDK):
 *   · Next.js + Vercel serverless · no Python runtime in the Edge
 *   · One round-trip per call · easy to telemeter
 *   · Same pattern as Venice/OpenAI clients · single auth header
 *
 * Endpoints (per docs.videodb.io · 2026-05-06):
 *   · GET    /collections                       · list (find default)
 *   · POST   /collections                       · create if missing
 *   · POST   /collections/{id}/upload           · multipart or {url}
 *   · POST   /videos/{id}/indexes               · {index_type:"spoken_word"}
 *   · GET    /videos/{id}/transcription         · final transcript
 *   · GET    /videos/{id}                       · status polling
 *
 * Auth: `x-access-token: $VIDEO_DB_API_KEY`
 *
 * ★★★ 2026-08-14 · BDN-321 · LIVE PROBE FOUND THIS CLIENT WAS NEVER
 * WORKING. The comment above ("best-effort transcribed from the docs")
 * was accurate and the guesses were wrong in two systematic ways:
 *
 *   1. PATHS ARE SINGULAR. `/collections` -> 404; `/collection` -> 200.
 *      Same for `/videos` -> `/video`, `/indexes` -> `/index`. Verified
 *      against a live key AND videodb-python's ApiPath constants
 *      (collection = "collection", video = "video", index = "index").
 *
 *   2. EVERY RESPONSE IS ENVELOPED: `{ "data": {...}, "success": true }`.
 *      This client read `json.collections` / `json.video_id` /
 *      `json.transcript` off the TOP level, which is always undefined.
 *      The SDK's http client does `response.json().get("data")` on every
 *      call; `unwrap()` below is the equivalent.
 *
 *   Listing videos is also not nested: `GET /video?collection_id=<id>`,
 *   not `/collection/<id>/video` (which 404s).
 *
 * Corroborating evidence that it never worked: the operator's collection
 * contained ZERO videos at probe time. If transcribeAudio had ever
 * succeeded there would be assets.
 *
 * Endpoints below are now the VERIFIED ones. Probe:
 * scripts/probe-videodb-transcript.ts (read-only).
 */

const BASE_URL = "https://api.videodb.io";
const POLL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60; // 2min ceiling for a transcript

function getKey(): string {
  const key = process.env.VIDEO_DB_API_KEY;
  if (!key) {
    throw new Error(
      "VIDEO_DB_API_KEY not set · get a free key at https://console.videodb.io · 50 free uploads, no credit card",
    );
  }
  return key;
}

interface VideoDbError extends Error {
  statusCode?: number;
  responseBody?: string;
}

/**
 * Unwrap the `{ data, success }` envelope every VideoDB response uses.
 * Mirrors videodb-python's `response.json().get("data")`, including its
 * fallback to the whole body when `data` is absent.
 */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    const inner = (body as { data?: unknown }).data;
    if (inner !== null && inner !== undefined) return inner as T;
  }
  return body as T;
}

async function vdbFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-access-token", getKey());
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: VideoDbError = new Error(
      `VideoDB ${res.status} ${path} · ${body.slice(0, 200)}`,
    );
    err.statusCode = res.status;
    err.responseBody = body;
    throw err;
  }
  return res;
}

// ── Collection helpers ───────────────────────────────────────────────

interface Collection {
  id: string;
  name: string;
}

/**
 * Get the default collection · creates one if no collections exist.
 * Cached per-process so we don't list collections on every upload.
 */
let cachedCollectionId: string | null = null;
export async function getDefaultCollection(): Promise<string> {
  if (cachedCollectionId) return cachedCollectionId;
  // Try list first
  try {
    const res = await vdbFetch("/collection");
    const data = unwrap<{ collections?: Collection[] }>(await res.json());
    const first = data.collections?.[0];
    if (first?.id) {
      cachedCollectionId = first.id;
      return first.id;
    }
  } catch {
    // Fall through to create
  }
  // Create one
  const createRes = await vdbFetch("/collection", {
    method: "POST",
    body: JSON.stringify({ name: "nour-os-default" }),
  });
  const created = unwrap<Collection>(await createRes.json());
  cachedCollectionId = created.id;
  return created.id;
}

// ── Upload ───────────────────────────────────────────────────────────

interface UploadResponse {
  /** Either field name observed in VideoDB responses · we accept both. */
  id?: string;
  asset_id?: string;
  video_id?: string;
  status?: string;
}

export interface UploadedAsset {
  videoId: string;
  rawResponse: UploadResponse;
}

/**
 * Upload audio/video by file (multipart) or URL. Returns the resulting
 * video/asset id which can be used for indexing + transcript fetch.
 */
export async function uploadMedia(args: {
  file?: File | Blob;
  filename?: string;
  url?: string;
}): Promise<UploadedAsset> {
  const collectionId = await getDefaultCollection();
  const path = `/collection/${collectionId}/upload`;

  let res: Response;
  if (args.file) {
    const form = new FormData();
    form.append("file", args.file, args.filename ?? "audio");
    res = await vdbFetch(path, {
      method: "POST",
      body: form,
      // Don't set Content-Type · browser/runtime sets multipart boundary
    });
  } else if (args.url) {
    res = await vdbFetch(path, {
      method: "POST",
      body: JSON.stringify({ url: args.url }),
    });
  } else {
    throw new Error("uploadMedia: either file or url is required");
  }

  const json = unwrap<UploadResponse>(await res.json());
  const videoId = json.video_id ?? json.asset_id ?? json.id;
  if (!videoId) {
    throw new Error(
      `VideoDB upload returned no video id · response: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return { videoId, rawResponse: json };
}

// ── Index spoken words ───────────────────────────────────────────────

export async function indexSpokenWords(videoId: string): Promise<void> {
  await vdbFetch(`/video/${videoId}/index`, {
    method: "POST",
    body: JSON.stringify({ index_type: "spoken_word" }),
  });
}

// ── Get transcript (with polling) ────────────────────────────────────

/**
 * BDN-318 (2026-08-14) · the transcript response, per the VideoDB SDK.
 *
 * Verified against the primary source rather than guessed —
 * videodb-python `Video._fetch_transcript` reads exactly two keys off
 * this endpoint:
 *
 *   transcript_data.get("word_timestamps", [])   → timed segments
 *   transcript_data.get("text", "")              → full plain text
 *
 * and `get_transcript` documents the element shape as
 * "List of dicts with keys: start (float), end (float), text (str)".
 *
 * ★ THE BUG THIS FIXES: the previous reader took `json.transcript ??
 * json.text` and returned a flat string. `transcript` is not even a key
 * this endpoint returns — the text came through the fallback — and
 * `word_timestamps` was discarded entirely. Every timing the API
 * produced was thrown away at the client boundary, which is why
 * clickable transcripts, chapters and "summarize this section" were all
 * reported as blocked on the backend.
 */
interface TranscriptSegmentRaw {
  start?: number;
  end?: number;
  text?: string;
}

interface TranscriptResponse {
  word_timestamps?: TranscriptSegmentRaw[];
  text?: string;
  /** Legacy/fallback key kept because the old reader relied on it. */
  transcript?: string;
  status?: string;
}

/** A timed transcript segment. Times are seconds. */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  /**
   * True when the API returned text but NO recognizable timed segments.
   *
   * Reported explicitly instead of letting `segments: []` stand, because
   * an empty array is ambiguous — it reads identically as "silent video"
   * and as "we failed to parse the timings". Callers that need segments
   * must be able to tell those apart, and a silent empty is exactly the
   * false-green this repo keeps relearning.
   */
  segmentsUnavailable: boolean;
}

/**
 * How the API should split the transcript.
 *   word     — one segment per word (precise seeking, unreadable as prose)
 *   sentence — one segment per sentence (what a transcript pane wants)
 *   time     — fixed-duration windows, size set by `length`
 */
export type TranscriptSegmenter = "word" | "sentence" | "time";

export function normalizeSegments(raw: TranscriptSegmentRaw[] | undefined): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptSegment[] = [];
  for (const seg of raw) {
    const text = typeof seg?.text === "string" ? seg.text : "";
    const start = typeof seg?.start === "number" ? seg.start : NaN;
    const end = typeof seg?.end === "number" ? seg.end : NaN;
    // Drop malformed rows rather than emitting NaN timings that would
    // seek a player to nowhere.
    if (!text.trim() || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end < start) continue;
    out.push({ start, end, text });
  }
  return out;
}

export async function getTranscript(
  videoId: string,
  opts: {
    pollMs?: number;
    maxAttempts?: number;
    /** Default "sentence" — readable prose. "word" for precise seeking. */
    segmenter?: TranscriptSegmenter;
    /** Window size in seconds when segmenter === "time". */
    length?: number;
  } = {},
): Promise<TranscriptResult> {
  const pollMs = opts.pollMs ?? POLL_MS;
  const maxAttempts = opts.maxAttempts ?? POLL_MAX_ATTEMPTS;
  // "sentence" is the default because the first consumer is a transcript
  // pane. "word" (the SDK's default) yields one segment per word, which
  // is perfect for seeking and unreadable as prose.
  const segmenter = opts.segmenter ?? "sentence";
  const query = new URLSearchParams({ segmenter });
  if (segmenter === "time") query.set("length", String(opts.length ?? 1));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await vdbFetch(
      `/video/${videoId}/transcription?${query.toString()}`,
    ).catch((e) => {
      // 404/425 typically means transcript not ready yet · keep polling
      const err = e as VideoDbError;
      if (err.statusCode === 404 || err.statusCode === 425) return null;
      throw e;
    });
    if (res) {
      const json = unwrap<TranscriptResponse>(await res.json());
      const text = json.text ?? json.transcript;
      const status = json.status ?? "unknown";
      if (text && status !== "indexing" && status !== "processing") {
        const segments = normalizeSegments(json.word_timestamps);
        return {
          text,
          segments,
          // Loud, not silent: text present but nothing timed means the
          // shape changed or indexing produced no timings. A caller must
          // be able to distinguish that from a genuinely silent clip.
          segmentsUnavailable: segments.length === 0,
        };
      }
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  throw new Error(
    `VideoDB transcript not ready after ${maxAttempts * (pollMs / 1000)}s · video ${videoId}`,
  );
}

/**
 * Back-compat shim for callers that only ever wanted the prose.
 * Kept so widening the return type is not a breaking change.
 */
export async function getTranscriptText(
  videoId: string,
  opts: Parameters<typeof getTranscript>[1] = {},
): Promise<string> {
  return (await getTranscript(videoId, opts)).text;
}

// ── End-to-end transcription helper ──────────────────────────────────

/**
 * Upload audio + index + return transcript text. Single-call helper for
 * the chat audio-attach flow.
 */
export async function transcribeAudio(args: {
  file?: File | Blob;
  filename?: string;
  url?: string;
}): Promise<{
  transcript: string;
  /** Timed segments — empty when the API returned none (see segmentsUnavailable). */
  segments: TranscriptSegment[];
  /** True when text came back but no timings did. */
  segmentsUnavailable: boolean;
  videoId: string;
  /**
   * WALL-CLOCK time this upload+index+poll round trip took — NOT the
   * media's duration. Renamed from `durationMs` on 2026-08-14 (BDN-312):
   * next to `transcript` and `videoId`, that name read as "how long is
   * the clip", and the media plan's provenance cards (item #4) render a
   * Duration field — so the first person to wire them up would have shown
   * transcription latency as clip length. No consumer existed at rename
   * time; grep confirmed the other `durationMs` fields in the app are
   * unrelated. Media duration is not currently returned by this client.
   */
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const { videoId } = await uploadMedia(args);
  await indexSpokenWords(videoId).catch((e) => {
    // Some uploads auto-trigger indexing · 409/already-indexing is OK
    const err = e as VideoDbError;
    if (err.statusCode === 409 || err.statusCode === 400) return;
    throw e;
  });
  const result = await getTranscript(videoId);
  return {
    transcript: result.text,
    segments: result.segments,
    segmentsUnavailable: result.segmentsUnavailable,
    videoId,
    elapsedMs: Date.now() - startedAt,
  };
}
