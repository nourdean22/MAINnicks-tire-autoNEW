"use client";

/**
 * components/actions/mission-scoreboard.tsx · ComparisonMatrix
 * surface #3 (task #15 · 2026-05-23).
 *
 * /tasks IntelPanel widget · operator-grade scoreboard for active
 * missions. The matrix lays each mission across 5 columns:
 *
 *   · progress  · % of mission's tasks done · higher-is-better
 *   · velocity  · tasks completed in last 24h · higher-is-better
 *   · overdue   · count of open overdue tasks · lower-is-better
 *   · stale     · days since latest activity · lower-is-better
 *   · deadline  · days to deadline (or "—") · informational only
 *
 * The per-column tinting in <ComparisonMatrix> means a glance tells
 * the operator which mission is the healthiest and which is at risk,
 * without reading anything · the rose-tinted progress cell + amber
 * stale cell pop the eye.
 *
 * Mirror of the two earlier ComparisonMatrix surfaces:
 *   1) /decisions/[id]   · siblings × {grade, age, review-due, has-outcome}  (task #8)
 *   2) /system/providers · providers × {status, latency, errors, cooldown, tier}  (task #9)
 *   3) /tasks (this)     · missions × {progress, velocity, overdue, stale, deadline}  (task #15)
 *
 * Self-fetching · self-hiding · matches the existing IntelPanel widget
 * contract (TodaysCompound, OperatorPulse, CompoundChain). When the
 * operator has zero ACTIVE missions with at least one task, the
 * widget renders nothing · keeps the panel clean on fresh-start days.
 *
 * Reads via tRPC (no auth-fetch leak) · polls every 60s + refetches
 * on `onDataChanged(["tasks","missions"])` so a check-off or new
 * mission mutation lands on the next paint without waiting for the
 * poll boundary.
 */

import { useEffect } from "react";

import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
import { ComparisonMatrix } from "@/components/ui/comparison-matrix";
import {
  buildMissionMatrixOptions,
  MISSION_MATRIX_CRITERIA,
  resolveMissionMatrixCell,
} from "@/components/actions/derive-mission-matrix";
import type { Project, Task } from "@/components/actions/shared";
import { isUserProject } from "@/lib/services/mission-helpers";

const POLL_MS = 60_000;

export function MissionScoreboard() {
  // ── Fetch ───────────────────────────────────────────────────────
  // Two queries · React Query handles dedup, the page-level load()
  // already fetches both upstream so these will mostly come from the
  // tRPC cache on /tasks. Standalone surfaces would still work via
  // the network fallback.
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const tasksQuery = trpc.task.list.useQuery(
    {},
    {
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  // Cross-tab refresh · matches the rest of /tasks · 500ms debounce
  // so the server-side write lands before the refetch reads stale.
  useEffect(() => {
    const off = onDataChanged(["tasks", "missions"], () => {
      setTimeout(() => {
        void missionsQuery.refetch();
        void tasksQuery.refetch();
      }, 500);
    });
    return off;
  }, [missionsQuery, tasksQuery]);

  // ── Guard rails ─────────────────────────────────────────────────
  // Loading shells stay invisible · this is an IntelPanel widget,
  // its job is to surface signal when there's signal. A 200ms
  // skeleton on a /tasks load is noise.
  if (missionsQuery.isLoading || tasksQuery.isLoading) return null;
  if (!missionsQuery.data || !tasksQuery.data) return null;

  // Normalize the missions list to ACTIVE + user-owned (the same
  // filter the /tasks page top-level load applies). The mission
  // service returns ALL missions including system + archived; we
  // only score what the operator owns and is actively working on.
  const missionsRaw = missionsQuery.data as Project[];
  const activeMissions = missionsRaw.filter(
    (m) => m.status === "ACTIVE" && isUserProject(m),
  );

  // ── Derive matrix ───────────────────────────────────────────────
  const tasks = tasksQuery.data as Task[];
  const options = activeMissions.length > 0
    ? buildMissionMatrixOptions(activeMissions, tasks)
    : [];

  // 2026-05-28 · operator asked "where are the missions". Was returning
  // `null` here when activeMissions or options were empty — operator saw
  // a missing widget with no signal of why. Now renders an editorial
  // empty-state pointing at /goals (mission authoring lives there).
  // Anchor `id="missions"` lets the floating-home Missions link jump
  // straight to this section regardless of state.
  if (activeMissions.length === 0 || options.length === 0) {
    return (
      <section id="missions" className="space-y-2 scroll-mt-24">
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-4 py-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            missions · scoreboard
          </p>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)] leading-snug">
            {activeMissions.length === 0
              ? "No active missions yet. Missions group tasks toward a goal so this scoreboard can rank them."
              : "Active missions found, but none have tasks attached yet. Attach tasks on /stats to populate the matrix."}
          </p>
          <a
            href="/stats"
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)] hover:text-[var(--gold)]/80"
          >
            Open Stats →
          </a>
        </div>
      </section>
    );
  }

  return (
    <section id="missions" className="space-y-2 scroll-mt-24">
      <ComparisonMatrix
        title="missions · scoreboard"
        caption="emerald = best in column · rose = worst · amber = middle · deadline column is informational · refreshes on every check-off"
        options={options}
        criteria={MISSION_MATRIX_CRITERIA}
        cells={resolveMissionMatrixCell}
        defaultSortCriterion="progress"
      />
    </section>
  );
}
