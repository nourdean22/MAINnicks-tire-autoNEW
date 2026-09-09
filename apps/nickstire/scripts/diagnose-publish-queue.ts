/**
 * READ-ONLY. Mirrors the drain pre-filter in cron/jobs/dailyReelPost.ts over
 * EVERY assembled job, using the same production functions the cron calls, so
 * the verdict here cannot disagree with the verdict there.
 *
 * Deliberately not a re-implementation: reelApprovalProblem, condemnedContentProblem,
 * originalityProblem, evaluateReelPublishGate and loadPublishedCorpus are the
 * real gates.
 *
 * 2026-09-09: evaluateReelPublishGate was MISSING from that list, so this script
 * ran four of the five doors and called the result "READY TO PUBLISH". It
 * reported job 1890002 ready on the same morning the cron was holding that exact
 * job on needs_paid_repair every 15 minutes. A diagnostic that omits a door does
 * not under-report - it manufactures a queue that does not exist, and it is
 * believed precisely because it looks thorough.
 */
import { getDb } from "../server/db";
import { reelJobs } from "../drizzle/schema";
import { and, eq, isNotNull, ne, asc } from "drizzle-orm";
import { reelApprovalProblem, findLiveApproval } from "../server/services/reelApproval";
import { condemnedContentProblem, auditPublishBlock } from "@shared/reelClaimAudit";
import { originalityProblem } from "@shared/reelOriginality";
import { evaluateReelPublishGate } from "../server/services/qualityGate";
import { loadPublishedCorpus } from "../server/services/reelOriginality";

function parsePayload(p: unknown): any {
  if (!p) return {};
  if (typeof p === "object") return p as any;
  try {
    return JSON.parse(String(p));
  } catch {
    return {};
  }
}

async function main() {
  const d = await getDb();
  if (!d) throw new Error("no database");

  const rows = await d
    .select()
    .from(reelJobs)
    .where(and(eq(reelJobs.status, "assembled"), isNotNull(reelJobs.mp4Url), ne(reelJobs.mp4Url, "")))
    .orderBy(asc(reelJobs.id));

  const corpus = await loadPublishedCorpus();
  console.log(`assembled jobs: ${rows.length} · published corpus: ${corpus.length}\n`);

  const publishable: number[] = [];
  const approvableOnly: number[] = [];
  const qaHeld: Array<{ id: number; gate: string }> = [];

  for (const row of rows) {
    const id = row.id;
    const caption = typeof row.caption === "string" ? row.caption : "";
    const videoUrl = typeof row.mp4Url === "string" ? row.mp4Url : "";
    const payload = parsePayload(row.payload);
    const onScreen = (payload.storyboardBeats ?? [])
      .map((b: any) => b?.onScreenText ?? "")
      .filter(Boolean)
      .join(" ");

    const veto = auditPublishBlock(id);
    const condemned = condemnedContentProblem({
      voiceover: payload.voiceoverScript,
      onScreenText: onScreen,
    });
    const dupe = originalityProblem(
      { onScreenText: onScreen, caption, videoUrl },
      corpus.filter((p: any) => p.label !== `reel job ${id}`),
    );
    const approval = await findLiveApproval(id);
    const approvalProb = await reelApprovalProblem({ jobId: id, caption, videoUrl });

    // THE RENDERED-QA GATE. Omitting this is why an earlier version of this
    // script reported job 1890002 "READY TO PUBLISH" on 2026-09-09 while the
    // cron was holding that exact job on needs_paid_repair every 15 minutes.
    // A queue diagnostic that runs four of the five doors reports a queue that
    // does not exist. runIfMissing:false keeps it a pure read - a diagnostic
    // must never spend money or mutate a job to answer a question.
    let qaGate: { gate: string; allowed: boolean } | null = null;
    try {
      const g = await evaluateReelPublishGate(id, { runIfMissing: false });
      qaGate = { gate: g.gate, allowed: g.allowed };
    } catch (e: any) {
      qaGate = { gate: `unreadable: ${e?.message ?? e}`, allowed: false };
    }

    const blockers: string[] = [];
    if (!caption.trim() || !videoUrl.trim()) blockers.push("missing_caption_or_asset");
    if (veto) blockers.push(`claim_veto: ${veto}`);
    if (condemned) blockers.push(`condemned_script: ${condemned.code ?? "yes"}`);
    if (dupe) blockers.push(`repost:${dupe.surface} (${dupe.reason ?? ""})`);

    const permanent = blockers.length > 0;
    const qaBlocked = qaGate !== null && !qaGate.allowed;
    const status = permanent
      ? "BLOCKED"
      : qaBlocked
        ? `HELD BY RENDERED QA (${qaGate!.gate})`
        : approvalProb
          ? `NEEDS APPROVAL (${approvalProb.code})`
          : "READY TO PUBLISH";

    if (!permanent && !qaBlocked && !approvalProb) publishable.push(id);
    if (!permanent && !qaBlocked && approvalProb) approvableOnly.push(id);
    if (!permanent && qaBlocked) qaHeld.push({ id, gate: qaGate!.gate });

    console.log(`#${id}  ${status}`);
    console.log(`   brief=${row.briefId} updated=${row.updatedAt}`);
    if (blockers.length) console.log(`   blockers: ${blockers.join(" | ")}`);
    console.log(`   liveApproval=${approval ? `${approval.approvedBy} exp=${approval.expiresAt}` : "none"}`);
    console.log(`   renderedQaGate=${qaGate ? `${qaGate.gate}${qaGate.allowed ? "" : " (BLOCKS PUBLISH)"}` : "not evaluated"}`);
    console.log(`   caption: ${caption.replace(/\s+/g, " ").slice(0, 150)}`);
    console.log("");
  }

  console.log("=== SUMMARY ===");
  console.log(`READY TO PUBLISH NOW (approved + all gates clean): ${JSON.stringify(publishable)}`);
  console.log(`CLEAN CONTENT, ONLY MISSING A VALID APPROVAL:      ${JSON.stringify(approvableOnly)}`);
  console.log(`HELD BY RENDERED QA (will NOT publish as-is):      ${JSON.stringify(qaHeld)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e?.stack ?? e);
  process.exit(1);
});
