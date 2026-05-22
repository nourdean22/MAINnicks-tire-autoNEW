/**
 * lib/services/personal-pulse.ts · Phase B.6a (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · operator-domain
 * sub-slice).
 *
 * The personal ticker counterpart to the top markets ticker. While
 * the top ticker shows EXTERNAL signal, this feeds a BOTTOM ticker
 * that rotates PERSONAL state:
 *
 *   - Most recent brain dump / capture          (📝)
 *   - Current MIT (today's Most Important Thing) (⚔)
 *   - Tomorrow note (if drafted)                 (🌙)
 *   - Latest narrator observation                (◆)
 *   - Overdue commitments                        (⚖)
 *   - Last reflection freshness                  (👁)
 *   - Last win (completed task in last 3h)       (🏆)
 *   - "Nick noticed today" (brain_insight)       (👁)
 *   - Contradictions · mind · life · wisdom
 *
 * Returns [] when nothing notable — the UI hides the strip entirely.
 *
 * Extracted from the inline route logic in
 * app/api/ultron/personal-pulse/route.ts so BOTH the legacy REST
 * route AND the new `operator.personalPulse` tRPC procedure call the
 * same `buildPersonalPulse` function · drift impossible. The
 * `cached()` wrapper lives inside `buildPersonalPulse` so both
 * transports share the 90s window.
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("services/personal-pulse");

export interface PulseItem {
  id: string;
  kind:
    | "capture"
    | "mit"
    | "tomorrow"
    | "narrator"
    | "commitment"
    | "reflection"
    | "win"
    | "insight"
    | "idle"
    | "contradiction"
    | "mind"
    | "life"
    | "wisdom";
  glyph: string;
  label: string;
  text: string;
  tone: "info" | "warn" | "win" | "mute";
  href?: string;
}

export interface PulsePayload {
  items: PulseItem[];
  generatedAt: string;
}

function todayDateString(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}
function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Build the bottom personal-pulse payload · cached 90s so rapid polls
 * don't hammer Prisma. Both the REST route and the
 * `operator.personalPulse` tRPC procedure call this.
 */
