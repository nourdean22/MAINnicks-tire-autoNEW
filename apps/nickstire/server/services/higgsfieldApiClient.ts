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
 *   Submit: POST /higgsfield-ai/dop/standard   (settled by the vendor's OpenAPI
 *           spec 2026-08-18; body = prompt + image_url, both REQUIRED)
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
 * WHAT IS AND IS NOT VERIFIED (be precise — this changed on 2026-08-17).
 *
 * VERIFIED LIVE: the base URL, and that Higgsfield's server PARSES this auth
 * header. `scripts/probe-higgsfield-api-key.mts` run with a deliberately bogus
 * key returned **HTTP 401** from platform.higgsfield.ai — not a connection
 * error, not a 404. A 401 is the server saying "these credentials are wrong",
 * which it can only say after understanding the `Authorization: Key id:secret`
 * scheme and routing the request. So the transport, host and auth SHAPE are
 * confirmed against the real service, not just the docs.
 *
 * STILL UNVERIFIED: generation itself — the submit body, the DoP endpoint path
 * (which is why submit tries TWO candidates; see DOP_SUBMIT_PATHS), the status
 * polling shape, and the result URL field. Those are built from
 * docs.higgsfield.ai and the official Node SDK and tested against a mocked
 * `fetch`; exercising them for real spends credits, which is an operator
 * decision. Run the probe first, then one real clip, before trusting this lane
 * for a scheduled reel.
 *
 * `probeHiggsfieldApiCredentials()` is the SAFE first call and costs nothing: it
 * looks up a request id that cannot exist, so 404 means the key works, 401/403
 * means it is rejected, and anything else is reported as UNKNOWN rather than
 * guessed. Reachable via `pnpm exec tsx scripts/probe-higgsfield-api-key.mts`
 * and via the Higgsfield health button on Today -> HQ.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:higgsfield-api");

const BASE_URL = "https://platform.higgsfield.ai";
/**
 * TWO CANDIDATE SUBMIT PATHS, tried in order, because the two authoritative
 * sources disagree and NEITHER can be verified without a working key.
 *
 * SETTLED 2026-08-18 — and worth keeping the history, because the wrong answer was
 * reached by ANALOGY and held for a day. docs.higgsfield.ai documents image
 * generation at `/higgsfield-ai/soul/standard`, so the DoP analogue looked like
 * `/higgsfield-ai/dop/standard`, while the official Node SDK's README calls
 * `higgsfield.subscribe('/v1/image2video/dop', ...)`. The vendor's own OpenAPI spec
 * enumerates all 50 paths: the first EXISTS, the second does NOT, and no path
 * contains "image2video". The live 422 and 403 both came from the first.
 *
 * The same analogy caused the real bug: `input_images: [{type, image_url}]` is the
 * SOUL body shape, and DoP wants a top-level `image_url` string. Reading the spec
 * would have cost one fetch; reasoning by analogy cost a day and 19 green tests
 * that were asserting a request the vendor rejects.
 *
 * WHY A PROBE CANNOT SETTLE IT (measured 2026-08-17). The server checks auth
 * BEFORE routing: a request to `/higgsfield-ai/definitely-not-real` with a bogus
 * key returns `401 {"detail":"Invalid credentials"}`, identical to a real path.
 * So 401 proves the host and auth SCHEME are right and says NOTHING about
 * whether a path exists — a free path-existence probe is impossible, and any
 * future attempt to build one will hit the same wall. Do not re-derive this.
 *
 * Rather than ship a coin flip, the submit tries the documented path and falls
 * through to the SDK path on a 404/405. A 404 costs nothing — auth already
 * succeeded, no generation was queued, no credit was spent — so the first real
 * call self-corrects instead of failing. The path that works is LOGGED so the
 * loser can be deleted once reality is known.
 */
// SETTLED 2026-08-18 by the vendor's own OpenAPI spec, which enumerates all 50
// paths: `/higgsfield-ai/dop/standard` exists, `/v1/image2video/dop` does NOT (no
// path in the spec contains "image2video"). The live 422 and 403 both came from
// the first path, so it is demonstrably the routed one. The comment above said the
// loser should be deleted once reality was known - it is, so it is.
//
// The array stays because the loop that reads it is the thing keeping a future
// path change from being a silent outage. The spec also offers cheaper DoP tiers
// - `/higgsfield-ai/dop/lite` and `/dop/turbo`, identical request schema - which
// is the lever to pull if credit cost per clip becomes the constraint.
const DOP_SUBMIT_PATHS = ["/higgsfield-ai/dop/standard"] as const;

