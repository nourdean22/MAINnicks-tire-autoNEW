/**
 * content-performance · AG-44 (2026-07-09)
 *
 * Closes the publish→performance half of the content loop. The social
 * pipeline published posts and never looked back — the ghostwriter had
 * taste signals (operator feedback) but zero REALITY signals (what the
 * audience actually engaged with).
 *
 * Weekly (Mon 12:00 UTC):
 *   1. Pull last-14d published SocialPublishQueue rows.
 *   2. Fetch Meta Graph insights per post (impressions + engaged
 *      users). No META_PAGE_ACCESS_TOKEN → skip honestly (AG-02 rule:
 *      absent data is absent, never fabricated).
 *   3. Stamp metrics into each row's sourceMetadata.performance.
 *   4. Write the top-3 by engagement to BrainMemory content_winners —
 *      consumed by buildGhostVoicePrompt's RECENT WINNERS block.
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/content-performance");
const inngest = getInngest();

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_POSTS = 10;

interface PostPerf {
  queueId: string;
  excerpt: string;
  impressions: number;
  engaged: number;
  permalink: string | null;
}

/** Extract a Graph post id from a row: prefer the stashed publishResults
 *  (AG-44 social-publish change), fall back to a bare `pageid_postid`
 *  publishUrls entry. Returns null when the row has no usable id. */
function extractPostId(row: {
  publishUrls: string[];
  sourceMetadata: unknown;
}): string | null {
  const meta = row.sourceMetadata as { publishResults?: Array<{ platform?: string; postId?: string }> } | null;
  const fromMeta = meta?.publishResults?.find((r) => r.postId)?.postId;
  if (fromMeta) return fromMeta;
  const bare = row.publishUrls.find((u) => /^\d+_\d+$/.test(u));
  return bare ?? null;
}

export const contentPerformanceWeekly = inngest.createFunction(
  {
    id: "content-performance-weekly",
    name: "Content · weekly publish→performance rollup",
    retries: 1,
    triggers: [{ cron: "0 12 * * 1" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
    if (!token) {
      log.info("META_PAGE_ACCESS_TOKEN not configured; skipping (no fabricated metrics).");
      return { ok: true, skipped: "no_meta_token" };
    }

    const rows = await step.run("load-published-posts", async () => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.socialPublishQueue.findMany({
        where: {
          status: "published",
          publishedAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
        },
        orderBy: { publishedAt: "desc" },
        take: MAX_POSTS,
        select: { id: true, content: true, publishUrls: true, sourceMetadata: true },
      });
    });
    if (rows.length === 0) {
      return { ok: true, measured: 0, reason: "no_published_posts_in_window" };
    }

    const perf = await step.run("fetch-insights", async () => {
      const out: PostPerf[] = [];
      for (const row of rows) {
        const postId = extractPostId(row);
        if (!postId) continue;
        try {
          const res = await fetch(
            `${GRAPH_BASE}/${postId}/insights?metric=post_impressions,post_engaged_users&access_token=${token}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (!res.ok) {
            log.warn("insights_fetch_failed", { postId, status: res.status });
            continue;
          }
          const body = (await res.json()) as {
            data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
          };
          const metric = (name: string) =>
            body.data?.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
          out.push({
            queueId: row.id,
            excerpt: row.content.slice(0, 160),
            impressions: metric("post_impressions"),
            engaged: metric("post_engaged_users"),
            permalink: row.publishUrls.find((u) => u.startsWith("http")) ?? null,
          });
        } catch (err) {
          log.warn("insights_fetch_threw", {
            postId,
            err: err instanceof Error ? err.message.slice(0, 120) : String(err),
          });
        }
      }
      return out;
    });
    if (perf.length === 0) {
      return { ok: true, measured: 0, reason: "no_insights_available" };
    }

    // Stamp per-row performance so the drafts UI / future analysis can
    // read it without re-hitting the Graph API.
    await step.run("stamp-source-metadata", async () => {
      const { prisma } = await import("@/lib/prisma");
      for (const p of perf) {
        const row = rows.find((r) => r.id === p.queueId);
        const currentMeta =
          row?.sourceMetadata && typeof row.sourceMetadata === "object"
            ? (row.sourceMetadata as Record<string, unknown>)
            : {};
        await prisma.socialPublishQueue
          .update({
            where: { id: p.queueId },
            data: {
              sourceMetadata: {
                ...currentMeta,
                performance: {
                  impressions: p.impressions,
                  engaged: p.engaged,
                  fetchedAt: new Date().toISOString(),
                },
              },
            },
          })
          .catch((err) => log.warn("perf_stamp_failed", { queueId: p.queueId, err: (err as Error).message }));
      }
    });

    const winners = await step.run("write-content-winners", async () => {
      const { prisma } = await import("@/lib/prisma");
      const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
      const top = [...perf].sort((a, b) => b.engaged - a.engaged || b.impressions - a.impressions).slice(0, 3);
      const dateKey = new Date().toISOString().slice(0, 10);
      const content = top
        .map(
          (p, i) =>
            `${i + 1}. [${p.engaged} engaged · ${p.impressions} impressions] "${p.excerpt}"`,
        )
        .join("\n");
      await prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.CONTENT_WINNERS, key: dateKey } },
        create: {
          category: BRAIN_CATEGORIES.CONTENT_WINNERS,
          key: dateKey,
          content,
          source: "inngest:content-performance",
          confidence: 1.0,
          expiresAt: new Date(Date.now() + 45 * 24 * 3600_000),
        },
        update: { content, lastSeen: new Date() },
      });
      return top.map((t) => ({ excerpt: t.excerpt.slice(0, 60), engaged: t.engaged }));
    });

    return { ok: true, measured: perf.length, winners };
  },
);
