/**
 * NOUR Video Forge client — the `self_hosted` reel video provider.
 *
 * Video Forge (apps/video-forge) is a separately-deployed GPU service that
 * runs open-weight video models (LTX-2.5, Wan 2.2, ...). This module is the
 * ONLY place nickstire talks to it. Reel Factory, assembly, rendered QA,
 * selective repair, the ledger and publishing are unchanged: self_hosted is a
 * provider behind them, not a parallel pipeline.
 *
 * THE LESSONS THIS FILE PRESERVES (each one cost money on another provider):
 *   1. A local timeout does not prove remote work stopped. The idempotency key
 *      is persisted on the beat BEFORE submit, the Forge job id right after, and
 *      a timeout throws a LocalTimeoutError so the pipeline RESUMES the same job.
 *      Resubmitting the same key returns the same job (Forge dedupes), so even
 *      "submit sent, response lost" cannot buy a second render.
 *   2. Timeouts are per PROFILE. A healthy 15-minute DFR render is not a dead
 *      6-minute provider; a genuinely dead one is cancelled at the profile's
 *      hard ceiling or when its heartbeat goes stale. No zombies, no duplicates.
 *   3. An outage is not bad credentials. Every Forge error code maps to message
 *      text shared/providerErrors.ts classifies into the right recovery action.
 *   4. Provider URLs are not production truth. The output is pulled over the
 *      authenticated channel, verified (bytes, sha256, mp4 container), and
 *      re-hosted through storagePut. The GPU box never holds a storage key.
 */
import { createHash, createHmac } from "crypto";
import { createLogger } from "../lib/logger";
import {
  capabilityMismatches,
  computeSourceFromEnv,
  getMediaProfile,
  profileEligibility,
  type MediaModelProfile,
} from "../../shared/mediaModelRegistry";
import { compileForgePrompt, dialectForFamily } from "../../shared/forgePromptAdapter";

const log = createLogger("services:video-forge");

export type ForgeJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ForgeJobView {
  id: string;
  idempotency_key: string;
  profile: string;
  status: ForgeJobStatus;
  progress?: number | null;
  created_at: string;
  started_at?: string | null;
  heartbeat_at?: string | null;
  finished_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  output?: {
    sha256: string;
    bytes: number;
    mime: string;
    width: number;
    height: number;
    fps: number;
    duration_seconds: number;
  } | null;
  gpu_seconds?: number | null;
  gpu_type?: string | null;
  model_version?: string | null;
  workflow_version?: string | null;
  seed?: number | null;
}

export interface ForgeSubmitRequest {
  idempotency_key: string;
  profile: string;
  prompt: string;
  negative_prompt?: string;
  /** base64 image bytes — sent inline so Forge never fetches arbitrary URLs (no SSRF surface). */
  start_image_b64?: string;
  end_image_b64?: string;
  seed?: number;
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  metadata?: Record<string, string | number>;
}

export interface ForgeDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_CLIP_BYTES = 20_000;

/** Terminal Forge failure. The message is phrased for classifyProviderError. */
class VideoForgeTerminalError extends Error {
  readonly forgeTerminal = true as const;
  constructor(readonly code: string, message: string, readonly jobId?: string) {
    super(message);
  }
}

/** Same duck-typed shape reelPipeline.isLocalTimeout recognises. */
class VideoForgeLocalTimeout extends Error {
  readonly isLocalTimeout = true as const;
}

export function videoForgeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VIDEO_FORGE_URL && env.VIDEO_FORGE_SECRET);
}

function resolveForgeProfile(env: NodeJS.ProcessEnv = process.env): MediaModelProfile | undefined {
  return getMediaProfile(env.VIDEO_FORGE_PROFILE || "ltx-2.5-distilled");
}

/**
 * Error code → message text. The prefixes are chosen so the EXISTING provider
 * taxonomy routes them correctly; see providerErrors PATTERNS.
 */
