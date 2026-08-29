/**
 * Regenerates docs/reel-packs/TRIAGE.json from the packs on disk.
 *
 * This is the CONSUMER of the promotability check. Review of #1988 found the
 * check was referenced only by its own tests and a helper - inert, in other
 * words, which is the same orphaned-subject defect that PR caught in the
 * is_ai_generated wiring. There is deliberately no paid-ads path in this repo,
 * so the honest consumer is the triage artifact the operator actually reads:
 * every concept row now carries promotable + promotionBlockers.
 *
 * RUNTIME: must run under tsx, not bare node - it imports a .ts module.
 *   pnpm run triage:reels
 * Read-only against the filesystem. Writes one JSON file. No network, no DB.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promotabilityBlockers } from "../shared/reelPromotability.ts";
import { PACK_DESTINATIONS, DELIBERATELY_UNASSIGNED } from "../shared/reelDestinationMap.ts";

const ROOT = "docs/reel-packs";
const COST = { "real-footage": 0, stills: 1, generated: 2, undetermined: 3 };

const rows = [];
for (const d of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, d);
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  const readme = join(dir, "README.md");
  const txt = existsSync(readme) ? readFileSync(readme, "utf8") : "";
  const srt = files.find((f) => f.endsWith(".srt"));
  const copy = srt ? readFileSync(join(dir, srt), "utf8").replace(/^\d+$|^[\d:,\s>-]+$/gm, " ").replace(/\s+/g, " ").trim() : "";

  const hasCaptions = Boolean(srt);
  const hasBrief = files.includes("brief.json");
  const hasRealFootage = /real (shop )?footage|filmed in the bay|operator footage/i.test(txt);
  const needsGeneratedVideo = /higgsfield|seedance|veo\b|generated video|motion route/i.test(txt);
  const declaredBlock = txt.includes("BLOCKED: NO MOTION ROUTE") ? "BLOCKED: NO MOTION ROUTE" : null;

  const productionType = hasRealFootage ? "real-footage"
    : needsGeneratedVideo ? "generated"
    : (hasCaptions || hasBrief) ? "stills" : "undetermined";

  let status, blockReason;
  if (declaredBlock) { status = "dead"; blockReason = declaredBlock; }
  else if (productionType === "undetermined") { status = "needs-work"; blockReason = "production route undetermined: no real footage, no captions and no brief - nothing can be assembled. Add a brief or attach footage."; }
  else if (!hasCaptions) { status = "needs-work"; blockReason = "no captions.srt - the reel cannot be assembled without them"; }
  else if (productionType === "generated") { status = "needs-work"; blockReason = "requires generated video: costs credits, and publishing needs Meta's is_ai_generated=true plus a caption making no real-evidence claim"; }
  else { status = "publishable"; blockReason = null; }

  // Promotability is assessed only when there is copy to assess. No copy means
  // unassessed (null), which is NOT the same as ineligible.
  const franchise = d.replace(/^\d{4}-\d{2}-\d{2}-/, "") || d;
  const landingDestination = PACK_DESTINATIONS[franchise] ?? null;
  const unassignedReason = landingDestination ? null : (DELIBERATELY_UNASSIGNED[franchise] ?? "no curated match yet");
  const blockers = copy
    ? promotabilityBlockers({
        id: d,
        copy,
        videoProvider: productionType === "generated" ? "higgsfield" : null,
        aspectRatio: "9:16",
        safeAreaRespected: null,
        ctaText: null,
        landingDestination,
      })
    : null;

  rows.push({
    id: d,
    franchise: d.replace(/^\d{4}-\d{2}-\d{2}-/, "") || d,
    productionType,
    cost: COST[productionType],
    status,
    blockReason,
    actuals: null,
    landingDestination,
    unassignedReason,
    promotable: blockers ? blockers.length === 0 : null,
    promotionBlockers: blockers ? blockers.map((b) => `${b.code}(${b.source}): ${b.reason}`) : null,
  });
}

rows.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
const totals = {};
for (const r of rows) totals[r.status] = (totals[r.status] || 0) + 1;
const unexplained = rows.filter((r) => r.status !== "publishable" && !r.blockReason).map((r) => r.id);
const dest = {
  assigned: rows.filter((r) => r.landingDestination).length,
  unassigned: rows.filter((r) => !r.landingDestination).length,
  distinctDestinations: new Set(rows.map((r) => r.landingDestination).filter(Boolean)).size,
};
const promo = { promotable: rows.filter((r) => r.promotable === true).length, notPromotable: rows.filter((r) => r.promotable === false).length, unassessed: rows.filter((r) => r.promotable === null).length };

writeFileSync(join(ROOT, "TRIAGE.json"), JSON.stringify({
  generated: process.env.TRIAGE_DATE || "2026-08-28",
  note: "Concepts as rows. No weighted rubric - ranked by cost ascending until actuals exist. Every non-publishable row carries blockReason; UNKNOWN is not a permitted state. promotable=null means UNASSESSED (no copy to read), not ineligible.",
  totals: { all: rows.length, ...totals },
  promotability: promo,
  destinations: dest,
  unexplained,
  concepts: rows,
}, null, 2) + "\n");
console.log(`TRIAGE.json: ${rows.length} concepts`, totals);
console.log("  destinations:", dest);
console.log("  promotability:", promo, "| unexplained:", unexplained.length);
