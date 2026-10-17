/**
 * External clips door (2026-10-16): attach per-beat clips rendered OUTSIDE the
 * pipeline (the higgsfield.ai web app's Unlimited models, driven by the
 * operator) to an existing reel job, so the normal assembly, rendered QA,
 * approval and publish drain take over unchanged.
 *
 * What it does, in order, all before any write:
 *   0. startFrame ("none" | "shop_still", required) is the operator's attestation, stored on the record;
 *   1. the job exists and is `needs_regen` or `queued` (never assembled/posted);
 *   2. one clip per GENERATED beat (same rule as the enqueue reservation in
 *      reelPipeline.ts: beatGenerationRoute(b) === "generate"); a local beat
 *      (bound real / drawn card) must already hold its resolved clip;
 *   3. every URL is https; durable storage is configured;
 *   4. per clip, in order: bounded SSRF-guarded download, ftyp sniff, ffprobe
 *      duration >= the 4 s beat; the first bad clip refuses the whole attach;
 *   5. re-host through storagePut (vendor CDN URLs expire; assembly downloads
 *      at assembly time). Vendor URLs survive only in payload.externalClips;
 *   6. ONE compare-and-swap UPDATE, then one audit row.
 *
 * Disclosure: a re-hosted URL loses the vendor's filename stamp, and
 * shouldDiscloseAi then falls back to REEL_VIDEO_PROVIDER, which is false
 * under a template_stock or self_hosted pin. So the storage key itself carries
 * the provider segment (`higgsfield-external-...`), which clipProvenance reads
 * as generative under EVERY pin, and the attach refuses if a re-hosted URL
 * somehow does not read that way. These are AI clips: Rule 1 forbids framing
 * them as real, so they never get a real_shop lineage row.
 */
import { and, eq, isNull } from "drizzle-orm";
import { reelJobs } from "../../drizzle/schema";
import { beatGenerationRoute } from "../../shared/shotRouter";
import { clipProvenance, EXTERNAL_CLIP_KEY_SEGMENT } from "../../shared/reelDisclosure";
import { parseReelJobPayload } from "../../shared/reelJobPayload";
import { queueStateForReelStatus } from "../../shared/reelQueue";
import { REEL_OUTPUT_RULES } from "../../client/src/lib/facelessReelStudio";
import { affectedRowCount } from "../lib/db-affected";
import { createLogger } from "../lib/logger";

const log = createLogger("services:external-clips");

const ATTACHABLE_STATUSES = ["needs_regen", "queued"] as const;
// A 1080x1920 8 s clip at a high web-app bitrate is 5-20 MB; 60 MB is 3x the top of that.
const MAX_CLIP_BYTES = 60 * 1024 * 1024;
// One clip of that size over a slow CDN hop; the web app's download links are not streamed.
const CLIP_TIMEOUT_MS = 60_000;

/** What the operator attests each clip was generated from: "none" = text-to-video with no start
 *  photograph, "shop_still" = image-to-video from the shop still. Required, no default: only an
 *  explicit "none" lets rendered QA judge the reel on its lens world (renderedQa.clipsWereTextOnly). */
const START_FRAMES = ["none", "shop_still"] as const;
type AttachInput = { jobId: number; clipUrls: string[]; source: "higgsfield-web"; startFrame: (typeof START_FRAMES)[number]; model?: string; note?: string };
type AttachResult = { ok: true; jobId: number; clipCount: number; rehostedUrls: string[] } | { ok: false; refusal: string };
type JobRow = { id: number; status: string; payload: string; clipUrlsJson: string | null };

type Deps = {
  // drizzle-shaped; only select/update are used
  database: any;
  fetchClip: (url: string) => Promise<Buffer>;
  probeDurationSec: (buf: Buffer) => Promise<number>;
  putClip: (key: string, buf: Buffer) => Promise<string>;
  assertDurable: () => void;
  audit: (e: { actionType: string; decision: "OK" | "REFUSED"; reasoningCodes: string[]; context: unknown }) => Promise<void>;
  now: () => Date;
};