/** Statuses meaning "wrong path", as distinct from "bad request to the right path". */
const PATH_MISS_STATUSES = new Set([404, 405]);

export interface HiggsfieldApiCredentials {
  keyId: string;
  keySecret: string;
}

/**
 * ENV-ONLY resolver. Kept for callers that must stay synchronous, and as the
 * fallback layer beneath the DB. Never logs the secret.
 */
export function higgsfieldApiCredentialsFromEnv(): HiggsfieldApiCredentials | null {
  const keyId = process.env.HIGGSFIELD_API_KEY_ID?.trim();
  const keySecret = process.env.HIGGSFIELD_API_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

let cachedApiCreds: HiggsfieldApiCredentials | null = null;
let apiCredsLoadAttempted = false;

/** Drop the cache so the next read re-queries the DB. Called after a write. */
export function clearRuntimeHiggsfieldApiKeyCache(): void {
  cachedApiCreds = null;
  apiCredsLoadAttempted = false;
}

/**
 * DB-FIRST resolver: `app_secret_kv` rows `higgsfield_api_key_id` /
 * `higgsfield_api_key_secret`, falling back to the env vars.
 *
 * WHY THE DB IS PREFERRED, exactly as it is for the CLI credentials
 * (`getHiggsfieldCredentialsJson`): a Railway env var can only be changed by
 * someone with Railway CLI/dashboard access, and setting one requires a redeploy
 * that measured ~20 minutes to come up. A DB row can be pasted from the admin UI
 * on a phone and takes effect immediately, because the write clears this cache.
 * For an operator whose reel lane is down, that is the difference between a
 * 60-second fix and a deploy cycle.
 *
 * Unlike the CLI credential blob, this one is NEVER rewritten by a rotation —
 * an API key is static, which is the entire reason this lane exists.
 */
export type HiggsfieldApiCredentialsResolution = {
  credentials: HiggsfieldApiCredentials | null;
  /** Where the returned credentials came from. "none" when there are none. */
  store: "app_secret_kv" | "env" | "none";
  /**
   * `null` means a lookup COMPLETED, so a null `credentials` is genuine absence.
   * A string means the store could not be read, so absence is UNKNOWN.
   */
  dbError: string | null;
};

/**
 * WHY THIS RETURNS A RESOLUTION AND NOT JUST A NULLABLE CREDENTIAL (P2 review by
 * Codex on PR #1653, and the sharpest catch of this arc from outside it).
 *
 * `getDb()` builds a LAZY mysql pool: `mysql.createPool` is synchronous and never
 * opens a socket, so a truthy Drizzle handle proves only that DATABASE_URL is
 * SET. If TiDB is unreachable or rejects the credentials, the handle is still
 * truthy and the FAILURE surfaces later, inside the query. A consumer that reads
 * a null credential as "no key configured" therefore announces absence when the
 * truth is "I could not look" — and those need opposite responses: one says paste
 * a key, the other says fix connectivity and do NOT rotate anything.
 *
 * My own probe had exactly that bug while carrying a `dbReachable` check that
 * looked like it prevented it. A presence check wearing a liveness check's name
 * is worse than no check, so the distinction now lives HERE, where every consumer
 * gets it, rather than being re-derived correctly-or-not at four call sites.
 */
export async function resolveHiggsfieldApiCredentials(): Promise<HiggsfieldApiCredentialsResolution> {
  const settle = (dbError: string | null): HiggsfieldApiCredentialsResolution => {
    if (cachedApiCreds) return { credentials: cachedApiCreds, store: "app_secret_kv", dbError };
    const env = higgsfieldApiCredentialsFromEnv();
    if (env) return { credentials: env, store: "env", dbError };
    return { credentials: null, store: "none", dbError };
  };

  // A completed earlier lookup is a real answer: nothing left to be unknown.
  if (apiCredsLoadAttempted) return settle(null);

  // The latch is set only after a load that actually COMPLETED (P2 review,
  // 2026-08-17). Setting it up-front meant a single DB outage or a thrown query
  // pinned `apiCredsLoadAttempted = true` with a null cache forever, so every
  // later call skipped the database and returned only the env fallback — a
  // DB-only key stayed invisible until a config write or a process restart. A
  // transient fault must not become a permanent blind spot.
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) {
      // Not "no key" — no way to ask. DATABASE_URL unset, or the pool could not
      // even be constructed.
      return settle("no database handle (DATABASE_URL unset or pool unavailable)");
    }
    const { appSecretKv } = await import("../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const rows = await d
      .select()
      .from(appSecretKv)
      .where(inArray(appSecretKv.k, ["higgsfield_api_key_id", "higgsfield_api_key_secret"]));
    let id: string | null = null;
    let secret: string | null = null;
    for (const r of rows as { k: string; v: string | null }[]) {
      if (r.k === "higgsfield_api_key_id" && r.v?.trim()) id = r.v.trim();
      if (r.k === "higgsfield_api_key_secret" && r.v?.trim()) secret = r.v.trim();
    }
    // BOTH or neither — a half-configured key would fail every call with a 401
    // and read as "the key is wrong" rather than "the key is incomplete".
    if (id && secret) cachedApiCreds = { keyId: id, keySecret: secret };
    // Reached only on a completed query — with or without rows. "Queried and
    // found nothing" is a real answer worth caching; "could not query" is not.
    apiCredsLoadAttempted = true;
    return settle(null);
  } catch (err) {
    // Never log the values, and never let a DB blip look like "no key" — the env
    // fallback still applies, and the error is REPORTED rather than swallowed so
    // the caller can say UNKNOWN instead of NO.
    const message = err instanceof Error ? err.message : String(err);
    log.error("failed to load Higgsfield API credentials from database", { err: message });
    return settle(message);
  }
}

