/**
 * Google Veo reel-clip generation (Gemini API) — the production replacement for
 * the Higgsfield/Seedance CLI. Drop-in for `generateReelClipVideo(prompt)`:
 * takes a prompt, returns a PUBLIC url to the re-hosted mp4 (reelPipeline expects
 * a fetchable url).
 *
 * Auth: prefers a Gemini API key (`GEMINI_API_KEY`, sent as x-goog-api-key);
 * otherwise mints a token from the repo's service account (cloud-platform scope —
 * the same `GOOGLE_SERVICE_ACCOUNT_*` creds reelVoice uses for Google TTS).
 *
 * Hardened (doctrine): no fake AI people (always-on negativePrompt; an optional
 * personGeneration guard for models that support it), fail-closed on every
 * error, a poll deadline so a stuck op can't wedge the queue, and a min-size
 * check so a truncated download never publishes as a broken clip. Model + params
 * are env-overridable so a Veo version/param change never needs a code change:
 *   REEL_VEO_MODEL (default veo-3.1-fast-generate-preview), REEL_VEO_RESOLUTION (720p),
 *   REEL_VEO_ASPECT_RATIO (9:16), REEL_VEO_DURATION (opt-in, numeric),
 *   REEL_VEO_PERSON_GENERATION (opt-in), REEL_VEO_POLL_INTERVAL_MS (10000),
 *   REEL_VEO_POLL_MAX_MS (360000).
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:veo-studio");

const VEO_BASE = "https://generativelanguage.googleapis.com/v1beta";
// A REEL_VEO_MODEL the key cannot see fails only at call time ("Model is not
// found"), which reads like a dead/unbilled key and has already been misread as
// one: prod ran veo-3.1-fast-generate-001 (nonexistent — the real names carry a
// -preview suffix), Veo was written off as broken, and REEL_VIDEO_PROVIDER was
// pinned to the session-token Higgsfield path. Validate a model change with
// scripts/probe-veo-generate.ts BEFORE deploying it.
const VEO_MODEL = process.env.REEL_VEO_MODEL || "veo-3.1-fast-generate-preview";
const POLL_INTERVAL_MS = Number(process.env.REEL_VEO_POLL_INTERVAL_MS) || 10_000;
const POLL_MAX_MS = Number(process.env.REEL_VEO_POLL_MAX_MS) || 6 * 60_000;
// Doctrine: AI gen is for real product objects only — never fake people. Belt
// (negativePrompt) is always on; personGeneration is opt-in (some Veo models reject it).
const NEGATIVE_PROMPT =
  "human, person, people, face, hands, fingers, crowd, mannequin, text, captions, subtitles, watermark, logo, blurry, low quality, distorted";

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
  };
}

/** Mint the Google auth header — Gemini API key if present, else the service-account JWT. */
/** Are Veo credentials PRESENT? Veo (not Higgsfield) is the background reel
 *  video generator, so this is what the pipeline-health card must check — a
 *  Higgsfield-only credential check reports the reel generator green while the
 *  active worker has no key. Presence only (mirrors veoAuthHeader's inputs);
 *  not a live probe. */
export function veoCredentialsPresent(): boolean {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENAI_API_KEY) return true;
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

async function veoAuthHeader(): Promise<Record<string, string>> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (apiKey) return { "x-goog-api-key": apiKey };
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  if (!email || !key) {
    // "authentication failed", not "cannot authenticate". The wording is load-bearing:
    // shared/providerErrors.ts:88 classifies AUTH_INVALID by matching literal tokens,
    // and "cannot authenticate" matches none of them. A missing Veo credential
    // therefore fell through to UNKNOWN, whose policy is RETRY_BACKOFF with
    // consumesAttempt (providerErrors.ts:112) — so a config problem that no retry can
    // ever fix burned all three attempts pretending to be a transient fault, then
    // failed with "unrecognised failure" instead of naming the missing key.
    // AUTH_INVALID routes to PAUSE_PROVIDER and goes terminal on the first attempt.
    throw new Error("Veo: authentication failed — no GEMINI_API_KEY and no GOOGLE_SERVICE_ACCOUNT_EMAIL/_KEY");
  }
  const { google } = await import("googleapis");
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Veo: failed to mint service-account access token");
  return { Authorization: `Bearer ${token}` };
}

