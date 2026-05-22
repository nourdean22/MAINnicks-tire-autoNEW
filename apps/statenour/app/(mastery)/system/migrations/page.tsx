"use client";

/**
 * /system/migrations · Phase Q.3 · 2026-05-18 PM.
 *
 * Surfaces the migration registry + live progress scans + feature
 * flag board · the single page that answers "what's in flight and
 * how close are we to done?"
 *
 * Replaces the old "trust commit messages + MEMORY notes" model
 * where migration progress lived in 3 different places and drifted
 * from reality whenever someone forgot to update one of them.
 */

// Phase straggler-pages (2026-05-22) · useAuthedFetch read migrated to
// trpc · the GET /api/system/migrations call now routes through
// `system.migrationsTracker`. Legacy REST route stays mounted.
import { trpc } from "@/lib/trpc/client";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Flag,
  Activity,
} from "lucide-react";

type MigrationStatus = "in-progress" | "stalled" | "completed";
type FlagStatus = "experimental" | "canary" | "stable" | "deprecated";

interface ScanResult {
  legacyFiles: number;
  legacyOccurrences: number;
  migratedFiles: number;
  migratedOccurrences: number;
  totalSurfaces: number;
  migratedPct: number;
}

interface MigrationProgress {
  scanned: boolean;
  result?: ScanResult;
  note?: string;
}

interface Migration {
  slug: string;
  name: string;
  startedAt: string;
  strategy: string;
  status: MigrationStatus;
  progressKind?: "trpc-surfaces" | "categories-codemod";
  nextMilestone: string;
  progress: MigrationProgress;
}

interface ResolvedFlag {
  key: string;
  description: string;
  status: FlagStatus;
  onValue: string;
  defaultBehavior: string;
  relatedMigration?: string;
  ownerDoc?: string;
  rawValue: string;
  isOn: boolean;
}

// Phase straggler-pages · the page-level `Payload` interface is removed
// — the query data shape now flows from the `system.migrationsTracker`
// procedure's return type. The Migration / ResolvedFlag / FlagSummary
// interfaces below stay: the MigrationRow / FlagRow / Counter helpers
// take them as props and they are structurally identical to the
// procedure's shapes.

const STATUS_TONE: Record<MigrationStatus, string> = {
  "in-progress": "border-amber-500/30 bg-amber-500/[0.04] text-amber-300",
  stalled: "border-rose-500/30 bg-rose-500/[0.04] text-rose-300",
  completed: "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300",
};

const FLAG_TONE: Record<FlagStatus, string> = {
  experimental: "border-violet-500/30 bg-violet-500/[0.04] text-violet-300",
  canary: "border-amber-500/30 bg-amber-500/[0.04] text-amber-300",
  stable: "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300",
  deprecated: "border-rose-500/30 bg-rose-500/[0.04] text-rose-300",
};

