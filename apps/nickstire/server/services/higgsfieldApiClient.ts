/**
 * Higgsfield's OFFICIAL REST API — key-based auth, no session, no device flow,
 * nothing to revoke.
 *
 * WHY THIS EXISTS. The CLI-session lane (`higgsfieldStudio.ts`) went dead for
 * four days on 2026-08-13 because the refresh token was revoked, and the
 * operator does not control the mechanism that revokes it: OAuth refresh tokens
 * are single-use, so running the `hf` CLI on ANY second machine against the
 * same account silently strands the first one's session — see
 * docs/runbooks/higgsfield-session.md §3. A repo comment used to say video
 * generation needs "Higgsfield (HIGGSFIELD_API_KEY)"; that env var was never
 * read anywhere. It should have been. This module is what it should have read.
 *
 * SOURCE OF TRUTH. Verified 2026-08-17 against the OFFICIAL docs
 * (docs.higgsfield.ai) and the OFFICIAL Node SDK
 * (github.com/higgsfield-ai/higgsfield-js), NOT the third-party apidog.com
 * write-up, which contradicts both on base URL, auth header shape, and endpoint
 * path — it reads AI-generated and wrong for this vendor. Do not "fix" this
 * file to match apidog.
 *
 *   Auth:   Authorization: Key <KEY_ID>:<KEY_SECRET>
 *   Base:   https://platform.higgsfield.ai
 *   Submit: POST /higgsfield-ai/dop/standard   (image-to-video, DoP model)
 *   Status: GET  /requests/{request_id}/status
 *   Cancel: POST /requests/{request_id}/cancel
 *
 * NO NEW DEPENDENCY. The official `@higgsfield/client` SDK is not installed —
 * every `pnpm install` variant is policy-blocked from a harness worktree
 * (harness-worktree-setup skill). The wire protocol is plain HTTP/JSON, so this
 * talks to it directly with the platform's own `fetch`, the same way
 * `lib/publicFetch.ts` talks to arbitrary hosts. Installing the real SDK later
 * is a drop-in replacement for this file, not a rewrite of its callers.
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT. Built from documentation, not exercised
 * against Higgsfield's servers — this repo's only funded lane so far is the CLI
 * session, and spending its credits to smoke-test a new integration is an
 * operator decision, not mine. `probeHiggsfieldApiCredentials()` below is the
 * SAFE first call: it hits the status endpoint with a garbage id, which costs
 * nothing and distinguishes "the key works" (404/not-found) from "the key is
 * wrong" (401/403) without spending a single credit.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:higgsfield-api");

const BASE_URL = "https://platform.higgsfield.ai";
/** DoP = Higgsfield's image-to-video model family; "standard" is the base tier. */
const DOP_SUBMIT_PATH = "/higgsfield-ai/dop/standard";

export interface HiggsfieldApiCredentials {
  keyId: string;
  keySecret: string;
}

/** Reads HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET. Never logs the secret. */
export function higgsfieldApiCredentialsFromEnv(): HiggsfieldApiCredentials | null {
  const keyId = process.env.HIGGSFIELD_API_KEY_ID?.trim();
  const keySecret = process.env.HIGGSFIELD_API_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

function authHeader(creds: HiggsfieldApiCredentials): string {
  return `Key ${creds.keyId}:${creds.keySecret}`;
}

interface SubmitResponse {
  status: string;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
}

interface StatusResponse {
  status: string;
  request_id: string;
  /** Shape varies by model per the docs; DoP video results carry `video.url`. */
  video?: { url?: string };
  images?: { url?: string }[];
  error?: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "canceled"]);

