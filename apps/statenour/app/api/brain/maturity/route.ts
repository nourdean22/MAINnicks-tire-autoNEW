/**
 * GET /api/brain/maturity — aggregate brain-maturity score + counters.
 *
 * Rolls up every subsystem into one summary payload. 0-100 score is
 * computed heuristically: more signal = higher maturity.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { loadActiveSkills, loadPendingSkills } from "@/lib/brain/skill-extractor";
import { loadIdentitySnapshot, loadIdentityHistory, type AxisKey } from "@/lib/brain/identity-snapshot";
import { loadQualitativeIdentity } from "@/lib/brain/qualitative-identity";
import { loadActiveBeliefs, loadBeliefCandidates } from "@/lib/brain/belief-harvester";
import { countUnresolved, loadAllContradictions } from "@/lib/brain/contradiction-surfacer";
import { loadGhostAccuracy } from "@/lib/brain/ghost-nick";

export const GET = apiHandler(
  async () => {
    const [
      skillsActive,
      skillsPending,
      snap,
      history,
      qualitative,
      beliefsActive,
      beliefsPending,
      contradictionsOpen,
      allContradictions,
      ghostAcc,
      importanceCount,
      distilledCount,
    ] = await Promise.all([
      loadActiveSkills().catch(() => []),
      loadPendingSkills().catch(() => []),
      loadIdentitySnapshot().catch(() => null),
      loadIdentityHistory(30).catch(() => []),
      loadQualitativeIdentity().catch(() => null),
      loadActiveBeliefs().catch(() => []),
      loadBeliefCandidates().catch(() => []),
      countUnresolved(14).catch(() => 0),
      loadAllContradictions(90).catch(() => []),
      loadGhostAccuracy().catch(() => null),
      prisma.brainMemory.count({ where: { category: "chat_importance" } }).catch(() => 0),
      prisma.brainMemory.count({ where: { category: "chat_summary" } }).catch(() => 0),
    ]);

    const graduatedCount = skillsActive.filter((s) => s.graduated).length;
    const axesFilled = snap
      ? (Object.keys(snap.axes) as AxisKey[]).filter((k) => {
          const a = snap.axes[k];
          return (a.manual ?? a.value) > 0 && a.evidence.length > 0;
        }).length
      : 0;

    const qualitativeEntries = qualitative
      ? qualitative.values.length +
        qualitative.fears.length +
        qualitative.operating_style.length +
        qualitative.rhythms.length +
        qualitative.red_lines.length
      : 0;

    const total = ghostAcc ? ghostAcc.hits + ghostAcc.surprises : 0;
    const accuracy = total > 0 && ghostAcc ? ghostAcc.hits / total : null;

    const resolvedContradictions = allContradictions.filter(
      (c) => c.status && c.status !== "unresolved",
    ).length;

    // Score: 0-100 composite
    // 20 pts — skills (active + graduated, cap at ~10 combined)
    // 15 pts — identity axes filled (8 × 1.875)
    // 15 pts — history depth (30d max)
    // 15 pts — qualitative entries (cap at 20)
    // 10 pts — beliefs (cap at 10)
    // 10 pts — contradictions resolved vs open (all resolved → full)
    // 10 pts — ghost accuracy (60%+ → full)
    //  5 pts — chat_memory depth (cap at 200 importance rows)
    const pts = {
      skills: Math.min(20, (skillsActive.length + graduatedCount) * 2),
      identity_axes: axesFilled * (15 / 8),
      history: Math.min(15, history.length * 0.5),
      qualitative: Math.min(15, qualitativeEntries * 0.75),
      beliefs: Math.min(10, beliefsActive.length * 1),
      contradictions: (() => {
        if (allContradictions.length === 0) return 7; // neutral-good default
        const resolveRate = resolvedContradictions / Math.max(1, allContradictions.length);
        const openPenalty = Math.min(5, contradictionsOpen);
        return Math.max(0, resolveRate * 10 - openPenalty);
      })(),
      ghost: accuracy != null ? Math.min(10, accuracy * (10 / 0.6)) : 0,
      chat_memory: Math.min(5, importanceCount / 40),
    };

    const score = Math.round(
      pts.skills +
      pts.identity_axes +
      pts.history +
      pts.qualitative +
      pts.beliefs +
      pts.contradictions +
      pts.ghost +
      pts.chat_memory,
    );

    return {
      maturity: {
        score: Math.max(0, Math.min(100, score)),
        components: {
          skills: {
            active: skillsActive.length,
            graduated: graduatedCount,
            pending: skillsPending.length,
          },
          identity: {
            axes_filled: axesFilled,
            history_days: history.length,
          },
          qualitative: {
            entries: qualitativeEntries,
          },
          beliefs: {
            active: beliefsActive.length,
            candidates: beliefsPending.length,
          },
          contradictions: {
            open: contradictionsOpen,
            resolved: resolvedContradictions,
          },
          ghost: {
            hits: ghostAcc?.hits ?? 0,
            surprises: ghostAcc?.surprises ?? 0,
            accuracy,
          },
          chat_memory: {
            importance_rows: importanceCount,
            distilled_sessions: distilledCount,
          },
        },
        computed_at: new Date().toISOString(),
      },
    };
  },
  { auth: "owner" },
);
