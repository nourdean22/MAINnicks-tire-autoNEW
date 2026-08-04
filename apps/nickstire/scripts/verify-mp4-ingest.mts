/**
 * verify-mp4-ingest — drives a REAL mp4 through ingestFinishedMp4 against a
 * DISPOSABLE local MySQL. Sibling of verify-template-stock-pipeline.mts; run it
 * after touching mp4Ingest.ts, the publicFetch guard, or the inventory link:
 *
 *   pnpm exec tsx scripts/verify-mp4-ingest.mts
 *
 * SAFE: mysql-memory-server (no Docker, no admin, torn down at exit), never the
 * repo DATABASE_URL (which points at PRODUCTION TiDB). No provider is called and
 * no network request leaves the machine — the mp4 is rendered locally by ffmpeg
 * — so this spends nothing and needs no credentials. Every emitted file is deleted
 * after.
 *
 * (verify-template-stock-pipeline.mts says "data/generated is NOT gitignored".
 * That is STALE — .gitignore:163 ignores apps/nickstire/data/generated/, and two
 * mp4s from that probe's 2026-08-03 run are still sitting there untracked. The
 * cleanup below is still right, but for the ordinary reason: a probe should not
 * leave hundreds of KB of junk in the working tree.)
 *
 * WHY IT EXISTS. ingestFinishedMp4 shipped with twelve passing unit tests and
 * ZERO importers, then got a router and a UI in #1342 — and its capability entry
 * has carried "NO RUNTIME VERIFICATION" the whole time, because the unit tests
 * mock the database, the storage layer and the draft link. Nothing had ever put
 * a real file with a real ftyp box through the real function against real
 * tables. That is the exact gap that let the template_stock lane sit fully green
 * while it could not render a frame.
 *
 * The unit suite and this script check DIFFERENT things and neither replaces the
 * other: the tests pin the branch decisions, this proves the plumbing joins up.
 *
 * DO NOT add this to `pnpm run verify` or CI. It boots a MySQL binary (~150MB on
 * first run), shells out to drizzle-kit push and runs ffmpeg. It is a probe you
 * reach for deliberately, like verify-template-stock-pipeline.mts.
 */
import mysql from "mysql2/promise";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { startDevDb } from "./lib/dev-db.mjs";

const CAPTION = "Winter tires are on. Book the changeover before the first freeze.";
const TOPIC = "Winter tire changeover";

let failures = 0;
const emitted: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectReject(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
    check(label, false, "resolved when it should have thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, pattern.test(msg), msg.slice(0, 140));
  }
}

/**
 * A real h264 mp4 from ffmpeg. Deliberately NOT generateTemplateStockClip: that
 * one re-hosts through storagePut and hands back a URL, and this probe needs a
 * local FILE so the filesystem branch of loadSource is the thing under test.
 * One second, tiny, silent — the ftyp box is what matters.
 */
function renderRealMp4(outFile: string): boolean {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "color=c=black:s=320x568:d=1", "-pix_fmt", "yuv420p", "-r", "15", outFile],
    { encoding: "utf8" },
  );
  return r.status === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0;
}

async function query<T>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await mysql.createConnection({ uri: url });
  const [rows] = await c.query(sql, params);
  await c.end();
  return rows as T[];
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mp4-ingest-"));
const mp4File = path.join(workDir, "sample.mp4");
const txtFile = path.join(workDir, "not-a-video.txt");

console.log("─── verify-mp4-ingest ───");

if (!renderRealMp4(mp4File)) {
  console.error("FAIL: ffmpeg could not render the sample mp4 — is ffmpeg on PATH?");
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
}
fs.writeFileSync(txtFile, "this is not a video, it is a 404 page pretending to be one");

const sampleBytes = fs.statSync(mp4File).size;
const head = fs.readFileSync(mp4File).subarray(4, 8).toString("ascii");
check("sample mp4 carries a real ISO-BMFF ftyp box", head === "ftyp", `bytes 4..8 = "${head}", ${sampleBytes} bytes`);

const { url, stop } = await startDevDb({ quiet: true });

