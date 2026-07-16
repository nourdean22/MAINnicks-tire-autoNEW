/**
 * GET /api/ai/chat-openers — Nick-leads-first opener lines.
 *
 * Replaces the generic "Revenue today? What should I focus on?"
 * starter prompts with 3 SPECIFIC observations Nick already has
 * ready based on live state. Tesla-style: the surface stays clean,
 * but tapping any opener launches a real thread grounded in real
 * signal.
 *
 * Openers are ranked by urgency:
 *   1. Unresolved contradictions (drift — highest priority)
 *   2. Overdue commitments
 *   3. Ghost Nick top prediction
 *   4. Weakest identity axis
 *   5. Fresh skill candidates awaiting promotion
 *   6. Positive momentum (if nothing else flares)
 *
 * Each opener is ≤70 chars and has a ready-to-send "ask" string —
 * the exact prompt to fill the input when Nour taps.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface Opener {
  id: string;
  headline: string;     // what the UI shows
  ask: string;          // what fills the input on tap
  severity: "alert" | "info" | "win";
  source:
    | "contradiction"
    | "commitment"
    | "ghost"
    | "identity"
    | "skill"
    | "momentum"
    | "leads"
    | "revenue"
    | "aging"
    | "time"
    | "pin";
}

/**
 * Phase of day — drives time-specific openers.
 * morning: what's the MIT, frame the day
 * midday: check-in on progress
 * afternoon: what's blocking, what's slipping
 * evening: reflect on today, set up tomorrow
 * late: pattern-level reflection, sleep hygiene
 */
function phaseOfDay(h: number): "morning" | "midday" | "afternoon" | "evening" | "late" {
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "late";
}

