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
import { BUSINESS } from "@shared/business";

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
  tone?: ReplyTone,
  opts?: { campaignKeyword?: string },
): Promise<{ draft: string; toneClassified?: ReplyTone; findings: ReturnType<typeof checkReviewReply>; blocked: boolean }> {
  // NT-003: a keyword comment is someone doing exactly what the post asked.
  // There is no DM automation in this stack, so the reply must give the REAL
  // next step (call/text line, link in bio) — never promise a DM.
  const keywordSteer = opts?.campaignKeyword
    ? `\nIMPORTANT: The commenter used our campaign keyword "${opts.campaignKeyword}" — they are answering the post's call-to-action. We have NO DM automation, so do not promise to DM them or ask them to DM us. Give the real next step in the reply itself: call or text ${BUSINESS.phone.display}, or tap the link in our bio.`
    : "";
  // If tone is not provided, perform sentiment-based classification first
  let prompt = "";
  if (!tone) {
    prompt = `You manage the Instagram account for Nick's Tire & Auto, a neighborhood Cleveland-area shop.
A follower left this comment on one of our posts: "${commentText}"

INSTRUCTIONS:
1. Classify the comment's sentiment and choose a reply tone:
   - If angry, complaining, or reporting a bad experience -> Use tone "professional" (polite, direct, helpful, inviting to DM for direct resolution).
   - If asking a technical/pricing question or scheduling -> Use tone "promo" (friendly, answering directly if simple, casually inviting to book or visit nickstire.org/contact).
   - If positive, praising, or sharing a joke/meme -> Use tone "witty" (friendly, neighborhood humor, or witty remark).
   - Otherwise -> Use tone "warm" (human, 1-2 sentence public reply sounding like the owner).

2. Write a 1-2 sentence reply in the chosen tone. Keep it under 200 characters.
3. Strict Safety Rules:
   - Forbid guarantees/warranties.
   - Forbid exact pricing quotes.
   - Use soft diagnostics (e.g. "could point to", "worth checking").
   - ASCII-only characters (no emojis, plain text only).

Your output must be a valid JSON object matching the requested schema. No conversational prose.${keywordSteer}`;
  } else {
    prompt = `You manage the Instagram account for Nick's Tire & Auto, a neighborhood Cleveland-area shop.
A follower left this comment on one of our posts: "${commentText}"

${TONE_GUIDELINES[tone]}
${buildReplyPromptRules()}
Keep it under 200 characters.${keywordSteer}`;
  }

  let draft = "";
  let toneClassified: ReplyTone = tone || "warm";

  try {
    if (!tone) {
      const result = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2048,
        outputSchema: {
          name: "comment_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              replyText: { type: "string" },
              classifiedTone: { type: "string", enum: ["warm", "professional", "witty", "promo"] }
            },
            required: ["replyText", "classifiedTone"]
          }
        }
      });
      const content = result.choices?.[0]?.message?.content as string;
      try {
        const parsed = JSON.parse(content);
        draft = sanitizeText(parsed.replyText || "");
        toneClassified = (parsed.classifiedTone as ReplyTone) || "warm";
      } catch (jsonErr) {
        draft = sanitizeText(content || "");
        toneClassified = "warm";
      }
    } else {
      const result = await invokeLLM({ messages: [{ role: "user", content: prompt }], maxTokens: 2048 });
      const content = result.choices?.[0]?.message?.content;
      draft = typeof content === "string" ? sanitizeText(content) : "";
    }
  } catch (err) {
    log.error("draftCommentReply LLM failed:", err);
    draft = "";
  }
  const findings = draft ? checkReviewReply(draft) : [];
  return { draft, toneClassified, findings, blocked: hasBlockingFindings(findings) };
}

const RECENT_REELS = Number(process.env.REEL_COMMENT_RESPONDER_REELS) || 3;
const MAX_REPLIES_PER_RUN = Number(process.env.REEL_COMMENT_RESPONDER_MAX) || 5;

/**
 * NT-003 (2026-08-13) · campaign-keyword comments get a working next step.
 *
 * Published creative burns `DM "KEYWORD"` into pixels (reelAssembly CTA text,
 * carousel slides), but this stack has NO Instagram DM path — the webhook and
 * this responder see comments only. So a commenter who does exactly what the
 * reel asked previously got the same generic reply as anyone else, and the
 * promised loop dead-ended. This matcher spots the keyword so the reply can
 * hand off to the channels that DO exist (call/text line, link in bio).
 *
 * Matching is exact-token: the campaign asks for the literal keyword, so
 * "POTHOLE!" matches and "potholes" does not. Lookarounds instead of \b on
 * both ends — a trailing `\b` after a non-word char can never match (the
 * repo's 4× regex trap), and lookarounds stay correct even if a keyword ever
 * carries punctuation. Longest keyword wins so "TIRESAFE" beats "TIRES".
 */
export function matchCampaignKeyword(text: string, keywords: readonly string[]): string | null {
  if (!text) return null;
  const candidates = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const keyword of candidates) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
    if (re.test(text)) return keyword;
  }
  return null;
}

