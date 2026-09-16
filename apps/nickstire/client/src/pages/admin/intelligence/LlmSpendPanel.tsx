/**
 * LLM usage per lane — the first consumer `llm_calls` has ever had.
 *
 * The table has been filling since 2026-09-02 and nothing read it; the schema
 * comment in drizzle/schema.ts says as much. This panel exists to end that.
 *
 * Three states, kept visually distinct on purpose:
 *   live          — real numbers.
 *   not recording — LLM_LEDGER_ENABLED is off, so rows cannot exist. Zero here
 *                   says NOTHING about AI usage, and painting it as "no
 *                   activity" would be the same confident lie as a failed read
 *                   rendering $0.
 *   unknown       — the read failed.
 *
 * No dollar figures anywhere. The table records tokens and there is no price
 * table in this repo; a hard-coded rate would be fabrication and would drift
 * from the vendor's real pricing with nothing to catch it.
 */
import { useState } from "react";
import { Cpu, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/lib/trpc";

const WINDOWS = [1, 7, 30] as const;
type Window = (typeof WINDOWS)[number];

const num = (n: number) => n.toLocaleString("en-US");

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
            // 48x48 minimum, per the standing iOS-PWA rule in
            // apps/nickstire/AGENTS.md §6. The first draft set min-w only and
            // left the height at roughly 28px.
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
  if (isError || !data) {
    return (
      <div className="stat-card p-5 border-amber-500/30 bg-amber-500/5">
        {header}
        <div className="flex items-start gap-2 text-amber-400" role="status">
          <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-sm">
            Ledger unreadable — this is UNKNOWN, not zero. Model calls may well be running; this panel
            could not read them.{error?.message ? ` (${error.message})` : ""}
          </p>
        </div>
      </div>
    );
  }

  if (data.state === "unreadable") {
    return (
      <div className="stat-card p-5 border-amber-500/30 bg-amber-500/5">
        {header}
        <div className="flex items-start gap-2 text-amber-400" role="status">
          <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-sm">
            The <code className="text-[11px]">llm_calls</code> read failed on the server — UNKNOWN, not zero.
          </p>
        </div>
      </div>
    );
  }

  if (data.state === "not_recording") {
    return (
      <div className="stat-card p-5 border-amber-500/30 bg-amber-500/5">
        {header}
        <div className="flex items-start gap-2 text-amber-400" role="status">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-sm">
            Not recording. <code className="text-[11px]">LLM_LEDGER_ENABLED</code> is not set to{" "}
            <code className="text-[11px]">true</code>, so no rows can exist — this says nothing about how much
            AI is running, only that nothing is being written down.
          </p>
        </div>
      </div>
    );
  }

  const { lanes, totals } = data;

  // state === "live" and nothing came back: the only case where zero is a fact.
  if (lanes.length === 0) {
    return (
      <div className="stat-card p-5">
        {header}
        <p className="text-sm text-muted-foreground">
          No model calls recorded in the last {data.windowDays} day{data.windowDays === 1 ? "" : "s"}. The
          ledger is live, so this one is a real zero.
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
  const visible = expanded ? lanes : lanes.slice(0, 6);

  return (
    <div className="stat-card p-5">
      {header}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <div className="text-xl font-black tabular-nums">{num(totals.calls)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">calls</div>
        </div>
        <div>
          <div
            className={`text-xl font-black tabular-nums ${totals.failed > 0 ? "text-red-400" : ""}`}
          >
            {failRate.toFixed(1)}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">failed</div>
        </div>
        <div>
          <div className="text-xl font-black tabular-nums">
            {num(totals.promptTokens + totals.completionTokens)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">tokens</div>
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

      {lanes.length > 6 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground min-h-[48px] px-1"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show fewer" : `Show all ${lanes.length} lanes`}
        </button>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        Tokens only — no cost. There is no price table in this repo, so a dollar figure here would be
        invented. Lane names come from the calling function; generic inner helpers report themselves
        rather than the feature that owns the call.
      </p>
    </div>
  );
}
