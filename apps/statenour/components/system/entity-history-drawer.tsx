"use client";

/**
 * EntityHistoryDrawer · v8.0 Phase 2A · Apr 29.
 *
 * Inline drawer that shows the field-level provenance log for one
 * entity. Reads from GET /api/audit/entity?type=&id=. Drop into any
 * Mission / Task / Goal / BrainMemory / Decision page to surface
 * "what changed, when, and who."
 *
 *   <EntityHistoryDrawer
 *     entityType="task"
 *     entityId={task.id}
 *     trigger={<button>History</button>}
 *   />
 *
 * The component lives entirely in the personal-OS shell. No business
 * data — autonicks-side audit only.
 */

import { useState, useMemo } from "react";

import { trpc } from "@/lib/trpc/client";
interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "soft_deleted" | "restored" | "purged";
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

interface Props {
  entityType: string;
  entityId: string;
  /** Trigger element rendered next to the entity. Click toggles drawer. */
  trigger?: React.ReactNode;
  /** Whether the drawer starts open. Defaults false. */
  defaultOpen?: boolean;
  /** Cap the page size; defaults to 50. */
  limit?: number;
}

const ACTION_TINT: Record<AuditEntry["action"], string> = {
  created: "bg-emerald-500/20 text-emerald-200",
  updated: "bg-blue-500/20 text-blue-200",
  soft_deleted: "bg-amber-500/20 text-amber-200",
  restored: "bg-violet-500/20 text-violet-200",
  purged: "bg-rose-500/20 text-rose-200",
};

const ACTION_LABEL: Record<AuditEntry["action"], string> = {
  created: "created",
  updated: "updated",
  soft_deleted: "deleted",
  restored: "restored",
  purged: "purged (perma)",
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatActor(actor: string): string {
  if (actor === "user") return "you";
  if (actor === "nick") return "Nick";
  if (actor === "system") return "system";
  if (actor.startsWith("cron:")) return `cron · ${actor.slice(5)}`;
  if (actor.startsWith("bridge:")) return `bridge · ${actor.slice(7)}`;
  return actor;
}

export function EntityHistoryDrawer({
  entityType,
  entityId,
  trigger,
  defaultOpen = false,
  limit = 50,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Phase VV (2026-05-22) · REST→tRPC · system.entityHistory. The fetch
  // only fired once the drawer opened (the prior effect bailed when
  // `!open`) — `enabled: open` reproduces that lazy behaviour exactly,
  // and React Query's per-input cache means a re-open of the same
  // entity is instant instead of re-fetching. The legacy route returned
  // `{ count, entries, mode }`; the procedure returns the same shape.
  const historyQuery = trpc.system.entityHistory.useQuery(
    { entityType, entityId, limit },
    { enabled: open },
  );
  const entries: AuditEntry[] | null = historyQuery.data
    ? (historyQuery.data.entries as AuditEntry[])
    : null;
  const loading = historyQuery.isPending && open;
  const error = historyQuery.error
    ? historyQuery.error.message || "Failed to load history"
    : null;

  const grouped = useMemo(() => {
    if (!entries) return [];
    // Group by createdAt date (YYYY-MM-DD) for visual scannability.
    const buckets = new Map<string, AuditEntry[]>();
    for (const e of entries) {
      const day = e.createdAt.slice(0, 10);
      const arr = buckets.get(day) ?? [];
      arr.push(e);
      buckets.set(day, arr);
    }
    return Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen((v) => !v)} className="cursor-pointer">
          {trigger}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-100 underline-offset-2 hover:underline"
        >
          History
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Entity history"
          className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                {entityType} · {entityId.slice(0, 12)}
              </div>
              <h2 className="text-lg font-semibold text-zinc-100">History</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            >
              Close
            </button>
          </div>

          {loading && (
            <div className="mt-6 text-sm text-zinc-500">loading…</div>
          )}
          {error && (
            <div className="mt-6 rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          {entries && entries.length === 0 && !loading && !error && (
            <div className="mt-8 text-center text-sm text-zinc-500">
              No history yet — nothing has changed since this row was created.
            </div>
          )}

          <div className="mt-4 space-y-6">
            {grouped.map(([day, items]) => (
              <section key={day}>
                <div className="mb-2 text-[10px] uppercase tracking-widest text-zinc-600">
                  {day}
                </div>
                <ol className="space-y-3">
                  {items.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${ACTION_TINT[e.action]}`}
                        >
                          {ACTION_LABEL[e.action]}
                        </span>
                        <span className="text-zinc-300">{formatActor(e.actor)}</span>
                        <span className="ml-auto text-zinc-500">
                          {formatRelative(e.createdAt)}
                        </span>
                      </div>
                      {e.reason && (
                        <div className="mt-1.5 text-sm text-zinc-300">{e.reason}</div>
                      )}
                      {e.source && (
                        <div className="mt-1 text-[10px] text-zinc-600">
                          {e.source}
                        </div>
                      )}
                      {(e.before || e.after) && e.action === "updated" && (
                        <FieldDiff before={e.before} after={e.after} />
                      )}
                      {e.action === "created" && e.after && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                            Initial values
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-[10px] text-zinc-400">
                            {JSON.stringify(e.after, null, 2)}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FieldDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort();
  if (keys.length === 0) return null;
  return (
    <table className="mt-2 w-full text-[11px]">
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-zinc-800/60 first:border-0">
            <td className="py-1 pr-2 align-top font-medium text-zinc-400">{k}</td>
            <td className="py-1 pr-2 align-top text-rose-300/80 line-through">
              {fmt(before?.[k])}
            </td>
            <td className="py-1 align-top text-emerald-300">{fmt(after?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  } catch {
    return "…";
  }
}
