/**
 * Runtime verification for the reel-voiceover fail-closed change (PR #756).
 *
 * Drives the REAL assembly stage (processNextAssemblyJob) against a throwaway
 * local MySQL and a locally-served real clip — no prod DB, no Meta, no Veo.
 *
 * The claim under test: a reel brief WITH a voiceoverScript but no TTS provider
 * must FAIL, not silently assemble voiceless. The clean contrast is the flag:
 * the ONLY difference between the two runs below is REEL_VO_OPTIONAL, so any
 * behavior difference is attributable to the VO gate and nothing else.
 *
 *   Run A (no flag)              → job fails; error names the missing TTS provider.
 *   Run B (REEL_VO_OPTIONAL=true)→ VO returns null; assembly proceeds PAST the VO
 *                                  stage and fails later for an unrelated reason
 *                                  (no S3 creds locally). The error must NOT be
 *                                  the TTS message — proving the gate is what
 *                                  changed, not the environment.
 *
 * Run:  pnpm exec tsx scripts/verify-reel-vo.mts
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { startDevDb } from "./lib/dev-db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIP = path.resolve(HERE, "..", "data", "generated", "clip-30008-1.mp4");

function serveClip(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const buf = fs.readFileSync(CLIP);
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": buf.length });
      res.end(buf);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/clip.mp4`, close: () => server.close() });
    });
  });
}

const brief = {
  id: "verify-vo",
  selectedCaption: "Cleveland potholes keep score.",
  voiceoverScript: "Your tires remember every pothole you pretend you didn't hit.",
  campaignKeyword: "POTHOLE",
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 3, onScreenText: "POTHOLE SEASON", visual: "tire" },
  ],
};

async function seedJob(url: string, clipUrl: string): Promise<number> {
  const c = await mysql.createConnection({ uri: url });
  const [res] = await c.query(
    `INSERT INTO reel_jobs (briefId, payload, clipUrlsJson, status, attempts, source)
     VALUES (?, ?, ?, 'assets_ready', 0, 'admin')`,
    ["unknown", JSON.stringify(brief), JSON.stringify([clipUrl])],
  );
  await c.end();
  return (res as { insertId: number }).insertId;
}

async function readJob(url: string, id: number): Promise<{ status: string; error: string | null; attempts: number }> {
  const c = await mysql.createConnection({ uri: url });
  const [rows] = await c.query("SELECT status, error, attempts FROM reel_jobs WHERE id = ?", [id]);
  await c.end();
  return (rows as { status: string; error: string | null; attempts: number }[])[0];
}

/** Drive the assembly stage until the job reaches a terminal state (or MAX_ATTEMPTS). */
async function driveToTerminal(url: string, id: number) {
  const { processNextAssemblyJob } = await import("../server/services/reelPipeline");
  for (let i = 0; i < 4; i++) {
    const r = await processNextAssemblyJob();
    const job = await readJob(url, id);
    if (job.status === "failed" || job.status === "assembled") return { job, pulses: i + 1, last: r };
  }
  return { job: await readJob(url, id), pulses: 4, last: null };
}

const { url, stop } = await startDevDb();
const clip = await serveClip();

// Bind the app to the local DB and arm the pipeline. No TTS creds — that is the point.
process.env.DATABASE_URL = url;
process.env.REEL_GENERATION_ENABLED = "true";
delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
delete process.env.ELEVENLABS_API_KEY;

const TTS_SIGNATURE = /TTS provider|Voiceover generation failed/i;

try {
  // ── Run A: fail-closed (no flag) ──────────────────────────────────────────
  delete process.env.REEL_VO_OPTIONAL;
  const idA = await seedJob(url, clip.url);
  const A = await driveToTerminal(url, idA);
  const aFailedOnTts = A.job.status === "failed" && !!A.job.error && TTS_SIGNATURE.test(A.job.error);

  // ── Run B: escape hatch (REEL_VO_OPTIONAL=true) ───────────────────────────
  process.env.REEL_VO_OPTIONAL = "true";
  const idB = await seedJob(url, clip.url);
  const B = await driveToTerminal(url, idB);
  const bPastVo = !B.job.error || !TTS_SIGNATURE.test(B.job.error);

  console.log("\n" + "=".repeat(72));
  console.log("REEL VOICEOVER FAIL-CLOSED — RUNTIME OBSERVATION");
  console.log("=".repeat(72));
  console.log(`\nRun A  (script present, no TTS, no flag)  after ${A.pulses} pulse(s):`);
  console.log(`   status = ${A.job.status}   attempts = ${A.job.attempts}`);
  console.log(`   error  = ${A.job.error}`);
  console.log(`   → fails closed on the missing TTS provider: ${aFailedOnTts ? "YES ✅" : "NO ❌"}`);
  console.log(`\nRun B  (same job + REEL_VO_OPTIONAL=true)  after ${B.pulses} pulse(s):`);
  console.log(`   status = ${B.job.status}   attempts = ${B.job.attempts}`);
  console.log(`   error  = ${B.job.error}`);
  console.log(`   → got PAST the VO stage (failure is not the TTS gate): ${bPastVo ? "YES ✅" : "NO ❌"}`);
  console.log("\n" + "-".repeat(72));

  const pass = aFailedOnTts && bPastVo;
  console.log(pass
    ? "VERDICT: PASS — the VO gate is the sole cause of Run A's failure; the flag lifts it."
    : "VERDICT: FAIL — behavior did not match the fail-closed claim (see above).");
  console.log("=".repeat(72) + "\n");
  process.exitCode = pass ? 0 : 1;
} finally {
  clip.close();
  await stop();
}
