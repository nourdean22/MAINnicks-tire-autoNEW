/**
 * VideoDB · Operator Session Capture · v10.0.525
 *
 * Thin REST wrapper over https://api.videodb.io for indexing operator
 * sessions (chat + computer-use recordings) so Nick can later
 * recall "what did I see / say in that recording last Tuesday".
 *
 * Why this file (vs. existing lib/videodb/client.ts):
 *   · client.ts is Phase 1 — audio-only transcribe-and-return for
 *     the chat audio-attach surface. It hard-throws on missing key
 *     and lacks scene indexing / search.
 *   · this file is Phase 2 — full session capture surface, graceful
 *     missing-key handling (code='missing_api_key'), withGuardian
 *     retries, and `searchVideo` for semantic recall.
 *
 * REST endpoints (per docs.videodb.io · 2026-05-12):
 *   · POST /collections/{id}/upload         · multipart or {url}
 *   · POST /videos/{id}/indexes             · {index_type:"spoken_word"}
 *   · POST /videos/{id}/indexes             · {index_type:"scene", prompt}
 *   · POST /videos/{id}/search              · {query, search_type, ...}
 *   · GET  /videos/{id}/transcription       · full transcript
 *
 * Auth: `x-access-token: $VIDEO_DB_API_KEY`
 *
 * All exported methods are wrapped with withGuardian (timeout +
 * exponential-backoff retry on transient errors). Missing API key
 * returns a structured `code='missing_api_key'` instead of throwing
 * so chat tools can surface "set the key" to the operator gracefully.
 */

import { withGuardian } from "@/lib/tools/guardian";

const BASE_URL = "https://api.videodb.io";
const DEFAULT_TIMEOUT_MS = 30_000;

export type VideoDbErrorCode =
  | "missing_api_key"
  | "upload_failed"
  | "index_failed"
  | "search_failed"
  | "transcript_failed"
  | "not_ready"
  | "unknown";

export interface UploadResult {
  videoId: string;
  streamUrl?: string;
  status?: string;
}

export interface IndexResult {
  indexId?: string;
  status?: string;
}

export interface SearchHit {
  videoId: string;
  /** Seconds from video start. */
  start: number;
  end: number;
  /** Text snippet (spoken word) or scene description (visual). */
  snippet: string;
  /** 0-1 similarity score · provider-reported. */
  similarity: number;
  /** "spoken_word" or "scene" · which index produced this hit. */
  source: "spoken_word" | "scene" | "unknown";
}

export interface SearchOptions {
  /** "spoken_word" (default) · "scene" · "semantic" (both). */
  indexType?: "spoken_word" | "scene" | "semantic";
  /** Max hits to return. Default 5. */
  limit?: number;
  /** Min similarity threshold. Default 0.2. */
  threshold?: number;
}

interface ErrorResult {
  ok: false;
  code: VideoDbErrorCode;
  error: string;
}

// ── Auth + low-level fetch ───────────────────────────────────────────

