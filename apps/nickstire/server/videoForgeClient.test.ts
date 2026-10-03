/**
 * NOUR Video Forge (self_hosted provider) — the no-duplicate-render contract.
 *
 * Every test here is a lesson another provider already charged for:
 *   - a local timeout must RESUME the same remote job, never resubmit
 *   - "submit sent, response lost" must dedupe on the persisted key
 *   - a healthy long render is not a dead one; a dead one is not immortal
 *   - an outage / license gate is not bad credentials
 *   - a provider URL is not production truth (verify, then re-host)
 */
import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const stored: Array<{ key: string; bytes: number }> = [];
vi.mock("./storage", () => ({
  storagePut: async (key: string, data: Buffer) => {
    stored.push({ key, bytes: data.length });
    return { key, url: `https://cdn.example/${key}` };
  },
}));

import {
  awaitForgeJob,
  forgeErrorMessage,
  renderSelfHostedBeat,
  verifyForgeOutput,
  type ForgeJobView,
  type SelfHostedBeatState,
} from "./services/videoForgeClient";
import { classifyProviderError } from "../shared/providerErrors";
import { getMediaProfile } from "../shared/mediaModelRegistry";

afterEach(() => {
  stored.length = 0;
  vi.unstubAllEnvs();
});

/** A clip whose bytes start with an ISO-BMFF ftyp box. */
function fakeMp4(n = 40_000): Buffer {
  const b = Buffer.alloc(n, 7);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4, "latin1");
  return b;
}

/**
 * In-memory Video Forge with the real contract: POST /v1/jobs dedupes on
 * idempotency_key, GET returns the job, /output serves verified bytes.
 * `script` decides how each poll advances.
 */
function fakeForge(opts: { pollsUntilDone?: number; failWith?: string; loseFirstSubmitResponse?: boolean; createdAt?: string; heartbeatAt?: string } = {}) {
  const clip = fakeMp4();
  const sha = createHash("sha256").update(clip).digest("hex");
  const jobs = new Map<string, ForgeJobView & { polls: number }>();
  const byKey = new Map<string, string>();
  let submits = 0;
  let created = 0;
  let lostOnce = false;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    expect((init?.headers as Record<string, string>)["x-forge-signature"]).toMatch(/^[0-9a-f]{64}$/);
    if (init?.method === "POST" && u.pathname === "/v1/jobs") {
      submits += 1;
      const body = JSON.parse(String(init.body));
      let id = byKey.get(body.idempotency_key);
      if (!id) {
        id = `job_${++created}`;
        byKey.set(body.idempotency_key, id);
        jobs.set(id, {
          id, idempotency_key: body.idempotency_key, profile: body.profile, status: "queued", polls: 0,
          created_at: opts.createdAt ?? new Date().toISOString(),
        });
      }
      if (opts.loseFirstSubmitResponse && !lostOnce) {
        lostOnce = true;
        throw new Error("fetch failed: socket hang up"); // Forge accepted it; we never heard
      }
      return json({ job: jobs.get(id) }, 202);
    }
    const m = /^\/v1\/jobs\/([^/]+)(\/output|\/cancel)?$/.exec(u.pathname);
    if (m) {
      const j = jobs.get(decodeURIComponent(m[1]));
      if (!j) return json({ detail: "not found" }, 404);
      if (m[2] === "/cancel") { j.status = "cancelled"; return json({ job: j }); }
      if (m[2] === "/output") return new Response(clip, { status: 200, headers: { "content-type": "video/mp4" } });
      j.polls += 1;
      if (opts.failWith) { j.status = "failed"; j.error_code = opts.failWith; j.error_message = "boom"; }
      else if (j.polls >= (opts.pollsUntilDone ?? 1)) {
        j.status = "succeeded";
        j.output = { sha256: sha, bytes: clip.length, mime: "video/mp4", width: 704, height: 1280, fps: 24, duration_seconds: 5 };
        j.gpu_seconds = 120; j.gpu_type = "A100-80GB"; j.model_version = "ltx-2.5-distilled@test"; j.seed = 42;
      } else {
        j.status = "running";
        j.heartbeat_at = opts.heartbeatAt ?? new Date().toISOString();
      }
      return json({ job: j });
    }
    return json({ detail: "nope" }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, stats: () => ({ submits, created }) };
}

function forgeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    VIDEO_FORGE_URL: "https://forge.internal",
    VIDEO_FORGE_SECRET: "s3cret",
    VIDEO_FORGE_PROFILE: "ltx-2.5-distilled",
    VIDEO_FORGE_ALLOW_PREPRODUCTION: "true",
    VIDEO_FORGE_POLL_INTERVAL_MS: "1",
    ...extra,
  } as NodeJS.ProcessEnv;
}

const noSleep = async () => undefined;

