/**
 * Classifies one reel pack from its README text and file list. Pure, so a test can drive it;
 * scripts/build-reel-triage.mjs is the consumer.
 */
const COST = { "real-footage": 0, stills: 1, generated: 2, undetermined: 3 };

export function classifyPack(txt, { hasCaptions, hasBrief }) {
  const hasRealFootage = /real (shop )?footage|filmed in the bay|operator footage/i.test(txt);
  const needsGeneratedVideo = /higgsfield|seedance|veo\b|generated video|motion route/i.test(txt);
  const declaredBlock = txt.includes("BLOCKED: NO MOTION ROUTE") ? "BLOCKED: NO MOTION ROUTE" : null;

  const productionType = hasRealFootage ? "real-footage"
    : needsGeneratedVideo ? "generated"
    : (hasCaptions || hasBrief) ? "stills" : "undetermined";

  // An AIRED line (e.g. "AIRED: 2026-10-25 instagram <media id>") marks a record of a reel already posted. It is checked
  // first so the pack is neither blocked ("dead") nor a draft regeneration could pick up again.
  const aired = /^AIRED: .+$/m.exec(txt);

  let status, blockReason;
  if (aired) { status = "aired"; blockReason = `already posted, not a draft (${aired[0]})`; }
  else if (declaredBlock) { status = "dead"; blockReason = declaredBlock; }
  else if (productionType === "undetermined") { status = "needs-work"; blockReason = "production route undetermined: no real footage, no captions and no brief - nothing can be assembled. Add a brief or attach footage."; }
  else if (!hasCaptions) { status = "needs-work"; blockReason = "no captions.srt - the reel cannot be assembled without them"; }
  else if (productionType === "generated") { status = "needs-work"; blockReason = "requires generated video: costs credits, and publishing needs Meta's is_ai_generated=true plus a caption making no real-evidence claim"; }
  else { status = "publishable"; blockReason = null; }
  return { productionType, cost: COST[productionType], status, blockReason };
}
