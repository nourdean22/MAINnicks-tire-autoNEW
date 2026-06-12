"use client";

import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
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
  const { data: tools, isLoading, refetch } = trpc.system.getTools.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const load = () => void refetch();

  if (isLoading && !tools) {
    return (
      <main className="max-w-6xl mx-auto px-3 py-4 space-y-4">
        <ShimmerSkeleton className="h-10 w-48 rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <ShimmerSkeleton key={i} className="h-24 rounded" />
          ))}
        </div>
        <ShimmerSkeleton className="h-96 rounded" />
      </main>
    );
  }

  if (!tools) {
    return (
      <main className="max-w-6xl mx-auto px-3 py-4">
        <p className="text-[var(--text-tertiary)]">Tools capabilities catalog unavailable</p>
      </main>
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
    <main className="max-w-6xl mx-auto px-3 py-4 space-y-6">
      {/* Header */}
      <PageHeader
        parentHref="/system"
        parentLabel="system"
        eyebrow="System Security"
        title="agent tools registry"
        description="Verify, govern, and audit tool availability and execution policies."
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={new Date().toISOString()}
              source="tools-registry"
              onReload={load}
            />
            <button
              onClick={load}
              className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-raised)] transition-colors"
              aria-label="refresh"
              title="refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        }
      />

      {/* Security Warnings Panel */}
      <Panel className="border-l-4 border-amber-500/80 bg-amber-500/[0.03] p-4 space-y-2">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
          <ShieldAlert size={14} />
          <span>Security & Fencing Warnings</span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] list-disc pl-4">
          <li>
            <strong className="text-white">Browser automation</strong> is completely <span className="text-amber-400 font-semibold">inert</span>. Web driving remains deactivated.
          </li>
          <li>
            <strong className="text-white">Local access</strong> (host filesystem and host shell execution) is strictly <span className="text-red-400 font-semibold">blocked</span>.
          </li>
          <li>
            <strong className="text-white">Gmail & Calendar writes</strong> are restricted to card-draft/link-proposal format. Direct execution is prohibited.
          </li>
          <li>
            <strong className="text-white">Untrusted content</strong> must undergo memory review checks before updating BrainMemory.
          </li>
          <li>
            <strong className="text-white">External mutations</strong> (such as PRs, quotes, or communication) require explicit operator approval.
          </li>
          <li>
            <strong className="text-white">Secrets exposure</strong> is prevented. No API keys or tokens are rendered or logged.
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

      {/* Capability Matrix */}
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
          <Info size={12} className="text-[var(--gold)]" />
          <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
            Capability Policy Matrix
          </h2>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto">
            {tools.length} capabilities loaded
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border-default)]/60 text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-void)]/30">
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
            <tbody className="divide-y divide-[var(--border-default)]/40 font-mono text-[11px]">
              {tools.map((t) => {
                const statusColor =
                  t.status === "active" ? "text-emerald-400"
                  : t.status === "restricted_active" ? "text-sky-400"
                  : t.status === "inert" ? "text-amber-400"
                  : t.status === "blocked" ? "text-red-400 font-semibold"
                  : "text-[var(--text-tertiary)]";

                const healthColor =
                  t.health === "active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : t.health === "degraded" ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                  : t.health === "missing_env" ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  : t.health === "inert" ? "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30"
                  : "bg-red-500/10 text-red-400 border border-red-500/30";

                const riskColor =
                  t.riskClass === "critical" ? "text-red-400 font-bold uppercase"
                  : t.riskClass === "high" ? "text-amber-400 font-semibold"
                  : t.riskClass === "medium" ? "text-sky-300"
                  : "text-[var(--text-tertiary)]";

                return (
                  <tr key={t.id} className="hover:bg-[var(--bg-void)]/40 group">
                    {/* Tool Info */}
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-white group-hover:text-[var(--gold)] transition-colors">{t.label}</div>
                      <div className="text-[10px] text-[var(--text-tertiary)] max-w-xs truncate" title={t.description}>
                        {t.description}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{t.category}</td>

                    {/* Status */}
                    <td className={cn("px-3 py-2.5 font-semibold", statusColor)}>{t.status}</td>

                    {/* Health */}
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-block px-1.5 py-0.5 rounded-sm text-[9px] uppercase font-bold", healthColor)}>
                        {t.health}
                      </span>
                    </td>

                    {/* Risk Class */}
                    <td className={cn("px-2 py-2.5 text-center font-bold", riskColor)}>{t.riskClass}</td>

                    {/* Access Flags */}
                    <td className="px-2 py-2.5 text-center">
                      {t.readAccess ? <Eye size={12} className="inline text-emerald-400" /> : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {t.writeAccess ? <Edit3 size={12} className="inline text-sky-400" /> : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {t.externalMutation ? <ExternalLink size={12} className="inline text-amber-400" /> : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {t.memoryWriteAllowed ? <Brain size={12} className="inline text-purple-400" /> : <span className="text-zinc-600">—</span>}
                    </td>

                    {/* Approval Policy */}
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] font-sans">{t.approvalPolicy}</td>

                    {/* Missing Env */}
                    <td className="px-3 py-2.5 text-[10px] text-amber-400/90 font-mono">
                      {t.missingEnv.length > 0 ? t.missingEnv.join(", ") : <span className="text-emerald-400">✓ None</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
