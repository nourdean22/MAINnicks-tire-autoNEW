"use client";

/**
 * Lane budgets · 2026-09-08 (program U6 · cost truth).
 *
 * One global daily budget existed; a lane (feature) could not be capped on
 * its own, and the /system cost page could not say what a lane costs today.
 * This card lists every lane with a cap — and today's uncapped spenders —
 * with spend vs cap. A capped lane past its cap is a deterministic stop:
 * `aiChat` returns the "none" sentinel for it until midnight UTC.
 *
 * Caps live in the `ai.laneBudgetCents` setting (JSON: {"chat": 500}) or
 * the AI_LANE_BUDGET_CENTS_JSON env; the source is shown so a number here
 * is never a mystery.
 */
import { Panel } from "@/components/panel";
import { trpc } from "@/lib/trpc/client";

const cents = (c: number) => `$${(c / 100).toFixed(2)}`;

export function LaneBudgets() {
  const { data, isPending, isError } = trpc.system.aiLanes.useQuery(undefined, { refetchInterval: 60_000 });

  return (
    <Panel className="border-edge-default">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">lane budgets · today</h2>
        <span className="text-[11px] font-mono text-fg-tertiary">
          {data?.source === "setting" ? "caps from ai.laneBudgetCents" : data?.source === "env" ? "caps from AI_LANE_BUDGET_CENTS_JSON" : "no caps set"}
        </span>
      </div>
      {isError ? (
        <p className="text-xs text-amber-300">lane read failed — spend per lane is unknown, not zero.</p>
      ) : isPending ? (
        <p className="text-xs text-fg-tertiary">loading lanes…</p>
      ) : !data || data.lanes.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Nothing recorded today. Set <code className="font-mono">ai.laneBudgetCents</code> to cap a lane, e.g.{" "}
          <code className="font-mono">{'{"chat": 500}'}</code> for $5.00/day on chat.
        </p>
      ) : (
        <table className="w-full text-xs">
              <thead className="text-[12px] font-medium text-fg-secondary">
            <tr>
              <th className="py-1 text-left">lane</th>
              <th className="py-1 text-right">spent</th>
              <th className="py-1 text-right">cap</th>
              <th className="py-1 text-right">state</th>
            </tr>
          </thead>
          <tbody>
            {data.lanes.map((l) => (
              <tr key={l.feature} className="border-t border-edge-default">
                <td className="py-1.5 font-mono">{l.feature}</td>
                <td className="py-1.5 text-right tabular-nums">{cents(l.spentCents)}</td>
                <td className="py-1.5 text-right tabular-nums">{l.capCents == null ? "—" : cents(l.capCents)}</td>
                <td className={`py-1.5 text-right font-mono ${l.over ? "text-rose-300" : l.capCents == null ? "text-fg-tertiary" : "text-emerald-300"}`}>
                  {l.over ? "STOPPED" : l.capCents == null ? "uncapped" : `${Math.round((l.spentCents / Math.max(1, l.capCents)) * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
