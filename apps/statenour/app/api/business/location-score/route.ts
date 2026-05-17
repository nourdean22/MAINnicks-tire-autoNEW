/**
 * /api/business/location-score · v10.0.526 · Arc C · Feature 7
 *
 * GET  ?address=X[&footTrafficPercentile=N&reviewDensity=N
 *      &competitorCluster=N&driveTimeToHomeMinutes=N&zoningFriction=N]
 *      · single-address score · owner-gated
 *
 * POST · body = { candidates: LocationParams[] } · scores + ranks ·
 *        returns sorted LocationScore[] · does NOT persist (use the
 *        cron or the dedicated persistRanking call for that) ·
 *        owner-gated
 *
 * Both endpoints are pure-compute over what the operator hands in.
 * Zero external data fetches in this handler · zero hidden state.
 * The model is decision-support · everything is transparent.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  scoreLocation,
  type LocationParams,
} from "@/lib/services/location-feasibility";
import { rankCandidates } from "@/lib/services/location-rank";

export const dynamic = "force-dynamic";

function parseOptionalNumber(input: string | null): number | undefined {
  if (input === null || input === undefined || input === "") return undefined;
  const n = Number(input);
  return Number.isFinite(n) ? n : undefined;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const address = url.searchParams.get("address")?.trim();
  if (!address) {
    return {
      ok: false,
      error: "address query parameter is required",
    };
  }

  const params: LocationParams = {
    address,
    footTrafficPercentile: parseOptionalNumber(url.searchParams.get("footTrafficPercentile")),
    reviewDensity: parseOptionalNumber(url.searchParams.get("reviewDensity")),
    competitorCluster: parseOptionalNumber(url.searchParams.get("competitorCluster")),
    driveTimeToHomeMinutes: parseOptionalNumber(url.searchParams.get("driveTimeToHomeMinutes")),
    zoningFriction: parseOptionalNumber(url.searchParams.get("zoningFriction")),
  };

  const result = scoreLocation(params);
  return { ok: true, score: result };
}, { auth: "owner" });

interface PostBody {
  candidates?: LocationParams[];
}

export const POST = apiHandler(async (req) => {
  const body = (await readRequestJson(req)) as PostBody;
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];

  // Validate that each candidate has an address · skip malformed
  // entries rather than 400-ing the whole batch so the operator's
  // bulk upload isn't a single-typo blocker.
  const valid: LocationParams[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  candidates.forEach((c, i) => {
    if (!c || typeof c !== "object") {
      skipped.push({ index: i, reason: "not_an_object" });
      return;
    }
    if (!c.address || typeof c.address !== "string" || c.address.trim() === "") {
      skipped.push({ index: i, reason: "missing_address" });
      return;
    }
    valid.push(c);
  });

  const rankings = rankCandidates(valid);
  return {
    ok: true,
    count: rankings.length,
    skipped: skipped.length === 0 ? undefined : skipped,
    rankings,
  };
}, { auth: "owner" });
