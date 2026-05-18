/**
 * POST /api/chat/resolve-mention
 *
 * Backend for the async mention expansion path (#7 Mentions 2.0).
 * The chat input hook calls this just before send() when the message
 * contains @yesterday / @week / @cold, and swaps each token with the
 * returned value before the message ships to the AI.
 *
 * Body: { key: "yesterday" | "week" | "cold", surroundingText?: string }
 * Returns: { value: string }
 */

import { prisma } from "@/lib/prisma";
import { searchColdMemory } from "@/lib/brain/cold-memory";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      key: string;
      surroundingText?: string;
    };

    switch (body.key) {
      case "yesterday":
        return Response.json({ value: await resolveYesterday() });
      case "week":
        return Response.json({ value: await resolveWeek() });
      case "cold":
        return Response.json({
          value: await resolveCold(body.surroundingText || ""),
        });
      default:
        return Response.json({ value: `[@${body.key}: unknown]` });
    }
  } catch (err) {
    recordError("api:unknown", err, { route: "chat/resolve-mention" });
    return Response.json({ value: "[mention resolution failed]" }, { status: 500 });
  }
}

async function resolveYesterday(): Promise<string> {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const date = y.toISOString().slice(0, 10);

  // Apr 19 · DailyScore retired. Yesterday's snapshot = brain-maturity
  // history row + brain dumps + DONE task count.
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

  // Apr 19 · DailyScore retired. Weekly read = brain-maturity trend
  // from identity snapshot history + DONE count + workout-habit count.
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
    prisma.task.count({ where: { status: "DONE", updatedAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.task
      .count({
        where: {
          loopKind: "DAILY",
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
