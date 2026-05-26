"use client";

/**
 * IntelPanel · 2026-05-21 · the /tasks "powerful underneath" drawer.
 *
 * As of 2026-05-26 (Mastery Layer Stage B), this is a thin wrapper
 * around `<MasteryContextDrawer surface="tasks">`. The original
 * /tasks-specific implementation was generalized into the cross-page
 * primitive · this wrapper preserves the existing API + visual contract
 * for the /tasks page mount.
 *
 * Why keep this wrapper instead of migrating /tasks to MasteryContextDrawer
 * directly: the /tasks page mount uses signalCount + signalLabel +
 * the "Today's intel" label · keeping a named wrapper documents the
 * /tasks-specific contract (signalCount = overdue, label = today's
 * intel) at a glance. Per-surface signalCount mapping can stay here.
 *
 * Visual + behavior contract is BYTE-IDENTICAL to the previous shape:
 * - "Today's intel" header label with the brief/suggestions/pulse hint
 * - signalCount → amber overdue chip when collapsed
 * - children mount only while expanded
 * - localStorage persistence under "mastery_ctx_open_tasks" (the new
 *   per-surface key · matches Stage B's per-surface contract). The
 *   pre-Stage B key was "tasks_intel_open" · operators on first
 *   pageload after this commit will see the drawer in default-closed
 *   state ONCE until they toggle (which then writes the new key).
 *   This is acceptable degradation · the drawer is collapsed by default
 *   anyway. No data is lost.
 */

import { MasteryContextDrawer } from "@/components/mastery/mastery-context-drawer";

interface IntelPanelProps {
  children: React.ReactNode;
  /**
   * When > 0 and the panel is collapsed, the toggle shows an amber
   * count pill — a breadcrumb that the folded widgets are worth
   * opening for, without un-folding (or fetching) them. The /tasks
   * page feeds its overdue count; OperatorPulse inside the drawer is
   * the strategic read on exactly those.
   */
  signalCount?: number;
  /** Noun rendered after the count, e.g. "overdue" → "3 overdue". */
  signalLabel?: string;
}

export function IntelPanel({ children, signalCount = 0, signalLabel }: IntelPanelProps) {
  return (
    <MasteryContextDrawer
      surface="tasks"
      label="Today's intel"
      hint="brief · suggestions · pulse · compounding"
      signalCount={signalCount}
      signalLabel={signalLabel}
    >
      {children}
    </MasteryContextDrawer>
  );
}
