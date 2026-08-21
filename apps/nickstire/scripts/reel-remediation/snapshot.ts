/**
 * Phase 3 — snapshot before you destroy. Runs before any delete, per the
 * mission's mandatory ordering: pulls live platform insights, archives the
 * original render + a manifest (script/caption/hook/VO/detection) to
 * durable storage with sha256 recorded, and emits pre-delete-report.csv.
 *
 * Resumable: an entry whose archive.video + archive.manifest +
 * insights_snapshot are already populated is skipped (LEDGER_TERMINAL.archived).
 * Never mutates reel_jobs or touches any platform write endpoint — this
 * phase is entirely read (Graph GET) + a NEW archive write (storagePut),
 * never a destructive one.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import fs from "node:fs";
import crypto from "node:crypto";
import { getMediaInsights, getMediaBasicFields } from "../../server/services/metaSocial";
import { storagePut } from "../../server/storage";
import { loadLedger, saveLedger, upsertEntry, LEDGER_TERMINAL, type LedgerEntry, type InsightsSnapshot } from "./ledger";

const REMEDIATION_DIR = path.join(__dirname, "..", "..", ".remediation");
const CSV_PATH = path.join(REMEDIATION_DIR, "pre-delete-report.csv");

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

async function snapshotInsights(entry: LedgerEntry): Promise<InsightsSnapshot[]> {
  const snapshots: InsightsSnapshot[] = [];
  for (const platform of entry.platforms) {
    if (platform.name !== "instagram") continue; // no Facebook posts among the candidates found in Phase 1
    const [insights, basic] = await Promise.all([
      getMediaInsights(platform.post_id),
      getMediaBasicFields(platform.post_id),
    ]);
    if (!insights.ok && !basic.ok) {
      console.log(`    ! reel ${entry.reel_id} platform post ${platform.post_id}: BOTH insights and basic-fields fetch failed (${insights.error || basic.error}) — the post may be gone or unreachable. Recording an empty snapshot, NOT fabricating zeros.`);
      continue;
    }
    if (basic.ok && basic.permalink) platform.permalink = basic.permalink;
    if (basic.ok && basic.timestamp) platform.published_at = basic.timestamp;
    snapshots.push({
      captured_at: new Date().toISOString(),
      platform: "instagram",
      post_id: platform.post_id,
      views: insights.ok ? insights.views ?? null : null,
      reach: insights.ok ? insights.reach ?? null : null,
      avg_watch_time_ms: insights.ok ? insights.avgWatchTimeMs ?? null : null,
      skip_rate: insights.ok ? insights.skipRate ?? null : null,
      likes: basic.ok ? basic.likes ?? null : null,
      comments: basic.ok ? basic.comments ?? null : null,
      saves: insights.ok ? insights.saved ?? null : null,
      shares: insights.ok ? insights.shares ?? null : null,
      // Graph has no per-media "follows attributed to this post" metric —
      // the mission asks for it, but it does not exist at the media level;
      // recorded as null (not knowable), never fabricated as 0.
      follows: null,
    });
  }
  return snapshots;
}

async function archiveOriginal(entry: LedgerEntry, renderUrl: string | null): Promise<{ video: LedgerEntry["archive"]["video"]; manifest: LedgerEntry["archive"]["manifest"] }> {
  let video: LedgerEntry["archive"]["video"] = null;
  if (renderUrl) {
    const buf = await fetchBuffer(renderUrl);
    if (buf) {
      const digest = sha256(buf);
      const put = await storagePut(`remediation-archive/${entry.reel_id}/original.mp4`, buf, "video/mp4");
      video = { key: put.key, url: put.url, sha256: digest, bytes: buf.length };
    } else {
      console.log(`    ! reel ${entry.reel_id}: could not fetch render at ${renderUrl} — video archive left null.`);
    }
  } else {
    console.log(`    ! reel ${entry.reel_id}: no render_path on record (job never assembled) — nothing to archive as video.`);
  }

  const manifestObj = {
    reel_id: entry.reel_id,
    detection: entry.detection,
    original: entry.original,
    platforms: entry.platforms,
    archived_at: new Date().toISOString(),
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifestObj, null, 2), "utf8");
  const manifestDigest = sha256(manifestBuf);
  const manifestPut = await storagePut(`remediation-archive/${entry.reel_id}/manifest.json`, manifestBuf, "application/json");
  const manifest: LedgerEntry["archive"]["manifest"] = { key: manifestPut.key, url: manifestPut.url, sha256: manifestDigest };

  return { video, manifest };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function emitCsv(entries: LedgerEntry[]): void {
  const header = [
    "reel_id", "hook", "script_excerpt", "confidence", "platform", "post_id", "permalink", "published_at",
    "views", "reach", "avg_watch_time_ms", "skip_rate", "likes", "comments", "saves", "shares",
    "video_archived", "video_sha256",
  ];
  const rows: string[] = [header.join(",")];
  for (const e of entries) {
    const scriptExcerpt = (e.original.script ?? "").slice(0, 200);
    if (e.platforms.length === 0) {
      rows.push([
        e.reel_id, e.original.hook, scriptExcerpt, e.detection.confidence,
        "", "", "", "", "", "", "", "", "", "", "", "",
        e.archive.video ? "yes" : "no", e.archive.video?.sha256 ?? "",
      ].map(csvEscape).join(","));
      continue;
    }
    for (const p of e.platforms) {
      const snap = (e.insights_snapshot ?? []).find((s) => s.post_id === p.post_id) ?? null;
      rows.push([
        e.reel_id, e.original.hook, scriptExcerpt, e.detection.confidence,
        p.name, p.post_id, p.permalink, p.published_at,
        snap?.views, snap?.reach, snap?.avg_watch_time_ms, snap?.skip_rate,
        snap?.likes, snap?.comments, snap?.saves, snap?.shares,
        e.archive.video ? "yes" : "no", e.archive.video?.sha256 ?? "",
      ].map(csvEscape).join(","));
    }
  }
  fs.mkdirSync(REMEDIATION_DIR, { recursive: true });
  fs.writeFileSync(CSV_PATH, rows.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${rows.length - 1} row(s) to ${CSV_PATH}`);
}

async function main() {
  const { getDb } = await import("../../server/db");
  const { reelJobs } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("DB not available — check DATABASE_URL");

  const ledger = loadLedger();
  const entries = Object.values(ledger.entries);
  if (entries.length === 0) {
    console.log("Ledger is empty — run detect.ts (Phase 1) first.");
    process.exit(1);
  }

  // --force re-archives entries already marked archived.
  //
  // Needed because WHERE an archive landed depends on the environment that ran
  // this. Run locally with no S3_BUCKET, storagePut falls back to local disk
  // and records a {SITE_URL}/generated/... URL that resolves ONLY on the
  // machine that wrote it — so the ledger claims a durable archive it does not
  // have. That is exactly the state the first Phase 3 run produced: 11 videos
  // on one Windows box, and a hard gate ("no deletion for any reel whose
  // archive is null") satisfied by a file nothing else can reach.
  //
  // Re-running under prod's env (railway run) puts the same bytes in Railway
  // Buckets and rewrites the ledger URLs to match. Archiving is additive —
  // new objects, nothing overwritten destructively — so re-running is safe.
  const FORCE = process.argv.includes("--force");

  console.log(`${entries.length} ledger entries. Snapshotting insights + archiving originals...`);
  if (FORCE) console.log("--force: re-archiving entries already marked archived (e.g. to move them to durable storage).");
  const durable = Boolean(process.env.S3_BUCKET);
  console.log(durable
    ? `storage: S3_BUCKET set — archives will be DURABLE.`
    : `storage: no S3_BUCKET — archives go to LOCAL DISK ONLY and the recorded URL will not resolve elsewhere.`);
  let archived = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!FORCE && LEDGER_TERMINAL.archived(entry)) {
      console.log(`  reel ${entry.reel_id}: already archived (insights_snapshot + archive both present) — skipping, resumable.`);
      skipped += 1;
      continue;
    }

    console.log(`  reel ${entry.reel_id}: pulling insights for ${entry.platforms.length} platform post(s)...`);
    const snapshots = await snapshotInsights(entry);
    entry.insights_snapshot = snapshots.length > 0 ? snapshots : (entry.platforms.length === 0 ? [] : entry.insights_snapshot ?? []);

    const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, entry.reel_id)).limit(1);
    const renderUrl = row?.mp4Url ?? entry.original.render_path;

    console.log(`  reel ${entry.reel_id}: archiving original render + manifest...`);
    const { video, manifest } = await archiveOriginal(entry, renderUrl);
    entry.archive = { video, manifest, archived_at: new Date().toISOString() };

    upsertEntry(ledger, entry);
    saveLedger(ledger); // save after EVERY reel, not just at the end — a crash mid-run loses at most one reel's progress, not the whole batch
    archived += 1;
    console.log(`  reel ${entry.reel_id}: done. video=${video ? "archived" : "MISSING"} manifest=archived insights=${entry.insights_snapshot?.length ?? 0} snapshot(s)`);
  }

  emitCsv(Object.values(ledger.entries));

  const notYetGated = Object.values(ledger.entries).filter((e) => !LEDGER_TERMINAL.archived(e));
  console.log(`\n${archived} archived this run, ${skipped} already done.`);
  if (notYetGated.length > 0) {
    console.log(`\n⚠ HARD GATE: ${notYetGated.length} reel(s) still have a null insights_snapshot or archive — these may NOT be deleted:`);
    for (const e of notYetGated) console.log(`    reel ${e.reel_id}: insights_snapshot=${e.insights_snapshot === null ? "null" : e.insights_snapshot.length} archive.video=${e.archive.video ? "ok" : "null"} archive.manifest=${e.archive.manifest ? "ok" : "null"}`);
  } else {
    console.log(`\nAll ${Object.values(ledger.entries).length} reels are snapshot+archive gated — clear to proceed to Phase 4 (regen).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase 3 snapshot failed:", err);
  process.exit(1);
});