/**
 * DB-FIRST resolver, thin wrapper over {@link resolveHiggsfieldApiCredentials}.
 * Kept because most callers only need "can I use this lane?" — but any caller
 * that REPORTS on configuration must use the resolution instead, or it will state
 * absence it has not established.
 */
export async function getHiggsfieldApiCredentials(): Promise<HiggsfieldApiCredentials | null> {
  return (await resolveHiggsfieldApiCredentials()).credentials;
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
  explicit?: HiggsfieldApiCredentials,
): Promise<{ healthy: boolean | null; reason: string }> {
  // Default-resolve through the DB-AWARE path, not the env-only one. The same
  // defect as the generator (P1 review): a bare call would have probed the env
  // vars while generation used the DB key, so the health surface could report
  // "not configured" about a lane that was about to run fine — or vice versa.
  const creds = explicit ?? (await getHiggsfieldApiCredentials()) ?? { keyId: "", keySecret: "" };
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
  /**
   * REQUIRED by the vendor spec despite being optional here, because the caller
   * may not have one and the error must name why. A publicly fetchable image URL
   * - the API fetches it server-side.
   *
   * THIS IMAGE DETERMINES THE CLIP'S ASPECT RATIO. DoP has no aspect_ratio
   * parameter (see the body construction), so a 9:16 clip requires a 9:16 still.
   */
  startImageUrl?: string;
}

/**
 * The CLI lane's proven clip arguments - what `buildSeedanceArgs` passes, and
 * therefore what produced every reel this shop has actually published.
 *
 * NOT sent to the API lane. DoP's spec has no duration/resolution/aspect_ratio
 * field at all, so passing these there did nothing; they are kept here because
 * the CLI lane does use them and a test pins that lane's args to these values.
 */

/**
 * MIRRORED FROM THE PROVEN CLI ARG SET, not invented and not from a doc page.
 * `buildSeedanceArgs` in higgsfieldStudio.ts has produced every real reel this
 * shop has published, and it passes exactly:
 *
 *     --aspect_ratio 9:16   --duration 4   --resolution 1080p
 *
 * CORRECTION, 2026-08-18. #1653 added these to the API request body and its commit
 * message claimed the API lane would otherwise have "paid for landscape clips the
 * assembler rejects". THAT WAS WRONG. The vendor's OpenAPI spec defines DoP's whole
 * body as `prompt, image_url, motions, end_image_url, seed, enhance_prompt` - there
 * is no duration, resolution or aspect_ratio field, so those three were ignored and
 * never controlled anything on that lane.
 *
 * What actually sets a DoP clip's shape is the ASPECT RATIO OF THE INPUT STILL,
 * because DoP is image-to-video. So satisfying reelAssembly's 1080x1920 gate is a
 * constraint on `brief.visualWorld.heroFrameUrl`, not something a request parameter
 * can buy. The genuine format risk is real, it just lives one step upstream.
 *
 * These therefore describe the CLI LANE ONLY. They stay exported because a test
 * pins `buildSeedanceArgs` to them, which keeps the lane that does honour them from
 * drifting.
 */
