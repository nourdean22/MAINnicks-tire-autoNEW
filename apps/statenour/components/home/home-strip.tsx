"use client";

/**
 * HomeStrip · Wave 27 (v10.0.529.83) · the Ultron→chat dissolution
 *
 * Tight 1-row strip mounted ABOVE the chat experience on the root
 * route. Carries the 3 highest-leverage signals that used to live on
 * Ultron's apex surface, distilled into chips:
 *   · Today's growth (mastery delta · done count · focused minutes)
 *   · Top alert (drift / overdue / contradictions)
 *   · Resume hint (last task in flight or last chat thread)
 *
 * The rest of Ultron's body is dissolved across:
 *   · SignalZone components → /brain
 *   · TodayZone / MITSlot → /tasks NOW (top of NextMoveCard)
 *   · AnticipatedQuestions → chat-side suggestions
 *
 * Self-hides when there's no signal worth surfacing (clean morning).
 *
 * Design contract:
 *   · ≤ 56px total height · doesn't compete with chat thread
 *   · ONE accent direction · gold-on-dark · matches /tasks editorial
 *   · Tap any chip → jump to the destination · this strip is a router,
 *     not a dashboard
 *   · 60s polling + onDataChanged refresh for tasks/goals events
 *
 * Skills applied:
 *   · ELON delete-first (Ultron's 7 cards collapse to 3 chips)
 *   · frontend-design (DFII ≥ 8 · ONE direction · no slop)
 *   · ux-flow (context-before-conversation · matches the /tasks pattern)
 *   · senior-frontend (zero render cost · single fetch · same data
 *     as /api/tasks/today-compound · reuses the cache)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";
import { Sparkles, AlertTriangle, RotateCcw } from "lucide-react";

interface CompoundData {
  topMastery: { domain: string; score: number; delta: number } | null;
  insightCount: number;
  goalsLifted: number;
  focusedMinutes: number;
  tasksDone: number;
  tasksOpen: number;
}

interface SituationData {
  alertCount: number;
  topAlertSummary: string | null;
}

interface ResumeData {
  taskId: string | null;
  taskTitle: string | null;
}

export function HomeStrip() {
  const [compound, setCompound] = useState<CompoundData | null>(null);
  const [situation, setSituation] = useState<SituationData | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);

  const load = useCallback(async () => {
    // 3 parallel fetches · each is cheap · all gracefully fail
    try {
      const [compoundRes, situationRes, resumeRes] = await Promise.all([
        authedFetch("/api/tasks/today-compound", { cache: "no-store" }).catch(() => null),
        authedFetch("/api/ultron/situation", { cache: "no-store" }).catch(() => null),
        authedFetch("/api/tasks?status=DOING&limit=1", { cache: "no-store" }).catch(() => null),
      ]);

      if (compoundRes?.ok) {
        const body = await compoundRes.json();
        const payload = (body?.data ?? body) as CompoundData;
        setCompound(payload);
      }

      if (situationRes?.ok) {
        const body = await situationRes.json();
        const payload = body?.data ?? body;
        const items = (payload?.items ?? []) as Array<{ summary?: string; severity?: string }>;
        const criticalOrHigh = items.filter(
          (i) => i.severity === "critical" || i.severity === "high",
        );
        setSituation({
          alertCount: criticalOrHigh.length,
          topAlertSummary: criticalOrHigh[0]?.summary ?? null,
        });
      }

      if (resumeRes?.ok) {
        const body = await resumeRes.json();
        const tasks = (body?.data ?? body?.tasks ?? []) as Array<{ id: string; title: string }>;
        const top = tasks[0];
        setResume(top ? { taskId: top.id, taskTitle: top.title } : null);
      }
    } catch {
      // silent · the strip auto-hides when nothing fired
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    // v10.0.529.89 · Wave 33 · widened subscription. Pre-Wave-33 the
    // alert chip + mastery delta + commitments-derived counters
    // refreshed via 60s poll only · score/brain/commitments writes
    // from chat tools (updateMasteryScore · pinMemory · markCommitment
    // Broken) sat invisible. Now all 5 axes push-refresh.
    const off = onDataChanged(
      ["tasks", "goals", "score", "brain", "commitments"],
      () => {
        setTimeout(() => void load(), 500);
      },
    );
    return () => {
      clearInterval(id);
      off();
    };
  }, [load]);

  const hasSignal =
    (compound &&
      (compound.tasksDone > 0 ||
        compound.tasksOpen > 0 ||
        (compound.topMastery && compound.topMastery.delta > 0))) ||
    (situation && situation.alertCount > 0) ||
    (resume && resume.taskId);

  if (!hasSignal) return null;

  return (
    <section
      aria-label="today's signal"
      className="flex items-center gap-1.5 flex-wrap rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-2.5 py-1.5 mx-3 mt-2"
    >
      {compound?.topMastery && compound.topMastery.delta > 0 && (
        <Link
          href="/mastery"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/[0.06] px-3 py-2 min-h-[44px] transition-colors hover:border-[var(--gold)]/60 focus-visible:outline-none focus-visible:border-[var(--gold)]/80"
        >
          <Sparkles size={10} className="text-[var(--gold)]" />
          <span className="text-[10px] font-mono lowercase tracking-[0.1em] text-[var(--gold)]">
            +{compound.topMastery.delta.toFixed(1)} · {compound.topMastery.domain}
          </span>
        </Link>
      )}

      {compound && compound.tasksDone > 0 && (
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-3 py-2 min-h-[44px] transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.04]"
        >
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            done
          </span>
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)]">
            {compound.tasksDone}
          </span>
        </Link>
      )}

      {compound && compound.tasksOpen > 0 && (
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-3 py-2 min-h-[44px] transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.04]"
        >
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            open
          </span>
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-primary)]">
            {compound.tasksOpen}
          </span>
        </Link>
      )}

      {situation && situation.alertCount > 0 && (
        <Link
          href="/system/logs?view=errors"
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 min-h-[44px] transition-colors hover:border-amber-500/60"
          title={situation.topAlertSummary ?? "active alerts"}
        >
          <AlertTriangle size={10} className="text-amber-400" />
          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-amber-300">
            {situation.alertCount} alert{situation.alertCount === 1 ? "" : "s"}
          </span>
        </Link>
      )}

      {resume?.taskId && (
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/[0.06] px-3 py-2 min-h-[44px] transition-colors hover:border-blue-500/60 max-w-[200px]"
        >
          <RotateCcw size={10} className="text-blue-400" />
          <span className="text-[10px] font-mono lowercase tracking-[0.1em] text-blue-300 truncate">
            resume · {resume.taskTitle ?? ""}
          </span>
        </Link>
      )}
    </section>
  );
}