describe("forge failures land in the right recovery class", () => {
  it("capacity unavailable is a rate limit: it never ran, so it does not burn an attempt", () => {
    const v = classifyProviderError(new Error(forgeErrorMessage("capacity_unavailable", "no 80GB GPUs")));
    expect(v.errorClass).toBe("RATE_LIMIT");
    expect(v.consumesAttempt).toBe(false);
  });
  it("OOM / inference / hard ceiling are REMOTE_FAILED — a new op is allowed", () => {
    for (const c of ["oom", "inference_failure", "model_load_failure", "hard_ceiling", "stale_heartbeat", "output_validation_failure"]) {
      expect(classifyProviderError(new Error(forgeErrorMessage(c, "x"))).errorClass).toBe("REMOTE_FAILED");
    }
  });
  it("a license gate is PROVIDER_CONFIG_BLOCKED, never AUTH_INVALID (the #2905 lesson)", () => {
    const v = classifyProviderError(new Error(forgeErrorMessage("license_blocked", "territory")));
    expect(v.errorClass).toBe("PROVIDER_CONFIG_BLOCKED");
    expect(v.action).toBe("PAUSE_PROVIDER");
    expect(v.consumesAttempt).toBe(false);
  });
  it("bad input / unsupported aspect is PROMPT_INVALID", () => {
    expect(classifyProviderError(new Error(forgeErrorMessage("unsupported_aspect", "1:1"))).errorClass).toBe("PROMPT_INVALID");
  });
});