const defaultDeps: Omit<Deps, "database" | "assertDurable"> = {
  fetchClip: async (url) => {
    const { fetchPublicBounded } = await import("../lib/publicFetch");
    return fetchPublicBounded(url, { maxBytes: MAX_CLIP_BYTES, timeoutMs: CLIP_TIMEOUT_MS, maxRedirects: 3, label: "external clip" });
  },
  probeDurationSec: async (buf) => {
    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");
    const file = path.join(os.tmpdir(), `external-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
    await fs.promises.writeFile(file, buf);
    try {
      const { probeMaster } = await import("./externalMasterFinish");
      return (await probeMaster(file)).durationSec;
    } finally {
      await fs.promises.unlink(file).catch(() => {});
    }
  },
  putClip: async (key, buf) => {
    const { storagePut } = await import("../storage");
    return (await storagePut(key, buf, "video/mp4")).url;
  },
  audit: async (e) => {
    const { recordAuditEvent, getActivePolicy } = await import("./autonomyControl");
    let policyVersion = 0;
    try { policyVersion = (await getActivePolicy()).version; } catch { /* degraded policy loader; the audit still records */ }
    await recordAuditEvent({ ...e, policyVersion });
  },
  now: () => new Date(),
};

/** Fill only what the caller did not inject, so a test never loads the real db or storage. */
async function resolveDeps(o: Partial<Deps>): Promise<Deps> {
  let database = o.database;
  if (database === undefined) {
    try { const { getDb } = await import("../db"); database = await getDb(); } catch { database = null; }
  }
  let assertDurable = o.assertDurable;
  if (!assertDurable) {
    const { assertDurableStorageForGeneration } = await import("../storage");
    assertDurable = () => assertDurableStorageForGeneration("external clips attach");
  }
  return { ...defaultDeps, ...o, database, assertDurable };
}

const isMp4 = (buf: Buffer) => buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function attachExternalClips(input: AttachInput, ctx: { attachedBy: string }, overrides: Partial<Deps> = {}): Promise<AttachResult> {
  const deps = await resolveDeps(overrides);
  const refuse = async (code: string, refusal: string): Promise<AttachResult> => {
    await deps.audit({ actionType: "attach_external_clips", decision: "REFUSED", reasoningCodes: [code], context: { jobId: input.jobId, source: input.source, model: input.model ?? null, clipCount: input.clipUrls?.length ?? null, refusal } }).catch(() => {});
    log.info("external clips attach refused", { jobId: input.jobId, code, refusal });
    return { ok: false, refusal };
  };

  // The router's zod enum is the first gate; this one covers a direct caller of this export.
  const startFrame: unknown = (input as { startFrame?: unknown }).startFrame;
  if (startFrame === undefined || startFrame === null) {
    return refuse("START_FRAME_MISSING", `No start frame given: say whether the clips used the shop still ("shop_still") or no start photograph ("none").`);
  }
  if (!(START_FRAMES as readonly unknown[]).includes(startFrame)) {
    return refuse("START_FRAME_INVALID", `Start frame ${JSON.stringify(startFrame).slice(0, 40)} is not one of ${START_FRAMES.join(", ")}.`);
  }

  if (!deps.database) return refuse("DB_UNAVAILABLE", "Database unavailable: the job cannot be read.");
  const rows: JobRow[] = await deps.database
    .select({ id: reelJobs.id, status: reelJobs.status, payload: reelJobs.payload, clipUrlsJson: reelJobs.clipUrlsJson })
    .from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
  const job = rows[0];
  if (!job) return refuse("JOB_NOT_FOUND", `Reel job ${input.jobId} not found.`);
  if (!(ATTACHABLE_STATUSES as readonly string[]).includes(job.status)) {
    return refuse("BAD_STATUS", `Reel job ${job.id} is in status ${job.status}; clips attach only to a needs_regen or queued job.`);
  }

  const payload = parseReelJobPayload(job.payload);
  const beats = payload.storyboardBeats ?? [];
  if (!beats.length) return refuse("NO_BEATS", `Reel job ${job.id} has no storyboard beats (payload missing or unreadable).`);
  const generatedIdx = beats.map((b, i) => (beatGenerationRoute(b as never) === "generate" ? i : -1)).filter((i) => i >= 0);
  if (input.clipUrls.length !== generatedIdx.length) {
    return refuse("COUNT_MISMATCH", `Got ${input.clipUrls.length} clips; reel job ${job.id} has ${generatedIdx.length} generated beats.`);
  }
  let existing: unknown[] = [];
  try { const p = job.clipUrlsJson ? JSON.parse(job.clipUrlsJson) : []; if (Array.isArray(p)) existing = p; } catch { existing = []; }
  for (let i = 0; i < beats.length; i++) {
    if (generatedIdx.includes(i)) continue;
    const clip = existing[i];
    if (!(typeof clip === "string" && clip.startsWith("http"))) {
      return refuse("LOCAL_BEAT_UNRESOLVED", `Beat ${beats[i].beatNumber} is a ${beatGenerationRoute(beats[i] as never)} beat with no resolved clip yet; this door attaches generated beats only.`);
    }
  }
  for (let i = 0; i < input.clipUrls.length; i++) {
    let ok = false;
    try { ok = new URL(input.clipUrls[i]).protocol === "https:"; } catch { ok = false; }
    if (!ok) return refuse("NOT_HTTPS", `Clip ${i + 1} is not an https URL.`);
  }
  try { deps.assertDurable(); } catch (e) {
    return refuse("NO_DURABLE_STORAGE", `No durable storage: re-hosted clips would be lost on the next deploy. ${errText(e)}`);
  }

  // Validate every clip before re-hosting any, so a bad clip 5 leaves nothing behind.
  const bodies: Buffer[] = [];
  for (let i = 0; i < input.clipUrls.length; i++) {
    let buf: Buffer;
    try { buf = await deps.fetchClip(input.clipUrls[i]); } catch (e) {
      return refuse("DOWNLOAD_FAILED", `Clip ${i + 1} download failed: ${errText(e)}`);
    }
    if (!isMp4(buf)) return refuse("NOT_MP4", `Clip ${i + 1} is not an MP4 (no ftyp box in the first bytes).`);
    let sec: number;
    try { sec = await deps.probeDurationSec(buf); } catch (e) {
      return refuse("PROBE_FAILED", `Clip ${i + 1} could not be probed: ${errText(e)}`);
    }
    if (!(sec >= REEL_OUTPUT_RULES.maxClipSeconds)) {
      return refuse("TOO_SHORT", `Clip ${i + 1} is ${sec}s; each beat needs at least ${REEL_OUTPUT_RULES.maxClipSeconds}s.`);
    }
    bodies.push(buf);
  }

  const stamp = deps.now().getTime();
  const rehostedUrls: string[] = [];
  for (let k = 0; k < bodies.length; k++) {
    const beatNumber = beats[generatedIdx[k]].beatNumber;
    // The `higgsfield-` segment is the disclosure marker (see the header): keep it.
    const key = `reel-clips/${EXTERNAL_CLIP_KEY_SEGMENT}${job.id}-b${beatNumber}-${stamp}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    try { rehostedUrls.push(await deps.putClip(key, bodies[k])); } catch (e) {
      return refuse("REHOST_FAILED", `Clip ${k + 1} re-host failed: ${errText(e)}`);
    }
  }
  if (clipProvenance(JSON.stringify(rehostedUrls)) !== "generative") {
    return refuse("DISCLOSURE_MARKER_LOST", "Re-hosted clip URLs do not read as AI-generated, so the reel would publish without the AI label. Not attached.");
  }

  const clips: unknown[] = beats.map((_, i) => existing[i] ?? null);
  generatedIdx.forEach((beatIdx, k) => { clips[beatIdx] = rehostedUrls[k]; });
  const attachedAt = deps.now().toISOString();
  const merged = {
    ...payload,
    externalClips: {
      source: input.source, startFrame: input.startFrame, model: input.model ?? null, note: input.note ?? null, attachedBy: ctx.attachedBy, attachedAt,
      originalUrls: input.clipUrls,
      disclosure: "re-hosted keys carry a higgsfield- segment so shouldDiscloseAi reads them as generative under any REEL_VIDEO_PROVIDER pin",
    },
  };

  // Claim: the swap pins every field the decision read (id, status, payload, clipUrlsJson); a loser writes nothing.
  const result = await deps.database.update(reelJobs)
    .set({
      status: "assets_ready", queueState: queueStateForReelStatus("assets_ready"), clipUrlsJson: JSON.stringify(clips),
      payload: JSON.stringify(merged), attempts: 0, error: null, productionReadyAt: deps.now(), updatedAt: deps.now(),
    })
    .where(and(
      eq(reelJobs.id, job.id),
      eq(reelJobs.status, job.status),
      eq(reelJobs.payload, job.payload),
      job.clipUrlsJson === null ? isNull(reelJobs.clipUrlsJson) : eq(reelJobs.clipUrlsJson, job.clipUrlsJson),
    ));
  if (affectedRowCount(result) !== 1) {
    return refuse("CAS_LOST", `Reel job ${job.id} changed under us (status, brief or clips moved); nothing attached. Re-read the job and retry.`);
  }

  await deps.audit({ actionType: "attach_external_clips", decision: "OK", reasoningCodes: ["ATTACHED"], context: { jobId: job.id, fromStatus: job.status, source: input.source, startFrame: input.startFrame, model: input.model ?? null, clipCount: rehostedUrls.length, rehostedUrls } }).catch(() => {});
  log.info("external clips attached", { jobId: job.id, clipCount: rehostedUrls.length, source: input.source, model: input.model ?? null });
  return { ok: true, jobId: job.id, clipCount: rehostedUrls.length, rehostedUrls };
}
