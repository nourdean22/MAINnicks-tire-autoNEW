"use client";

/**
 * PersonInspector · the human view, not the strategy game · 2026-09-15
 * (flagship slice 3).
 *
 * The /people dossier keeps its Power Atlas depth (and owns the `person` kind
 * there — hooks/use-inspector.ts `useInspectorOwnership`). Everywhere else
 * — a journal mention, a Cmd+K hit, a task's "promised to" — this is the
 * default signal: usual cadence vs current gap (a Metric with a baseline,
 * not a colour), last meaningful interaction, open promises, the last few
 * ledger entries. Greene analysis and power balance are deliberately absent
 * here; they are one click away on the person's page.
 */

import { trpc } from "@/lib/trpc/client";
import { errorCodeOf, type MetricResult } from "@/lib/services/metric-result";
import type { EntityRef } from "@/lib/ui/entity-ref";
import { formatAge } from "@/lib/ui/metric-datum";
import { Metric } from "@/components/ui/metric";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import type { InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";
import { useInspector } from "@/hooks/use-inspector";

interface LedgerRow {
  id: string;
  createdAt: string | Date;
  amount: number;
  note: string;
  source: string;
}

interface OpenTask {
  id: string;
  title: string;
  status: string;
  dueDate?: string | Date | null;
}

export function contactGapMetric(
  lastInteraction: string | Date | null | undefined,
  now: Date,
): MetricResult<number> {
  if (!lastInteraction) return { status: "unavailable", source: "person_profile", errorCode: "NO_INTERACTION" };
  const last = new Date(lastInteraction);
  if (Number.isNaN(last.getTime())) return { status: "unavailable", source: "person_profile", errorCode: "BAD_DATE" };
  const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000));
  return { status: "ok", value: days, measuredAt: now.toISOString(), source: "person_profile" };
}

export function PersonInspector({ entity }: InspectorPanelProps) {
  const query = trpc.task.personProfile.useQuery({ personId: entity.id }, { staleTime: 30_000, retry: 1 });
  const { openInspector } = useInspector();
  const now = new Date();

  if (query.isLoading) return <InspectorNotice state="loading" kind="person" />;
  if (query.isError) return <InspectorNotice state="error" kind="person" code={errorCodeOf(query.error)} />;
  const data = query.data as
    | {
        person: {
          id: string;
          name: string;
          role: string;
          relationship: string;
          lastInteraction?: string | Date | null;
          interactionCount?: number;
          cadenceDays?: number | null;
          status?: string;
          source?: string | null;
        };
        ledger: LedgerRow[];
        openTasks: OpenTask[];
      }
    | null
    | undefined;
  if (!data?.person) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="person" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const p = data.person;
  const lastLedger = data.ledger[0];
  const lastInteraction = p.lastInteraction ?? lastLedger?.createdAt ?? null;
  const gap = contactGapMetric(lastInteraction, now);
  const promises = (data.openTasks ?? []).slice(0, 5);

  return (
    <div className="space-y-5" data-person-inspector={p.id}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            {p.role.replace(/_/g, " ")}
          </span>
          {p.status && p.status !== "active" ? (
            <span className="rounded-micro border border-amber-500/30 px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300">
              {p.status}
            </span>
          ) : null}
        </div>
        <h2 className="text-[17px] font-semibold leading-tight text-fg">{p.name}</h2>
        {p.relationship ? <p className="text-[13px] text-fg-secondary">{p.relationship}</p> : null}
      </header>

      <Metric
        result={gap}
        spec={{
          label: "contact gap",
          unit: "d",
          baseline: p.cadenceDays ? { value: p.cadenceDays, label: `usual cadence ${p.cadenceDays}d` } : null,
          higherIsBetter: false,
        }}
        now={now}
      />

      <section aria-label="Last interaction">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">last interaction</p>
        {lastLedger ? (
          <p className="text-[13px] text-fg-secondary">
            <span className="font-mono text-[11px] text-fg-tertiary">
              {formatAge(new Date(lastLedger.createdAt), now)} · {lastLedger.source} · {lastLedger.amount > 0 ? "+" : ""}
              {lastLedger.amount}
            </span>
            <br />
            {lastLedger.note}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-fg-tertiary">
            {lastInteraction ? `${formatAge(new Date(lastInteraction), now)} · no ledger note` : "no interaction recorded"}
          </p>
        )}
      </section>

      <section aria-label="Open promises">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          open promises · {promises.length}
        </p>
        {promises.length === 0 ? (
          <p className="font-mono text-[11px] text-fg-tertiary">none open (measured over tasks linked to this person)</p>
        ) : (
          <ul className="space-y-1">
            {promises.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => openInspector({ kind: "task", id: task.id })}
                  className="text-left text-[13px] text-fg-secondary hover:text-fg"
                >
                  {task.title}
                  <span className="ml-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{task.status.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EntityActionRow entities={[entity]} labelOf={() => p.name} />
    </div>
  );
}