function getApiKey(): string | null {
  const key = (process.env.VIDEO_DB_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

function missingKeyError(): ErrorResult {
  return {
    ok: false,
    code: "missing_api_key",
    error:
      "VIDEO_DB_API_KEY not set · sign up at https://console.videodb.io (50 free uploads, no card) and add the key to env.",
  };
}

async function vdbFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-access-token", apiKey);
  if (
    !headers.has("Content-Type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `VideoDB ${res.status} ${path} · ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }
  return res;
}

// ── Collection cache · shared with lib/videodb/client.ts semantics ──

let cachedCollectionId: string | null = null;

interface CollectionResponse {
  collections?: { id: string; name: string }[];
}

interface CollectionCreateResponse {
  id: string;
  name: string;
}

async function getOrCreateCollection(apiKey: string): Promise<string> {
  if (cachedCollectionId) return cachedCollectionId;
  try {
    const res = await vdbFetch(apiKey, "/collections");
    const data = (await res.json()) as CollectionResponse;
    const first = data.collections?.[0];
    if (first?.id) {
      cachedCollectionId = first.id;
      return first.id;
    }
  } catch {
    // fall through and create
  }
  const createRes = await vdbFetch(apiKey, "/collections", {
    method: "POST",
    body: JSON.stringify({ name: "nour-os-sessions" }),
  });
  const created = (await createRes.json()) as CollectionCreateResponse;
  cachedCollectionId = created.id;
  return created.id;
}

// ── uploadVideo ──────────────────────────────────────────────────────

interface UploadRawResponse {
  id?: string;
  video_id?: string;
  asset_id?: string;
  stream_url?: string;
  status?: string;
}

async function _uploadVideo(
  source: { url: string } | { file: File | Blob; filename?: string },
): Promise<UploadResult | ErrorResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyError();

  try {
    const collectionId = await getOrCreateCollection(apiKey);
    const path = `/collections/${collectionId}/upload`;

    let res: Response;
    if ("url" in source) {
      res = await vdbFetch(apiKey, path, {
        method: "POST",
        body: JSON.stringify({ url: source.url }),
      });
    } else {
      const form = new FormData();
      form.append("file", source.file, source.filename ?? "session");
      res = await vdbFetch(apiKey, path, {
        method: "POST",
        body: form,
      });
    }

    const json = (await res.json()) as UploadRawResponse;
    const videoId = json.video_id ?? json.asset_id ?? json.id;
    if (!videoId) {
      return {
        ok: false,
        code: "upload_failed",
        error: `VideoDB upload returned no video id · ${JSON.stringify(json).slice(0, 200)}`,
      };
    }
    return {
      videoId,
      streamUrl: json.stream_url,
      status: json.status,
    };
  } catch (err) {
    return {
      ok: false,
      code: "upload_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const uploadVideo = withGuardian("videodb-upload", _uploadVideo, {
  timeoutMs: 60_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal sub-op of the videodb capture endpoint
});

// ── indexSpokenWords ─────────────────────────────────────────────────

async function _indexSpokenWords(
  videoId: string,
): Promise<IndexResult | ErrorResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyError();

  try {
    const res = await vdbFetch(apiKey, `/videos/${videoId}/indexes`, {
      method: "POST",
      body: JSON.stringify({ index_type: "spoken_word" }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      index_id?: string;
      status?: string;
    };
    return { indexId: json.index_id, status: json.status };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // 409 = already indexing · treat as success
    if (status === 409 || status === 400) {
      return { status: "already_indexing" };
    }
    return {
      ok: false,
      code: "index_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const indexSpokenWords = withGuardian(
  "videodb-index-spoken",
  _indexSpokenWords,
  { timeoutMs: 30_000, maxRetries: 2, reliabilityOnly: true },
);

// ── indexScenes ──────────────────────────────────────────────────────

async function _indexScenes(
  videoId: string,
  prompt: string,
): Promise<IndexResult | ErrorResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyError();

  try {
    const res = await vdbFetch(apiKey, `/videos/${videoId}/indexes`, {
      method: "POST",
      body: JSON.stringify({ index_type: "scene", prompt }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      index_id?: string;
      status?: string;
    };
    return { indexId: json.index_id, status: json.status };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 400) {
      return { status: "already_indexing" };
    }
    return {
      ok: false,
      code: "index_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const indexScenes = withGuardian("videodb-index-scenes", _indexScenes, {
  timeoutMs: 60_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal sub-op of the videodb capture endpoint
});

// ── searchVideo ──────────────────────────────────────────────────────

interface SearchRawResponse {
  results?: {
    start?: number;
    end?: number;
    text?: string;
    description?: string;
    score?: number;
    similarity?: number;
    type?: string;
  }[];
}

async function _searchVideo(
  videoId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<{ hits: SearchHit[] } | ErrorResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyError();

  const indexType = opts.indexType ?? "spoken_word";
  const limit = opts.limit ?? 5;
  const threshold = opts.threshold ?? 0.2;

  try {
    const res = await vdbFetch(apiKey, `/videos/${videoId}/search`, {
      method: "POST",
      body: JSON.stringify({
        query,
        search_type: indexType,
        result_limit: limit,
        score_threshold: threshold,
      }),
    });
    const json = (await res.json()) as SearchRawResponse;
    const hits: SearchHit[] = (json.results ?? []).map((r) => ({
      videoId,
      start: r.start ?? 0,
      end: r.end ?? 0,
      snippet: r.text ?? r.description ?? "",
      similarity: r.similarity ?? r.score ?? 0,
      source:
        r.type === "scene"
          ? "scene"
          : r.type === "spoken_word"
            ? "spoken_word"
            : "unknown",
    }));
    return { hits };
  } catch (err) {
    return {
      ok: false,
      code: "search_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const searchVideo = withGuardian("videodb-search", _searchVideo, {
  timeoutMs: 25_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal sub-op behind media.session_search
});

// ── getTranscript ────────────────────────────────────────────────────

interface TranscriptResponse {
  transcript?: string;
  text?: string;
  status?: string;
}

async function _getTranscript(
  videoId: string,
): Promise<{ transcript: string } | ErrorResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyError();

  try {
    const res = await vdbFetch(apiKey, `/videos/${videoId}/transcription`);
    const json = (await res.json()) as TranscriptResponse;
    const text = json.transcript ?? json.text;
    const status = json.status ?? "unknown";
    if (!text || status === "indexing" || status === "processing") {
      return {
        ok: false,
        code: "not_ready",
        error: `Transcript not ready · status=${status}`,
      };
    }
    return { transcript: text };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404 || status === 425) {
      return {
        ok: false,
        code: "not_ready",
        error: "Transcript still being prepared · try again in 30-60s.",
      };
    }
    return {
      ok: false,
      code: "transcript_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const getTranscript = withGuardian(
  "videodb-transcript",
  _getTranscript,
  { timeoutMs: 25_000, maxRetries: 1, reliabilityOnly: true },
);

// ── Type guards · narrow union returns ───────────────────────────────

export function isError<T extends object>(
  result: T | ErrorResult,
): result is ErrorResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: boolean }).ok === false
  );
}