export const REEL_CLIP_DEFAULTS = {
  aspectRatio: "9:16",
  durationSeconds: 4,
  resolution: "1080p",
} as const;

/**
 * Thrown once a generation has been SUBMITTED, i.e. once Higgsfield may bill for
 * it. Carries the request id so a caller can log it, and — critically — tells the
 * caller it MUST NOT retry this clip on another provider.
 *
 * This distinction is the whole reason the class exists. Higgsfield's DoP call
 * has no resumable handle, so a caller that reacts to a post-submit failure by
 * generating the same clip again pays TWICE for one beat. That is not
 * hypothetical: "re-submitting is what doubled the paid spend on every timeout"
 * is the recorded history of the CLI lane, which is why that lane KILLS its child
 * process on timeout rather than abandoning it. A silent provider fallback would
 * have reintroduced exactly that bug with a friendlier face.
 */
export class HiggsfieldApiSubmittedError extends Error {
  readonly requestId: string;
  /** Always true — the marker a caller checks before deciding to retry. */
  readonly spendMayHaveOccurred = true;
  constructor(requestId: string, message: string) {
    super(message);
    this.name = "HiggsfieldApiSubmittedError";
    this.requestId = requestId;
  }
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
  // DB-AWARE, not env-only (P1 review, 2026-08-17). This line read
  // `higgsfieldApiCredentialsFromEnv()` and that defeated the entire feature: with
  // the env vars unset — the phone-only configuration this lane exists for — the
  // CALLER's check passed on the DB key, then this threw "not configured" and
  // generateReelClipVideo fell through to the legacy CLI lane. A key pasted into
  // Settings would never have generated anything.
  //
  // My own test missed it because it asserted the three CALLER files used the
  // DB-aware resolver and excluded this file from that loop — so the one place
  // that actually resolves credentials went unchecked. The test below now covers
  // the generator itself.
  const creds = await getHiggsfieldApiCredentials();
  if (!creds) {
    throw new Error(
      "Higgsfield API credentials not configured — set them in Instagram -> Settings " +
      "(app_secret_kv) or via HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET",
    );
  }

  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  // Matches the CLI lane's floor/default so operator-facing latency expectations
  // do not silently change based on which lane happened to run.
  const timeoutMs = Math.max(60_000, opts.timeoutMs ?? (Number(process.env.HIGGSFIELD_CLI_TIMEOUT_MS) || 6 * 60_000));
  const deadline = Date.now() + timeoutMs;

