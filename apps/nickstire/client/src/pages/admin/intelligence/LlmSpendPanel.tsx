/**
 * LLM usage per lane — the first consumer `llm_calls` has ever had.
 *
 * The table has been filling since 2026-09-02 and nothing read it; the schema
 * comment in drizzle/schema.ts says as much. This panel ends that.
 *
 * TWO INDEPENDENT FACTS, shown independently. The first draft folded them into
 * one state and got two things wrong for it:
 *
 *   recording — what the WRITER is doing (on / off / stopped after a write
 *               error). "off" does NOT mean there is nothing to show: rows
 *               already recorded are still real and still worth reading, and
 *               the first draft refused to query at all in that case.
 *   read      — whether this particular read worked.
 *
 * So a stopped writer now renders a banner ABOVE real history, rather than
 * replacing it. A failed read still renders UNKNOWN, never zero.
 *
 * No dollar figures anywhere: the table records tokens, this repo has no price
 * table, and an invented rate would drift from the vendor with nothing to
 * catch it.
 */
import { useState } from "react";
import { Cpu, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { provenanceOf } from "@shared/tileProvenance";
import { ProvenanceTag } from "../shared/ProvenanceTag";

const WINDOWS = [1, 7, 30] as const;
type Window = (typeof WINDOWS)[number];

const LANES_SHOWN = 6;
const num = (v: number) => v.toLocaleString("en-US");

export function LlmSpendPanel() {
  const [windowDays, setWindowDays] = useState<Window>(7);
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError, error } = trpc.system.llmLedger.useQuery(
    { windowDays },
    { staleTime: 60_000, retry: 1 },
  );

  const header = (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-black tracking-wide uppercase">AI usage by lane</h2>
      </div>
      <div className="flex gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setWindowDays(w)}
            // 48x48 minimum per the iOS-PWA rule in apps/nickstire/AGENTS.md §6.
            className={`text-[11px] rounded border min-w-[48px] min-h-[48px] ${
              windowDays === w
                ? "border-indigo-400 bg-indigo-400/15 text-indigo-300 font-bold"
                : "border-border/40 text-foreground/60"
            }`}
          >
            {w}d
          </button>
        ))}
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="stat-card p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3 mb-4" />
        <div className="h-4 bg-muted/50 rounded w-full" />
      </div>
    );
  }

  // A failed query is UNKNOWN. It is not an idle model fleet.
  if (isError || !data || data.read === "unreadable") {
    return (
      <div className="stat-card p-5 border-amber-500/30 bg-amber-500/5">
        {header}
        <div className="flex items-start gap-2 text-amber-400" role="status">
          <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <ProvenanceTag provenance={provenanceOf("observed", "unavailable")} />
          <p className="text-sm">
            Ledger unreadable — this is UNKNOWN, not zero. Model calls may well be running; this panel
            could not read them.{isError && error?.message ? ` (${error.message})` : ""}
          </p>
        </div>
      </div>
    );
  }

  const { lanes, totals, recording, lanesTruncated } = data;

  /**
   * Q-23 · rows in `llm_calls` are stored records, so a count read while the
   * writer is on is MEASURED. With the writer off or stopped, calls made in the
   * window may be missing: the count is a lower bound, an ESTIMATE.
   */
  const countProvenance = provenanceOf("observed", recording === "on" ? "ok" : "partial");

  /**
   * The writer's state, shown above whatever history exists rather than
   * instead of it. `stopped_after_error` is the one a flag check alone cannot
   * see: llmLedger latches an internal `disabled` on its first insert failure
   * and drops every later call until the process restarts.
   */
  const recordingNotice =
    recording === "on" ? null : (
      <div
        className="flex items-start gap-2 text-amber-400 mb-3 text-[12px]"
        role="status"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        {recording === "off" ? (
          <p>
            Not recording — <code className="text-[11px]">LLM_LEDGER_ENABLED</code> is not{" "}
            <code className="text-[11px]">true</code>. Anything below was recorded earlier and is
            real; new calls are not being written down, so these numbers will not grow.
          </p>
        ) : (
          <p>
            Recording <strong>stopped after a write failure</strong> and stays stopped until the
            server restarts. History below is real but is no longer growing — treat it as a
            snapshot, not as current usage.
          </p>
        )}
      </div>
    );

  if (lanes.length === 0) {
    return (
      <div className="stat-card p-5">
        {header}
        {recordingNotice}
        <p className="text-sm text-muted-foreground">
          <ProvenanceTag provenance={provenanceOf("observed", recording === "on" ? "ok" : "unavailable")} />{" "}
          {recording === "on"
            ? `No model calls recorded in the last ${windowDays} day${windowDays === 1 ? "" : "s"}. The ledger is live, so this one is a real zero.`
            : `No rows in the last ${windowDays} day${windowDays === 1 ? "" : "s"}. With recording stopped, that is not evidence about how much AI ran.`}
        </p>
      </div>
    );
  }

  const failRate = totals.calls > 0 ? (totals.failed / totals.calls) * 100 : 0;
  // Token sums cover only the rows whose provider returned usage. Saying
  // "1.2M tokens" while a third of calls reported none is the partsCost
  // failure again: the column exists, the values stopped, the UI kept
  // rendering a confident number.
  const tokenCoverage = totals.calls > 0 ? (totals.callsWithTokens / totals.calls) * 100 : 0;
  // A token total over partial usage coverage is a floor, so it is an ESTIMATE.
  const tokenProvenance = tokenCoverage < 99.5 ? provenanceOf("observed", "partial") : countProvenance;
  const visible = expanded ? lanes : lanes.slice(0, LANES_SHOWN);

  return (
    <div className="stat-card p-5">
      {header}
      {recordingNotice}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <div className="text-xl font-black tabular-nums">{num(totals.calls)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">calls</div>
          <div data-provenance-for="calls"><ProvenanceTag provenance={countProvenance} /></div>
        </div>
        <div>
          <div className={`text-xl font-black tabular-nums ${totals.failed > 0 ? "text-red-400" : ""}`}>
            {failRate.toFixed(1)}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">failed</div>
          <div data-provenance-for="failed"><ProvenanceTag provenance={countProvenance} /></div>
        </div>
        <div>
          <div className="text-xl font-black tabular-nums">
            {num(totals.promptTokens + totals.completionTokens)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">tokens</div>
          <div data-provenance-for="tokens"><ProvenanceTag provenance={tokenProvenance} /></div>
        </div>
      </div>

      {tokenCoverage < 99.5 && (
        <p className="text-[11px] text-amber-400/90 mb-3">
          Token counts cover {num(totals.callsWithTokens)} of {num(totals.calls)} calls (
          {tokenCoverage.toFixed(0)}%) — the rest returned no usage, so the total above is a floor, not
          the full figure.
        </p>
      )}

      <ul className="divide-y divide-border/30 -mx-5">
        {visible.map((l) => (
          <li key={`${l.lane}:${l.provider}`} className="px-5 py-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{l.lane}</div>
              <div className="text-[10px] text-muted-foreground">
                {l.provider} · avg {num(l.avgLatencyMs)}ms · max {num(l.maxLatencyMs)}ms
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold tabular-nums">{num(l.calls)}</div>
              {l.failed > 0 && (
                <div className="text-[10px] text-red-400 tabular-nums">{num(l.failed)} failed</div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {lanes.length > LANES_SHOWN && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground min-h-[48px] px-1"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show fewer" : `Show ${lanes.length} lanes`}
        </button>
      )}

      {/* The list is capped server-side; the totals above are not. Say so
          rather than implying the rows account for the headline numbers. */}
      {lanesTruncated && (
        <p className="text-[11px] text-amber-400/90 mt-2">
          Showing the {num(lanes.length)} busiest of {num(totals.groups)} lane/provider combinations.
          The totals above cover all {num(totals.groups)}, not just the ones listed.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        Tokens only — no cost. There is no price table in this repo, so a dollar figure here would be
        invented. Lane names come from the calling function; generic inner helpers report themselves
        rather than the feature that owns the call.
      </p>
    </div>
  );
}