try {
  // In-process only. startDevDb hands back a throwaway mysql-memory-server URI;
  // this never reaches the repo's real DATABASE_URL.
  process.env.DATABASE_URL = url;
  process.env.SITE_URL = "https://nickstire.org";
  // ingest calls assertDurableStorageForGeneration, which refuses without
  // S3_BUCKET. The template_stock probe needs the same opt-in for the same
  // reason: locally there is no bucket, and the point here is the ingest
  // contract, not the storage backend.
  process.env.REEL_ALLOW_EPHEMERAL_STORAGE = "true";
  // BOTH deletions are egress guards, not tidiness. storage.ts branches on
  // S3_BUCKET, so an ambient one from the operator shell would upload this
  // sample into the REAL production bucket; and STORAGE_CATBOX_FALLBACK_ENABLED
  // would, on any local write failure, push it to catbox.moe — an anonymous
  // third-party public host. A verification script must not be able to publish
  // anything anywhere.
  delete process.env.S3_BUCKET;
  delete process.env.STORAGE_CATBOX_FALLBACK_ENABLED;
  // Audio QA shells out to ffmpeg on a temp copy; whichever way it lands, its
  // result is asserted below as a RECORDED state rather than assumed to pass.
  delete process.env.MP4_INGEST_ENABLED;

  const { ingestFinishedMp4 } = await import("../server/services/mp4Ingest.js");

  // ── 1. the flag actually gates it ───────────────────────────────────────
  await expectReject(
    "refuses while MP4_INGEST_ENABLED is unset",
    () => ingestFinishedMp4({ source: mp4File, topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /disabled/i,
  );
  process.env.MP4_INGEST_ENABLED = "1";
  await expectReject(
    "requires the flag to be exactly \"true\" — 1 does not arm it",
    () => ingestFinishedMp4({ source: mp4File, topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /disabled/i,
  );
  process.env.MP4_INGEST_ENABLED = "true";

  // ── 2. the happy path, end to end, against real tables ──────────────────
  const res = await ingestFinishedMp4({
    source: mp4File,
    topic: TOPIC,
    caption: CAPTION,
    origin: "verify-mp4-ingest",
  });
  if (res.mp4Url.startsWith("https://nickstire.org/generated/")) {
    emitted.push(path.join(process.cwd(), "data", "generated", path.basename(res.mp4Url)));
  }

  check("returns an inventory id", /^ingest-[0-9a-f]{24}$/.test(res.inventoryId), res.inventoryId);
  check("returns a real reel job id", Number.isInteger(res.reelJobId) && res.reelJobId > 0, String(res.reelJobId));
  check("byte count matches the file on disk", res.bytes === sampleBytes, `${res.bytes} vs ${sampleBytes}`);
  check("mp4Url is an http(s) URL", /^https?:\/\//.test(res.mp4Url), res.mp4Url);

  const jobs = await query<{ id: number; briefId: string; status: string; mp4Url: string; caption: string; payload: string }>(
    url,
    "SELECT id, briefId, status, mp4Url, caption, payload FROM reel_jobs WHERE id = ?",
    [res.reelJobId],
  );
  check("the reel_jobs row exists", jobs.length === 1);
  if (jobs[0]) {
    const job = jobs[0];
    check("briefId is the inventory id — what resolveReelJobId looks up", job.briefId === res.inventoryId, job.briefId);
    check("status is assembled", job.status === "assembled", job.status);
    check(
      "status fits reel_jobs.status varchar(20)",
      job.status.length <= 20,
      `${job.status.length} chars`,
    );
    check("the job carries the caption", job.caption === CAPTION);
    const brief = JSON.parse(job.payload) as Record<string, unknown>;
    check("brief.selectedCaption is the caption — it becomes hookText", brief.selectedCaption === CAPTION);
    check("brief.topic round-trips", brief.topic === TOPIC);
    check("brief.origin records provenance", brief.origin === "verify-mp4-ingest");
    const qa = brief.audioQa as { qaState?: string } | undefined;
    check(
      "audio QA is RECORDED, never silently absent",
      typeof qa?.qaState === "string",
      `qaState=${qa?.qaState}`,
    );
  }

  // Columns are snake_case in SQL and camelCase in drizzle. Written out rather
  // than selected with * so a renamed column fails here loudly instead of
  // silently reading undefined and passing every assertion below.
  const drafts = await query<{ id: string; status: string; hookText: string; bodyText: string | null; briefJson: string; assetPaths: unknown }>(
    url,
    `SELECT id, status, hook_text AS hookText, body_text AS bodyText,
            brief_json AS briefJson, asset_paths AS assetPaths
       FROM social_content_inventory WHERE id = ?`,
    [res.inventoryId],
  );
  check("the inventory draft exists", drafts.length === 1);
  if (drafts[0]) {
    const draft = drafts[0];
    check("draft is review_ready — a DRAFT, not published", draft.status === "review_ready", draft.status);
    check("hookText is the caption", draft.hookText === CAPTION);
    // body_text is NOT NULL in the schema, so "no body supplied" means empty,
    // never null. The published caption is `hookText\n\nbodyText`, so anything
    // non-empty here would silently append to every post.
    check("bodyText stays EMPTY when none was supplied", !draft.bodyText, JSON.stringify(draft.bodyText));
    const brief = JSON.parse(draft.briefJson) as { reelJobId?: number };
    check(
      "briefJson carries the reelJobId stamp resolveReelJobId prefers",
      brief.reelJobId === res.reelJobId,
      String(brief.reelJobId),
    );
    check("assetPaths points at the stored mp4", String(draft.assetPaths).includes(res.mp4Url));
  }

  // ── 3. the publish gate can actually FIND the job ───────────────────────
  // This is the whole reason the reel_jobs row is created. Without it the gate
  // warn-and-proceeds today and hard-blocks once REEL_GATE_REQUIRE_JOB is armed.
  const { getDbTyped } = await import("../server/db.js");
  const typed = await getDbTyped();
  if (!typed) {
    check("dev DB handle for the publish-gate lookup", false, "getDbTyped returned null");
  } else {
    const { resolveReelJobId } = await import("../server/services/reelPublishAuthority.js");
    const viaStamp = await resolveReelJobId(typed, { id: res.inventoryId, briefJson: drafts[0]?.briefJson ?? null });
    check("resolveReelJobId finds the job via the brief stamp", viaStamp === res.reelJobId, String(viaStamp));
    const viaQuery = await resolveReelJobId(typed, { id: res.inventoryId, briefJson: "{}" });
    check("…and via the briefId fallback query when the stamp is missing", viaQuery === res.reelJobId, String(viaQuery));
  }

  // ── 4. the refusals, against the real database ──────────────────────────
  await expectReject(
    "refuses a file that is not an mp4 (a fetched 404 page cannot become a draft)",
    () => ingestFinishedMp4({ source: txtFile, topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /not an mp4/i,
  );
  await expectReject(
    "requires a caption — it is what gets published",
    () => ingestFinishedMp4({ source: mp4File, topic: TOPIC, caption: "   ", origin: "verify" }),
    /caption/i,
  );
  await expectReject(
    "refuses a missing file rather than creating an empty draft",
    () => ingestFinishedMp4({ source: path.join(workDir, "nope.mp4"), topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /ENOENT|no such file/i,
  );

  // The SSRF guard, proven through the real ingest path rather than in isolation.
  // A loopback source is exactly what an attacker-supplied URL would reach for,
  // and it is refused BEFORE any fetch — which is also why this probe cannot
  // exercise the remote branch against a local test server, and should not try.
  await expectReject(
    "refuses a loopback URL — the SSRF guard is wired into ingest, not just unit-tested",
    () => ingestFinishedMp4({ source: "http://127.0.0.1:9/x.mp4", topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /refusing non-public host/i,
  );
  await expectReject(
    "refuses the cloud metadata endpoint",
    () => ingestFinishedMp4({ source: "http://169.254.169.254/latest/meta-data/", topic: TOPIC, caption: CAPTION, origin: "verify" }),
    /refusing non-public host/i,
  );

  // ── 5. nothing leaked into the tables on the refusals ───────────────────
  const jobCount = await query<{ n: number }>(url, "SELECT COUNT(*) AS n FROM reel_jobs");
  const draftCount = await query<{ n: number }>(url, "SELECT COUNT(*) AS n FROM social_content_inventory");
  check("exactly ONE reel job exists — no refusal left a row behind", Number(jobCount[0]?.n) === 1, `${jobCount[0]?.n}`);
  check("exactly ONE draft exists", Number(draftCount[0]?.n) === 1, `${draftCount[0]?.n}`);
} catch (err) {
  failures++;
  console.error("  FAIL unexpected throw:", err instanceof Error ? err.stack : String(err));
} finally {
  await stop();
  fs.rmSync(workDir, { recursive: true, force: true });
  // Every byte this probe wrote comes back out. data/generated IS gitignored
  // (.gitignore:163), so this is hygiene rather than a commit hazard.
  for (const f of emitted) {
    try {
      fs.rmSync(f, { force: true });
      console.log(`  cleaned ${path.relative(process.cwd(), f)}`);
    } catch {
      console.error(`  WARNING could not delete ${f} — remove it before committing`);
    }
  }
}

console.log(failures === 0 ? "\n✓ mp4 ingest verified end to end" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