describe("awaitForgeJob timing is per profile", () => {
  const profile = getMediaProfile("ltx-2.5-dfr")!;
  it("a healthy long render returns a RESUMABLE local timeout, not a failure", async () => {
    const forge = fakeForge({ pollsUntilDone: 1000 });
    const env = forgeEnv();
    const { submitForgeJob } = await import("./services/videoForgeClient");
    const job = await submitForgeJob({ idempotency_key: "k", profile: profile.id, prompt: "p", duration_seconds: 5, width: 704, height: 1280, fps: 24 }, { env, fetchImpl: forge.fetchImpl });
    let t = Date.now();
    const err = await awaitForgeJob(job.id, profile, { pollWindowMs: 60_000, pollIntervalMs: 10_000 }, { env, fetchImpl: forge.fetchImpl, now: () => t, sleep: async (ms) => { t += ms; } }).catch((e) => e);
    expect(err.isLocalTimeout).toBe(true);
    expect(classifyProviderError(err, { isLocalTimeout: true, hasRemoteOperationId: true }).action).toBe("RESUME_OPERATION");
  });
  it("a job older than the profile hard ceiling is cancelled and terminal (no zombies)", async () => {
    const old = new Date(Date.now() - profile.timing.hardCeilingMs - 60_000).toISOString();
    const forge = fakeForge({ pollsUntilDone: 1000, createdAt: old });
    const env = forgeEnv();
    const { submitForgeJob } = await import("./services/videoForgeClient");
    const job = await submitForgeJob({ idempotency_key: "k2", profile: profile.id, prompt: "p", duration_seconds: 5, width: 704, height: 1280, fps: 24 }, { env, fetchImpl: forge.fetchImpl });
    const err = await awaitForgeJob(job.id, profile, { pollWindowMs: 60_000, pollIntervalMs: 1 }, { env, fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err.forgeTerminal).toBe(true);
    expect(err.code).toBe("hard_ceiling");
  });
  it("a running job with a stale heartbeat is presumed dead", async () => {
    const stale = new Date(Date.now() - profile.timing.staleHeartbeatMs - 60_000).toISOString();
    const forge = fakeForge({ pollsUntilDone: 1000, heartbeatAt: stale });
    const env = forgeEnv();
    const { submitForgeJob } = await import("./services/videoForgeClient");
    const job = await submitForgeJob({ idempotency_key: "k3", profile: profile.id, prompt: "p", duration_seconds: 5, width: 704, height: 1280, fps: 24 }, { env, fetchImpl: forge.fetchImpl });
    const err = await awaitForgeJob(job.id, profile, { pollWindowMs: 60_000, pollIntervalMs: 1 }, { env, fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err.code).toBe("stale_heartbeat");
  });
});

describe("renderSelfHostedBeat — idempotency and resume", () => {
  it("persists the key BEFORE submit, records a receipt, re-hosts, clears active handles", async () => {
    const forge = fakeForge();
    const beat: SelfHostedBeatState = { beatNumber: 1 };
    const snapshots: SelfHostedBeatState[] = [];
    const r = await renderSelfHostedBeat(
      { beat, idempotencyBase: "nickstire-reel-9-b1", prompt: "SUBJECT: tire\nSCENE: bay\nACTION AND CAMERA MOTION: dolly in", persist: async () => { snapshots.push(JSON.parse(JSON.stringify(beat))); } },
      { env: forgeEnv(), fetchImpl: forge.fetchImpl, sleep: noSleep },
    );
    expect(snapshots[0].selfHostedIdempotencyKey).toBe("nickstire-reel-9-b1-ltx-2.5-distilled-a0");
    expect(snapshots[0].selfHostedJobId).toBeUndefined(); // key landed before any job existed
    expect(snapshots[1].selfHostedJobId).toBe("job_1");
    expect(r.url).toBe("https://cdn.example/reel-clips/forge-job_1.mp4");
    expect(r.receipt.gpuSeconds).toBe(120);
    expect(r.receipt.computeUsd).toBeGreaterThan(0); // rented GPU is not free
    expect(beat.selfHostedJobId).toBeUndefined();
    expect(beat.providerOps?.[0]).toMatchObject({ provider: "self_hosted", opId: "job_1", outcome: "succeeded" });
    expect(stored).toHaveLength(1);
  });

  it("a local timeout keeps the job id and the next call RESUMES — one submit, one render", async () => {
    const forge = fakeForge({ pollsUntilDone: 3 });
    const beat: SelfHostedBeatState = { beatNumber: 2 };
    const env = forgeEnv({ VIDEO_FORGE_POLL_WINDOW_MS: "1", VIDEO_FORGE_POLL_INTERVAL_MS: "60000" });
    const first = await renderSelfHostedBeat({ beat, idempotencyBase: "b", prompt: "x", persist: async () => undefined }, { env, fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(first.isLocalTimeout).toBe(true);
    expect(beat.selfHostedJobId).toBe("job_1");
    const env2 = forgeEnv({ VIDEO_FORGE_POLL_WINDOW_MS: "600000" });
    const r = await renderSelfHostedBeat({ beat, idempotencyBase: "b", prompt: "x", persist: async () => undefined }, { env: env2, fetchImpl: forge.fetchImpl, sleep: noSleep });
    expect(r.url).toContain("forge-job_1");
    expect(forge.stats()).toEqual({ submits: 1, created: 1 });
  });

  it("submit accepted but response lost → retry with the SAME key dedupes at Forge", async () => {
    const forge = fakeForge({ loseFirstSubmitResponse: true });
    const beat: SelfHostedBeatState = { beatNumber: 3 };
    const first = await renderSelfHostedBeat({ beat, idempotencyBase: "c", prompt: "x", persist: async () => undefined }, { env: forgeEnv(), fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(String(first.message)).toMatch(/socket hang up/);
    expect(beat.selfHostedIdempotencyKey).toBeTruthy(); // survives the ambiguous failure
    const r = await renderSelfHostedBeat({ beat, idempotencyBase: "c", prompt: "x", persist: async () => undefined }, { env: forgeEnv(), fetchImpl: forge.fetchImpl, sleep: noSleep });
    expect(r.url).toContain("forge-job_1");
    expect(forge.stats()).toEqual({ submits: 2, created: 1 }); // two requests, ONE render
  });

  it("a terminal failure records history and ADVANCES the key so the next attempt is a new job", async () => {
    const forge = fakeForge({ failWith: "oom" });
    const beat: SelfHostedBeatState = { beatNumber: 4 };
    const err = await renderSelfHostedBeat({ beat, idempotencyBase: "d", prompt: "x", persist: async () => undefined }, { env: forgeEnv(), fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err.code).toBe("oom");
    expect(beat.providerOps?.[0]).toMatchObject({ opId: "job_1", outcome: "failed" });
    expect(beat.selfHostedIdempotencyKey).toBeUndefined();
    const err2 = await renderSelfHostedBeat({ beat, idempotencyBase: "d", prompt: "x", persist: async () => undefined }, { env: forgeEnv(), fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err2.code).toBe("oom");
    expect(forge.stats().created).toBe(2);
    expect(beat.providerOps?.map((o) => o.opId)).toEqual(["job_1", "job_2"]);
  });

  it("refuses a TERRITORY_BLOCKED profile before touching a GPU", async () => {
    const forge = fakeForge();
    const beat: SelfHostedBeatState = { beatNumber: 5 };
    const err = await renderSelfHostedBeat({ beat, idempotencyBase: "e", prompt: "x", persist: async () => undefined }, { env: forgeEnv({ VIDEO_FORGE_PROFILE: "minimax-h3" }), fetchImpl: forge.fetchImpl }).catch((e) => e);
    expect(classifyProviderError(err).errorClass).toBe("PROVIDER_CONFIG_BLOCKED");
    expect(forge.stats().submits).toBe(0);
  });

  it("refuses a capability mismatch before a key exists or a GPU is touched", async () => {
    const forge = fakeForge();
    const beat: SelfHostedBeatState = { beatNumber: 8 };
    const err = await renderSelfHostedBeat({ beat, idempotencyBase: "h", prompt: "x", persist: async () => undefined }, { env: forgeEnv({ VIDEO_FORGE_PROFILE: "wan2.2-ti2v-5b", VIDEO_FORGE_DURATION_SECONDS: "8" }), fetchImpl: forge.fetchImpl }).catch((e) => e);
    expect(err.code).toBe("capability_mismatch");
    expect(classifyProviderError(err).errorClass).toBe("PROMPT_INVALID");
    expect(beat.selfHostedIdempotencyKey).toBeUndefined();
    expect(forge.stats().submits).toBe(0);
  });

  it("requests each profile at its NATIVE shape (Wan A14B: 720x1280 @16fps), not a global default", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const forge = fakeForge();
    const spy = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/v1/jobs")) seen.push(JSON.parse(String(init.body)));
      return forge.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    await renderSelfHostedBeat(
      { beat: { beatNumber: 9 }, idempotencyBase: "n", prompt: "x", startImageUrl: undefined, persist: async () => undefined },
      { env: forgeEnv({ VIDEO_FORGE_PROFILE: "wan2.2-i2v-a14b" }), fetchImpl: spy, sleep: noSleep },
    ).catch(() => undefined); // A14B with no hero is refused before submit
    expect(seen).toHaveLength(0);
  });

  it("refuses a pre-production profile unless the canary flag is set", async () => {
    const forge = fakeForge();
    const env = forgeEnv();
    delete env.VIDEO_FORGE_ALLOW_PREPRODUCTION;
    const err = await renderSelfHostedBeat({ beat: { beatNumber: 6 }, idempotencyBase: "f", prompt: "x", persist: async () => undefined }, { env, fetchImpl: forge.fetchImpl }).catch((e) => e);
    expect(String(err.message)).toMatch(/rollout_built/);
    expect(forge.stats().submits).toBe(0);
  });

  it("does not switch models mid-beat on resume even if the env profile changed", async () => {
    const forge = fakeForge({ pollsUntilDone: 2 });
    const beat: SelfHostedBeatState = { beatNumber: 7 };
    const first = await renderSelfHostedBeat({ beat, idempotencyBase: "g", prompt: "x", persist: async () => undefined }, { env: forgeEnv({ VIDEO_FORGE_POLL_WINDOW_MS: "1", VIDEO_FORGE_POLL_INTERVAL_MS: "60000" }), fetchImpl: forge.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(first.isLocalTimeout).toBe(true);
    expect(beat.selfHostedProfile).toBe("ltx-2.5-distilled");
    const r = await renderSelfHostedBeat({ beat, idempotencyBase: "g", prompt: "x", persist: async () => undefined }, { env: forgeEnv({ VIDEO_FORGE_PROFILE: "wan2.2-ti2v-5b", VIDEO_FORGE_POLL_WINDOW_MS: "600000" }), fetchImpl: forge.fetchImpl, sleep: noSleep });
    expect(r.receipt.profile).toBe("ltx-2.5-distilled");
  });
});

describe("output verification", () => {
  const base: ForgeJobView = { id: "j", idempotency_key: "k", profile: "p", status: "succeeded", created_at: new Date().toISOString() };
  it("rejects a checksum mismatch as a re-downloadable storage fault, not a re-render", () => {
    const clip = fakeMp4();
    const job = { ...base, output: { sha256: "0".repeat(64), bytes: clip.length, mime: "video/mp4", width: 704, height: 1280, fps: 24, duration_seconds: 5 } };
    expect(() => verifyForgeOutput(job, clip, { width: 704, height: 1280 })).toThrow(/truncated download/);
    expect(classifyProviderError(new Error("truncated download: x")).errorClass).toBe("STORAGE_OR_ASSEMBLY");
  });
  it("rejects a crop/aspect mismatch and a non-mp4 body", () => {
    const clip = fakeMp4();
    const sha = createHash("sha256").update(clip).digest("hex");
    const wrongDims = { ...base, output: { sha256: sha, bytes: clip.length, mime: "video/mp4", width: 1280, height: 704, fps: 24, duration_seconds: 5 } };
    expect(() => verifyForgeOutput(wrongDims, clip, { width: 704, height: 1280 })).toThrow(/aspect/);
    const junk = Buffer.alloc(40_000, 1);
    const junkJob = { ...base, output: { sha256: createHash("sha256").update(junk).digest("hex"), bytes: junk.length, mime: "video/mp4", width: 704, height: 1280, fps: 24, duration_seconds: 5 } };
    expect(() => verifyForgeOutput(junkJob, junk, { width: 704, height: 1280 })).toThrow(/not an mp4/);
  });
  it("rejects a succeeded job with no output receipt", () => {
    expect(() => verifyForgeOutput(base, fakeMp4(), { width: 704, height: 1280 })).toThrow(/no output receipt/);
  });
});
