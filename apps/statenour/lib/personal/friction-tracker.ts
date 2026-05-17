/**
 * FRICTION TRACKER — log when actions take more taps than they should.
 *
 * v7 · BATCH 5 · Apr 28. Records moments where Nour wanted to do
 * something simple but the OS made him work for it. Surfaces a
 * "make this 1-tap" backlog so we systematically reduce friction.
 *
 * Examples we'd capture:
 *   · Asked Nick to "draft a brake post" → had to tap Generate, then
 *     Edit, then Publish, then Schedule → 4 taps for a routine flow
 *   · Wanted to see today's revenue → 3 taps to /admin → /reports → today
 *   · Tried to pin a fact → had to remember the slash command
 *
 * Detection (heuristic):
 *   · Same user message rephrased in successive turns (re-asking) = friction
 *   · "why doesn't X work" / "how do I" / "where is" = friction
 *   · Multiple navigation events in <30s = friction
 *
 * Output: brain_memory category="friction" entries with capturedAt,
 * description, taps_estimated, tag (chat / nav / data / pin).
 *
 * Surfaces in a /system/friction page that lists "make this 1-tap"
 * candidates ranked by frequency.
 */

import { prisma } from "@/lib/prisma";

const FRICTION_PATTERNS: Array<{ pattern: RegExp; tag: string; description: string }> = [
  {
    pattern: /\b(why doesn'?t|why won'?t|why can'?t i)\b/i,
    tag: "broken_flow",
    description: "user reports something doesn't work as expected",
  },
  {
    pattern: /\b(how do i|how to|where is|where do i find)\b/i,
    tag: "discoverability",
    description: "user can't find a feature",
  },
  {
    pattern: /\b(again|still not|tried that|same thing|didn'?t work)\b/i,
    tag: "repeated_attempt",
    description: "user repeating after a failed attempt",
  },
  {
    pattern: /\b(make it|just|wish (it|this|i could))\b.*\b(easier|faster|simpler|one tap|1.tap)/i,
    tag: "request_simplification",
    description: "user asking for a simpler flow",
  },
  {
    pattern: /\b(damn|fuck|wtf|annoying|broken|stuck|frustrated)\b/i,
    tag: "frustration",
    description: "frustration signal",
  },
];

export interface FrictionEntry {
  detected: boolean;
  tag: string;
  description: string;
  rawText: string;
  pattern: string;
}

export function detectFriction(message: string): FrictionEntry | null {
  if (!message || message.length < 4) return null;
  for (const f of FRICTION_PATTERNS) {
    if (f.pattern.test(message)) {
      return {
        detected: true,
        tag: f.tag,
        description: f.description,
        rawText: message.slice(0, 300),
        pattern: f.pattern.source,
      };
    }
  }
  return null;
}

export async function persistFriction(args: {
  entry: FrictionEntry;
  conversationId?: string;
  pagePath?: string;
}): Promise<void> {
  try {
    const { entry, conversationId, pagePath } = args;
    const key = `friction:${entry.tag}-${Date.now()}`;
    await prisma.brainMemory.create({
      data: {
        category: "friction",
        key,
        source: "auto_detect",
        content: `[${entry.tag}] "${entry.rawText.slice(0, 180)}"`,
        confidence: 0.7,
        metadata: {
          tag: entry.tag,
          description: entry.description,
          pattern: entry.pattern,
          rawText: entry.rawText,
          conversationId,
          pagePath,
          capturedAt: new Date().toISOString(),
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    console.warn("[friction-tracker] persist failed:", err instanceof Error ? err.message : err);
  }
}

export interface FrictionSummary {
  byTag: Record<string, number>;
  totalEntries: number;
  topRecurring: Array<{ tag: string; count: number; sample: string }>;
}

export async function summarizeFriction(daysBack = 30): Promise<FrictionSummary> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: "friction", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { content: true, metadata: true },
    })
    .catch(() => [] as Array<{ content: string; metadata: unknown }>);

  const byTag: Record<string, number> = {};
  const samples: Record<string, string> = {};
  for (const r of rows) {
    const meta = (r.metadata as { tag?: string } | null) ?? {};
    const tag = meta.tag ?? "unknown";
    byTag[tag] = (byTag[tag] ?? 0) + 1;
    if (!samples[tag]) samples[tag] = r.content;
  }

  const topRecurring = Object.entries(byTag)
    .map(([tag, count]) => ({ tag, count, sample: samples[tag] ?? "" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { byTag, totalEntries: rows.length, topRecurring };
}