export const GET = apiHandler(
  async () => {
    const now = Date.now();
    const todayLocal = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    const [
      contradictions,
      overdueCommits,
      ghost,
      identitySnap,
      pendingSkills,
      doneToday,
      topMission,
      stalePins,
      criticalTasks,
    ] = await Promise.all([
      prisma.brainMemory
        .count({
          where: {
            category: BRAIN_CATEGORIES.CONTRADICTION,
            deletedAt: null,
            createdAt: { gte: new Date(now - 14 * 86400_000) },
          },
        })
        .catch(() => 0),
      prisma.commitment
        .findMany({
          where: { status: "active", deadline: { lt: todayLocal }, deletedAt: null },
          orderBy: { deadline: "asc" },
          take: 1,
          select: { description: true, toWhom: true },
        })
        .then(async (active) => {
          const count = await prisma.commitment
            .count({ where: { status: "active", deadline: { lt: todayLocal }, deletedAt: null } })
            .catch(() => 0);
          return { count, sample: active[0] ?? null };
        })
        .catch(() => ({ count: 0, sample: null })),
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
          select: { content: true, updatedAt: true },
        })
        .catch(() => null),
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { content: true },
        })
        .catch(() => null),
      prisma.brainMemory
        .count({ where: { category: BRAIN_CATEGORIES.SKILL_PENDING, deletedAt: null } })
        .catch(() => 0),
      prisma.task
        .count({
          where: {
            status: "DONE",
            deletedAt: null,
            updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        })
        .catch(() => 0),
      // Top active Mission = surrogate MIT (Most Important Thing)
      prisma.mission
        .findFirst({
          where: { status: "ACTIVE" },
          orderBy: [{ priority: "desc" }, { roiScore: "desc" }],
          select: { id: true, title: true, deadline: true, domain: true },
        })
        .catch(() => null),
      // Stale pins — pinned content that hasn't been reviewed/reinforced
      // in 14+ days. Nour may want to revisit or unpin.
      prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.PINNED_USER,
            updatedAt: { lt: new Date(now - 14 * 86400_000) },
          },
          orderBy: { updatedAt: "asc" },
          select: { id: true, content: true, updatedAt: true },
        })
        .catch(() => null),
      // Critical-priority open tasks — time-of-day prompt anchor
      prisma.task
        .count({
          where: {
            status: { in: ["INBOX", "READY", "DOING"] },
            deletedAt: null,
            // priority enum varies; rely on roiScore >= 70 as "matters"
            roiScore: { gte: 70 },
          },
        })
        .catch(() => 0),
    ]);

    const openers: Opener[] = [];

    // 1. Contradictions (alert)
    if (contradictions > 0) {
      openers.push({
        id: "contradictions",
        headline: `${contradictions} contradiction${contradictions > 1 ? "s" : ""} open — reconcile?`,
        ask: `Walk me through the ${contradictions} open contradiction${contradictions > 1 ? "s" : ""} · which one matters most to resolve first?`,
        severity: "alert",
        source: "contradiction",
      });
    }

    // 2. Overdue commitments (alert)
    if (overdueCommits.count > 0) {
      const tail = overdueCommits.sample
        ? ` (oldest: ${overdueCommits.sample.description.slice(0, 40)})`
        : "";
      openers.push({
        id: "overdue-commits",
        headline: `${overdueCommits.count} overdue promise${overdueCommits.count > 1 ? "s" : ""}${tail}`,
        ask: `I have ${overdueCommits.count} overdue commitment${overdueCommits.count > 1 ? "s" : ""} — which should I renegotiate vs close out?`,
        severity: "alert",
        source: "commitment",
      });
    }

    // 3. Ghost Nick top prediction (info)
    if (ghost?.content) {
      try {
        const bundle = JSON.parse(ghost.content) as {
          predictions: Array<{ title: string; confidence: number; dismissed?: boolean }>;
          predicted_at: string;
        };
        const ageH = (now - new Date(bundle.predicted_at).getTime()) / 3600_000;
        if (ageH < 6) {
          const top = bundle.predictions.find((p) => !p.dismissed);
          if (top) {
            const pct = Math.round(top.confidence * 100);
            openers.push({
              id: "ghost-top",
              headline: `ghost says you'll tackle "${top.title.slice(0, 40)}" next (${pct}%)`,
              ask: `Ghost thinks I'll tackle "${top.title}" next. Walk me through whether to follow or break the pattern.`,
              severity: "info",
              source: "ghost",
            });
          }
        }
      } catch {
        // skip
      }
    }

    // 4. Weakest identity axis (info if <50)
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as {
          axes: Record<string, { value: number; manual: number | null }>;
        };
        const axes = Object.entries(snap.axes ?? {});
        if (axes.length > 0) {
          const weakest = [...axes].sort(
            ([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value),
          )[0];
          if (weakest) {
            const [name, axis] = weakest;
            const value = axis.manual ?? axis.value;
            if (value < 50) {
              openers.push({
                id: "weak-axis",
                headline: `${name.replace(/_/g, " ")} at ${value}/100 — weakest axis`,
                ask: `My ${name.replace(/_/g, " ")} axis is at ${value}/100 and it's my weakest. What behaviors move it the most?`,
                severity: "info",
                source: "identity",
              });
            }
          }
        }
      } catch {
        // skip
      }
    }

    // 5. Pending skills (info — "review the candidates")
    if (pendingSkills >= 3) {
      openers.push({
        id: "skills-pending",
        headline: `${pendingSkills} skill candidates awaiting review`,
        ask: `I have ${pendingSkills} skill candidates in /brain — which ones should I promote vs drop?`,
        severity: "info",
        source: "skill",
      });
    }

    // 5b. Top Mission — surrogate MIT. High ROI + active missions
    //     get surfaced as an opener tuned to phase of day.
    const phase = phaseOfDay(new Date().getHours());
    if (topMission && openers.length < 3) {
      const title = topMission.title.slice(0, 50);
      const domain = topMission.domain.toLowerCase();
      const deadlineStr = topMission.deadline
        ? (() => {
            const d = new Date(topMission.deadline);
            const daysOut = Math.round((d.getTime() - now) / 86400_000);
            if (daysOut < 0) return ` (overdue ${-daysOut}d)`;
            if (daysOut === 0) return " (due today)";
            if (daysOut <= 7) return ` (${daysOut}d out)`;
            return "";
          })()
        : "";
      const headline =
        phase === "morning"
          ? `morning MIT: "${title}"${deadlineStr}`
          : phase === "evening"
            ? `close the loop: "${title}"${deadlineStr}`
            : `active mission: "${title}"${deadlineStr}`;
      openers.push({
        id: "top-mission",
        headline,
        ask:
          phase === "morning"
            ? `My top mission right now is "${topMission.title}" (${domain}). What's the single most important move on it today?`
            : phase === "evening"
              ? `My top mission is "${topMission.title}". What progress did I make today and what's the first thing to pick up tomorrow?`
              : `Where am I on "${topMission.title}" (${domain})? What's the next concrete step?`,
        severity: topMission.deadline && new Date(topMission.deadline).getTime() < now ? "alert" : "info",
        source: "time",
      });
    }

    // 5c. Stale pin review — Nour pinned this 2+ weeks ago, check if
    //     it's still current / still matters.
    if (stalePins && openers.length < 3) {
      openers.push({
        id: "stale-pin",
        headline: `pinned context going stale — still relevant?`,
        ask: `I pinned this a while back: "${stalePins.content.slice(0, 140)}". Is it still relevant or should I unpin it?`,
        severity: "info",
        source: "pin",
      });
    }

    // 5d. Time-of-day + task volume — specific phase prompts when
    //     there's enough critical work to justify a framing question.
    if (openers.length < 3 && criticalTasks >= 3) {
      if (phase === "morning") {
        openers.push({
          id: "phase-morning-mit",
          headline: `${criticalTasks} high-ROI tasks open — pick the MIT`,
          ask: `I have ${criticalTasks} high-ROI open tasks. Which ONE is the MIT I should lock in before anything else today?`,
          severity: "info",
          source: "time",
        });
      } else if (phase === "afternoon") {
        openers.push({
          id: "phase-afternoon-slip",
          headline: `afternoon check — what's slipping?`,
          ask: `Afternoon check-in. I have ${criticalTasks} high-ROI open tasks. What's at risk of slipping into tomorrow and what should I rescue?`,
          severity: "info",
          source: "time",
        });
      } else if (phase === "evening") {
        openers.push({
          id: "phase-evening-reflect",
          headline: `reflect on today + frame tomorrow`,
          ask: `End of day. Walk me through what went well today, what I missed, and the one thing to set up for tomorrow morning.`,
          severity: "info",
          source: "time",
        });
      }
    }

    // 6. Positive momentum (win) — fill if the alert/info slots are thin
    if (doneToday >= 3) {
      openers.push({
        id: "momentum",
        headline: `${doneToday} done today · protect the streak`,
        ask: `I've already done ${doneToday} tasks today. What's the one thing I should NOT let slip before the day ends?`,
        severity: "win",
        source: "momentum",
      });
    }

    // Always-on fallback so the empty state never looks dead
    if (openers.length === 0) {
      openers.push({
        id: "default-1",
        headline: "what should I focus on right now?",
        ask: "What should I focus on right now — read my current state and pick the one thing.",
        severity: "info",
        source: "momentum",
      });
      openers.push({
        id: "default-2",
        headline: "walk me through this week so far",
        ask: "Walk me through how this week's gone so far — wins, misses, patterns.",
        severity: "info",
        source: "momentum",
      });
    }

    // Cap at 3 — Tesla principle. Fewer but sharper.
    return { openers: openers.slice(0, 3) };
  },
  { auth: "owner", rateLimit: "ai" }, // v9.1.19 · cost-bomb guard
);
