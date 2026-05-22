"use client";

/**
 * /system/policies — the Automation Policy registry surface.
 *
 * v10.0.148 · May 03 · Slice #1 of the post-audit consolidation wave.
 *
 * Every cron / tool / slash command / autonomous-action / webhook in
 * the system gets one row here. Each row carries the six required
 * governance fields:
 *   · objective     — why this exists, in operator language
 *   · trigger       — when it fires
 *   · inputs        — what it consumes (env, tables, services)
 *   · approvalClass — auto / pending / forbidden
 *   · rollback      — path to undo, or null if non-reversible
 *   · successMetric — how we know it worked
 *
 * Operator controls (in-page):
 *   · approval-class flip       (auto ↔ pending ↔ forbidden)
 *   · enabled toggle (kill-switch)
 *   · notes edit
 *
 * The "pending" approval class is the lever that wires this registry
 * to the W11 approval-queue UI: when an automation declared `pending`
 * fires, an AutonomousAction row is created instead of executing
 * immediately. Operator approves/rejects from the queue.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import {
  Clock,
  Wrench,
  Slash,
  Bot,
  Webhook,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Power,
  Loader2,
  CheckCircle2,
  XCircle,
  History,
} from "lucide-react";
import { toast } from "sonner";

type Surface = "cron" | "tool" | "slash" | "autonomous-action" | "webhook";
type ApprovalClass = "auto" | "pending" | "forbidden";

interface Policy {
  id: string;
  surface: Surface;
  name: string;
  objective: string;
  trigger: string;
  // Phase B.7b · the AutomationPolicy `inputs` Json column · optional
  // because the tRPC client types `unknown`-valued procedure fields as
  // optional (the JSON transformer can omit an explicit `undefined`).
  inputs?: unknown;
  approvalClass: ApprovalClass;
  rollback: string | null;
  successMetric: string;
  owner: string;
  enabled: boolean;
  lastFiredAt: string | null;
  lastResult: string | null;
  fireCount: number;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const SURFACE_META: Record<
  Surface,
  { label: string; icon: React.ComponentType<{ className?: string }>; tint: string }
> = {
  cron: { label: "Cron", icon: Clock, tint: "text-blue-400 border-blue-500/30" },
  tool: { label: "Tool", icon: Wrench, tint: "text-violet-400 border-violet-500/30" },
  slash: { label: "Slash", icon: Slash, tint: "text-amber-400 border-amber-500/30" },
  "autonomous-action": {
    label: "Auto",
    icon: Bot,
    tint: "text-emerald-400 border-emerald-500/30",
  },
  webhook: {
    label: "Webhook",
    icon: Webhook,
    tint: "text-rose-400 border-rose-500/30",
  },
};

const APPROVAL_META: Record<
  ApprovalClass,
  { label: string; icon: React.ComponentType<{ className?: string }>; tint: string }
> = {
  auto: {
    label: "auto",
    icon: ShieldCheck,
    tint: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  pending: {
    label: "pending",
    icon: ShieldAlert,
    tint: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
  forbidden: {
    label: "forbidden",
    icon: ShieldX,
    tint: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PoliciesPage() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [surfaceFilter, setSurfaceFilter] = useState<"all" | Surface>("all");
  const [approvalFilter, setApprovalFilter] = useState<"all" | ApprovalClass>("all");
  const [search, setSearch] = useState("");
  // v10.0.438 · sort key · 6 modes
  type PolicySort = "name" | "fired-most" | "fired-least" | "last-fired-newest" | "enabled-first" | "approval-strict-first";
  const [sortKey, setSortKey] = useState<PolicySort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("system-policies:sortKey");
    const valid: PolicySort[] = ["name", "fired-most", "fired-least", "last-fired-newest", "enabled-first", "approval-strict-first"];
    return saved && valid.includes(saved as PolicySort) ? (saved as PolicySort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-policies:sortKey", sortKey);
  }, [sortKey]);
  // v10.0.529.70 · agent-audit fix · was `{ forbidden, gated, manual, auto }`
  // but ApprovalClass is `"auto" | "pending" | "forbidden"` — the rank dict
  // contained phantom keys ("gated", "manual" never exist) AND was missing
  // "pending", which silently fell through to the default rank 9 (sorting
  // pending policies to the bottom of "approval-strict-first" instead of
  // between forbidden and auto). Fix uses real type values.
  const APPROVAL_RANK: Record<ApprovalClass, number> = { forbidden: 0, pending: 1, auto: 2 };

  // Phase B.7b · React Query drives the registry feed (was a manual
  // authedFetch). The page-local `Policy` interface matches the
  // procedure's PolicyView shape (string-typed dates) exactly.
  const utils = trpc.useUtils();
  const policiesQuery = trpc.system.policies.useQuery(undefined, {
    staleTime: 30_000,
  });
  const policies: Policy[] = policiesQuery.data?.policies ?? [];
  const loading = policiesQuery.isLoading;
  const error = policiesQuery.error;

  // Phase B.7b · the multi-field PATCH is now a tRPC mutation. On
  // success it invalidates the list so the row re-renders with the
  // server-truth record (was a manual setPolicies splice).
  const updateMutation = trpc.system.updatePolicy.useMutation();

  const patch = useCallback(
    async (
      id: string,
      body: Partial<Pick<Policy, "approvalClass" | "enabled" | "notes">>,
    ) => {
      setBusyId(id);
      try {
        await updateMutation.mutateAsync({ id, ...body });
        await utils.system.policies.invalidate();
        toast.success(`policy ${id} updated`);
      } catch (e) {
        toast.error(`update failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [updateMutation, utils],
  );

  const filtered = useMemo(() => {
    let rows = policies;
    if (surfaceFilter !== "all") rows = rows.filter((p) => p.surface === surfaceFilter);
    if (approvalFilter !== "all") rows = rows.filter((p) => p.approvalClass === approvalFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.objective.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.trigger.toLowerCase().includes(q),
      );
    }
    // v10.0.438 · sort dispatch
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "fired-most":
          return (b.fireCount ?? 0) - (a.fireCount ?? 0);
        case "fired-least":
          return (a.fireCount ?? 0) - (b.fireCount ?? 0);
        case "last-fired-newest": {
          const at = a.lastFiredAt ? new Date(a.lastFiredAt).getTime() : 0;
          const bt = b.lastFiredAt ? new Date(b.lastFiredAt).getTime() : 0;
          return bt - at;
        }
        case "enabled-first": {
          const ea = a.enabled ? 0 : 1;
          const eb = b.enabled ? 0 : 1;
          if (ea !== eb) return ea - eb;
          return a.name.localeCompare(b.name);
        }
        case "approval-strict-first": {
          const ra = APPROVAL_RANK[a.approvalClass] ?? 9;
          const rb = APPROVAL_RANK[b.approvalClass] ?? 9;
          if (ra !== rb) return ra - rb;
          return a.name.localeCompare(b.name);
        }
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [policies, surfaceFilter, approvalFilter, search, sortKey, APPROVAL_RANK]);

  // Counts by surface + approvalClass (computed from unfiltered list so
  // toggling filters doesn't make the strip headers wobble).
  const counts = useMemo(() => {
    const bySurface = new Map<Surface, number>();
    const byApproval = new Map<ApprovalClass, number>();
    let enabled = 0;
    for (const p of policies) {
      bySurface.set(p.surface, (bySurface.get(p.surface) ?? 0) + 1);
      byApproval.set(p.approvalClass, (byApproval.get(p.approvalClass) ?? 0) + 1);
      if (p.enabled) enabled += 1;
    }
    return { bySurface, byApproval, enabled, total: policies.length };
  }, [policies]);

  return (
    <div className="space-y-4">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="system · governance"
        title="policies"
        description="Every cron · tool · slash · webhook with its objective, trigger, approval class, rollback path, and success metric"
      />

      {/* Top strip — counts + governance posture at a glance */}
      <Panel>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3">
          <Stat label="total" value={counts.total} />
          <Stat label="enabled" value={counts.enabled} tint="text-emerald-300" />
          <Stat
            label="auto"
            value={counts.byApproval.get("auto") ?? 0}
            tint="text-emerald-300"
          />
          <Stat
            label="pending"
            value={counts.byApproval.get("pending") ?? 0}
            tint="text-amber-300"
          />
          <Stat
            label="forbidden"
            value={counts.byApproval.get("forbidden") ?? 0}
            tint="text-rose-300"
          />
        </div>
      </Panel>

      {/* Filter bar */}
      <Panel>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">
            surface
          </span>
          <FilterPill
            label="all"
            active={surfaceFilter === "all"}
            onClick={() => setSurfaceFilter("all")}
          />
          {(Object.keys(SURFACE_META) as Surface[]).map((s) => (
            <FilterPill
              key={s}
              label={`${SURFACE_META[s].label} (${counts.bySurface.get(s) ?? 0})`}
              active={surfaceFilter === s}
              onClick={() => setSurfaceFilter(s)}
              tint={SURFACE_META[s].tint}
            />
          ))}
          <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 ml-3">
            approval
          </span>
          <FilterPill
            label="all"
            active={approvalFilter === "all"}
            onClick={() => setApprovalFilter("all")}
          />
          {(Object.keys(APPROVAL_META) as ApprovalClass[]).map((a) => (
            <FilterPill
              key={a}
              label={a}
              active={approvalFilter === a}
              onClick={() => setApprovalFilter(a)}
            />
          ))}
          <input
            type="text"
            placeholder="search id / objective / trigger…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 w-56"
          />
          {/* v10.0.438 · sort dropdown · 6 modes */}
          <SortDropdown<PolicySort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="name"
            ariaLabel="Sort policies"
            options={[
              { value: "name", label: "name · A→Z" },
              { value: "fired-most", label: "fires · most" },
              { value: "fired-least", label: "fires · least" },
              { value: "last-fired-newest", label: "last fired · newest" },
              { value: "enabled-first", label: "enabled first" },
              { value: "approval-strict-first", label: "approval · strict first" },
            ]}
          />
        </div>
      </Panel>

      {/* Rows */}
      {loading && (
        <Panel>
          <div className="flex items-center gap-2 p-4 text-zinc-500 text-[12px]">
            <Loader2 className="animate-spin" size={14} />
            loading registry…
          </div>
        </Panel>
      )}
      {error && (
        <Panel>
          <p className="p-3 text-rose-400 text-[12px]">
            failed to load: {error.message}
          </p>
        </Panel>
      )}
      {!loading && !error && filtered.length === 0 && policies.length === 0 && (
        <Panel>
          <div className="p-6 text-center space-y-3">
            <p className="text-zinc-400 text-[13px]">
              No policies seeded yet.
            </p>
            <p className="text-zinc-600 text-[10px] font-mono">
              run <code>pnpm tsx scripts/seed-policies.ts</code> to populate from config/crons.ts
            </p>
          </div>
        </Panel>
      )}
      {!loading && !error && filtered.length === 0 && policies.length > 0 && (
        <Panel>
          <p className="p-4 text-zinc-500 text-[12px]">
            No policies match these filters.
          </p>
        </Panel>
      )}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PolicyRow
              key={p.id}
              policy={p}
              busy={busyId === p.id}
              onApprovalChange={(c) => patch(p.id, { approvalClass: c })}
              onEnabledToggle={() => patch(p.id, { enabled: !p.enabled })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={cn("text-[18px] font-bold tabular-nums", tint ?? "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  tint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border transition-all focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
        active
          ? tint
            ? `${tint} bg-zinc-900/80`
            : "border-zinc-500 bg-zinc-800 text-zinc-100"
          : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400",
      )}
    >
      {label}
    </button>
  );
}

