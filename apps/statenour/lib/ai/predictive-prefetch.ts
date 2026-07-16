/**
 * Predictive Tool Pre-routing — fire off likely data fetches in
 * parallel with the Venice streamText call so common intents have
 * their data already warm in the prompt by the time Venice decides
 * which tool to call.
 *
 * For conversational messages (quick mode) we skip entirely. For
 * standard/deep mode we keyword-match the user text and pre-fetch
 * the relevant DB rows. Results are injected into the system prompt
 * as a "PRE-FETCHED CONTEXT" block so Venice can answer without a
 * tool round-trip.
 *
 * All queries are schema-verified (field names checked against the
 * live Prisma schema on 2026-04-15) and wrapped with a 2500ms
 * per-query timeout + error-swallowing. A single slow query never
 * blocks chat startup.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface PrefetchResult {
  label: string;
  data: unknown;
}

const PER_QUERY_TIMEOUT = 2500;

function wrap<T>(label: string, p: Promise<T>): Promise<PrefetchResult | null> {
  return Promise.race([
    p.then((data): PrefetchResult => ({ label, data })).catch((): null => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PER_QUERY_TIMEOUT)),
  ]);
}

export async function prefetchIntents(
  userContent: string
): Promise<PrefetchResult[]> {
  const text = userContent.toLowerCase();
  const tasks: Promise<PrefetchResult | null>[] = [];

  // v11.1 · Business data lives on nickstire.org. The Apr cleanup
  // stubbed these prefetches to []; this wire-up routes them through
  // the queryNick bridge so Nick actually has answers when Nour asks
  // about revenue / quotes / leads. If a nickstire action isn't
  // implemented yet, the wrapper returns `{ error }` and we degrade
  // gracefully to the empty shape.
  const { queryNickBatch } = await import("@/lib/nickstire/query");

  // ─── Revenue / quotes / aging ───
  if (/\b(revenue|money|sales?|quote|estimate|aging|stale|pending|pipeline)\b/.test(text)) {
    tasks.push(
      wrap(
        "QUOTES & REVENUE",
        (async () => {
          const batch = await queryNickBatch([
            { query: "quotes_pending" },
            { query: "quotes_booked_week" },
            { query: "quotes_stale", filters: { olderThanDays: 7 } },
          ]);
          const extract = (r: unknown): any[] => {
            if (!r || typeof r !== "object") return [];
            const w = r as { data?: unknown; error?: string };
            if (w.error) return [];
            if (Array.isArray(w.data)) return w.data as any[];
            if (w.data && typeof w.data === "object" && Array.isArray((w.data as any).rows)) return (w.data as any).rows as any[];
            return [];
          };
          const pending = extract(batch["quotes_pending"]);
          const recent = extract(batch["quotes_booked_week"]);
          const stale = extract(batch["quotes_stale"]);

          const sum = (rows: any[]) => rows.reduce((s, q) => s + (q.grandTotal || 0), 0);
          return {
            pending: { count: pending.length, totalValue: sum(pending), samples: pending.slice(0, 5) },
            weeklyBooked: { count: recent.length, total: sum(recent) },
            staleOver7d: { count: stale.length, totalAtRisk: sum(stale), oldest: stale[0] || null },
          };
        })()
      )
    );
  }

  // ─── Leads / pipeline ───
  if (/\b(lead|prospect|pipeline|new.*customer|walk[ -]?in|booking)\b/.test(text)) {
    tasks.push(
      wrap(
        "LEAD PIPELINE",
        (async () => {
          const batch = await queryNickBatch([
            { query: "leads_open" },
            { query: "leads_overdue_count" },
          ]);
          const openWrap = batch["leads_open"] as { data?: unknown; error?: string } | undefined;
          const overdueWrap = batch["leads_overdue_count"] as { data?: unknown; error?: string } | undefined;
          const open: any[] = Array.isArray(openWrap?.data) ? (openWrap!.data as any[]) : [];
          const overdue: number =
            typeof overdueWrap?.data === "number"
              ? (overdueWrap!.data as number)
              : (overdueWrap?.data as { count?: number })?.count ?? 0;
          return {
            openCount: open.length,
            overdue,
            samples: open.slice(0, 5).map((l) => ({
              name: l.fullName,
              status: l.status,
              urgency: l.urgency,
              type: l.leadType,
              ageHours: l.createdAt ? Math.round((Date.now() - new Date(l.createdAt).getTime()) / 3600000) : null,
            })),
          };
        })()
      )
    );
  }

  // ─── Tasks / MIT ───
  // Apr 18: OpenLoop retired → single Task query (INBOX/READY/DOING).
  if (/\b(task|todo|action|next|priority|what.*do|mit|focus)\b/.test(text)) {
    tasks.push(
      wrap(
        "TASKS + MIT",
        (async () => {
          const [activeTasks, mit] = await Promise.all([
            prisma.task
              .findMany({
                where: { status: { in: ["INBOX", "READY", "DOING"] } },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  autoPriority: true,
                  effort: true,
                },
                orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
                take: 10,
              })
              .catch((): never[] => []),
            prisma.brainMemory
              .findFirst({
                where: { category: BRAIN_CATEGORIES.MIT },
                orderBy: { createdAt: "desc" },
                select: { content: true, createdAt: true },
              })
              .catch((): null => null),
          ]);
          const byBand: Record<string, number> = {};
          for (const t of activeTasks) byBand[t.effort] = (byBand[t.effort] || 0) + 1;
          return {
            tasks: activeTasks.length,
            byBand,
            mit: mit?.content || null,
            samples: activeTasks.slice(0, 3),
          };
        })()
      )
    );
  }

  // ─── Commitments / keep rate (verified: status field, groupBy _count) ───
  if (/\b(commit|promise|kept|broke|keep rate|owe)\b/.test(text)) {
    tasks.push(
      wrap(
        "COMMITMENTS",
        (async () => {
          const stats = await prisma.commitment
            .groupBy({
              by: ["status"],
              where: { deletedAt: null },
              _count: { _all: true },
            })
            .catch((): Array<{ status: string; _count: { _all: number } }> => []);

          let active = 0;
          let kept = 0;
          let broken = 0;
          let total = 0;
          for (const s of stats) {
            const n = s._count._all;
            total += n;
            if (s.status === "active" || s.status === "in_progress") active += n;
            if (s.status === "kept") kept += n;
            if (s.status === "broken") broken += n;
          }
          const keepRate = total > 0 ? Math.round((kept / total) * 100) : 0;
          return { active, kept, broken, total, keepRate };
        })()
      )
    );
  }

  // Apr 19 · Score/habits prefetch retired alongside DailyScore +
  // MasteryHabit. Body/workout/energy signals now pull from
  // PersonalJournal + identity-snapshot when relevant — handled by
  // other prefetch branches and brain context blocks.

  // ─── Forecast / financial ───
  if (/\b(forecast|project|target|goal|gap|save|cash|burn|month-end)\b/.test(text)) {
    tasks.push(
      wrap(
        "FORECAST MEMORY",
        (async () => {
          const mem = await prisma.brainMemory
            .findMany({
              where: { category: BRAIN_CATEGORIES.FINANCIAL_FORECAST },
              orderBy: { createdAt: "desc" },
              take: 3,
              select: { content: true, confidence: true, createdAt: true },
            })
            .catch((): never[] => []);
          return mem.map((m) => ({ content: m.content.slice(0, 300), confidence: m.confidence }));
        })()
      )
    );
  }

  // ─── Blind spots / drift alerts / patterns ───
  if (/\b(missing|blind.?spot|drift|pattern|notice|signal|alert)\b/.test(text)) {
    tasks.push(
      wrap(
        "DRIFT + PATTERNS",
        (async () => {
          const [alerts, patterns] = await Promise.all([
            prisma.brainMemory
              .findMany({
                where: {
                  category: "coach_event",
                  key: { startsWith: "coach:drift-recovery:" },
                  deletedAt: null,
                },
                orderBy: { createdAt: "desc" },
                select: { key: true, content: true, metadata: true, createdAt: true },
                take: 15,
              })
              .then((rows) => {
                const unresolved = rows.filter((e) => {
                  const meta = (e.metadata ?? {}) as Record<string, unknown>;
                  return !meta.ackedAt;
                });
                return unresolved.slice(0, 5).map((e) => {
                  const meta = (e.metadata ?? {}) as Record<string, unknown>;
                  return {
                    id: e.key,
                    ruleName: e.content,
                    message: typeof meta.body === "string" ? meta.body : "",
                    severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
                    createdAt: e.createdAt,
                  };
                });
              })
              .catch((): never[] => []),
            prisma.patternDetection
              .findMany({
                orderBy: { createdAt: "desc" },
                select: { patternName: true, evidence: true, createdAt: true },
                take: 3,
              })
              .catch((): never[] => []),
          ]);
          return {
            activeDriftCount: alerts.length,
            alerts: alerts.slice(0, 3).map((a) => ({
              rule: a.ruleName,
              severity: a.severity,
              message: (a.message || "").slice(0, 120),
            })),
            patterns: patterns.map((p) => p.patternName),
          };
        })()
      )
    );
  }

  if (tasks.length === 0) return [];

  const results = await Promise.all(tasks);
  return results.filter((r): r is PrefetchResult => r !== null);
}

/**
 * Format prefetch results as a compact context block for injection
 * into the system prompt. Each block gets a clear label so Venice
 * knows what it's looking at without a tool call.
 */
export function formatPrefetchContext(results: PrefetchResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = [];
  lines.push("# PRE-FETCHED CONTEXT (live data, no tool call needed)");
  lines.push("");
  for (const r of results) {
    lines.push(`## ${r.label}`);
    lines.push("```json");
    lines.push(JSON.stringify(r.data, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
