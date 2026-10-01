/**
 * LaneHealthStrip — Q-23 phase 11 · is each customer lane reaching customers?
 *
 * One row per customer-contact lane: when its job last ran, texts sent in 30
 * days, the holdout-adjusted outcome, and the reason it is blocked when one is
 * on record. The rules live in @shared/laneHealth; this component only draws.
 *
 * HONESTY · like Data freshness, the card always renders, because its job is to
 * report the lanes that are not working. A failed query is one "unknown" line,
 * never an empty card and never a fleet of "not run" lanes.
 */
import { trpc } from "@/lib/trpc";
import type { ReactNode } from "react";
import { Radio } from "lucide-react";
import { buildLaneHealthRows, type LaneHealthPayload, type LaneHealthRow } from "@shared/laneHealth";
import { ProvenanceTag } from "../shared/ProvenanceTag";

const STATE_TONE: Record<LaneHealthRow["state"], string> = {
  running: "bg-emerald-400",
  blocked: "bg-amber-400",
  stale: "bg-amber-400",
  failing: "bg-red-400",
  unknown: "bg-foreground/30",
};

const STATE_WORD: Record<LaneHealthRow["state"], string> = {
  running: "running",
  blocked: "blocked",
  stale: "stale",
  failing: "failing",
  unknown: "unknown",
};

function Cell({ label, cell }: { label: string; cell: LaneHealthRow["lastRun"] }) {
  return (
    <span className="text-[11px] text-foreground/60" data-lane-cell={label}>
      <span className="text-foreground/40">{label}</span> {cell.text} <ProvenanceTag provenance={cell.provenance} />
    </span>
  );
}

export function LaneHealthStrip() {
  // 10 min: the holdout part is the same invoice join recoveredRevenue makes.
  const q = trpc.smsPerformance.laneHealth.useQuery(undefined, { refetchInterval: 600_000 });

  let body: ReactNode;
  let needsLook = 0;
  if (q.isError) {
    body = (
      <div className="px-4 py-2.5 text-xs text-amber-400" data-lane-health-error>
        Lane health could not be read · unknown, not idle <ProvenanceTag provenance="UNMEASURED" />
      </div>
    );
  } else if (!q.data) {
    body = <div className="px-4 py-2.5 text-xs text-foreground/50">checking…</div>;
  } else {
    const rows = buildLaneHealthRows(q.data as LaneHealthPayload, new Date());
    needsLook = rows.filter((r) => r.state !== "running").length;
    body = rows.map((r) => (
      <div key={r.key} className="px-4 py-2.5" data-lane-row={r.key} data-lane-state={r.state}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-foreground/80 flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATE_TONE[r.state]}`} aria-hidden />
            {r.label}
          </span>
          <span className={`text-[11px] ${r.state === "running" ? "text-foreground/50" : "text-amber-400"}`}>
            {STATE_WORD[r.state]}
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-0.5">
          <Cell label="last run" cell={r.lastRun} />
          <Cell label="sent" cell={r.sent} />
          <Cell label="outcome" cell={r.outcome} />
        </div>
        {r.blockedReason && (
          <div className="text-[11px] text-amber-400/90 mt-0.5" data-lane-blocked>
            {r.blockedReason}
          </div>
        )}
        {r.lastNote && (
          <div className="text-[11px] text-foreground/40 mt-0.5" data-lane-note>
            last run said: {r.lastNote}
          </div>
        )}
      </div>
    ));
  }

  return (
    <div className="bg-card border border-border/30" data-card="lane-health">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Radio className="w-4 h-4 text-foreground/60" />
        <span className="text-xs uppercase tracking-[0.15em] text-foreground/70 font-medium">Customer lanes</span>
        {needsLook > 0 && (
          <span className="ml-auto text-[11px] text-amber-400" data-lane-summary>
            {needsLook} need a look
          </span>
        )}
      </div>
      <div className="divide-y divide-border/20">{body}</div>
    </div>
  );
}
