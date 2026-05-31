"use client";

/**
 * TodaysCompound · Wave 23 (v10.0.529.79) · #1 of the next-level wave
 *
 * Compact 1-row strip at the top of /tasks showing today's compounded
 * auto-learn signal. Renders the data that's filling up the brain ·
 * makes the daily compounding VISIBLE.
 *
 * Layout: chip row · each chip is the gold-on-dark editorial style
 * already used on /tasks. Top mastery axis is the headline chip
 * (since it's the most-watched metric). The rest scale by signal
 * presence — chip hides when its count is 0 so the strip stays clean
 * on slow days.
 *
 * Polls every 60s · refreshes on `onDataChanged("tasks")` so the
 * strip updates instantly after a task check-off without waiting for
 * the next poll cycle.
 */

import { useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
import { TipChip } from "@/components/ui/tip-chip";

const REFRESH_TIP =
  "live-updates as you check off tasks. shows today's compounded growth · mastery lifts · insights captured · wisdom matched · goals moved · time focused.";

export function TodaysCompound() {
  // Polls every 60s · matches the legacy setInterval cadence.
  // onDataChanged refetches after a task/goal mutation so the strip
  // updates instantly after a check-off. The 500ms delay lets the
  // server-side auto-learn write land before the refetch fires.
  const { data, isError, refetch } = trpc.task.todayCompound.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );

  useEffect(() => {
    const off = onDataChanged(["tasks", "goals"], () => {
      setTimeout(() => void refetch(), 500);
    });
    return off;
  }, [refetch]);

  // Silent on failure · the strip is non-essential context.
  if (isError || !data) return null;

  // Strip hides entirely if literally nothing happened today AND
  // there's no open work. Avoids surfacing an empty row first thing
  // in the morning before any check-offs.
  const hasSignal =
    data.masteryTotal > 0 ||
    data.insightCount > 0 ||
    data.learnCount > 0 ||
    data.goalsLifted > 0 ||
    data.tasksDone > 0;
  if (!hasSignal && data.tasksOpen === 0) return null;

  const chips: Array<{
    key: string;
    label: string;
    value: string;
    href?: string;
    accent?: boolean;
  }> = [];

  if (data.topMastery && data.topMastery.delta > 0) {
    chips.push({
      key: "mastery",
      label: data.topMastery.domain,
      value: `+${data.topMastery.delta.toFixed(1)} → ${data.topMastery.score}/100`,
      href: "/stats",
      accent: true,
    });
  }
  if (data.tasksDone > 0) {
    chips.push({ key: "done", label: "done today", value: `${data.tasksDone}` });
  }
  if (data.focusedMinutes > 0) {
    chips.push({
      key: "focus",
      label: "focused",
      value: `${data.focusedMinutes}m`,
    });
  }
  if (data.insightCount > 0) {
    chips.push({
      key: "insights",
      label: "insights",
      value: `${data.insightCount}`,
      href: "/brain",
    });
  }
  if (data.wisdomCount > 0) {
    chips.push({
      key: "wisdom",
      // v10.0.529.84 · Wave 28 · A3 · relabeled from plain "wisdom".
      // The count is actually insights that HAVE a wisdom_query
      // metadata field · not the number of times a wisdom principle
      // was matched in the toast. Audit caught the misleading label.
      label: "w/ wisdom thread",
      value: `${data.wisdomCount}`,
      href: "/brain/wisdom",
    });
  }
  if (data.goalsLifted > 0) {
    chips.push({
      key: "goals",
      label: "goals moved",
      value: `${data.goalsLifted}`,
    });
  }
  if (data.learnCount > 0) {
    chips.push({
      key: "learn",
      label: "tutorials",
      value: `${data.learnCount}`,
      href: "/learn",
    });
  }
  if (data.tasksOpen > 0) {
    chips.push({
      key: "open",
      label: "open",
      value: `${data.tasksOpen}`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <section
      aria-label="today's compounded growth"
      className="flex items-center gap-1 flex-wrap rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-2.5 py-1.5"
    >
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] shrink-0">
        today ·
      </span>
      {chips.map((c) => {
        const inner = (
          <>
            <span className="text-[10px] font-mono lowercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {c.label}
            </span>
            <span
              className={
                c.accent
                  ? "text-[10px] font-mono tabular-nums text-[var(--gold)]"
                  : "text-[10px] font-mono tabular-nums text-[var(--text-primary)]"
              }
            >
              {c.value}
            </span>
          </>
        );
        return c.href ? (
          <Link
            key={c.key}
            href={c.href}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-2 py-0.5 transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.06] focus-visible:outline-none focus-visible:border-[var(--gold)]/60"
          >
            {inner}
          </Link>
        ) : (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-2 py-0.5"
          >
            {inner}
          </span>
        );
      })}
      <TipChip tip={REFRESH_TIP} title="today's compound" size="xs" />
    </section>
  );
}