/**
 * Pure: the Veo predictLongRunning body for a 9:16 product reel clip. Testable
 * without I/O. The default param set is empirically verified against
 * veo-3.0-generate-001 (see the Veo probe): that model REJECTS numberOfVideos,
 * personGeneration:"dont_allow", and a string durationSeconds. aspectRatio +
 * resolution + negativePrompt generate cleanly, and the negativePrompt carries
 * the no-people doctrine guard. The model-specific extras are opt-in via env so
 * the default body stays portable across Veo models (3.0 / 3.1 / fast variants).
 */
export function buildVeoRequestBody(prompt: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    aspectRatio: env.REEL_VEO_ASPECT_RATIO || "9:16",
    resolution: env.REEL_VEO_RESOLUTION || "720p",
    negativePrompt: NEGATIVE_PROMPT,
  };
  if (env.REEL_VEO_DURATION) parameters.durationSeconds = Number(env.REEL_VEO_DURATION);
  if (env.REEL_VEO_PERSON_GENERATION) parameters.personGeneration = env.REEL_VEO_PERSON_GENERATION;
  return { instances: [{ prompt }], parameters };
}

export async function submitVeoRequest(prompt: string): Promise<string> {
  if (!prompt?.trim()) throw new Error("Veo: empty prompt");
  const auth = await veoAuthHeader();
  log.info("Submitting reel clip via Veo predictLongRunning...", { model: VEO_MODEL, prompt: prompt.slice(0, 120) });

  const submitRes = await fetch(`${VEO_BASE}/models/${VEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(buildVeoRequestBody(prompt)),
    signal: AbortSignal.timeout(30_000),
  });
  const submitData = (await submitRes.json().catch(() => null)) as VeoOperation | null;
  if (!submitRes.ok || !submitData?.name) {
    throw new Error(`Veo submit failed (HTTP ${submitRes.status}): ${submitData?.error?.message ?? "no operation name returned"}`);
  }
  return submitData.name;
}

export async function pollVeoOperation(opName: string): Promise<string> {
  const auth = await veoAuthHeader();
  const deadline = Date.now() + POLL_MAX_MS;
  let videoUri: string | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${VEO_BASE}/${opName}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
    const pollData = (await pollRes.json().catch(() => null)) as VeoOperation | null;
    if (!pollRes.ok) {
      log.warn("Veo poll non-OK, retrying", { status: pollRes.status });
      continue;
    }
    if (pollData?.error) throw new Error(`Veo operation error: ${pollData.error.message ?? "unknown"}`);
    if (pollData?.done) {
      videoUri = pollData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) throw new Error(`Veo finished but returned no video uri: ${JSON.stringify(pollData.response).slice(0, 300)}`);
      break;
    }
  }
  if (!videoUri) throw new Error(`Veo generation timed out after ${POLL_MAX_MS}ms (op ${opName})`);
  return videoUri;
}

export async function downloadAndRehostVeoVideo(videoUri: string): Promise<string> {
  const auth = await veoAuthHeader();
  const dlRes = await fetch(videoUri, { headers: auth, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!dlRes.ok) throw new Error(`Veo video download failed (HTTP ${dlRes.status})`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`Veo video suspiciously small (${buf.length} bytes) — failing closed`);

  const { storagePut } = await import("../storage");
  const { url } = await storagePut(
    `reel-clips/veo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    buf,
    "video/mp4",
  );
  log.info("Veo clip generated + hosted", { bytes: buf.length, url });
  return url;
}

export async function generateReelClipVideo(prompt: string): Promise<string> {
  const opName = await submitVeoRequest(prompt);
  const videoUri = await pollVeoOperation(opName);
  return await downloadAndRehostVeoVideo(videoUri);
}

export async function probeVeoConnection(): Promise<{ success: boolean; modelInfo?: any; error?: string }> {
  try {
    const auth = await veoAuthHeader();
    const res = await fetch(`${VEO_BASE}/models/${VEO_MODEL}`, {
      headers: auth,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    return { success: true, modelInfo: data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
