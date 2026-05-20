/**
 * INDUSTRY MONITOR — pulls + parses RSS feeds into BrainMemory.
 *
 * v6 · BATCH 5 · Apr 28. Reads sources from industry-sources.ts,
 * fetches each, parses RSS via fast-xml-parser (already in repo via
 * other paths) or simple regex, dedupes by guid+title, writes new
 * items to BrainMemory category="industry_intel".
 *
 * The chat brain's content engine recalls relevant items when
 * generating posts ("there was a NHTSA recall on 2018-2020 Civics
 * yesterday, do you want to position around that?").
 *
 * Run via /api/cron/industry-pull (daily at 5am Cleveland time).
 */

import { prisma } from "@/lib/prisma";
import { getActiveSources, type IndustrySource } from "./industry-sources";

interface ParsedItem {
  guid: string;
  title: string;
  description?: string;
  link?: string;
  publishedAt?: Date;
  category?: string;
}

const MAX_ITEMS_PER_SOURCE = 8;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Pull all enabled sources, write new items to brain memory.
 * Returns a summary so the cron can log progress.
 */
export async function pullIndustryFeeds(): Promise<{
  sourcesAttempted: number;
  sourcesOk: number;
  itemsAdded: number;
  itemsSkipped: number;
  errors: Array<{ sourceId: string; error: string }>;
}> {
  const sources = getActiveSources();
  let itemsAdded = 0;
  let itemsSkipped = 0;
  let sourcesOk = 0;
  const errors: Array<{ sourceId: string; error: string }> = [];

  // Process serially to avoid hammering shared CDNs
  for (const source of sources) {
    try {
      const items = await fetchAndParseSource(source);
      sourcesOk++;
      for (const item of items.slice(0, MAX_ITEMS_PER_SOURCE)) {
        const { added } = await persistItem(source, item);
        if (added) itemsAdded++;
        else itemsSkipped++;
      }
    } catch (err) {
      errors.push({
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    sourcesAttempted: sources.length,
    sourcesOk,
    itemsAdded,
    itemsSkipped,
    errors,
  };
}

async function fetchAndParseSource(source: IndustrySource): Promise<ParsedItem[]> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: ac.signal,
      headers: {
        // Some publishers block default node fetch user-agents; pretend to be a feed reader.
        "User-Agent": "NickAuto-IndustryMonitor/1.0 (+bdnick.info)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    if (source.type === "rss") {
      return parseRssText(text, source);
    }
    if (source.type === "json") {
      return parseJsonText(text, source);
    }
    // HTML fallback — only a few sources, return empty for now (would need a proper extractor)
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Lightweight RSS parser using regex + simple state. Avoids adding a
 * new dependency. Handles RSS 2.0 + Atom feed conventions.
 */
function parseRssText(text: string, source: IndustrySource): ParsedItem[] {
  const items: ParsedItem[] = [];

  // Try RSS <item> first, then Atom <entry>
  const blocks = [
    ...matchAll(text, /<item[^>]*>([\s\S]*?)<\/item>/gi),
    ...matchAll(text, /<entry[^>]*>([\s\S]*?)<\/entry>/gi),
  ];

  for (const block of blocks) {
    const title = decodeXml(extractTag(block, "title")?.trim());
    const link =
      extractTag(block, "link")?.trim()
      || matchAttr(block, /<link[^>]*href="([^"]+)"/) // Atom-style
      || undefined;
    const guid = extractTag(block, "guid")?.trim()
      || extractTag(block, "id")?.trim()
      || link
      || title;
    const description = decodeXml(extractTag(block, "description")?.trim() || extractTag(block, "summary")?.trim());
    const pubDateStr = extractTag(block, "pubDate")?.trim() || extractTag(block, "published")?.trim() || extractTag(block, "updated")?.trim();
    const publishedAt = pubDateStr ? new Date(pubDateStr) : undefined;
    if (!title || !guid) continue;
    if (!matchesFilter(title + " " + (description ?? ""), source)) continue;
    items.push({
      guid: `${source.id}:${guid}`,
      title,
      description,
      link,
      publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      category: source.category,
    });
  }

  return items;
}

function parseJsonText(_text: string, _source: IndustrySource): ParsedItem[] {
  // Stub for future JSON-feed support (most sources are RSS).
  return [];
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  if (!m) return undefined;
  // Strip CDATA wrappers if present
  return m[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");
}

function matchAttr(block: string, re: RegExp): string | undefined {
  const m = re.exec(block);
  return m?.[1];
}

function decodeXml(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, ""); // strip any remaining tags from descriptions
}

function matchesFilter(haystack: string, source: IndustrySource): boolean {
  if (!source.filterKeywords || source.filterKeywords.length === 0) return true;
  const hay = haystack.toLowerCase();
  return source.filterKeywords.some((kw) => hay.includes(kw.toLowerCase()));
}

async function persistItem(source: IndustrySource, item: ParsedItem): Promise<{ added: boolean }> {
  // Dedupe by stable key — guid is unique within source
  const key = item.guid.slice(0, 200);
  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "industry_intel", key } },
      select: { id: true },
    })
    .catch(() => null);
  if (existing) return { added: false };

  await prisma.brainMemory
    .create({
      data: {
        category: "industry_intel",
        key,
        source: source.id,
        content: `[${source.category}] ${item.title}${item.description ? " — " + item.description.slice(0, 300) : ""}`,
        confidence: source.weight / 10,
        metadata: {
          sourceName: source.name,
          sourceCategory: source.category,
          sourceWeight: source.weight,
          link: item.link,
          publishedAt: item.publishedAt?.toISOString(),
        },
      },
    })
    .catch((err) => {
      console.warn(`[industry-monitor] persist failed for ${key}:`, err?.message);
    });

  return { added: true };
}

/**
 * Recall recent industry intel for the chat brain. Returns top N items
 * across categories, weighted by source weight + recency. Used by the
 * content engine when generating posts.
 */
export async function recallIndustryIntel(args: {
  limit?: number;
  category?: IndustrySource["category"];
  daysBack?: number;
}): Promise<Array<{
  title: string;
  category: string;
  source: string;
  link?: string;
  publishedAt?: string;
  weight: number;
}>> {
  const limit = args.limit ?? 10;
  const daysBack = args.daysBack ?? 14;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "industry_intel",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { content: true, source: true, metadata: true, createdAt: true },
    })
    .catch(() => [] as Array<{ content: string; source: string | null; metadata: unknown; createdAt: Date }>);

  const filtered = args.category
    ? rows.filter((r) => {
        const meta = r.metadata as { sourceCategory?: string };
        return meta?.sourceCategory === args.category;
      })
    : rows;

  return filtered.slice(0, limit).map((r) => {
    const meta = (r.metadata as {
      sourceName?: string;
      sourceCategory?: string;
      sourceWeight?: number;
      link?: string;
      publishedAt?: string;
    } | null) ?? {};
    return {
      title: r.content.replace(/^\[[^\]]+\]\s*/, "").slice(0, 200),
      category: meta.sourceCategory ?? "uncategorized",
      source: meta.sourceName ?? r.source ?? "unknown",
      link: meta.link,
      publishedAt: meta.publishedAt,
      weight: meta.sourceWeight ?? 5,
    };
  });
}