export default function MigrationsPage() {
  const { data, isLoading, error, refetch } =
    trpc.system.migrationsTracker.useQuery(undefined, {
      staleTime: 30_000,
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
          Migrations
        </h1>
        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          live tracker · strangler-fig progress · feature flags
        </p>
      </div>

      {isLoading && !data && (
        <GlassCard>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
            <Loader2 size={12} className="animate-spin" />
            scanning source tree…
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-rose-300">
                migrations fetch failed
              </p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 break-words font-mono">
                {error.message}
              </p>
            </div>
            <button
              onClick={() => void refetch()}
              className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
            >
              retry
            </button>
          </div>
        </GlassCard>
      )}

      {data && (
        <>
          {/* ── Summary ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={13} className="text-[var(--gold)]" />
              <span className="section-label">
                Summary · {data.summary.inProgress} in flight
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Counter label="total" value={data.summary.totalMigrations} tone="tertiary" />
              <Counter label="in flight" value={data.summary.inProgress} tone="amber" />
              <Counter label="stalled" value={data.summary.stalled} tone="rose" />
              <Counter label="done" value={data.summary.completed} tone="emerald" />
            </div>
          </GlassCard>

          {/* ── Migrations list ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={13} className="text-[var(--gold)]" />
              <span className="section-label">Active migrations</span>
            </div>
            <div className="space-y-2">
              {data.migrations.map((m) => (
                <MigrationRow key={m.slug} m={m} />
              ))}
            </div>
          </GlassCard>

          {/* ── Feature flags board ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Flag size={13} className="text-[var(--gold)]" />
              <span className="section-label">
                Feature flags · {data.flags.summary.on}/{data.flags.summary.total} ON
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <Counter label="on" value={data.flags.summary.on} tone="emerald" />
              <Counter label="off" value={data.flags.summary.off} tone="tertiary" />
              <Counter label="canary" value={data.flags.summary.byStatus.canary} tone="amber" />
              <Counter label="experimental" value={data.flags.summary.byStatus.experimental} tone="violet" />
            </div>
            <div className="space-y-1.5">
              {data.flags.list.map((f) => (
                <FlagRow key={f.key} f={f} />
              ))}
            </div>
          </GlassCard>

          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] text-center">
            generated · {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "tertiary" | "violet";
}) {
  const colorMap = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    tertiary: "text-[var(--text-secondary)]",
    violet: "text-violet-300",
  };
  return (
    <div className="rounded-lg bg-[var(--bg-base)]/40 border border-[var(--border-default)] px-2 py-2 text-center">
      <div className={cn("text-lg font-bold tabular-nums", colorMap[tone])}>
        <AnimatedCounter value={value} />
      </div>
      <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)] mt-0.5">
        {label}
      </p>
    </div>
  );
}

function MigrationRow({ m }: { m: Migration }) {
  const pct = m.progress.result?.migratedPct ?? null;
  return (
    <div className="px-2.5 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border",
            STATUS_TONE[m.status],
          )}
        >
          {m.status === "completed" ? (
            <CheckCircle2 size={9} className="inline mr-0.5 -mt-0.5" />
          ) : m.status === "stalled" ? (
            <AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" />
          ) : (
            <Circle size={9} className="inline mr-0.5 -mt-0.5" />
          )}
          {m.status}
        </span>
        <span className="text-[11px] font-medium text-[var(--text-secondary)] flex-1 min-w-0 truncate">
          {m.name}
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
          {m.startedAt}
        </span>
      </div>

      <p className="text-[10px] text-[var(--text-tertiary)] leading-snug mb-1.5">
        strategy · <span className="text-[var(--text-secondary)]">{m.strategy}</span>
      </p>

      {pct !== null && m.progress.result && (
        <div className="mb-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider mb-1">
            <span className="text-[var(--text-tertiary)]">progress</span>
            <span className="text-[var(--text-secondary)] tabular-nums">
              {m.progress.result.migratedFiles}/{m.progress.result.totalSurfaces} files · {pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--bg-void)] overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                pct >= 75 ? "bg-emerald-400" : pct >= 25 ? "bg-amber-400" : "bg-rose-400",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-amber-300/80 font-mono leading-relaxed">
        → {m.nextMilestone}
      </p>

      <p className="mt-1.5 text-[9px] font-mono text-[var(--gold)]/60">
        docs/migrations/{m.slug}.md
      </p>
    </div>
  );
}

function FlagRow({ f }: { f: ResolvedFlag }) {
  return (
    <div className="px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40">
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={cn(
            "text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border",
            FLAG_TONE[f.status],
          )}
        >
          {f.status}
        </span>
        <span className="text-[10px] font-mono text-[var(--text-primary)] flex-1 min-w-0 truncate">
          {f.key}
        </span>
        <span
          className={cn(
            "text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded",
            f.isOn
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-[var(--bg-void)] text-[var(--text-tertiary)]",
          )}
        >
          {f.isOn ? "ON" : "OFF"}
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
        {f.description}
      </p>
      {f.relatedMigration && (
        <p className="text-[9px] font-mono text-[var(--gold)]/60 mt-0.5">
          ↳ docs/migrations/{f.relatedMigration}.md
        </p>
      )}
    </div>
  );
}
