/**
 * READ-ONLY. Mirrors the drain pre-filter in cron/jobs/dailyReelPost.ts over
 * EVERY assembled job, using the same production functions the cron calls, so
 * the verdict here cannot disagree with the verdict there.
 *
 * Deliberately not a re-implementation: reelApprovalProblem, condemnedContentProblem,
 * originalityProblem and loadPublishedCorpus are the real gates.
 */
import { getDb } from "../server/db";
import { reelJobs } from "../drizzle/schema";
import { and, eq, isNotNull, ne, asc } from "drizzle-orm";
import { reelApprovalProblem, findLiveApproval } from "../server/services/reelApproval";
import { condemnedContentProblem, auditPublishBlock } from "@shared/reelClaimAudit";
import { originalityProblem } from "@shared/reelOriginality";
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

    const blockers: string[] = [];
    if (!caption.trim() || !videoUrl.trim()) blockers.push("missing_caption_or_asset");
    if (veto) blockers.push(`claim_veto: ${veto}`);
    if (condemned) blockers.push(`condemned_script: ${condemned.code ?? "yes"}`);
    if (dupe) blockers.push(`repost:${dupe.surface} (${dupe.reason ?? ""})`);

    const permanent = blockers.length > 0;
    const status = permanent
      ? "BLOCKED"
      : approvalProb
        ? `NEEDS APPROVAL (${approvalProb.code})`
        : "READY TO PUBLISH";

    if (!permanent && !approvalProb) publishable.push(id);
    if (!permanent && approvalProb) approvableOnly.push(id);

    console.log(`#${id}  ${status}`);
    console.log(`   brief=${row.briefId} updated=${row.updatedAt}`);
    if (blockers.length) console.log(`   blockers: ${blockers.join(" | ")}`);
    console.log(`   liveApproval=${approval ? `${approval.approvedBy} exp=${approval.expiresAt}` : "none"}`);
    console.log(`   caption: ${caption.replace(/\s+/g, " ").slice(0, 150)}`);
    console.log("");
  }

  console.log("=== SUMMARY ===");
  console.log(`READY TO PUBLISH NOW (approved + all gates clean): ${JSON.stringify(publishable)}`);
  console.log(`CLEAN CONTENT, ONLY MISSING A VALID APPROVAL:      ${JSON.stringify(approvableOnly)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e?.stack ?? e);
  process.exit(1);
});
