"use client";

import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ToolGapPanel } from "@/components/system/tool-gap-panel";
import { DecisionPlanePanel } from "@/components/system/decision-plane-panel";
// 2026-09-15 · UI workbench wave 3: a registry row is an inspectable object.
import { useInspector } from "@/hooks/use-inspector";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Info,
  Lock,
  Eye,
  Edit3,
  ExternalLink,
  Brain,
  RefreshCw
} from "lucide-react";

export default function SystemToolsPage() {
  const { data: tools, isLoading, refetch, dataUpdatedAt } = trpc.system.getTools.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const load = () => void refetch();
  const { openInspector } = useInspector();

  if (isLoading && !tools) {
    return (
      <StandardPage
        eyebrow="System Security"
        title="Agent Tools Registry"
        description="Verify, govern, and audit tool availability and execution policies."
        width="2xl"
        className="px-3 py-4"
        loading
      />
    );
  }

  if (!tools) {
    return (
      <StandardPage
        eyebrow="System Security"
        title="Agent Tools Registry"
        description="Verify, govern, and audit tool availability and execution policies."
        width="2xl"
        className="px-3 py-4"
      >
        <p className="text-fg-tertiary">Tools capabilities catalog unavailable — registry state unknown.</p>
      </StandardPage>
    );
  }

  // Calculate metrics
  const activeCount = tools.filter((t) => t.status === "active").length;
  const restrictedActiveCount = tools.filter((t) => t.status === "restricted_active").length;
  const inertCount = tools.filter((t) => t.status === "inert" || t.status === "scaffolded").length;
  const blockedCount = tools.filter((t) => t.status === "blocked").length;

  const highCriticalRiskCount = tools.filter((t) => t.riskClass === "high" || t.riskClass === "critical").length;
  const ownerRequiredCount = tools.filter((t) => t.approvalPolicy === "owner_required").length;

  const missingEnvKeys = new Set<string>();
  tools.forEach((t) => {
    t.missingEnv.forEach((key) => missingEnvKeys.add(key));
  });

  return (
    <StandardPage
      eyebrow="System Security"
      title="Agent Tools Registry"
      description="Verify, govern, and audit tool availability and execution policies."
      width="2xl"
      rhythm="loose"
      className="px-3 py-4"
      actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              // 2026-09-10 · was `new Date().toISOString()` — the chip
              // displayed RENDER time, so it read "just now" no matter how
              // old the underlying fetch was, and stayed "fresh" while a
              // query was failing. `dataUpdatedAt` is when the data actually
              // arrived; 0 means it never has, and the chip renders that as
              // "no data" rather than inventing a timestamp.
              lastFetchedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
              source="tools-registry"
              onReload={load}
            />
            <button
              onClick={load}
              className="p-1.5 rounded-control text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
              aria-label="refresh"
              title="refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        }
    >

      {/* Security Warnings Panel */}
      <Panel className="border-l-4 border-amber-500/80 bg-amber-500/[0.03] p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-mono text-[11px] uppercase tracking-[0.12em]">
          <ShieldAlert size={14} />
          <span>Security & Fencing Warnings</span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-fg-secondary list-disc pl-4">
          <li>
            <strong className="text-fg">Browser automation</strong> is <span className="text-fg-secondary font-semibold">intentionally parked</span> - the operator uses Claude-in-Chrome + computer-use instead.
          </li>
          <li>
            <strong className="text-fg">Local access</strong> (host filesystem and host shell execution) is strictly <span className="text-red-400 font-semibold">blocked</span>.
          </li>
          <li>
            <strong className="text-fg">Gmail & Calendar writes</strong> are restricted to card-draft/link-proposal format. Direct execution is prohibited.
          </li>
          <li>
            <strong className="text-fg">Untrusted content</strong> must undergo memory review checks before updating BrainMemory.
          </li>
          <li>
            <strong className="text-fg">External mutations</strong> (such as PRs, quotes, or communication) require explicit operator approval.
          </li>
          <li>
            <strong className="text-fg">Secrets exposure</strong> is prevented. No API keys or tokens are rendered or logged.
          </li>
        </ul>
      </Panel>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Active Tools"
          value={activeCount}
          hint={`${restrictedActiveCount} restricted active`}
        />
        <MetricCard
          label="Inert / Blocked"
          value={`${inertCount} / ${blockedCount}`}
          hint="safety limits enforced"
        />
        <MetricCard
          label="High / Critical Risk"
          value={highCriticalRiskCount}
          hint={`${ownerRequiredCount} require owner auth`}
        />
        <MetricCard
          label="Missing Setup Env"
          value={missingEnvKeys.size}
          hint={missingEnvKeys.size > 0 ? Array.from(missingEnvKeys).join(", ") : "All healthy"}
        />
      </div>

      <ToolGapPanel />
      <DecisionPlanePanel />

      {/* Capability Matrix */}
      <section className="rounded-surface border border-edge-default bg-content overflow-hidden">
              <header className="flex items-center gap-2 px-3 py-2 border-b border-edge-default">
          <Info size={12} className="text-fg-secondary" />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
            Capability Policy Matrix
          </h2>
          <span className="text-[11px] font-mono text-fg-tertiary ml-auto">
            {tools.length} capabilities loaded
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-edge-default text-[12px] font-medium text-fg-secondary bg-canvas">
                <th className="px-3 py-2 font-normal">Tool / ID</th>
                <th className="px-3 py-2 font-normal">Category</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Health</th>
                <th className="px-2 py-2 font-normal text-center">Risk</th>
                <th className="px-2 py-2 font-normal text-center">Read</th>
                <th className="px-2 py-2 font-normal text-center">Write</th>
                <th className="px-2 py-2 font-normal text-center">Mutate</th>
                <th className="px-2 py-2 font-normal text-center">Mem W</th>
                <th className="px-3 py-2 font-normal">Approval Policy</th>
                <th className="px-3 py-2 font-normal">Missing Env</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]/40 font-mono text-[11px]" data-selection-scope="system-tools">
              {tools.map((t) => {
                const statusColor =
                  t.status === "active" ? "text-emerald-400"
                  : t.status === "restricted_active" ? "text-sky-400"
                  : t.status === "inert" ? "text-amber-400"
                  : t.status === "blocked" ? "text-red-400 font-semibold"
                  : "text-fg-tertiary";

                const healthColor =
                  t.health === "active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : t.health === "degraded" ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                  : t.health === "missing_env" ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  : t.health === "inert" ? "bg-fg-tertiary text-fg-secondary border border-edge-default"
                  : "bg-red-500/10 text-red-400 border border-red-500/30";

                const riskColor =
                  t.riskClass === "critical" ? "text-red-400 font-bold"
                  : t.riskClass === "high" ? "text-amber-400 font-semibold"
                  : t.riskClass === "medium" ? "text-sky-300"
                  : "text-fg-tertiary";

                return (
                  <tr
                    key={t.id}
                    data-entity={`tool:${t.id}`}
                    data-entity-label={t.label}
                    className="hover:bg-canvas group data-[entity-focused=true]:bg-surface-hover data-[entity-selected=true]:bg-accent-soft"
                  >
                    {/* Tool Info */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-fg group-hover:text-fg transition-colors">{t.label}</span>
                        <button
                          type="button"
                          onClick={() => openInspector({ kind: "tool", id: t.id })}
                          aria-label="inspect tool"
                          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-control text-fg-tertiary transition-colors hover:text-fg md:min-h-[28px] md:min-w-[28px]"
                        >
                          <Eye size={12} strokeWidth={2} />
                        </button>
                      </div>
                      <div className="text-[11px] text-fg-tertiary max-w-xs truncate" title={t.description}>
                        {t.description}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-3 py-2.5 text-fg-secondary">{t.category}</td>

                    {/* Status */}
                    <td className={cn("px-3 py-2.5 font-semibold", statusColor)}>{t.status}</td>

                    {/* Health */}
                    <td className="px-3 py-2.5">
              <span className={cn("inline-block px-1.5 py-0.5 rounded-micro text-[11px] font-bold", healthColor)}>
                        {t.health}
                      </span>
                    </td>

                    {/* Risk Class */}
                    <td className={cn("px-2 py-2.5 text-center font-bold", riskColor)}>{t.riskClass}</td>

                    {/* Access Flags */}
                    <td className="px-2 py-2.5 text-center">
              {t.readAccess ? <Eye size={12} className="inline text-emerald-400" /> : <span className="text-fg-tertiary">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
              {t.writeAccess ? <Edit3 size={12} className="inline text-sky-400" /> : <span className="text-fg-tertiary">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
              {t.externalMutation ? <ExternalLink size={12} className="inline text-amber-400" /> : <span className="text-fg-tertiary">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
              {t.memoryWriteAllowed ? <Brain size={12} className="inline text-fg-secondary" /> : <span className="text-fg-tertiary">—</span>}
                    </td>

                    {/* Approval Policy */}
                    <td className="px-3 py-2.5 text-fg-secondary font-sans">{t.approvalPolicy}</td>

                    {/* Missing Env */}
                    <td className="px-3 py-2.5 text-[11px] text-amber-400/90 font-mono">
                      {t.missingEnv.length > 0 ? t.missingEnv.join(", ") : <span className="text-emerald-400">✓ None</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </StandardPage>
  );
}
