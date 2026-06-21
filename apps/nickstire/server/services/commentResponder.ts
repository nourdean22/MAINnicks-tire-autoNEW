/**
 * Comment-velocity responder (Phase 3.2). First-hour comment velocity is a Meta
 * Reels ranking signal; the admin console can already draft + post replies
 * (suggestReply/postReply) but only by hand. This closes the loop: it polls the
 * most recently posted reels' comments and, for each un-answered claim-safe
 * comment, drafts a reply with the SAME LLM prompt + claim-safety detector the
 * operator's send button uses.
 *
 * SAFE BY DEFAULT — three independent guards:
 *   1. The cron only RUNS when REEL_COMMENT_RESPONDER_ENABLED=true (scheduler
 *      requiresEnv) — off by default, exactly like reel-pipeline / daily-reel-post.
 *   2. Even when it runs it DRY-RUNS (logs drafts, posts nothing) unless
 *      REEL_COMMENT_RESPONDER_LIVE=true.
 *   3. A claim-safety-blocked draft is NEVER posted (the @shared/reviewReplyQa
 *      detector — same one postReply enforces).
 * Dedup is belt-and-suspenders: the IgComment.replied flag AND a per-reel
 * timestamp watermark in shop_settings, so a flaky Graph `from` edge can't cause
 * double-reply spam.
 */
import { createLogger } from "../lib/logger";
import { checkReviewReply, buildReplyPromptRules, hasBlockingFindings } from "@shared/reviewReplyQa";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";

const log = createLogger("services:comment-responder");

export type ReplyTone = "warm" | "professional" | "witty" | "promo";

const TONE_GUIDELINES: Record<ReplyTone, string> = {
  warm: "Write a warm, human, 1-2 sentence public reply that sounds like the shop owner, not a brand.",
  professional: "Write a professional, polite, and direct 1-2 sentence reply focused on customer service and help.",
  witty: "Write a witty, lighthearted, and friendly 1-2 sentence reply with a touch of neighborhood humor.",
  promo: "Write a warm 1-2 sentence reply that casually invites them to check out our shop deals, book an appointment, or visit nickstire.org.",
};

/**
 * Draft a brand-safe reply to a comment. Mirrors instagramAdminRouter.suggestReply
 * (same prompt rules + claim-safety detector) so the autonomous loop and the
 * manual button behave identically. Suggestion only — posts nothing.
 */
export async function draftCommentReply(
  commentText: string,
  tone: ReplyTone = "warm",
): Promise<{ draft: string; findings: ReturnType<typeof checkReviewReply>; blocked: boolean }> {
  const prompt = `You manage the Instagram account for Nick's Tire & Auto, a neighborhood Cleveland-area shop.
A follower left this comment on one of our posts: "${commentText}"

${TONE_GUIDELINES[tone]}
${buildReplyPromptRules()}
Keep it under 200 characters.`;

  let draft = "";
  try {
    const result = await invokeLLM({ messages: [{ role: "user", content: prompt }], maxTokens: 2048 });
    const content = result.choices?.[0]?.message?.content;
    draft = typeof content === "string" ? sanitizeText(content) : "";
  } catch (err) {
    log.error("draftCommentReply LLM failed:", err);
    draft = "";
  }
  const findings = draft ? checkReviewReply(draft) : [];
  return { draft, findings, blocked: hasBlockingFindings(findings) };
}

const RECENT_REELS = Number(process.env.REEL_COMMENT_RESPONDER_REELS) || 3;
const MAX_REPLIES_PER_RUN = Number(process.env.REEL_COMMENT_RESPONDER_MAX) || 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getKv(d: any, key: string): Promise<string | null> {
  const { shopSettings } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  return rows.length ? (rows[0].value as string) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setKv(d: any, key: string, value: string): Promise<void> {
  const { shopSettings } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await d.update(shopSettings).set({ value, updatedBy: "system" }).where(eq(shopSettings.key, key));
  } else {
    await d.insert(shopSettings).values({ key, value, label: "Comment responder watermark", category: "general", updatedBy: "system" });
  }
}

export async function runReelCommentResponder(): Promise<{ recordsProcessed: number; details: string }> {
  const live = process.env.REEL_COMMENT_RESPONDER_LIVE === "true";

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "DB not available" };

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, isNotNull, desc } = await import("drizzle-orm");
  const posted = await d
    .select()
    .from(reelJobs)
    .where(and(eq(reelJobs.status, "posted"), isNotNull(reelJobs.igPostId)))
    .orderBy(desc(reelJobs.id))
    .limit(RECENT_REELS);

  if (posted.length === 0) return { recordsProcessed: 0, details: "no recently-posted reels to scan" };

  const { getMediaComments, replyToComment } = await import("./metaSocial");
  let postedCount = 0;
  let drafted = 0;
  let blocked = 0;

  for (const job of posted) {
    if (postedCount >= MAX_REPLIES_PER_RUN) break;
    const mediaId = job.igPostId as string;
    // NOTE: getMediaComments returns up to 50 top-level comments (no pagination);
    // on a very high-traffic reel, comments past the first 50 aren't reachable here.
    const res = await getMediaComments(mediaId);
    if (!res.ok) {
      log.warn("comments fetch failed", { mediaId, error: res.error });
      continue;
    }
    const wmKey = `comment_responder_ts_${mediaId}`;
    const lastTs = await getKv(d, wmKey);
    // Process oldest-first so the watermark is a clean "everything at or before
    // this timestamp is handled" cursor. On a FAILED live reply we freeze the
    // cursor so that comment (and anything newer) retries next pulse instead of
    // being silently dropped; c.replied dedups the ones that already succeeded.
    const ordered = [...res.comments].sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    let cursorTs = lastTs;
    let frozen = false;
    const advance = (ts: string) => {
      if (!frozen && ts && (!cursorTs || ts > cursorTs)) cursorTs = ts;
    };

    for (const c of ordered) {
      if (postedCount >= MAX_REPLIES_PER_RUN) break;
      if (lastTs && c.timestamp && c.timestamp <= lastTs) continue; // already past the cursor
      if (c.replied || !c.text.trim()) {
        advance(c.timestamp);
        continue;
      }
      const { draft, blocked: isBlocked } = await draftCommentReply(c.text, "warm");
      if (!draft || isBlocked) {
        if (isBlocked) blocked++;
        advance(c.timestamp);
        continue;
      }
      drafted++;
      if (!live) {
        log.info("[dry-run] would reply to comment", { mediaId, commentId: c.id, draft });
        advance(c.timestamp);
        continue;
      }
      const r = await replyToComment(c.id, draft);
      if (r.success) {
        postedCount++;
        advance(c.timestamp);
        log.info("posted comment reply", { mediaId, commentId: c.id, replyId: r.replyId });
      } else {
        // Leave the cursor frozen so this comment is retried on the next pulse.
        frozen = true;
        log.error("comment reply failed", { mediaId, commentId: c.id, error: r.error });
      }
    }
    if (cursorTs && cursorTs !== lastTs) await setKv(d, wmKey, cursorTs);
  }

  const mode = live ? "live" : "dry-run";
  return {
    recordsProcessed: postedCount,
    details: `${mode}: ${posted.length} reels scanned, ${drafted} drafted, ${postedCount} posted, ${blocked} claim-blocked`,
  };
}
