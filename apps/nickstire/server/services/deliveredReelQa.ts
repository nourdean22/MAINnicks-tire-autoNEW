/**
 * QA on the copy Instagram actually delivers (2026-10-08).
 *
 * WHY. Rendered QA judges the master on our disk. Viewers never see that file:
 * Meta re-encodes every upload into its own renditions (resolution, bitrate,
 * codec), and a Reel can come back cropped, downscaled, shortened, silent or
 * with a flash the master did not have. Until now nothing ever looked at the
 * delivered copy, so "QA passed" described a file no customer watched.
 *
 * WHAT. For each recently posted Reel that has not been checked: read the
 * delivered video URL from the Graph API (read-only), ffprobe both the master
 * and the delivered copy, run the flash scan on the delivered copy, and record
 * a verdict on the job's payload as `deliveredQa`. The comparison is pure
 * (`compareDelivered`) and tested; the IO is a thin shell around it.
 *
 * WHAT IT IS NOT. It does not re-publish, delete or edit anything; Graph calls
 * are GETs. It runs at most two Reels per pass inside the existing 8-hourly
 * Instagram analytics pipeline, so it adds no cron and no provider spend.
 *
 * THE WRITE keeps reel_jobs.updatedAt unchanged (`updatedAt = updatedAt` in
 * SQL — an explicit assignment suppresses ON UPDATE CURRENT_TIMESTAMP), because
 * the morning brief's stalled-lane check reads MAX(updatedAt) of posted rows as
 * "last posted"; a QA write must not look like a new post.
 */
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import type { FlashRisk } from "./flashRisk";

const log = createLogger("services:delivered-reel-qa");

export interface MediaProbe {
  width: number;
  height: number;
  fps: number | null;
  durationSec: number | null;
  hasAudio: boolean;
}

export type DeliveredIssue =
  | "below_720p"
  | "resolution_dropped"
  | "aspect_changed"
  | "duration_changed"
  | "audio_lost"
  | "low_frame_rate"
  | "flash_on_delivered_copy";

export interface DeliveredQaVerdict {
  checkedAt: string;
  verdict: "pass" | "issues" | "unmeasured";
  issues: DeliveredIssue[];
  master?: MediaProbe;
  delivered?: MediaProbe;
  flash?: FlashRisk | { unmeasured: string };
  reason?: string;
  /** Passes that ran for this job; an `unmeasured` result is retried up to 3. */
  attempts?: number;
  /** The master could not be read (ephemeral disk, expired URL): only the delivered-only rules ran. */
  masterUnreadable?: string;
}

/**
 * Pure. Each rule names a way the delivered copy can be worse than intended.
 * The first, frame-rate and flash rules need only the delivered copy; the rest
 * compare against the master and are skipped when it could not be read.
 */
export function compareDelivered(master: MediaProbe | null, delivered: MediaProbe, flash?: FlashRisk | null): DeliveredIssue[] {
  const issues: DeliveredIssue[] = [];
  // Instagram's own floor for Reels is 720 px; below it the platform served a
  // low rendition as the copy we could read.
  if (Math.min(delivered.width, delivered.height) < 720) issues.push("below_720p");
  if (delivered.fps != null && delivered.fps < 24) issues.push("low_frame_rate");
  if (flash?.fail) issues.push("flash_on_delivered_copy");
  if (!master) return issues;
  // Downscaling by more than a third of the master's short side.
  if (Math.min(delivered.width, delivered.height) < (2 / 3) * Math.min(master.width, master.height)) issues.push("resolution_dropped");
  // A changed aspect ratio means cropping or letterboxing happened after us.
  const ar = (p: MediaProbe) => p.width / p.height;
  if (Math.abs(ar(delivered) - ar(master)) / ar(master) > 0.02) issues.push("aspect_changed");
  if (master.durationSec != null && delivered.durationSec != null && Math.abs(master.durationSec - delivered.durationSec) > 0.5) {
    issues.push("duration_changed");
  }
  if (master.hasAudio && !delivered.hasAudio) issues.push("audio_lost");
  return issues;
}

function parseRate(rate: unknown): number | null {
  if (typeof rate !== "string") return null;
  const [n, d] = rate.split("/").map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  const fps = n / d;
  return fps > 0 ? fps : null;
}

/** Pure: an ffprobe -show_streams -show_format JSON document → MediaProbe. */
export function probeFromFfprobeJson(doc: unknown): MediaProbe | null {
  const j = doc as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const video = j?.streams?.find((s) => s.codec_type === "video");
  if (!video || typeof video.width !== "number" || typeof video.height !== "number") return null;
  const dur = Number(j.format?.duration ?? video.duration);
  return {
    width: video.width,
    height: video.height,
    fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
    durationSec: Number.isFinite(dur) && dur > 0 ? dur : null,
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === "audio")),
  };
}

