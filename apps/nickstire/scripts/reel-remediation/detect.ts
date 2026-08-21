/**
 * Phase 1 — build the ledger. Read-only against reel_jobs/cron_log/Instagram
 * Graph; the only write is the local .remediation/ledger.json.
 *
 * THREE SIGNALS, adapted to what this codebase actually is rather than the
 * generic mission language ("stock template library... sha256sum each"):
 * templateStockStudio.ts is a PROCEDURAL ffmpeg SYNTHESIZER (a near-black
 * base + one of 4 sweep tones + one of 6 deterministic camera moves), not a
 * library of pre-recorded files — there is nothing to enumerate or
 * sha256sum as a fixed asset set. The three signals below are the honest
 * equivalent for a synthesis-based fallback:
 *
 *   1. storage_path_provenance — every stock clip's URL contains
 *      "reels/template-stock/" (templateStockStudio.ts:324, the ONLY writer
 *      of that path pattern in the repo). Reuses qualityGate.ts's own
 *      reelClipsIncludeStock so detection can never drift from the publish
 *      guard's definition of "stock". Strong, direct.
 *   2. outage_window_temporal — the reel's createdAt falls inside the
 *      Higgsfield-session outage window, derived EMPIRICALLY from
 *      cron_log's higgsfield-session-keepalive failure history (not a
 *      hardcoded date range) — an independent data source (job metadata vs.
 *      clip URL content) corroborating signal 1.
 *   3. frame_perceptual_signature — ffmpeg-sample a frame from the clip and
 *      check its average color against templateStockStudio's own known,
 *      small, fixed palette (BASE_DARK 0x0B0B0F + the 4 SWEEP_TONES). A
 *      real Higgsfield/Veo scene is complex, non-uniform imagery; the
 *      synthetic lane is a near-black gradient by construction. Direct
 *      palette matching is a MORE precise signal here than a generic pHash
 *      library comparison would be, because the reference palette is small,
 *      known, and exhaustively enumerable from the generator's own source.
 *
 * Confidence: high = signal 1 + at least one of {2,3}. medium = signal 1
 * alone, or 2+3 without 1. low = a single weak signal (2 or 3 alone) —
 * per the mission's hard rule, low confidence NEVER auto-deletes.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import { getDb } from "../../server/db";
import { reelJobs, cronLog } from "../../drizzle/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";
import { reelClipsIncludeStock } from "../../server/services/qualityGate";
import { getInstagramPermalink } from "../../server/services/metaSocial";
import {
  loadLedger,
  saveLedger,
  getOrCreateEntry,
  upsertEntry,
  printConfidenceCounts,
  type DetectionSignal,
  type ConfidenceTier,
  type LedgerEntry,
} from "./ledger";
import { sampleFrameSignature, frameLooksSynthetic, extractStockAssets } from "./signals";

async function deriveOutageWindow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<{ start: Date; end: Date } | null> {
  const rows = await db
    .select({ min: sql<string>`MIN(${cronLog.startedAt})`, max: sql<string>`MAX(${cronLog.startedAt})` })
    .from(cronLog)
    .where(and(eq(cronLog.jobName, "higgsfield-session-keepalive"), eq(cronLog.status, "failed")));
  const row = rows[0];
  if (!row?.min || !row?.max) return null;
  return { start: new Date(row.min), end: new Date(row.max) };
}

function classify(signals: DetectionSignal[]): ConfidenceTier {
  const hasProvenance = signals.includes("storage_path_provenance");
  const others = signals.filter((s) => s !== "storage_path_provenance").length;
  if (hasProvenance && others >= 1) return "high";
  if (hasProvenance) return "medium";
  if (others >= 2) return "medium";
  return "low";
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available — check DATABASE_URL");

  const outageWindow = await deriveOutageWindow(db);
  if (outageWindow) {
    console.log(`Outage window (from cron_log, higgsfield-session-keepalive failures): ${outageWindow.start.toISOString()} .. ${outageWindow.end.toISOString()}`);
  } else {
    console.log("No higgsfield-session-keepalive failure rows in cron_log — signal 2 (outage_window_temporal) will never fire this run.");
  }

  // Every reel_job that ever rendered a clip — queued/generating rows never
  // had a chance to include stock content, so excluding them keeps this
  // query cheap without narrowing the candidate set the mission asks for
  // ("classify every reel").
  const rows = await db.select().from(reelJobs).where(isNotNull(reelJobs.clipUrlsJson));
  console.log(`Scanning ${rows.length} reel_jobs row(s) with rendered clips...`);

  const ledger = loadLedger();
  let flagged = 0;

  for (const row of rows) {
    const stockAssets = extractStockAssets(row.clipUrlsJson);
    const signalA = reelClipsIncludeStock(row.clipUrlsJson);
    if (!signalA && stockAssets.length === 0) continue; // clean reel, not a candidate at all

    const signals: DetectionSignal[] = [];
    const notes: string[] = [];
    if (signalA) {
      signals.push("storage_path_provenance");
      notes.push(`${stockAssets.length} of its clip URL(s) contain "reels/template-stock/".`);
    }

    if (outageWindow && row.createdAt >= outageWindow.start && row.createdAt <= outageWindow.end) {
      signals.push("outage_window_temporal");
      notes.push(`createdAt (${row.createdAt.toISOString()}) falls inside the derived outage window.`);
    }

    // Frame sampling is real network + ffmpeg work — only worth it once
    // signal 1 already flagged the reel as a candidate, since signal 3
    // exists to CORROBORATE, not to blind-scan every clean reel.
    if (signalA && stockAssets.length > 0) {
      const sample = await sampleFrameSignature(stockAssets[0]);
      if (sample) {
        const synthetic = frameLooksSynthetic(sample);
        notes.push(`frame sample at t=1s: luma std-dev ${sample.stdDevLuma} (mean ${sample.meanLuma}, range ${sample.rangeLuma}) — ${synthetic ? "FLAT, consistent with the synthetic gradient lane" : "detailed, consistent with real generated footage"}.`);
        if (synthetic) signals.push("frame_perceptual_signature");
      } else {
        notes.push("frame sample failed (ffmpeg unavailable, unreachable URL, or timeout) — signal 3 abstained rather than guessed.");
      }
    }

    const confidence = classify(signals);
    flagged += 1;

    let brief: Record<string, unknown> = {};
    try { brief = JSON.parse(row.payload); } catch { /* leave empty — reported as null fields below */ }
    const beats = Array.isArray(brief.storyboardBeats) ? (brief.storyboardBeats as Array<Record<string, unknown>>) : [];
    const hook = typeof beats[0]?.onScreenText === "string" && beats[0].onScreenText
      ? (beats[0].onScreenText as string)
      : (typeof beats[0]?.visual === "string" ? (beats[0].visual as string) : null);

    const entry: LedgerEntry = getOrCreateEntry(ledger, row.id);
    entry.detection = { signals, confidence, stock_assets: stockAssets, notes, detected_at: new Date().toISOString() };
    entry.original = {
      render_path: row.mp4Url,
      script: typeof brief.voiceoverScript === "string" ? brief.voiceoverScript : null,
      vo_path: row.voUrl,
      caption: row.caption ?? (typeof brief.selectedCaption === "string" ? brief.selectedCaption : null),
      hook,
    };
    entry.platforms = [];
    if (row.igPostId) {
      const permalink = await getInstagramPermalink(row.igPostId).catch(() => null);
      entry.platforms.push({ name: "instagram", post_id: row.igPostId, permalink, published_at: row.updatedAt?.toISOString() ?? null });
    }
    upsertEntry(ledger, entry);

    console.log(`  reel_job ${row.id} [${row.status}] -> ${confidence.toUpperCase()} (${signals.join(", ") || "none"})${row.igPostId ? `  igPostId=${row.igPostId}` : ""}`);
  }

  saveLedger(ledger);
  printConfidenceCounts(ledger);
  console.log(`\n${flagged} candidate(s) written to apps/nickstire/.remediation/ledger.json.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase 1 detection failed:", err);
  process.exit(1);
});
