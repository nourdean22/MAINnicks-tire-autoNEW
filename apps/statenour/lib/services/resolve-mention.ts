/**
 * lib/services/resolve-mention.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * The async @mention expander (@yesterday / @week / @cold) · extracted
 * verbatim from the POST /api/chat/resolve-mention route handler so the
 * legacy REST endpoint AND the new `chat.resolveMention` tRPC procedure
 * both call this one function · drift between the two consumers is
 * structurally impossible.
 *
 * Each token resolves to a short bracketed summary the chat input hook
 * inlines into the message just before send. Returns a string only —
 * no Prisma row reaches the AppRouter (TS2589 firewall trivially
 * satisfied).
 */

import { prisma } from "@/lib/prisma";
import { searchColdMemory } from "@/lib/brain/cold-memory";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

async function resolveYesterday(): Promise<string> {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const date = y.toISOString().slice(0, 10);

  const [identityRow, dumps, doneCount, contradictionCount] = await Promise.all([
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: `history:${date}` } },
        select: { content: true },
      })
      .catch(() => null),
    prisma.brainDump.findMany({
      where: { date, deletedAt: null },
      take: 3,
      select: { summary: true, rawThoughts: true },
    }),
    prisma.task
      .count({
        where: {
          status: "DONE",
          deletedAt: null,
          updatedAt: {
            gte: new Date(`${date}T00:00:00Z`),
            lt: new Date(`${date}T23:59:59Z`),
          },
        },
      })
      .catch(() => 0),
    prisma.brainMemory
      .count({
        where: {
          category: BRAIN_CATEGORIES.CONTRADICTION,
          deletedAt: null,
          createdAt: {
            gte: new Date(`${date}T00:00:00Z`),
            lt: new Date(`${date}T23:59:59Z`),
          },
        },
      })
      .catch(() => 0),
  ]);

  const parts: string[] = [`[yesterday ${date}:`];
  if (identityRow?.content) {
    try {
      const snap = JSON.parse(identityRow.content) as { axes: Record<string, { value: number; manual: number | null }> };
      const axes = Object.values(snap.axes ?? {});
      if (axes.length > 0) {
        const avg = Math.round(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length);
        parts.push(`brain maturity ${avg}/100`);
      }
    } catch {
      // skip
    }
  }
  parts.push(`${doneCount} task${doneCount === 1 ? "" : "s"} done`);
  if (contradictionCount > 0) parts.push(`${contradictionCount} contradiction${contradictionCount > 1 ? "s" : ""} flagged`);
  if (dumps.length > 0) {
    parts.push(
      `dumps: ${dumps
        .map((d) => d.summary || d.rawThoughts?.slice(0, 80) || "")
        .filter(Boolean)
        .join(" | ")}`
    );
  }
  parts.push("]");
  return parts.join(" ");
}

async function resolveWeek(): Promise<string> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [historyRows, doneCount, workoutDays] = await Promise.all([
    prisma.brainMemory
      .findMany({
        where: {
          category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
          key: { startsWith: "history:" },
          updatedAt: { gte: weekAgo },
        },
        select: { key: true, content: true },
        orderBy: { key: "asc" },
      })
      .catch(() => [] as Array<{ key: string; content: string }>),
    prisma.task.count({ where: { status: "DONE", deletedAt: null, updatedAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.task
      .count({
        where: {
          loopKind: "DAILY",
          deletedAt: null,
          lastCompletedAt: { gte: weekAgo },
          OR: [
            { title: { contains: "workout", mode: "insensitive" } },
            { title: { contains: "gym", mode: "insensitive" } },
          ],
        },
      })
      .catch(() => 0),
  ]);

  if (historyRows.length === 0 && doneCount === 0) {
    return "[week: no signal yet — snapshot has < 1 day of data]";
  }

  const scores: number[] = [];
  for (const row of historyRows) {
    try {
      const snap = JSON.parse(row.content) as { axes: Record<string, { value: number; manual: number | null }> };
      const axes = Object.values(snap.axes ?? {});
      if (axes.length === 0) continue;
      scores.push(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length);
    } catch {
      // skip
    }
  }
  const avgBrain = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0)
    : "?";

  return `[week: brain maturity ${avgBrain}/100 (${historyRows.length}/7 snapshots) · ${doneCount} tasks done · ${workoutDays} workout day${workoutDays === 1 ? "" : "s"}]`;
}

async function resolveCold(surroundingText: string): Promise<string> {
  const query = surroundingText.trim().slice(0, 200);
  if (!query) {
    return "[@cold: use near a question for automatic search, or pass a specific query]";
  }

  const results = await searchColdMemory(query, { scope: "drive", limit: 3 });
  if (results.length === 0) {
    return "[@cold: no matches — try @cold with a more specific query, or call syncDriveMemory first]";
  }

  const lines = results.map((r, i) => {
    const excerpt = r.content.slice(0, 180).replace(/\s+/g, " ");
    return `${i + 1}. [${r.category}] ${excerpt}${r.driveViewUrl ? ` (${r.driveViewUrl})` : ""}`;
  });
  return `[@cold top ${results.length}:\n${lines.join("\n")}]`;
}

/**
 * Resolve a single async @mention token into its bracketed live value.
 * Unknown keys return `[@<key>: unknown]` (matching the legacy route).
 */
export async function resolveMention(args: {
  key: string;
  surroundingText?: string;
}): Promise<{ value: string }> {
  switch (args.key) {
    case "yesterday":
      return { value: await resolveYesterday() };
    case "week":
      return { value: await resolveWeek() };
    case "cold":
      return { value: await resolveCold(args.surroundingText || "") };
    default:
      return { value: `[@${args.key}: unknown]` };
  }
}