export function forgeErrorMessage(code: string | null | undefined, detail: string | null | undefined): string {
  const c = String(code ?? "unknown").toLowerCase();
  const d = String(detail ?? "").slice(0, 300);
  switch (c) {
    case "capacity_unavailable":
      // Never started — must not consume an attempt (RATE_LIMIT policy).
      return `429 video forge capacity unavailable: ${d}`;
    case "invalid_input":
    case "invalid_reference_image":
    case "unsupported_aspect":
    case "unsupported_duration":
    case "unsupported_fps":
    case "unsupported_resolution":
    case "capability_mismatch":
      return `400 invalid request (${c}): ${d}`;
    case "license_blocked":
    case "config_unavailable":
      return `video forge license_blocked/config_unavailable (${c}): ${d}`;
    case "cancelled":
      return `generation cancelled (forge): ${d}`;
    default:
      // oom, model_load_failure, inference_failure, output_validation_failure,
      // hard_ceiling, stale_heartbeat, worker_restart_lost — the op ran (or
      // tried to) and is terminal; a NEW op is allowed.
      return `generation failed (${c}): ${d}`;
  }
}

function sign(secret: string, ts: string, method: string, path: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${ts}.${method}.${path}.${bodyHash}`).digest("hex");
}

async function forgeFetch(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  deps: ForgeDeps,
  timeoutMs = 30_000,
): Promise<Response> {
  const env = deps.env ?? process.env;
  const base = (env.VIDEO_FORGE_URL || "").replace(/\/+$/, "");
  const secret = env.VIDEO_FORGE_SECRET || "";
  if (!base || !secret) {
    throw new VideoForgeTerminalError("config_unavailable", forgeErrorMessage("config_unavailable", "VIDEO_FORGE_URL / VIDEO_FORGE_SECRET not set"));
  }
  const payload = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor((deps.now ?? Date.now)() / 1000));
  const f = deps.fetchImpl ?? fetch;
  return f(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forge-timestamp": ts,
      "x-forge-signature": sign(secret, ts, method, path, payload),
    },
    body: method === "POST" ? payload : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Forge's own refusals carry `{error_code, detail}`; plain-HTTP errors carry `{detail}`. */
async function readForgeError(res: Response): Promise<{ error_code?: string; detail?: string }> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error_code?: string; detail?: unknown };
    return { error_code: j.error_code, detail: typeof j.detail === "string" ? j.detail : text.slice(0, 200) };
  } catch {
    return { detail: text.slice(0, 200) };
  }
}

/** Codes that mean "this worker will never do this as configured" — pause the lane, never retry. */
const CONFIG_REFUSALS = new Set(["license_blocked", "config_unavailable"]);

async function readJob(res: Response, context: string): Promise<ForgeJobView> {
  if (res.status === 401 || res.status === 403) {
    // A 403 license refusal is NOT a bad signature. Reading it as one classified a
    // license gate as AUTH_INVALID — the exact confusion PROVIDER_CONFIG_BLOCKED exists for.
    const e = await readForgeError(res);
    if (e.error_code && CONFIG_REFUSALS.has(e.error_code)) {
      throw new VideoForgeTerminalError(e.error_code, forgeErrorMessage(e.error_code, e.detail || context));
    }
    throw new Error(`${res.status} unauthorized: video forge rejected the signature (${context})`);
  }
  if (res.status === 503) {
    // 503 is either "busy" or "refusing everything" (no / too-short FORGE_SECRET).
    // The second never clears on its own, so it must not retry as capacity forever.
    const e = await readForgeError(res);
    if ((e.error_code && CONFIG_REFUSALS.has(e.error_code)) || /FORGE_SECRET/.test(e.detail ?? "")) {
      throw new VideoForgeTerminalError("config_unavailable", forgeErrorMessage("config_unavailable", `${context}: ${e.detail ?? "HTTP 503"}`));
    }
    throw new Error(forgeErrorMessage("capacity_unavailable", `${context}: HTTP 503 ${e.detail ?? ""}`));
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    throw new Error(forgeErrorMessage("capacity_unavailable", `${context}: HTTP 429 ${text.slice(0, 200)}`));
  }
  if (res.status === 404 && context === "poll") {
    // The worker no longer knows this job (store lost, container replaced). Re-polling
    // a dead id until attempts run out never recovers; terminal lets the key advance.
    throw new VideoForgeTerminalError("worker_restart_lost", forgeErrorMessage("worker_restart_lost", "video forge has no record of this job (404)"));
  }
  if (res.status === 409) {
    throw new VideoForgeTerminalError("invalid_input", forgeErrorMessage("invalid_input", `${context}: idempotency key reused with a different request`));
  }
  if (res.status === 400 || res.status === 422) {
    const j = (await res.json().catch(() => ({}))) as { error_code?: string; detail?: string };
    throw new VideoForgeTerminalError(j.error_code || "invalid_input", forgeErrorMessage(j.error_code || "invalid_input", j.detail || context));
  }
  if (!res.ok) {
    throw new Error(`video forge ${context} HTTP ${res.status}`);
  }
  const j = (await res.json()) as { job?: ForgeJobView };
  if (!j?.job?.id) throw new Error(`video forge ${context}: malformed response (no job)`);
  return j.job;
}

export async function submitForgeJob(req: ForgeSubmitRequest, deps: ForgeDeps = {}): Promise<ForgeJobView> {
  return readJob(await forgeFetch("POST", "/v1/jobs", req, deps), "submit");
}

async function getForgeJob(id: string, deps: ForgeDeps = {}): Promise<ForgeJobView> {
  return readJob(await forgeFetch("GET", `/v1/jobs/${encodeURIComponent(id)}`, undefined, deps), "poll");
}

async function cancelForgeJob(id: string, deps: ForgeDeps = {}): Promise<void> {
  try {
    await forgeFetch("POST", `/v1/jobs/${encodeURIComponent(id)}/cancel`, {}, deps);
  } catch (e) {
    log.warn("video forge cancel failed (job will still be reclaimed by the worker ceiling)", { id, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface ForgeHealth {
  status: "ready" | "degraded" | "unavailable" | "unknown";
  detail?: Record<string, unknown>;
}

/** Health is UNKNOWN when we cannot ask — never a fabricated "ready". */
export async function getForgeHealth(deps: ForgeDeps = {}): Promise<ForgeHealth> {
  if (!videoForgeConfigured(deps.env)) return { status: "unknown", detail: { reason: "not configured" } };
  try {
    const res = await forgeFetch("GET", "/health", undefined, deps, 10_000);
    if (!res.ok) return { status: "unavailable", detail: { http: res.status } };
    const j = (await res.json()) as { status?: string } & Record<string, unknown>;
    const s = j.status === "ready" || j.status === "degraded" ? j.status : "unknown";
    return { status: s, detail: j };
  } catch (e) {
    return { status: "unavailable", detail: { err: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Poll a job until it succeeds, fails, or the LOCAL window closes.
 *
 * - window closes while queued/running and healthy → VideoForgeLocalTimeout
 *   (resumable; the beat keeps the job id, no attempt consumed)
 * - job age > profile.hardCeilingMs, or running with a stale heartbeat →
 *   cancel, then VideoForgeTerminalError (a new op is allowed)
 * - failed/cancelled → VideoForgeTerminalError with the Forge error code
 */
export async function awaitForgeJob(
  jobId: string,
  profile: MediaModelProfile,
  opts: { pollWindowMs: number; pollIntervalMs?: number; onPoll?: (j: ForgeJobView) => Promise<void> | void },
  deps: ForgeDeps = {},
): Promise<ForgeJobView> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.pollIntervalMs ?? 15_000;
  const deadline = now() + opts.pollWindowMs;
  for (;;) {
    const job = await getForgeJob(jobId, deps);
    if (opts.onPoll) await opts.onPoll(job);
    if (job.status === "succeeded") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      const code = job.status === "cancelled" ? "cancelled" : job.error_code || "inference_failure";
      throw new VideoForgeTerminalError(code, forgeErrorMessage(code, job.error_message), job.id);
    }
    const age = now() - Date.parse(job.created_at);
    if (Number.isFinite(age) && age > profile.timing.hardCeilingMs) {
      await cancelForgeJob(job.id, deps);
      throw new VideoForgeTerminalError("hard_ceiling", forgeErrorMessage("hard_ceiling", `job ${job.id} exceeded ${Math.round(profile.timing.hardCeilingMs / 60_000)}m for ${profile.id}`), job.id);
    }
    if (job.status === "running" && job.heartbeat_at) {
      const silent = now() - Date.parse(job.heartbeat_at);
      if (Number.isFinite(silent) && silent > profile.timing.staleHeartbeatMs) {
        await cancelForgeJob(job.id, deps);
        throw new VideoForgeTerminalError("stale_heartbeat", forgeErrorMessage("stale_heartbeat", `job ${job.id} silent ${Math.round(silent / 1000)}s`), job.id);
      }
    }
    if (now() + interval > deadline) {
      throw new VideoForgeLocalTimeout(`video forge job ${job.id} still ${job.status} after local window — resume same job next pulse`);
    }
    await sleep(interval);
  }
}

/** True for an ISO-BMFF (mp4/mov) container: bytes 4..8 are "ftyp". */
function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp";
}

/** Hard cap when a receipt has no byte count (it always should). */
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

/**
 * Why a hero-frame URL may not be fetched server-side, or null when it may.
 * https only; no IP-literal or localhost hosts; optionally a host allowlist
 * (VIDEO_FORGE_HERO_HOSTS, comma-separated) for when the storage host is fixed.
 */
function heroUrlRefusal(raw: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "hero frame URL is not a URL";
  }
  if (u.protocol !== "https:") return "hero frame URL must be https";
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return "hero frame URL points at an internal host";
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return "hero frame URL must use a hostname, not an IP";
  const allow = (env.VIDEO_FORGE_HERO_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some((h) => host === h || host.endsWith(`.${h}`))) return `hero frame host ${host} is not allowed`;
  return null;
}

/** Verify the output against the job's own receipt before it becomes canonical. */
export function verifyForgeOutput(job: ForgeJobView, buf: Buffer, expect: { width: number; height: number }): void {
  const o = job.output;
  if (!o) throw new VideoForgeTerminalError("output_validation_failure", forgeErrorMessage("output_validation_failure", "succeeded job has no output receipt"), job.id);
  // Transport checks FIRST: a truncated download is retryable (re-download, same
  // job). Checked after the size floor, a short truncation read as a terminal bad
  // clip and bought a new GPU render instead.
  if (buf.length !== o.bytes) throw new Error(`truncated download: video forge output ${buf.length} bytes, receipt says ${o.bytes}`);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== o.sha256) throw new Error(`truncated download: video forge output sha256 mismatch (${sha.slice(0, 12)} vs ${o.sha256.slice(0, 12)})`);
  if (buf.length < MIN_CLIP_BYTES) throw new VideoForgeTerminalError("output_validation_failure", forgeErrorMessage("output_validation_failure", `clip suspiciously small (${buf.length} bytes)`), job.id);
  if (!looksLikeMp4(buf) || !/^video\/mp4$/i.test(o.mime)) throw new VideoForgeTerminalError("output_validation_failure", forgeErrorMessage("output_validation_failure", `not an mp4 (${o.mime})`), job.id);
  if (o.width !== expect.width || o.height !== expect.height) {
    throw new VideoForgeTerminalError("output_validation_failure", forgeErrorMessage("output_validation_failure", `crop/aspect mismatch ${o.width}x${o.height} != ${expect.width}x${expect.height}`), job.id);
  }
}

/** Pull, verify, re-host. Deterministic key → a retried re-host overwrites, never duplicates. */
async function fetchAndRehostForgeOutput(job: ForgeJobView, expect: { width: number; height: number }, deps: ForgeDeps = {}): Promise<string> {
  const res = await forgeFetch("GET", `/v1/jobs/${encodeURIComponent(job.id)}/output`, undefined, deps, 120_000);
  if (res.status === 404) {
    // Succeeded but the file is gone: re-fetching cannot recover it; let the key advance.
    throw new VideoForgeTerminalError("worker_restart_lost", forgeErrorMessage("worker_restart_lost", `output for ${job.id} is missing on the worker`), job.id);
  }
  if (!res.ok) throw new Error(`fetch failed: video forge output HTTP ${res.status}`);
  // Refuse before buffering: the receipt says how big the clip is.
  const declared = Number(res.headers.get("content-length"));
  const cap = (job.output?.bytes ?? MAX_OUTPUT_BYTES) + 1024;
  if (Number.isFinite(declared) && declared > cap) throw new Error(`video forge output ${declared} bytes exceeds receipt (${cap})`);
  const buf = Buffer.from(await res.arrayBuffer());
  verifyForgeOutput(job, buf, expect);
  const { storagePut } = await import("../storage");
  const { url } = await storagePut(`reel-clips/forge-${job.id}.mp4`, buf, "video/mp4");
  return url;
}

/** Read an approved hero frame from our own storage as base64, bounded. */
async function loadReferenceImageB64(url: string, deps: ForgeDeps = {}): Promise<string> {
  // heroFrameUrl is admin-supplied text. Fetching it server-side without a check is a
  // blind SSRF into the Railway network (e.g. a link-local metadata address).
  const refusal = heroUrlRefusal(url, deps.env ?? process.env);
  if (refusal) throw new VideoForgeTerminalError("invalid_reference_image", forgeErrorMessage("invalid_reference_image", refusal));
  const f = deps.fetchImpl ?? fetch;
  const res = await f(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (res.status >= 500 || res.status === 429) {
    // Storage outage, not a bad prompt: retryable, no attempt burned as PROMPT_INVALID.
    throw new Error(`fetch failed: hero frame HTTP ${res.status}`);
  }
  if (!res.ok) throw new VideoForgeTerminalError("invalid_reference_image", forgeErrorMessage("invalid_reference_image", `hero frame HTTP ${res.status}`));
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new VideoForgeTerminalError("invalid_reference_image", forgeErrorMessage("invalid_reference_image", `hero frame ${declared} bytes (max ${MAX_IMAGE_BYTES})`));
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    throw new VideoForgeTerminalError("invalid_reference_image", forgeErrorMessage("invalid_reference_image", `hero frame ${buf.length} bytes (max ${MAX_IMAGE_BYTES})`));
  }
  return buf.toString("base64");
}

/** $ for a measured render. Rented: measured seconds × rate. Owned/existing: the operator's marginal rate (power), default 0 vendor cost — flagged estimate either way. */
function forgeComputeCostUsd(gpuSeconds: number | null | undefined, profile: MediaModelProfile, env: NodeJS.ProcessEnv = process.env): number {
  const seconds = typeof gpuSeconds === "number" && gpuSeconds >= 0 ? gpuSeconds : profile.cost.expectedGpuSeconds;
  const src = computeSourceFromEnv(env);
  const rate =
    src === "rented_gpu"
      ? Number(env.VIDEO_FORGE_USD_PER_GPU_HOUR) || profile.cost.referenceUsdPerGpuHour
      : Number(env.VIDEO_FORGE_MARGINAL_USD_PER_GPU_HOUR) || 0;
  return (seconds / 3600) * rate;
}

/** The beat fields this provider owns (persisted in reel_jobs.payload). */
export interface SelfHostedBeatState {
  beatNumber: number;
  /** Persisted BEFORE submit: Forge dedupes on it, so a lost response is safe to resubmit. */
  selfHostedIdempotencyKey?: string;
  /** Persisted right after submit: resume polls this, never resubmits. */
  selfHostedJobId?: string;
  /** A resume must not silently switch models mid-beat. */
  selfHostedProfile?: string;
  providerOps?: Array<{
    provider: string;
    opId: string;
    at: string;
    outcome: "succeeded" | "failed" | "abandoned";
    receipt?: SelfHostedReceipt;
  }>;
}

export interface SelfHostedReceipt {
  profile: string;
  gpuSeconds: number | null;
  gpuType: string | null;
  modelVersion: string | null;
  workflowVersion: string | null;
  seed: number | null;
  outputSha256: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSeconds: number | null;
  computeUsd: number;
  computeSource: string;
}

export interface RenderSelfHostedInput {
  beat: SelfHostedBeatState;
  /** e.g. `nickstire-reel-<jobId>-b<beat>` or `nickstire-repair-<logicalRepairId>` */
  idempotencyBase: string;
  prompt: string;
  negativePrompt?: string;
  startImageUrl?: string;
  /** write the brief/payload (with the beat's new fields) durably */
  persist: () => Promise<void>;
  /** bump updatedAt so the stuck-job sweeper sees a live render */
  heartbeat?: () => Promise<void>;
  metadata?: Record<string, string | number>;
}

export interface RenderSelfHostedResult {
  url: string;
  receipt: SelfHostedReceipt;
}

function recordOp(beat: SelfHostedBeatState, opId: string, outcome: "succeeded" | "failed" | "abandoned", receipt?: SelfHostedReceipt) {
  if (!Array.isArray(beat.providerOps)) beat.providerOps = [];
  if (beat.providerOps.length >= 50) return;
  beat.providerOps.push({ provider: "self_hosted", opId, at: new Date().toISOString(), outcome, ...(receipt ? { receipt } : {}) });
}

/** 704x1280: LTX and Wan both need multiples of 32. Assembly scales to the reel canvas. */
const DEFAULT_CLIP = { width: 704, height: 1280, durationSeconds: 5, fps: 24 } as const;

function clipShapeFromEnv(env: NodeJS.ProcessEnv = process.env, profile?: MediaModelProfile) {
  // Profile-native first (upstream-verified sizes/fps); env overrides only for
  // deliberate experiments. A global 24fps default broke Wan A14B (16fps native).
  const n = profile?.native;
  return {
    width: Number(env.VIDEO_FORGE_WIDTH) || n?.width || DEFAULT_CLIP.width,
    height: Number(env.VIDEO_FORGE_HEIGHT) || n?.height || DEFAULT_CLIP.height,
    durationSeconds: Number(env.VIDEO_FORGE_DURATION_SECONDS) || n?.durationSeconds || DEFAULT_CLIP.durationSeconds,
    fps: Number(env.VIDEO_FORGE_FPS) || n?.fps || DEFAULT_CLIP.fps,
  };
}

/**
 * Render ONE beat through Video Forge with resume-safe bookkeeping. Used by the
 * generation stage and by selective repair, so both obey the same no-duplicate
 * rules.
 */
export async function renderSelfHostedBeat(input: RenderSelfHostedInput, deps: ForgeDeps = {}): Promise<RenderSelfHostedResult> {
  const env = deps.env ?? process.env;
  const { beat } = input;
  const profile = getMediaProfile(beat.selfHostedProfile) ?? resolveForgeProfile(env);
  const elig = profileEligibility(profile, { allowPreProduction: env.VIDEO_FORGE_ALLOW_PREPRODUCTION === "true" });
  if (!profile || !elig.eligible) {
    throw new VideoForgeTerminalError(
      "license_blocked",
      forgeErrorMessage("license_blocked", `profile ${beat.selfHostedProfile || env.VIDEO_FORGE_PROFILE || "(default)"} not eligible: ${elig.reasons.join(",")}`),
    );
  }
  const shape = clipShapeFromEnv(env, profile);
  // Capability mismatch is decided HERE, before a key exists or a GPU is
  // touched: an unsupported duration/resolution/conditioning is a config
  // problem, and submitting it would only buy a 400 (or worse, a bad render).
  const mismatches = capabilityMismatches(profile, {
    width: shape.width,
    height: shape.height,
    durationSeconds: shape.durationSeconds,
    startImage: Boolean(input.startImageUrl),
    endImage: false,
  }).filter((m) => m !== "image_to_video_unsupported"); // no-I2V profiles simply ignore the hero (below)
  if (mismatches.length) {
    throw new VideoForgeTerminalError("capability_mismatch", forgeErrorMessage("capability_mismatch", `${profile.id}: ${mismatches.join(",")}`));
  }

  // 1. Stable key BEFORE any network call. It only advances after a KNOWN
  //    terminal failure, so retries of an ambiguous submit dedupe at Forge.
  if (!beat.selfHostedIdempotencyKey) {
    const terminalFailures = (beat.providerOps ?? []).filter((o) => o.provider === "self_hosted" && o.outcome !== "succeeded").length;
    beat.selfHostedIdempotencyKey = `${input.idempotencyBase}-${profile.id}-a${terminalFailures}`;
    beat.selfHostedProfile = profile.id;
    await input.persist();
  }

  try {
    // 2. Submit (or re-attach). Same key → Forge returns the existing job.
    if (!beat.selfHostedJobId) {
      const startImage =
        input.startImageUrl && profile.capabilities.imageToVideo ? await loadReferenceImageB64(input.startImageUrl, deps) : undefined;
      const job = await submitForgeJob(
        {
          idempotency_key: beat.selfHostedIdempotencyKey,
          profile: profile.id,
          prompt: compileForgePrompt(input.prompt, dialectForFamily(profile.family), { nativeAudio: profile.capabilities.nativeAudio }),
          negative_prompt: profile.capabilities.negativePrompt ? input.negativePrompt : undefined,
          start_image_b64: startImage,
          duration_seconds: shape.durationSeconds,
          width: shape.width,
          height: shape.height,
          fps: shape.fps,
          metadata: input.metadata,
        },
        deps,
      );
      beat.selfHostedJobId = job.id;
      await input.persist();
    }

    // 3. Poll inside a window shorter than the stuck-job sweeper, heartbeating.
    const pollWindowMs = Number(env.VIDEO_FORGE_POLL_WINDOW_MS) || 5 * 60_000;
    const done = await awaitForgeJob(
      beat.selfHostedJobId,
      profile,
      { pollWindowMs, pollIntervalMs: Number(env.VIDEO_FORGE_POLL_INTERVAL_MS) || 15_000, onPoll: () => input.heartbeat?.() },
      deps,
    );

    // 4. Pull + verify + re-host. A failure here keeps the job id: the render
    //    exists and is paid for; the next pulse re-downloads, never re-renders.
    const url = await fetchAndRehostForgeOutput(done, { width: shape.width, height: shape.height }, deps);
    const receipt: SelfHostedReceipt = {
      profile: profile.id,
      gpuSeconds: done.gpu_seconds ?? null,
      gpuType: done.gpu_type ?? null,
      modelVersion: done.model_version ?? null,
      workflowVersion: done.workflow_version ?? null,
      seed: done.seed ?? null,
      outputSha256: done.output?.sha256 ?? null,
      bytes: done.output?.bytes ?? null,
      width: done.output?.width ?? null,
      height: done.output?.height ?? null,
      fps: done.output?.fps ?? null,
      durationSeconds: done.output?.duration_seconds ?? null,
      computeUsd: forgeComputeCostUsd(done.gpu_seconds, profile, env),
      computeSource: computeSourceFromEnv(env),
    };
    recordOp(beat, done.id, "succeeded", receipt);
    delete beat.selfHostedJobId;
    delete beat.selfHostedIdempotencyKey;
    delete beat.selfHostedProfile;
    await input.persist();
    log.info("video forge clip rendered + re-hosted", { jobId: done.id, profile: profile.id, gpuSeconds: receipt.gpuSeconds });
    return { url, receipt };
  } catch (err) {
    if (err instanceof VideoForgeTerminalError) {
      // Known-terminal: history first, then free the handles so the NEXT
      // attempt gets a fresh key. A capability/license refusal before submit
      // has no job id and nothing to record.
      const opId = err.jobId ?? beat.selfHostedJobId;
      if (opId) recordOp(beat, opId, "failed");
      // Refused at submit (400/409) — no job exists, but the KEY must still
      // advance: a 409 means the request changed under the same key (e.g. a
      // regenerated prompt), and reusing it would 409 forever.
      else if (beat.selfHostedIdempotencyKey) recordOp(beat, beat.selfHostedIdempotencyKey, "abandoned");
      if (opId || err.code !== "license_blocked") {
        delete beat.selfHostedJobId;
        delete beat.selfHostedIdempotencyKey;
        delete beat.selfHostedProfile;
      }
      await input.persist().catch(() => undefined);
    }
    throw err;
  }
}
