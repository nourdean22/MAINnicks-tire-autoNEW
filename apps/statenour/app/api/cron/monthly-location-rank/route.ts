/**
 * GET /api/cron/monthly-location-rank · v10.0.526 · Arc C · Feature 7
 *
 * Monthly second-location ranking · folded into mega-evening. Reads
 * an operator-curated candidate file (data/location-candidates.json),
 * scores each candidate, persists the top-20 to BrainMemory.
 *
 * KEY DESIGN DECISIONS:
 *   · NO automatic data ingestion. The operator owns the candidate
 *     list and the per-candidate measurements. This cron purely runs
 *     the SCORER over what's already in the JSON file.
 *   · 1st-of-month gate. The cron route is folded into mega-evening
 *     (runs every night) but no-ops on any day other than the 1st of
 *     the ET month · keeps the work cheap during the other 30 days.
 *   · File-missing is a no-op with a structured-log warning, NOT an
 *     error. The operator may not pre-populate yet · we don't want
 *     to red-paint the cron dashboard while the feature is gated.
 *
 * To enable monthly auto-ranking: drop a JSON array at the file path
 * above. Schema lives in docs/business/location-feasibility-model.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { cronHandler } from "@/lib/utils/http";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  rankCandidates,
  persistRanking,
  etMonthKey,
} from "@/lib/services/location-rank";
import type { LocationParams } from "@/lib/services/location-feasibility";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/monthly-location-rank");

export const maxDuration = 60;

function isFirstOfEtMonth(now: Date = new Date()): boolean {
  const day = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
  });
  return day === "1";
}

interface CandidateFile {
  candidates: LocationParams[];
}

export const GET = cronHandler(async () => {
  // 1st-of-month gate · cheap on the other 30 days.
  if (!isFirstOfEtMonth()) {
    return {
      ok: true,
      skipped: true,
      reason: "not_first_of_month",
      monthKey: etMonthKey(),
    };
  }

  const filePath = path.join(process.cwd(), "data", "location-candidates.json");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    log.warn("candidate_file_missing", {
      path: filePath,
      error: sanitizeError(err),
    });
    return {
      ok: true,
      skipped: true,
      reason: "candidate_file_missing",
      hint: "Populate data/location-candidates.json to enable monthly ranking.",
      monthKey: etMonthKey(),
    };
  }

  let parsed: CandidateFile;
  try {
    parsed = JSON.parse(raw) as CandidateFile;
  } catch (err) {
    log.warn("candidate_file_invalid_json", {
      path: filePath,
      error: sanitizeError(err),
    });
    return {
      ok: false,
      reason: "invalid_json",
      monthKey: etMonthKey(),
    };
  }

  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  if (candidates.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "empty_candidate_list",
      monthKey: etMonthKey(),
    };
  }

  const rankings = rankCandidates(candidates);
  const result = await persistRanking(rankings);

  return {
    ok: true,
    skipped: false,
    monthKey: result.monthKey,
    candidates: candidates.length,
    ranked: result.count,
    topAddress: result.topAddress,
    persisted: result.brainMemoryId !== null,
  };
});