function PolicyRow({
  policy,
  busy,
  onApprovalChange,
  onEnabledToggle,
}: {
  policy: Policy;
  busy: boolean;
  onApprovalChange: (c: ApprovalClass) => void;
  onEnabledToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fireHistory, setFireHistory] = useState<
    Array<{
      id: string;
      firedAt: string;
      result: string;
      resultMessage: string | null;
      durationMs: number | null;
    }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const utils = trpc.useUtils();
  const surfaceMeta = SURFACE_META[policy.surface];
  const approvalMeta = APPROVAL_META[policy.approvalClass];
  const SurfaceIcon = surfaceMeta.icon;
  const ApprovalIcon = approvalMeta.icon;

  // Phase B.7b · lazy fire-history fetch via the imperative tRPC
  // utils.fetch (was authedFetch). Fired once when the operator first
  // opens the fire-history panel · `firedAt` arrives ISO-stringified
  // from the procedure, matching the local row shape.
  const loadFireHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await utils.system.policyFires.fetch({
        policyId: policy.id,
        limit: 20,
      });
      setFireHistory(res.fires ?? []);
    } catch {
      // best-effort: ignore load failures
    } finally {
      setHistoryLoading(false);
    }
  }, [policy.id, utils]);

  return (
    <Panel className={cn(!policy.enabled && "opacity-60")}>
      <div className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border",
              surfaceMeta.tint,
            )}
          >
            <SurfaceIcon className="h-2.5 w-2.5" />
            {surfaceMeta.label}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[12px] text-zinc-200 hover:text-amber-300 transition-colors focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none rounded px-1"
            aria-expanded={expanded}
            aria-label={expanded ? "collapse policy details" : "expand policy details"}
          >
            {policy.id}
          </button>
          <span className="text-[10px] text-zinc-500 truncate flex-1 min-w-0">
            {policy.objective}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border",
              approvalMeta.tint,
            )}
          >
            <ApprovalIcon className="h-3 w-3" />
            {approvalMeta.label}
          </span>
          <button
            onClick={onEnabledToggle}
            disabled={busy}
            aria-label={policy.enabled ? "disable automation (kill switch)" : "enable automation"}
            title={policy.enabled ? "disable (kill switch)" : "enable"}
            className={cn(
              "p-1 rounded border transition-all focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
              policy.enabled
                ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                : "border-zinc-700 text-zinc-600 hover:bg-zinc-800",
              busy && "opacity-50",
            )}
          >
            <Power size={12} />
          </button>
        </div>

        {/* Operational quick-stats line */}
        <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-600">
          <span>fired: {policy.fireCount}</span>
          <span>last: {timeAgo(policy.lastFiredAt)}</span>
          {policy.fireCount > 0 && (
            <button
              onClick={() => {
                if (!historyOpen && fireHistory.length === 0) {
                  void loadFireHistory();
                }
                setHistoryOpen((v) => !v);
              }}
              className="flex items-center gap-1 hover:text-amber-300 transition-colors focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none rounded px-1"
              aria-label="view fire history"
              title="view fire history"
            >
              <History className="h-3 w-3" />
              history
            </button>
          )}
          {policy.lastResult && (
            <span
              className={cn(
                policy.lastResult === "success"
                  ? "text-emerald-500"
                  : policy.lastResult === "failure"
                    ? "text-rose-400"
                    : policy.lastResult === "pending_approval"
                      ? "text-amber-400"
                      : "text-zinc-500",
              )}
            >
              {policy.lastResult === "success" ? (
                <CheckCircle2 className="inline h-2.5 w-2.5 mr-0.5" />
              ) : policy.lastResult === "failure" ? (
                <XCircle className="inline h-2.5 w-2.5 mr-0.5" />
              ) : null}
              {policy.lastResult}
            </span>
          )}
          {policy.tags.length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              {policy.tags.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-px rounded bg-zinc-800/60 text-zinc-400 text-[8px]"
                >
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="pt-2 mt-2 border-t border-zinc-800/50 space-y-2 text-[11px]">
            <DetailLine label="trigger" value={policy.trigger} />
            <DetailLine label="success metric" value={policy.successMetric} />
            <DetailLine
              label="rollback"
              value={policy.rollback ?? "— non-reversible —"}
              tint={policy.rollback ? "text-zinc-300" : "text-amber-400"}
            />
            {policy.notes && <DetailLine label="notes" value={policy.notes} />}
            {policy.inputs ? (
              <DetailLine
                label="inputs"
                value={
                  <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(policy.inputs, null, 2)}
                  </pre>
                }
              />
            ) : null}
            <DetailLine
              label="approval class"
              value={
                <div className="flex items-center gap-1">
                  {(["auto", "pending", "forbidden"] as ApprovalClass[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => onApprovalChange(c)}
                      disabled={busy || policy.approvalClass === c}
                      className={cn(
                        "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-all",
                        policy.approvalClass === c
                          ? APPROVAL_META[c].tint + " cursor-default"
                          : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              }
            />
            <DetailLine
              label="meta"
              value={`owner: ${policy.owner} · created ${timeAgo(policy.createdAt)} · updated ${timeAgo(policy.updatedAt)}`}
              tint="text-zinc-600"
            />

            {/* Fire history — chronological list */}
            {historyOpen && (
              <div className="pt-2 mt-2 border-t border-zinc-800/50">
                <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
                  fire history
                </div>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    loading…
                  </div>
                ) : fireHistory.length === 0 ? (
                  <div className="text-[10px] text-zinc-500">no fire history</div>
                ) : (
                  <div className="space-y-1">
                    {fireHistory.map((fire) => (
                      <div
                        key={fire.id}
                        className="flex items-center gap-2 text-[9px] font-mono"
                      >
                        <span className="text-zinc-500">{timeAgo(fire.firedAt)}</span>
                        <span
                          className={cn(
                            fire.result === "success"
                              ? "text-emerald-500"
                              : fire.result === "failure"
                                ? "text-rose-400"
                                : fire.result === "pending_approval"
                                  ? "text-amber-400"
                                  : "text-zinc-500",
                          )}
                        >
                          {fire.result}
                        </span>
                        {fire.durationMs != null && (
                          <span className="text-zinc-600">
                            {fire.durationMs}ms
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function DetailLine({
  label,
  value,
  tint,
}: {
  label: string;
  value: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600 pt-0.5">
        {label}
      </div>
      <div className={cn(tint ?? "text-zinc-300")}>{value}</div>
    </div>
  );
}