  // THE VENDOR'S OWN OpenAPI SPEC (docs.higgsfield.ai/docs/openapi.json, read
  // 2026-08-18) DEFINES DoP's ENTIRE REQUEST BODY AS:
  //
  //     required: prompt, image_url
  //     properties: seed, prompt, motions, image_url, end_image_url, enhance_prompt
  //
  // There is NO duration, NO resolution, NO aspect_ratio and NO model field.
  // This file used to send all four, and #1653's commit message claimed they were
  // what kept a clip portrait and priced. That was WRONG and worth stating
  // plainly: unknown fields are simply ignored, so those four never controlled
  // anything. The 422 we measured was about image_url alone.
  //
  // WHAT ACTUALLY DETERMINES PORTRAIT: the ASPECT RATIO OF `image_url`. DoP is
  // image-to-video and inherits its frame from the still. So a 9:16 clip requires
  // a 9:16 hero frame - reelAssembly's 1080x1920 gate cannot be satisfied by a
  // request parameter, only by the input image. That is a real constraint on
  // brief.visualWorld.heroFrameUrl, not a knob here.
  //
  // KEPT, because the spec confirms it is real AND defaults to TRUE:
  // `enhance_prompt`. Letting the vendor rewrite copy server-side would put
  // UNREVIEWED text into a published reel for a business that must not make
  // unsupported claims - a compliance hole, not a quality feature. This is the
  // one format field that was doing work all along.
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    enhance_prompt: false,
  };

  // MEASURED AGAINST THE LIVE API 2026-08-18, then confirmed by the spec:
  //
  //   HTTP 422 {"detail":[{"type":"missing","loc":["body","image_url"],
  //                        "msg":"Field required"}]}
  //
  // `image_url` is a REQUIRED TOP-LEVEL STRING. The old
  // `input_images: [{ type, image_url }]` is the SOUL (text-to-image) shape,
  // carried to a different endpoint by analogy; 53 mocked tests could not see the
  // difference because the mock accepted whatever we sent.
  //
  // A beat with no hero frame therefore cannot use this lane at all, and throwing
  // here is FREE: this is not a HiggsfieldApiSubmittedError, so
  // generateReelClipVideo treats it as PRE-submit and falls back having spent
  // nothing, rather than paying a round-trip for a guaranteed rejection.
  if (!req.startImageUrl) {
    throw new Error(
      "Higgsfield API DoP requires a start image (body.image_url) - it is image-to-video only. " +
        "This beat has no hero frame, so the API lane cannot run it. In production the anchor is " +
        "brief.visualWorld.heroFrameUrl, shared by every beat for identity lock (reelPipeline.ts). " +
        "Nothing was submitted and nothing was spent.",
    );
  }
  body.image_url = req.startImageUrl;

  log.info("submitting Higgsfield API DoP video generation", {
    promptLen: req.prompt.length,
    // Portrait is inherited from this image, not requested - so the URL is the
    // thing worth logging when a clip comes back the wrong shape.
    startImage: req.startImageUrl,
  });

  // Try each candidate path. A 404/405 means "wrong path", and crucially it means
  // NOTHING was queued and NOTHING was billed — so advancing to the next candidate
  // cannot double-charge. Any other non-2xx is a real rejection of a real endpoint
  // and stops immediately rather than blindly retrying elsewhere.
  let submit: { status: number; json: unknown } | null = null;
  let usedPath = "";
  const attempted: string[] = [];
  for (const candidate of DOP_SUBMIT_PATHS) {
    const res = await apiFetch(creds, candidate, { method: "POST", body, timeoutMs: 20_000 });
    attempted.push(`${candidate} -> ${res.status}`);
    if (PATH_MISS_STATUSES.has(res.status)) {
      log.warn("Higgsfield API submit path not found — trying the next candidate", {
        path: candidate,
        status: res.status,
      });
      continue;
    }
    submit = res;
    usedPath = candidate;
    break;
  }
  if (!submit) {
    throw new Error(
      `Higgsfield API submit: no candidate DoP path exists. Tried ${attempted.join(", ")}. ` +
      `Auth succeeded (a wrong KEY returns 401, not 404), so this is a PATH problem: check ` +
      `docs.higgsfield.ai and @higgsfield/client for the current image-to-video endpoint.`,
    );
  }
  if (submit.status < 200 || submit.status >= 300) {
    throw new Error(
      `Higgsfield API submit failed on ${usedPath}: HTTP ${submit.status} ${JSON.stringify(submit.json).slice(0, 300)}`,
    );
  }
  if (usedPath !== DOP_SUBMIT_PATHS[0]) {
    // Worth a loud line: it means the documented path is wrong and the fallback
    // carried the call. Delete the loser from DOP_SUBMIT_PATHS once confirmed.
    log.warn("Higgsfield API submit used the FALLBACK path — the documented one 404'd", { usedPath });
  }
  const submitted = submit.json as SubmitResponse;
  if (!submitted?.request_id) {
    throw new Error(`Higgsfield API submit returned no request_id: ${JSON.stringify(submit.json).slice(0, 300)}`);
  }
  const requestId = submitted.request_id;
  log.info("Higgsfield API generation submitted", { requestId, path: usedPath });

  while (true) {
    if (Date.now() >= deadline) {
      throw new HiggsfieldApiSubmittedError(
        requestId,
        `Higgsfield API generation timed out after ${timeoutMs}ms polling request ${requestId} — ` +
        `the job may still complete server-side and BILL; this request_id was NOT cancelled, only abandoned locally. ` +
        `Do NOT regenerate this clip on another provider: that is how one beat gets paid for twice.`,
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
      throw new HiggsfieldApiSubmittedError(
        requestId,
        `Higgsfield API generation ${result.status} for request ${requestId}: ${result.error ?? "no error detail"}`,
      );
    }
    const url = result.video?.url ?? result.images?.[0]?.url;
    if (!url) {
      throw new HiggsfieldApiSubmittedError(
        requestId,
        `Higgsfield API reported completed but returned no video/image URL for request ${requestId}: ${JSON.stringify(result).slice(0, 300)}`,
      );
    }
    log.info("Higgsfield API generation completed", { requestId });
    return url;
  }
}