async function apiFetch(
  creds: HiggsfieldApiCredentials,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (e.g. an HTML error page from an upstream proxy) is
    // reported through `status` + the raw text below rather than thrown here,
    // so a caller can distinguish "API is reachable but returned garbage" from
    // "API is unreachable" — different faults, different operator actions.
    json = { _rawText: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

/**
 * FREE liveness/auth check — no generation, no credit spend. Hits the status
 * endpoint for a request id that cannot exist, so a 404 means "the key
 * authenticated and the server processed the request" (i.e. the key works) and
 * a 401/403 means the key itself is wrong. Mirrors the shape of
 * `higgsfieldSessionHealth()` in the CLI lane: three states, `healthy: null`
 * when the answer is not knowable, never a guess rendered as a pass.
 */
export async function probeHiggsfieldApiCredentials(
  creds: HiggsfieldApiCredentials = higgsfieldApiCredentialsFromEnv() ?? { keyId: "", keySecret: "" },
): Promise<{ healthy: boolean | null; reason: string }> {
  if (!creds.keyId || !creds.keySecret) {
    return { healthy: null, reason: "HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET not configured" };
  }
  try {
    const probeId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { status, json } = await apiFetch(creds, `/requests/${probeId}/status`, { method: "GET", timeoutMs: 10_000 });
    if (status === 401 || status === 403) {
      return { healthy: false, reason: `key rejected (HTTP ${status}) — HIGGSFIELD_API_KEY_ID/SECRET are wrong or revoked` };
    }
    if (status === 404) {
      return { healthy: true, reason: "key authenticated (probe id correctly reported not-found)" };
    }
    // Any other status is a real answer but not one of the two we designed for
    // — reported as unknown rather than guessed in either direction.
    return { healthy: null, reason: `unexpected HTTP ${status} from status endpoint: ${JSON.stringify(json).slice(0, 200)}` };
  } catch (err) {
    return { healthy: null, reason: `probe request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface DopVideoRequest {
  prompt: string;
  /** A publicly fetchable image URL — the API fetches it server-side. */
  startImageUrl?: string;
  aspectRatio?: string;
}

/**
 * Submit + poll a DoP (image-to-video) generation to completion.
 *
 * Deliberately mirrors the CLI lane's safety properties rather than trusting the
 * API to have its own:
 *   - a hard wall-clock TIMEOUT, because a hung poll loop must not become an
 *     unbounded await the same way an unkilled CLI child was ("Seedance is a
 *     single blocking call with no resumable request-id" — same class here: an
 *     abandoned poll leaves the SUBMITTED job running server-side, so this
 *     returns the request_id in every error so a caller can log it for
 *     reconciliation, even though there is no local reconciler for it yet).
 *   - the timeout STOPS polling and rejects; it does not attempt to CANCEL,
 *     because an unverified cancel call against an unexercised endpoint is a
 *     worse failure mode than a job that finishes without being awaited.
 */
export async function generateReelClipVideoViaApi(
  req: DopVideoRequest,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const creds = higgsfieldApiCredentialsFromEnv();
  if (!creds) throw new Error("Higgsfield API credentials not configured (HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET)");

  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  // Matches the CLI lane's floor/default so operator-facing latency expectations
  // do not silently change based on which lane happened to run.
  const timeoutMs = Math.max(60_000, opts.timeoutMs ?? (Number(process.env.HIGGSFIELD_CLI_TIMEOUT_MS) || 6 * 60_000));
  const deadline = Date.now() + timeoutMs;

  const body: Record<string, unknown> = { model: "dop-standard", prompt: req.prompt };
  if (req.startImageUrl) body.input_images = [{ type: "image_url", image_url: req.startImageUrl }];
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;

  log.info("submitting Higgsfield API DoP video generation", { promptLen: req.prompt.length, hasStartImage: !!req.startImageUrl });

  const submit = await apiFetch(creds, DOP_SUBMIT_PATH, { method: "POST", body, timeoutMs: 20_000 });
  if (submit.status < 200 || submit.status >= 300) {
    throw new Error(`Higgsfield API submit failed: HTTP ${submit.status} ${JSON.stringify(submit.json).slice(0, 300)}`);
  }
  const submitted = submit.json as SubmitResponse;
  if (!submitted?.request_id) {
    throw new Error(`Higgsfield API submit returned no request_id: ${JSON.stringify(submit.json).slice(0, 300)}`);
  }
  const requestId = submitted.request_id;
  log.info("Higgsfield API generation submitted", { requestId });

  while (true) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Higgsfield API generation timed out after ${timeoutMs}ms polling request ${requestId} — ` +
        `the job may still complete server-side; this request_id was NOT cancelled, only abandoned locally`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const poll = await apiFetch(creds, `/requests/${requestId}/status`, { method: "GET", timeoutMs: 15_000 });
    if (poll.status < 200 || poll.status >= 300) {
      // A transient poll failure is not a generation failure — keep polling
      // until the deadline rather than failing the whole reel on one bad HTTP
      // response, mirroring the CLI lane's "an occasional transient must cost
      // one beat's retry, not the reel."
      log.warn("Higgsfield API status poll returned non-2xx, will retry", { requestId, status: poll.status });
      continue;
    }
    const result = poll.json as StatusResponse;
    if (!TERMINAL_STATUSES.has(result.status)) continue;

    if (result.status !== "completed") {
      throw new Error(`Higgsfield API generation ${result.status} for request ${requestId}: ${result.error ?? "no error detail"}`);
    }
    const url = result.video?.url ?? result.images?.[0]?.url;
    if (!url) {
      throw new Error(`Higgsfield API reported completed but returned no video/image URL for request ${requestId}: ${JSON.stringify(result).slice(0, 300)}`);
    }
    log.info("Higgsfield API generation completed", { requestId });
    return url;
  }
}