async function ffprobe(input: string): Promise<MediaProbe> {
  const bin = process.env.FFPROBE_PATH || "ffprobe";
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], { stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    let e = "";
    p.stdout.on("data", (c) => { o += c; });
    p.stderr.on("data", (c) => { e = (e + c).slice(-500); });
    const t = setTimeout(() => p.kill("SIGKILL"), 60_000);
    p.on("error", (err) => { clearTimeout(t); reject(err); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(o) : reject(new Error(`ffprobe exited ${code}: ${e}`)); });
  });
  const probe = probeFromFfprobeJson(JSON.parse(out));
  if (!probe) throw new Error("ffprobe found no video stream");
  return probe;
}

type Db = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** Check one posted Reel. Never throws: a check that cannot run is `unmeasured`, with the reason. */
export async function checkDeliveredReel(job: { igPostId: string; mp4Url: string }): Promise<DeliveredQaVerdict> {
  const checkedAt = new Date().toISOString();
  try {
    const { getMediaDeliveryUrl } = await import("./metaSocial");
    const media = await getMediaDeliveryUrl(job.igPostId);
    if (!media.ok || !media.mediaUrl) {
      return { checkedAt, verdict: "unmeasured", issues: [], reason: `delivered URL unavailable: ${media.error ?? "no media_url"}` };
    }
    const delivered = await ffprobe(media.mediaUrl);
    let masterUnreadable: string | undefined;
    const master = await ffprobe(job.mp4Url).catch((err: unknown) => {
      masterUnreadable = err instanceof Error ? err.message.slice(0, 160) : String(err);
      return null;
    });
    const { scanFlashRisk } = await import("./flashRisk");
    const flash = await scanFlashRisk(media.mediaUrl).catch((err: unknown) => ({ unmeasured: err instanceof Error ? err.message.slice(0, 160) : String(err) }));
    const issues = compareDelivered(master, delivered, "fail" in flash ? flash : null);
    return {
      checkedAt, verdict: issues.length ? "issues" : "pass", issues, delivered, flash,
      ...(master ? { master } : {}),
      ...(masterUnreadable ? { masterUnreadable } : {}),
    };
  } catch (err) {
    return { checkedAt, verdict: "unmeasured", issues: [], reason: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

/**
 * One bounded pass: Reels posted in the last 7 days, at least 30 minutes ago
 * (Meta needs time to finish its renditions), not yet checked. Oldest first,
 * at most `limit`. Returns a summary for the pipeline result.
 */
export async function runDeliveredReelQaPass(db: Db, limit = 2): Promise<{ checked: number; issues: number; unmeasured: number; jobs: string[] }> {
  const res = await db.execute(sql`
    SELECT id, igPostId, mp4Url, payload FROM reel_jobs
    WHERE status = 'posted' AND igPostId IS NOT NULL AND mp4Url IS NOT NULL AND mp4Url <> ''
      AND updatedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND updatedAt <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY id ASC
    LIMIT 25
  `);
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : []) as Array<{ id: number; igPostId: string; mp4Url: string; payload: string | null }>;
  const summary = { checked: 0, issues: 0, unmeasured: 0, jobs: [] as string[] };
  for (const row of rows) {
    if (summary.checked >= limit) break;
    let payload: Record<string, unknown>;
    try {
      payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
    } catch {
      continue; // an unreadable payload is not ours to rewrite
    }
    const prev = payload.deliveredQa as DeliveredQaVerdict | undefined;
    if (prev && (prev.verdict !== "unmeasured" || (prev.attempts ?? 1) >= 3)) continue;
    const verdict = await checkDeliveredReel({ igPostId: row.igPostId, mp4Url: row.mp4Url });
    verdict.attempts = (prev?.attempts ?? 0) + 1;
    payload.deliveredQa = verdict;
    await db.execute(sql`UPDATE reel_jobs SET payload = ${JSON.stringify(payload)}, updatedAt = updatedAt WHERE id = ${row.id}`);
    summary.checked++;
    if (verdict.verdict === "issues") summary.issues++;
    if (verdict.verdict === "unmeasured") summary.unmeasured++;
    summary.jobs.push(`${row.id}:${verdict.verdict}${verdict.issues.length ? `(${verdict.issues.join(",")})` : ""}`);
    if (verdict.verdict === "issues") log.warn("delivered Reel differs from the master", { jobId: row.id, igPostId: row.igPostId, issues: verdict.issues });
  }
  return summary;
}
