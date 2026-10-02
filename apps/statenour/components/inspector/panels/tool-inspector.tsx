"use client";

/**
 * ToolInspector · a registry capability as an object · 2026-09-15 (wave 3).
 *
 * The last System kind without a renderer. Reads the same
 * `system.getTools` the registry page polls (one list, 30s cache — opening
 * the inspector from the page costs nothing) and finds the row by id, the
 * cron inspector's pattern. Shows what the policy matrix truncates: the
 * full description, every access flag with its meaning, the approval
 * policy, limits and cost class, allowed / blocked domains, the missing
 * env keys and the registry's own `currentLimitations` list. Read-only —
 * `evaluateTool` is a policy probe, not a toggle, and stays on its page.
 *
 * A name the registry does not know is NOT-FOUND, a failed read is ERROR.
 */

import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import { cn } from "@/lib/utils";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import type { InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";

interface ToolRow {
  id: string;
  label: string;
  description: string;
  category: string;
  status: string;
  health: string;
  riskClass: string;
  readAccess: boolean;
  writeAccess: boolean;
  externalMutation: boolean;
  memoryWriteAllowed: boolean;
  approvalPolicy: string;
  requiredEnv: string[];
  optionalEnv?: string[];
  allowedDomains?: string[];
  blockedDomains?: string[];
  timeoutMs?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  costClass?: string;
  auditLogRequired: boolean;
  ownerOnly?: boolean;
  currentLimitations: string[];
  notes?: string;
  missingEnv: string[];
}

const STATUS_CLS: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  restricted_active: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  inert: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  scaffolded: "border-edge-default text-fg-tertiary",
  blocked: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const HEALTH_CLS: Record<string, string> = {
  active: "text-emerald-300",
  degraded: "text-amber-300",
  missing_env: "text-amber-300",
  inert: "text-fg-tertiary",
  blocked: "text-rose-300",
};

const RISK_CLS: Record<string, string> = {
  critical: "text-rose-300",
  high: "text-amber-300",
  medium: "text-sky-300",
  low: "text-fg-tertiary",
};

function Flag({ on, label, meaning }: { on: boolean; label: string; meaning: string }) {
  return (
    <li className="flex items-baseline gap-2 font-mono text-[11px]" data-tool-flag={label} data-tool-flag-on={on || undefined}>
      <span className={cn("w-[5.5rem] shrink-0", on ? "text-fg" : "text-fg-tertiary line-through")}>{label}</span>
      <span className="text-fg-tertiary">{on ? meaning : "no"}</span>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{label}</dt>
      <dd className="break-words font-mono text-[12px] text-fg-secondary">{value}</dd>
    </div>
  );
}

export function ToolInspector({ entity }: InspectorPanelProps) {
  const query = trpc.system.getTools.useQuery(undefined, { staleTime: 30_000, retry: 1 });

  if (query.isLoading) return <InspectorNotice state="loading" kind="tool" />;
  if (query.isError) return <InspectorNotice state="error" kind="tool" code={errorCodeOf(query.error)} />;
  const rows = (query.data ?? []) as ToolRow[];
  const t = rows.find((r) => r.id === entity.id) ?? null;
  if (!t) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="tool" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const limits = [
    t.timeoutMs ? `timeout ${t.timeoutMs}ms` : null,
    t.dailyLimit ? `${t.dailyLimit}/day` : null,
    t.monthlyLimit ? `${t.monthlyLimit}/month` : null,
    t.costClass ? `cost ${t.costClass}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5" data-tool-inspector={t.id}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-micro border px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em]", STATUS_CLS[t.status] ?? "border-edge-default text-fg-tertiary")}>
            {t.status.replace(/_/g, " ")}
          </span>
          <span className="rounded-micro border border-edge-default px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{t.category}</span>
          <span className={cn("font-mono text-[11px] uppercase tracking-[0.12em]", HEALTH_CLS[t.health] ?? "text-fg-tertiary")} data-tool-health={t.health}>
            health · {t.health.replace(/_/g, " ")}
          </span>
        </div>
        <h2 className="text-[17px] font-semibold leading-tight text-fg">{t.label}</h2>
        <p className="font-mono text-[11px] text-fg-tertiary">{t.id}</p>
        <p className="text-[13px] leading-relaxed text-fg-secondary">{t.description}</p>
      </header>

      <section aria-label="Access">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">access</p>
        <ul className="space-y-1">
          <Flag on={t.readAccess} label="read" meaning="reads external or local data" />
          <Flag on={t.writeAccess} label="write" meaning="writes to a system it does not own" />
          <Flag on={t.externalMutation} label="mutate" meaning="side effects leave the machine (send, publish, order)" />
          <Flag on={t.memoryWriteAllowed} label="memory" meaning="may write BrainMemory rows" />
        </ul>
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">risk</dt>
          <dd className={cn("font-mono text-[11px] uppercase tracking-[0.12em]", RISK_CLS[t.riskClass] ?? "text-fg-secondary")} data-tool-risk={t.riskClass}>
            {t.riskClass}
          </dd>
        </div>
        <Fact label="approval" value={t.approvalPolicy.replace(/_/g, " ") + (t.ownerOnly ? " · owner only" : "")} />
        <Fact label="audit log" value={t.auditLogRequired ? "required" : "not required"} />
        <Fact label="limits" value={limits || null} />
        <Fact label="allowed domains" value={t.allowedDomains?.length ? t.allowedDomains.join(", ") : null} />
        <Fact label="blocked domains" value={t.blockedDomains?.length ? t.blockedDomains.join(", ") : null} />
      </dl>

      <section aria-label="Environment" data-tool-missing-env={t.missingEnv.length}>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">env</p>
        {t.missingEnv.length > 0 ? (
          <p className="font-mono text-[12px] text-amber-300">missing · {t.missingEnv.join(", ")}</p>
        ) : t.requiredEnv.length > 0 ? (
          <p className="font-mono text-[12px] text-emerald-300/90">all {t.requiredEnv.length} required keys present</p>
        ) : (
          <p className="font-mono text-[12px] text-fg-tertiary">no env required</p>
        )}
        {t.optionalEnv?.length ? <p className="font-mono text-[11px] text-fg-tertiary">optional · {t.optionalEnv.join(", ")}</p> : null}
      </section>

      {t.currentLimitations.length > 0 ? (
        <section aria-label="Limitations">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">current limitations</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-fg-secondary">
            {t.currentLimitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {t.notes ? <p className="text-[12px] italic text-fg-tertiary">{t.notes}</p> : null}

      <EntityActionRow entities={[entity]} labelOf={() => t.label} />
      <p className="font-mono text-[11px] text-fg-tertiary">policy evaluation stays on the registry page — this is the capability as declared, not a toggle</p>
    </div>
  );
}