export async function buildPersonalPulse(): Promise<PulsePayload> {
  return cached<PulsePayload>("ultron_personal_pulse_v3", 90, async () => {
    const now = Date.now();
    const todayStr = todayDateString();
    const tomorrowStr = tomorrowDateString();
    const threeHoursAgo = new Date(now - 3 * 3600_000);
    const items: PulseItem[] = [];

    // ── Parallel pulls ──
    const [
      latestDump,
      mit,
      tomorrowNote,
      latestNarratorMemory,
      overdueCommitments,
      lastReflection,
      latestWin,
      todaysInsights,
      recentContradictions,
      identitySnap,
      topSilentPerson,
      pendingCalls,
      memoryOfDayPick,
    ] = await Promise.all([
      prisma.brainDump.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, summary: true, rawThoughts: true },
      }),
      prisma.brainMemory.findUnique({
        where: {
          category_key: { category: BRAIN_CATEGORIES.MIT, key: todayStr },
        },
        select: { content: true, updatedAt: true },
      }),
      prisma.brainMemory
        .findUnique({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.TOMORROW_NOTE,
              key: tomorrowStr,
            },
          },
          select: { content: true },
        })
        .catch(() => null),
      prisma.brainMemory.findFirst({
        where: { source: { startsWith: "ultron_narrator" } },
        orderBy: { createdAt: "desc" },
        select: { content: true, category: true, createdAt: true },
      }),
      prisma.commitment.findMany({
        where: { status: "active", deadline: { lt: todayStr }, deletedAt: null },
        orderBy: { deadline: "asc" },
        take: 3,
        select: { id: true, description: true, deadline: true, toWhom: true },
      }),
      prisma.reflection.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, insight: true },
      }),
      prisma.task.findFirst({
        where: {
          status: "DONE",
          updatedAt: { gte: threeHoursAgo },
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        select: { title: true, updatedAt: true },
      }),
      prisma.auditEvent
        .findMany({
          where: {
            eventType: "brain_insight",
            createdAt: { gte: new Date(now - 24 * 3600_000) },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, detail: true, actor: true, createdAt: true },
        })
        .catch(
          (): Array<{
            id: number;
            detail: string;
            actor: string;
            createdAt: Date;
          }> => [],
        ),
      prisma.brainMemory
        .findMany({
          where: {
            category: BRAIN_CATEGORIES.CONTRADICTION,
            createdAt: { gte: new Date(now - 7 * 86400_000) },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, key: true, content: true, createdAt: true },
        })
        .catch(
          (): Array<{
            id: string;
            key: string;
            content: string;
            createdAt: Date;
          }> => [],
        ),
      prisma.brainMemory
        .findUnique({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
              key: "current",
            },
          },
          select: { content: true },
        })
        .catch(() => null),
      prisma.personProfile
        .findFirst({
          where: {
            role: { in: ["family", "friend", "partner", "wife", "dania"] },
            lastInteraction: { not: null },
          },
          orderBy: { lastInteraction: "asc" },
          select: { name: true, lastInteraction: true },
        })
        .catch(() => null),
      prisma.personProfile
        .count({
          where: {
            role: { in: ["family", "friend", "partner", "wife", "dania"] },
            lastInteraction: { lt: new Date(now - 7 * 86400_000) },
          },
        })
        .catch(() => 0),
      prisma.brainMemory
        .findFirst({
          where: {
            category: "memory_of_day_pick",
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: { metadata: true, key: true },
        })
        .catch(() => null),
    ]);

    // ── Latest capture (most recent brain dump in last 24h) ──
    if (latestDump) {
      const ageMins = Math.round(
        (now - latestDump.createdAt.getTime()) / 60_000,
      );
      if (ageMins < 24 * 60) {
        const text = (
          latestDump.summary ||
          latestDump.rawThoughts ||
          ""
        ).slice(0, 140);
        if (text) {
          items.push({
            id: `capture-${latestDump.createdAt.getTime()}`,
            kind: "capture",
            glyph: "📝",
            label: "CAPTURE",
            text: `${ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`} · ${text}`,
            tone: "info",
            href: "/journal",
          });
        }
      }
    }

    // ── MIT ──
    if (mit?.content) {
      items.push({
        id: "mit",
        kind: "mit",
        glyph: "⚔",
        label: "MIT",
        text: mit.content.slice(0, 140),
        tone: "win",
        href: "/tasks",
      });
    } else {
      // Before noon, nudge that MIT isn't set
      const h = new Date().getHours();
      if (h >= 7 && h < 12) {
        items.push({
          id: "mit-unset",
          kind: "mit",
          glyph: "⚔",
          label: "MIT",
          text: "not set today — lock it in",
          tone: "warn",
          href: "/tasks",
        });
      }
    }

    // ── Tomorrow note ──
    if (tomorrowNote?.content) {
      let focus = "drafted";
      try {
        const parsed = JSON.parse(tomorrowNote.content);
        if (parsed.focus) focus = String(parsed.focus).slice(0, 80);
      } catch {
        focus = tomorrowNote.content.slice(0, 80);
      }
      items.push({
        id: "tomorrow-note",
        kind: "tomorrow",
        glyph: "🌙",
        label: "TOMORROW",
        text: `focus: ${focus}`,
        tone: "info",
      });
    }

    // ── Narrator — latest observation (last 12h) ──
    if (latestNarratorMemory) {
      const ageH = (now - latestNarratorMemory.createdAt.getTime()) / 3600_000;
      if (ageH < 12) {
        items.push({
          id: `narrator-${latestNarratorMemory.createdAt.getTime()}`,
          kind: "narrator",
          glyph: "◆",
          label: "NARRATOR",
          text: latestNarratorMemory.content.slice(0, 140),
          tone: "info",
        });
      }
    }

    // ── Overdue commitments ──
    for (const c of overdueCommitments.slice(0, 2)) {
      const daysOverdue = c.deadline
        ? Math.floor((now - new Date(c.deadline).getTime()) / 86400000)
        : 0;
      items.push({
        id: `commitment-${c.id}`,
        kind: "commitment",
        glyph: "⚖",
        label: "PROMISE",
        text: `owed ${c.toWhom}${daysOverdue > 0 ? ` · ${daysOverdue}d overdue` : ""}: ${c.description.slice(0, 100)}`,
        tone: "warn",
        href: "/tasks",
      });
    }

    // ── Reflection freshness ──
    if (lastReflection) {
      const ageDays = Math.floor(
        (now - lastReflection.createdAt.getTime()) / 86400000,
      );
      if (ageDays >= 3) {
        items.push({
          id: "reflection-gap",
          kind: "reflection",
          glyph: "👁",
          label: "REFLECT",
          text: `${ageDays}d since last reflection — tonight's good`,
          tone: "mute",
          href: "/journal#reflect",
        });
      } else if (ageDays === 0) {
        items.push({
          id: "reflection-today",
          kind: "reflection",
          glyph: "👁",
          label: "REFLECT",
          text: `reflected today · "${lastReflection.insight.slice(0, 100)}"`,
          tone: "win",
        });
      }
    }

    // ── Win in last 3h ──
    if (latestWin) {
      const ageMins = Math.round(
        (now - latestWin.updatedAt.getTime()) / 60_000,
      );
      items.push({
        id: `win-${latestWin.updatedAt.getTime()}`,
        kind: "win",
        glyph: "🏆",
        label: "DONE",
        text: `${ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`} · ${latestWin.title.slice(0, 110)}`,
        tone: "win",
        href: "/tasks",
      });
    }

    // ── "Nick noticed" — today's brain_insights ──
    const seenInsightKeys = new Set<string>();
    const pretty = (detail: string): string => {
      const isWatcher = detail.startsWith("CRON WATCHER:");
      return isWatcher
        ? detail.replace(/^CRON WATCHER:\s*/, "⚙︎ ")
        : detail;
    };
    const HIDDEN_ACTORS_TICKER = new Set([
      "system",
      "cron_watcher",
      "cron_health",
      "backlog_triage",
    ]);
    for (const raw of todaysInsights as Array<{
      id: number | string;
      detail: string;
      actor: string;
      createdAt: Date;
    }>) {
      if (HIDDEN_ACTORS_TICKER.has((raw.actor ?? "").toLowerCase())) continue;
      if ((raw.detail ?? "").startsWith("CRON WATCHER:")) continue;
      const headline = pretty(raw.detail || "").slice(0, 130).trim();
      if (!headline) continue;
      const dedupKey = headline.toLowerCase().slice(0, 50);
      if (seenInsightKeys.has(dedupKey)) continue;
      seenInsightKeys.add(dedupKey);
      const ageMins = Math.round((now - raw.createdAt.getTime()) / 60_000);
      const age =
        ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
      items.push({
        id: `insight-${raw.id}`,
        kind: "insight",
        glyph: "👁",
        label: "NICK NOTICED",
        text: `${age} · ${headline}`,
        tone: "info",
        href: "/brain",
      });
      if (seenInsightKeys.size >= 3) break; // cap at 3 per ticker loop
    }

    // ── Contradictions — up to 2 unresolved rows from last 7d ──
    const contradictions = recentContradictions as Array<{
      id: string;
      key: string;
      content: string;
      createdAt: Date;
    }>;
    let renderedContradictions = 0;
    for (const row of contradictions) {
      if (renderedContradictions >= 2) break;
      try {
        const parsed = JSON.parse(row.content) as {
          new_excerpt: string;
          old_excerpt: string;
          days_apart: number;
          signal: string;
          status?: string;
        };
        if (parsed.status && parsed.status !== "unresolved") continue;
        const newPart = parsed.new_excerpt.slice(0, 60).trim();
        const oldPart = parsed.old_excerpt.slice(0, 60).trim();
        items.push({
          id: `contradiction-${row.id}`,
          kind: "contradiction",
          glyph: "⚠",
          label: "CONTRADICTION",
          text: `"${newPart}" conflicts with ${parsed.days_apart}d-old: "${oldPart}"`,
          tone: "warn",
          href: `/?resolve=${encodeURIComponent(row.key)}#contradictions`,
        });
        renderedContradictions++;
      } catch {
        // skip malformed row
      }
    }

    // ── MIND (brain maturity) ──
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as {
          axes: Record<
            string,
            { value: number; manual: number | null; direction: string }
          >;
        };
        const axes = Object.values(snap.axes);
        if (axes.length > 0) {
          const avg = Math.round(
            axes.reduce((sum, a) => sum + (a.manual ?? a.value), 0) /
              axes.length,
          );
          const shifting = axes.find((a) => a.direction !== "stable");
          const tone: PulseItem["tone"] =
            avg >= 60 ? "win" : avg >= 40 ? "info" : "warn";
          items.push({
            id: "mind-chip",
            kind: "mind",
            glyph: "◆",
            label: "MIND",
            text: `brain maturity ${avg}/100${shifting ? ` · ${shifting.direction === "rising" ? "↑" : "↓"}` : ""}`,
            tone,
            href: "/brain",
          });
        }
      } catch {
        // skip
      }
    }

    // ── LIFE — person silence + silent-person count ──
    if (topSilentPerson?.name && topSilentPerson.lastInteraction) {
      const days = Math.floor(
        (now - topSilentPerson.lastInteraction.getTime()) / 86400_000,
      );
      if (days >= 3) {
        const firstName = topSilentPerson.name.split(/\s+/)[0];
        items.push({
          id: "life-silent",
          kind: "life",
          glyph: "♥",
          label: "LIFE",
          text: `${firstName} silent ${days}d${
            pendingCalls > 1 ? ` · ${pendingCalls - 1} more quiet 7d+` : ""
          }`,
          tone: days >= 14 ? "warn" : "info",
          href: "/chat",
        });
      }
    } else if (pendingCalls > 0) {
      items.push({
        id: "life-silent",
        kind: "life",
        glyph: "♥",
        label: "LIFE",
        text: `${pendingCalls} ${pendingCalls === 1 ? "person" : "people"} quiet 7d+`,
        tone: "info",
        href: "/chat",
      });
    }

    // ── Memory of the day ──
    if (memoryOfDayPick?.metadata) {
      const meta = memoryOfDayPick.metadata as {
        memoryId?: string;
      } | null;
      if (meta?.memoryId) {
        try {
          const mem = await prisma.brainMemory.findUnique({
            where: { id: meta.memoryId },
            select: { category: true, content: true, key: true },
          });
          if (mem) {
            const snippet = mem.content
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
            items.push({
              id: `wisdom-${meta.memoryId}`,
              kind: "wisdom",
              glyph: "✦",
              label: "BRAIN",
              text: `[${mem.category.replace(/_/g, " ")}] ${snippet}`,
              tone: "info",
              href: "/brain",
            });
          } else {
            log.warn("wisdom_memory_not_found", {
              memoryId: meta.memoryId,
              pickKey: memoryOfDayPick.key,
            });
          }
        } catch (err) {
          log.warn("wisdom_resolve_failed", {
            memoryId: meta.memoryId,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
    }

    return {
      items,
      generatedAt: new Date().toISOString(),
    };
  });
}
