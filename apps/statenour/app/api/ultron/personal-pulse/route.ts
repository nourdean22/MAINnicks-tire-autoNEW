// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("ultron/personal-pulse");

/**
 * GET /api/ultron/personal-pulse
 *
 * The personal ticker counterpart to the top markets ticker. While
 * the top ticker shows EXTERNAL signal (markets, macro headlines,
 * shop pulse, personal timelines), this feeds a BOTTOM ticker that
 * rotates PERSONAL state:
 *
 *   - Most recent brain dump / capture         (📝)
 *   - Current MIT (today's Most Important Thing)  (⚔)
 *   - Tomorrow note (if drafted)                (🌙)
 *   - Latest narrator observation               (◆)
 *   - Overdue commitments                        (⚖)
 *   - Last reflection freshness                  (👁)
 *   - Last win (completed task in last 3h)       (🏆)
 *   - Time since last /capture                   (📝 idle ticker)
 *
 * Returns [] when nothing notable — the UI hides the strip entirely.
 * Cache 90s so rapid polls don't hammer Prisma.
 */

export const revalidate = 90;

interface PulseItem {
  id: string;
  kind:
    | "capture" | "mit" | "tomorrow" | "narrator" | "commitment" | "reflection"
    | "win" | "insight" | "idle" | "contradiction" | "mind" | "life"
    // v10.0.97 — daily curated wisdom pick from /api/brain/memory-of-the-day.
    // Surfaces as a rotating ticker item instead of a card, respecting
    // Nour's "kill the cards" preference for the chat empty state while
    // still giving the brain a daily voice on every mastery page.
    | "wisdom";
  glyph: string;      // unicode glyph to prepend
  label: string;      // 3-6 char caps
  text: string;       // the actual content
  tone: "info" | "warn" | "win" | "mute";
  href?: string;
}

interface PulsePayload {
  items: PulseItem[];
  generatedAt: string;
}

function todayDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function GET() {
  try {
    // v10.0.97 · cache key bumped to v3 — schema added `wisdom` kind
    // + tz-resilient findFirst lookup
    const payload = await cached<PulsePayload>("ultron_personal_pulse_v3", 90, async () => {
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
          where: { category_key: { category: BRAIN_CATEGORIES.MIT, key: todayStr } },
          select: { content: true, updatedAt: true },
        }),
        prisma.brainMemory
          .findUnique({
            where: { category_key: { category: BRAIN_CATEGORIES.TOMORROW_NOTE, key: tomorrowStr } },
            select: { content: true },
          })
          .catch(() => null),
        // Most recent narrator-sourced memory (adviser/coach/etc)
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
          where: { status: "DONE", updatedAt: { gte: threeHoursAgo }, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          select: { title: true, updatedAt: true },
        }),
        // Apr 18 · "Nick noticed" rollup — brain_insight AuditEvent rows
        // from today, dedup'd by headline, rotated into the ticker.
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
          .catch((): Array<{ id: number; detail: string; actor: string; createdAt: Date }> => []),
        // Apr 19 · Contradictions — rotate conflict flags from the
        // last 7d into the ticker so Nour sees drift against his
        // stated positions in the same session.
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
          .catch((): Array<{ id: string; key: string; content: string; createdAt: Date }> => []),
        // Apr 19 · Identity snapshot (MIND chip replacement — live brain
        // maturity instead of stale MasteryScore "mind" domain).
        prisma.brainMemory
          .findUnique({
            where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
            select: { content: true },
          })
          .catch(() => null),
        // Apr 19 · LIFE chip — person profile with longest silence.
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
        // No followUpDue column in schema — count distinct person
        // profiles whose last interaction is ≥7 days old instead.
        prisma.personProfile
          .count({
            where: {
              role: { in: ["family", "friend", "partner", "wife", "dania"] },
              lastInteraction: { lt: new Date(now - 7 * 86400_000) },
            },
          })
          .catch(() => 0),
        // v10.0.97 — Memory-of-the-day pick. Looks up the most-recent
        // memory_of_day_pick marker (NOT keyed exactly to NY-local
        // todayStr because /api/brain/memory-of-the-day stores key
        // in UTC date — that mismatch would silently skip the ticker
        // item near midnight Cleveland time). findFirst orderBy desc
        // gives us the latest pick regardless of timezone-shift.
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
        const ageMins = Math.round((now - latestDump.createdAt.getTime()) / 60_000);
        if (ageMins < 24 * 60) {
          const text = (latestDump.summary || latestDump.rawThoughts || "").slice(0, 140);
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
          // /commitments retired v10 · promises live on /tasks via loopKind=PROMISE
          href: "/tasks",
        });
      }

      // ── Reflection freshness ──
      if (lastReflection) {
        const ageDays = Math.floor((now - lastReflection.createdAt.getTime()) / 86400000);
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
        const ageMins = Math.round((now - latestWin.updatedAt.getTime()) / 60_000);
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
      // Dedup by headline prefix so repeated pattern-fires collapse.
      const seenInsightKeys = new Set<string>();
      const pretty = (detail: string): string => {
        // Watcher insights carry the "CRON WATCHER:" prefix — swap for ⚙︎
        // so they're visibly system-origin; same as pulse-digest does.
        const isWatcher = detail.startsWith("CRON WATCHER:");
        return isWatcher
          ? detail.replace(/^CRON WATCHER:\s*/, "⚙︎ ")
          : detail;
      };
      // Apr 19 · Skip watcher / system-origin insights in the personal
      // ticker too. They live on /system/health + /settings cron control.
      // Personal ticker is for Nour's own signals (self-model, wins,
      // drift, commitments).
      const HIDDEN_ACTORS_TICKER = new Set(["system", "cron_watcher", "cron_health", "backlog_triage"]);
      // v10.0.123 cleanup · removed dead insightLinkFor function. Every
      // branch of its conditional returned "/brain" — the if-chain over
      // actor types was scaffolding for per-actor sub-page routing
      // (e.g. /brain#contradictions) that never landed. Inlined as a
      // constant so a future actor-specific link is a single-line edit.
      for (const raw of (todaysInsights as Array<{ id: number | string; detail: string; actor: string; createdAt: Date }>)) {
        if (HIDDEN_ACTORS_TICKER.has((raw.actor ?? "").toLowerCase())) continue;
        if ((raw.detail ?? "").startsWith("CRON WATCHER:")) continue;
        const headline = pretty(raw.detail || "").slice(0, 130).trim();
        if (!headline) continue;
        const dedupKey = headline.toLowerCase().slice(0, 50);
        if (seenInsightKeys.has(dedupKey)) continue;
        seenInsightKeys.add(dedupKey);
        const ageMins = Math.round((now - raw.createdAt.getTime()) / 60_000);
        const age = ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
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
      // These are the "you said X but earlier you said NOT X" flags
      // from the contradiction surfacer. Resolved + dismissed are
      // filtered so the ticker stays fresh.
      // v10.0.529.30 · Arc B Phase 3 · href fixed to point at the
      // ContradictionsCard on /ultron (root) instead of the dead
      // /brain?resolve= path (per v10.0.123 cleanup note · /brain
      // sub-page routing for contradictions was scaffolded but never
      // landed). New format: `/?resolve=<key>#contradictions` ·
      // hash triggers scroll to the anchor wrapper · `?resolve=`
      // tells the card to auto-open that specific contradiction's
      // resolution form so the ticker tap is a one-shot deep link
      // rather than "scroll and hunt".
      const contradictions = recentContradictions as Array<{ id: string; key: string; content: string; createdAt: Date }>;
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

      // ── MIND (brain maturity) — folded from the old PulseStack chip ──
      // Apr 19 · Replaces the stale MasteryScore "mind" domain chip.
      // Pulls the live 8-axis snapshot score + direction so the ticker
      // reflects where Nour is right now, not whatever he last logged.
      if (identitySnap?.content) {
        try {
          const snap = JSON.parse(identitySnap.content) as {
            axes: Record<string, { value: number; manual: number | null; direction: string }>;
          };
          const axes = Object.values(snap.axes);
          if (axes.length > 0) {
            // Average all axes for a single MIND signal
            const avg = Math.round(
              axes.reduce((sum, a) => sum + (a.manual ?? a.value), 0) / axes.length,
            );
            const shifting = axes.find((a) => a.direction !== "stable");
            const tone: PulseItem["tone"] = avg >= 60 ? "win" : avg >= 40 ? "info" : "warn";
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
      // Apr 19 · Replaces the "0d connected" stale chip with a live
      // read: who's gone the longest without interaction + how many
      // people haven't been reached in 7d+. If neither signal is
      // meaningful, we skip.
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

      // v10.0.97 — Memory of the day. Resolve the picked memory's
      // content + category, surface as one ticker item. Idempotent
      // per calendar day via /api/brain/memory-of-the-day. Silent
      // when no pick is available (first run of the day, before the
      // endpoint is hit). Respects Nour's "kill the cards" preference
      // for the chat empty state by living in the ambient strip
      // instead of as a card.
      // v10.0.104 audit fix · log failures instead of silently swallowing.
      // The extra round-trip is intentional (small, gated by 90s cache),
      // but masking errors meant a misconfigured memoryId would cause
      // wisdom to silently disappear with no telemetry. Now if anything
      // fails it'll surface in the runtime log.
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

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          items: [],
          generatedAt: new Date().toISOString(),
        },
        error: sanitizeError(err),
      },
      { status: 200 }
    );
  }
}
