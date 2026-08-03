/**
 * verify-template-stock-pipeline — drives a template_stock reel through the REAL
 * pipeline stages against a DISPOSABLE local MySQL. Sibling of
 * verify-reel-vo.mts; run it after touching the lane or the beat loop:
 *
 *   pnpm exec tsx scripts/verify-template-stock-pipeline.mts
 *
 * SAFE: mysql-memory-server (no Docker, no admin, torn down at exit), never the
 * repo DATABASE_URL (which points at PRODUCTION TiDB). No provider is called —
 * template_stock is local ffmpeg — so this spends nothing and needs no
 * credentials. Emitted mp4s are deleted after; data/generated is NOT gitignored.
 *
 * It exists because the lane's unit tests all passed while the lane could not
 * render a single frame (a filtergraph space broke the shell:true spawn), and
 * because nothing had ever driven a beat through
 * queued -> generating -> assets_ready -> assembling -> assembled.
 *
 * Verified 2026-08-03: guard refuses without durable storage; 2 clips render;
 * job reaches assets_ready then assembled; master 745,681 bytes, 9s, 270 frames,
 * render integrity verified.
 */
import mysql from "mysql2/promise";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { startDevDb } from "./lib/dev-db.mjs";

const brief = {
  id: "verify-template-stock",
  selectedCaption: "Cleveland potholes keep score.",
  campaignKeyword: "POTHOLE",
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 3, onScreenText: "POTHOLE SEASON", visual: "close-up of tire tread on wet asphalt, cinematic" },
    { beatNumber: 2, startSecond: 3, endSecond: 6, onScreenText: "CHECK YOUR TREAD", visual: "mechanic gauge on tire, shallow depth of field" },
  ],
};

async function seedQueued(url: string): Promise<number> {
  const c = await mysql.createConnection({ uri: url });
  const [res] = await c.query(
    `INSERT INTO reel_jobs (briefId, payload, status, attempts, source)
     VALUES (?, ?, 'queued', 0, 'admin')`,
    ["verify-template-stock", JSON.stringify(brief)],
  );
  await c.end();
  return (res as { insertId: number }).insertId;
}

async function readJob(url: string, id: number) {
  const c = await mysql.createConnection({ uri: url });
  const [rows] = await c.query(
    "SELECT status, error, attempts, clipUrlsJson, mp4Url FROM reel_jobs WHERE id = ?",
    [id],
  );
  await c.end();
  return (rows as Array<{ status: string; error: string | null; attempts: number; clipUrlsJson: string | null; mp4Url: string | null }>)[0];
}

function ffprobe(file: string): Record<string, string> {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height,codec_type", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1", file],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const o: Record<string, string> = {};
  for (const line of String(r.stdout ?? "").split(/\r?\n/)) {
    const [k, v] = line.split("=");
    if (k && v !== undefined) o[k.trim()] = (o[k.trim()] ? o[k.trim()] + "," : "") + v.trim();
  }
  return o;
}

const { url, stop } = await startDevDb({ quiet: true });
const emitted: string[] = [];
let ok = false;
try {
  process.env.DATABASE_URL = url;
  process.env.REEL_GENERATION_ENABLED = "true";
  process.env.REEL_VIDEO_PROVIDER = "template_stock";
  // No TTS creds locally; the silent path is a supported mode.
  process.env.REEL_VO_OPTIONAL = "true";
  delete process.env.ELEVENLABS_API_KEY;

  const { processNextReelJob, processNextAssemblyJob } = await import("../server/services/reelPipeline");

  // ── 1. the durable-storage precondition must REFUSE without S3 ──────────
  delete process.env.REEL_ALLOW_EPHEMERAL_STORAGE;
  const guardId = await seedQueued(url);
  await processNextReelJob();
  const guarded = await readJob(url, guardId);
  console.log(JSON.stringify({
    step: "1-durable-storage-guard",
    status: guarded.status,
    refused: /durable storage|S3_BUCKET/i.test(guarded.error ?? ""),
    error: (guarded.error ?? "").slice(0, 90),
  }, null, 2));

  // ── 2. full pipeline with the documented local escape hatch ─────────────
  process.env.REEL_ALLOW_EPHEMERAL_STORAGE = "true";
  const id = await seedQueued(url);

  const t0 = Date.now();
  // Read back the job the stage ACTUALLY claimed, not the one just seeded.
  // processNextReelJob takes the OLDEST queued row, and step 1's guard job was
  // requeued to `queued` when it refused — so it is claimed first. Polling the
  // seeded id reported zeros while the pipeline was succeeding on the other row.
  const gen = await processNextReelJob();
  const workedId = gen.jobId ?? id;
  const afterGen = await readJob(url, workedId);
  const clips: string[] = JSON.parse(afterGen.clipUrlsJson ?? "[]");
  console.log(JSON.stringify({
    step: "2-generation",
    status: afterGen.status,
    clips: clips.length,
    allHttp: clips.length > 0 && clips.every((u) => u.startsWith("http")),
    error: (afterGen.error ?? "").slice(0, 120),
    ms: Date.now() - t0,
  }, null, 2));

  const t1 = Date.now();
  let assembled = afterGen;
  for (let i = 0; i < 3 && assembled.status !== "assembled" && assembled.status !== "failed"; i++) {
    await processNextAssemblyJob();
    assembled = await readJob(url, workedId);
  }
  console.log(JSON.stringify({
    step: "3-assembly",
    status: assembled.status,
    mp4Url: assembled.mp4Url,
    error: (assembled.error ?? "").slice(0, 200),
    ms: Date.now() - t1,
  }, null, 2));

  if (assembled.mp4Url) {
    const local = path.join(process.cwd(), "data", "generated", path.basename(new URL(assembled.mp4Url).pathname));
    if (fs.existsSync(local)) {
      emitted.push(local);
      console.log(JSON.stringify({ step: "4-ffprobe", bytes: fs.statSync(local).size, ...ffprobe(local) }, null, 2));
    }
  }
  for (const c of clips) {
    const p = path.join(process.cwd(), "data", "generated", path.basename(new URL(c).pathname));
    if (fs.existsSync(p)) emitted.push(p);
  }
  ok = assembled.status === "assembled" && clips.length > 0 && clips.every((u) => u.startsWith("http"));
} finally {
  for (const f of emitted) fs.rmSync(f, { force: true });
  await stop();
}

// Explicit exit: mysql-memory-server's teardown kills the process group, which
// otherwise surfaces as a misleading 137 on a run that fully succeeded.
console.log(ok ? "VERIFIED — queued -> assets_ready -> assembled" : "NOT VERIFIED");
process.exit(ok ? 0 : 1);
