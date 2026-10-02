"use client";

/**
 * TaskInspector · the task as an object, not a row · 2026-09-15 (flagship slice 2).
 *
 * The Missions row is built for scanning; this is built for deciding: the
 * next physical action, the definition of done, the mission, due state, what
 * it is waiting on, how long it has sat untouched — and WHY it ranks where it
 * does: the scorer's own per-term breakdown (lib/scoring/task-priority.ts
 * `PriorityBreakdown`, carried by task.byId), never a fabricated confidence
 * (Home doctrine §2). Mutations run through the PAGE's dispatch when the page
 * lends them (Missions registers complete / snooze via
 * useRegisterInspectorActions) so the board's own mutation path — optimistic
 * update, completion prompt, telemetry — is the only one; elsewhere the
 * footer says where to go instead of showing dead buttons.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import type { PriorityBreakdown } from "@/lib/scoring/task-priority";
import { useInspectorStore, type InspectorPageAction } from "@/lib/state/inspector-store";
import { formatAge } from "@/lib/ui/metric-datum";
import { cn } from "@/lib/utils";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { PriorityBreakdownView } from "@/components/inspector/priority-breakdown";
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
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{label}</dt>
      <dd className={tone === "warn" ? "text-[13px] text-amber-300" : tone === "gold" ? "text-[13px] text-fg" : "text-[13px] text-fg-secondary"}>
        {value}
      </dd>
    </div>
  );
}

/** The page's lent actions, run then the inspector's own read invalidated. */
function PageActions({ taskId, actions }: { taskId: string; actions: InspectorPageAction[] }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState<string | null>(null);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-inspector-page-actions={actions.length}>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(a.id);
            try {
              await a.run(taskId);
              await utils.task.byId.invalidate({ id: taskId });
            } finally {
              setBusy(null);
            }
          }}
          className={cn(
            "inline-flex min-h-[44px] items-center rounded-control border px-3 text-[13px] font-medium transition-colors duration-[var(--motion-state)] md:min-h-[36px]",
            a.tone === "primary"
              ? "border-accent bg-accent-soft text-fg hover:bg-accent-medium"
              : "border-edge-default bg-content text-fg-secondary hover:border-edge-strong hover:text-fg",
            busy === a.id && "opacity-60",
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

type TaskDetail = Record<string, unknown> & {
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
  effectivePriority?: number | null;
  priorityBreakdown?: PriorityBreakdown | null;
  priorityManual?: boolean;
  manualPriorityOverride?: number | null;
  lastTouchedAt?: string | Date | null;
  createdAt?: string | Date | null;
  mission?: { title: string; domain: string } | null;
  promiseTo?: string | null;
};

export function TaskInspector({ entity }: InspectorPanelProps) {
  const query = trpc.task.byId.useQuery({ id: entity.id }, { staleTime: 15_000, retry: 1 });
  const pageActions = useInspectorStore((s) => s.pageActions.task);
  const now = new Date();

  if (query.isLoading) return <InspectorNotice state="loading" kind="task" />;
  if (query.isError) return <InspectorNotice state="error" kind="task" code={errorCodeOf(query.error)} />;
  const t = query.data as TaskDetail | null | undefined;
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
  const manualScore = typeof t.manualPriorityOverride === "number" ? t.manualPriorityOverride : null;

  return (
    <div className="space-y-5" data-task-inspector={t.id}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            {t.status.toLowerCase()}
          </span>
          {t.mission ? (
            <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              {t.mission.title}
            </span>
          ) : null}
        </div>
        <h2 className="text-[17px] font-semibold leading-tight text-fg">{t.title}</h2>
      </header>

      {pageActions && pageActions.length > 0 ? <PageActions taskId={t.id} actions={pageActions} /> : null}

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
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">why this priority</p>
        {t.priorityManual && manualScore !== null ? (
          <p className="font-mono text-[12px] text-fg-secondary" data-priority-manual={manualScore}>
            manual override {manualScore} · set by you; the scorer is not consulted
          </p>
        ) : t.priorityBreakdown ? (
          <PriorityBreakdownView breakdown={t.priorityBreakdown} />
        ) : why ? (
          // An older server payload (deploy window) carries only the string.
          <p className="font-mono text-[12px] text-fg-secondary">
            {why}
            {typeof t.autoPriority === "number" ? ` → ${t.autoPriority}` : ""}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-fg-tertiary">not scored yet · the scorer has not seen this task</p>
        )}
      </section>

      <EntityActionRow entities={[entity]} labelOf={() => t.title} />
      {!pageActions || pageActions.length === 0 ? (
        <p className="font-mono text-[11px] text-fg-tertiary">complete · snooze · park run from the Missions board — open it there to act</p>
      ) : null}
    </div>
  );
}
