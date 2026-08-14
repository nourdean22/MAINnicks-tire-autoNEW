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
 * The endpoints are best-effort transcribed from the docs since the
 * full REST schema isn't published the same way Venice/OpenAI publish
 * theirs. If a call returns 404, the response body usually includes
 * the correct route · we retry once and surface the diagnostic.
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
    const res = await vdbFetch("/collections");
    const data = (await res.json()) as { collections?: Collection[] };
    const first = data.collections?.[0];
    if (first?.id) {
      cachedCollectionId = first.id;
      return first.id;
    }
  } catch {
    // Fall through to create
  }
  // Create one
  const createRes = await vdbFetch("/collections", {
    method: "POST",
    body: JSON.stringify({ name: "nour-os-default" }),
  });
  const created = (await createRes.json()) as Collection;
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
  const path = `/collections/${collectionId}/upload`;

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

  const json = (await res.json()) as UploadResponse;
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
  await vdbFetch(`/videos/${videoId}/indexes`, {
    method: "POST",
    body: JSON.stringify({ index_type: "spoken_word" }),
  });
}

// ── Get transcript (with polling) ────────────────────────────────────

interface TranscriptResponse {
  transcript?: string;
  status?: string;
  text?: string;
}

export async function getTranscript(
  videoId: string,
  opts: { pollMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const pollMs = opts.pollMs ?? POLL_MS;
  const maxAttempts = opts.maxAttempts ?? POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await vdbFetch(`/videos/${videoId}/transcription`).catch((e) => {
      // 404/425 typically means transcript not ready yet · keep polling
      const err = e as VideoDbError;
      if (err.statusCode === 404 || err.statusCode === 425) return null;
      throw e;
    });
    if (res) {
      const json = (await res.json()) as TranscriptResponse;
      const text = json.transcript ?? json.text;
      const status = json.status ?? "unknown";
      if (text && status !== "indexing" && status !== "processing") {
        return text;
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
  const transcript = await getTranscript(videoId);
  return {
    transcript,
    videoId,
    elapsedMs: Date.now() - startedAt,
  };
}
