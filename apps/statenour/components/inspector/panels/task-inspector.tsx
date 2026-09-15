"use client";

/**
 * TaskInspector · the task as an object, not a row · 2026-09-15 (flagship slice 2).
 *
 * The Missions row is built for scanning; this is built for deciding: the
 * next physical action, the definition of done, the mission, due state, the
 * scorer's real explanation string (never a fabricated confidence — Home
 * doctrine §2, lib/home/operator-brief.ts), what it is waiting on, and how
 * long it has sat untouched. Mutations (complete, snooze, park) stay on the
 * row until a global dispatch exists — the footer says so rather than
 * showing dead buttons.
 */

import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import type { EntityRef } from "@/lib/ui/entity-ref";
import { formatAge } from "@/lib/ui/metric-datum";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import type { InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";

function dueLine(dueDate: string | null | undefined, now: Date): string | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  const when = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (days < 0) return `${when} · overdue ${Math.abs(days)}d`;
  if (days === 0) return `${when} · due today`;
  return `${when} · in ${days}d`;
}

function Row({ label, value, tone }: { label: string; value: string | null | undefined; tone?: "warn" | "gold" }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">{label}</dt>
      <dd className={tone === "warn" ? "text-[13px] text-amber-300" : tone === "gold" ? "text-[13px] text-gold" : "text-[13px] text-fg-secondary"}>
        {value}
      </dd>
    </div>
  );
}

export function TaskInspector({ entity }: InspectorPanelProps) {
  const query = trpc.task.byId.useQuery({ id: entity.id }, { staleTime: 15_000, retry: 1 });
  const now = new Date();

  if (query.isLoading) return <InspectorNotice state="loading" kind="task" />;
  if (query.isError) return <InspectorNotice state="error" kind="task" code={errorCodeOf(query.error)} />;
  const t = query.data as
    | (Record<string, unknown> & {
        id: string;
        title: string;
        status: string;
        nextPhysicalAction?: string | null;
        finishCondition?: string | null;
        dueDate?: string | Date | null;
        effort?: string | null;
        energyRequired?: string | null;
        context?: string | null;
        waitingOn?: string | null;
        autoPriority?: number | null;
        autoPriorityExplanation?: string | null;
        lastTouchedAt?: string | Date | null;
        createdAt?: string | Date | null;
        mission?: { title: string; domain: string } | null;
        promiseTo?: string | null;
      })
    | null
    | undefined;
  if (!t) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="task" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const due = dueLine(t.dueDate ? new Date(t.dueDate).toISOString() : null, now);
  const untouched = t.lastTouchedAt ? formatAge(new Date(t.lastTouchedAt), now) : t.createdAt ? formatAge(new Date(t.createdAt), now) : null;
  const meta = [t.effort, t.energyRequired ? `${t.energyRequired} energy` : null, t.context].filter(Boolean).join(" · ");
  const why = t.autoPriorityExplanation?.replace(/^picked because: /, "") ?? null;
  const nextAction = t.nextPhysicalAction && t.nextPhysicalAction !== t.title ? t.nextPhysicalAction : null;

  return (
    <div className="space-y-5" data-task-inspector={t.id}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-edge px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-fg-tertiary">
            {t.status.toLowerCase()}
          </span>
          {t.mission ? (
            <span className="rounded border border-edge px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-fg-tertiary">
              {t.mission.title}
            </span>
          ) : null}
        </div>
        <h2 className="font-[var(--font-display)] text-xl font-bold leading-tight text-fg">{t.title}</h2>
      </header>

      <dl className="space-y-3">
        <Row label="next physical action" value={nextAction} tone="gold" />
        <Row label="definition of done" value={t.finishCondition ?? null} />
        <Row label="due" value={due} tone={due?.includes("overdue") ? "warn" : undefined} />
        <Row label="waiting on" value={t.waitingOn ?? null} tone="warn" />
        <Row label="promised to" value={t.promiseTo ?? null} />
        <Row label="shape" value={meta || null} />
        <Row label="last touched" value={untouched} />
      </dl>

      <section aria-label="Why">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">why this priority</p>
        {why ? (
          <p className="font-mono text-[12px] text-fg-secondary">
            {why}
            {typeof t.autoPriority === "number" ? ` → ${t.autoPriority}` : ""}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-fg-tertiary">not scored yet · the scorer has not seen this task</p>
        )}
      </section>

      <EntityActionRow entities={[entity]} labelOf={() => t.title} />
      <p className="font-mono text-[10px] text-fg-tertiary">complete · snooze · park stay on the Missions row until a shared dispatch exists</p>
    </div>
  );
}