/**
 * Active campaign keywords, cheapest sources first: the posted reels already
 * in hand (their payload carries campaignKeyword — zero extra queries) plus
 * published inventory items with an interactive DM keyword. Failure returns
 * what was gathered so far — a keyword miss degrades to a generic reply, it
 * must never fail the responder run.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function collectActiveCampaignKeywords(d: any, postedJobs: Array<{ payload?: string | null }>): Promise<string[]> {
  const keywords = new Set<string>();
  for (const job of postedJobs) {
    try {
      const brief = JSON.parse(job.payload ?? "") as { campaignKeyword?: unknown };
      if (typeof brief.campaignKeyword === "string" && brief.campaignKeyword.trim()) {
        keywords.add(brief.campaignKeyword.trim());
      }
    } catch {
      // unparseable payload → that reel simply contributes no keyword
    }
  }
  try {
    const { socialContentInventory } = await import("../../drizzle/schema");
    const { eq, and, sql } = await import("drizzle-orm");
    const rows = await d
      .select({ keyword: socialContentInventory.interactiveDmKeyword })
      .from(socialContentInventory)
      .where(and(eq(socialContentInventory.status, "published"), sql`${socialContentInventory.interactiveDmKeyword} IS NOT NULL`))
      .limit(50);
    for (const r of rows as Array<{ keyword: string | null }>) {
      if (r.keyword?.trim()) keywords.add(r.keyword.trim());
    }
  } catch (err) {
    log.warn("campaign keyword inventory read failed (keyword steer degrades, run continues)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return [...keywords];
}

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

  // Calculate dynamic velocity limit (first-hour bonus).
  //
  // AGE IS COMPUTED BY THE DATABASE, not from a driver-parsed Date. mysql2 parses
  // DATETIME columns in the connection's LOCAL zone while this DB returns UTC, so
  // `Date.now() - parsedDate` ran ~4 hours NEGATIVE on an ET host - which made
  // "posted in the last hour" true for roughly the last FIVE hours, and the
  // first-hour reply-velocity bonus applied all afternoon (measured 2026-08-18;
  // same skew broke the keepalive staleness guard the same day). Also:
  // `job.publishedAt` was consulted here and reel_jobs HAS no such column - the
  // fallback to createdAt was the only branch that ever ran.
  let dynamicLimit = MAX_REPLIES_PER_RUN;
  try {
    const { sql } = await import("drizzle-orm");
    const fresh = await d
      .select({ n: sql<number>`COUNT(*)` })
      .from(reelJobs)
      .where(
        and(
          eq(reelJobs.status, "posted"),
          isNotNull(reelJobs.igPostId),
          sql`TIMESTAMPDIFF(MINUTE, ${reelJobs.createdAt}, UTC_TIMESTAMP()) <= 60`,
        ),
      );
    const n = Number((fresh as { n: number | string }[])[0]?.n ?? 0);
    if (Number.isFinite(n) && n > 0) {
      log.info(`A reel posted within the last hour (${n}) - raising comment responder limit to 15.`);
      dynamicLimit = 15;
    }
  } catch (err) {
    // Fail CLOSED to the normal limit - a broken bonus query must not widen the
    // reply-velocity envelope.
    log.warn("first-hour bonus query failed - keeping the base reply limit", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const { getMediaComments, replyToComment } = await import("./metaSocial");
  // NT-003: campaign keywords active right now — from the posted reels already
  // in hand plus published inventory. A keyword comment gets a reply that
  // hands off to a channel that exists (call/text, link in bio) instead of a
  // generic pleasantry that leaves the post's own CTA dangling.
  const activeKeywords = await collectActiveCampaignKeywords(d, posted);
  let postedCount = 0;
  let drafted = 0;
  let blocked = 0;

  for (const job of posted) {
    if (postedCount >= dynamicLimit) break;
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
      if (postedCount >= dynamicLimit) break;
      if (lastTs && c.timestamp && c.timestamp <= lastTs) continue; // already past the cursor
      if (c.replied || !c.text.trim()) {
        advance(c.timestamp);
        continue;
      }
      // Choose tone dynamically based on comment sentiment (pass no tone
      // parameter). A campaign-keyword hit adds the hand-off steer (NT-003).
      const matchedKeyword = matchCampaignKeyword(c.text, activeKeywords);
      if (matchedKeyword) {
        log.info("campaign keyword comment detected", { mediaId, commentId: c.id, keyword: matchedKeyword });
      }
      const { draft, toneClassified, blocked: isBlocked } = await draftCommentReply(
        c.text,
        undefined,
        matchedKeyword ? { campaignKeyword: matchedKeyword } : undefined,
      );
      if (!draft || isBlocked) {
        if (isBlocked) blocked++;
        advance(c.timestamp);
        continue;
      }
      drafted++;
      if (!live) {
        log.info("[dry-run] would reply to comment", { mediaId, commentId: c.id, draft, tone: toneClassified });
        advance(c.timestamp);
        continue;
      }
      const r = await replyToComment(c.id, draft);
      if (r.success) {
        postedCount++;
        advance(c.timestamp);
        log.info("posted comment reply", { mediaId, commentId: c.id, replyId: r.replyId, tone: toneClassified });
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
