"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/utils/api-fetch";

export type TimeTravelReport = {
  date: string;
  /**
   * Reads that FAILED server-side (summary keys, plus memoriesByCategory,
   * identitySnapshot, healthDigest, emotionalStates). Their values are
   * fallbacks, not measurements. Optional only for deploy skew with an
   * older server that did not send it.
   */
  degradedReads?: string[];
  summary: {
    memoriesCreated: number;
    tasksCreated: number;
    tasksCompleted: number;
    brainDumpsWritten: number;
    reflectionsLogged: number;
    decisionsLogged: number;
    chatsActive: number;
    healthOverall: string | null;
    healthWarnings: number | null;
    emotionalStateLogged: boolean;
  };
  memoriesByCategory: Array<{ category: string; count: number }>;
  chats: Array<{ id: string; title: string; lastActiveAt: string | null; messageCount: number }>;
  brainDumps: Array<{ id: string; text: string }>;
  reflections: Array<{ id: string; category: string; insight: string }>;
  decisions: Array<{ id: string; title: string; predictedOutcome: string | null; reviewDate: string | null }>;
  emotionalStates: Array<{ key: string; snippet: string }>;
  identitySnapshotPresent: boolean;
};
function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const UNKNOWN = "—";

const COUNT_LABELS: Array<[keyof TimeTravelReport["summary"], string]> = [
  ["memoriesCreated", "memories"],
  ["tasksCreated", "tasks made"],
  ["tasksCompleted", "tasks done"],
  ["brainDumpsWritten", "brain dumps"],
  ["reflectionsLogged", "reflections"],
  ["decisionsLogged", "decisions"],
  ["chatsActive", "active chats"],
];

export function TimeTravelPanel() {
  const [date, setDate] = useState(todayEt);
  const [report, setReport] = useState<TimeTravelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function loadSnapshot() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TimeTravelReport>(
        `/api/brain/time-travel?date=${encodeURIComponent(date)}`,
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="time-travel" className="scroll-mt-24 rounded-lg border border-edge bg-surface/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-gold" />
            <h3 className="text-sm font-semibold text-fg">Time travel</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-tertiary">
            Reconstruct what was active in your system on one Eastern Time calendar day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="brain-time-travel-date">Snapshot date</label>
          <input
            id="brain-time-travel-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-11 rounded-md border border-edge bg-void px-3 text-xs text-fg"
          />
          <button
            type="button"
            onClick={loadSnapshot}
            disabled={!date || loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gold/30 bg-gold/10 px-3 text-xs font-semibold text-gold disabled:opacity-40"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Load
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error} — state unknown, not empty.
        </p>
      ) : null}
      {report ? <TimeTravelSnapshot report={report} /> : null}
    </section>
  );
}

/**
 * The loaded day. Pure, so the honest-render test can drive it with the
 * route's real output. A read listed in `degradedReads` FAILED: its value is
 * a fallback, so it renders as "—" — never as a zero or as "absent".
 */
export function TimeTravelSnapshot({ report }: { report: TimeTravelReport }) {
  const failed = new Set(report.degradedReads ?? []);
  const healthUnknown = failed.has("healthDigest");

  return (
    <div className="mt-4 space-y-4">
      {failed.size > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-xs text-amber-200"
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Some of this day could not be read — values shown as {UNKNOWN} are unknown, not zero. Unread:{" "}
            {[...failed].join(", ")}.
          </span>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key} className="rounded-md border border-edge bg-void/50 p-2.5">
            <div className="font-mono text-lg tabular-nums text-fg">{failed.has(key) ? UNKNOWN : String(report.summary[key])}</div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-fg-tertiary">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-fg-tertiary">
        <span>health {healthUnknown ? UNKNOWN : (report.summary.healthOverall ?? "unmeasured")}</span>
        <span>warnings {healthUnknown ? UNKNOWN : (report.summary.healthWarnings ?? UNKNOWN)}</span>
        <span>
          emotion{" "}
          {failed.has("emotionalStates") ? UNKNOWN : report.summary.emotionalStateLogged ? "logged" : "not logged"}
        </span>
        <span>
          identity snapshot{" "}
          {failed.has("identitySnapshot") ? UNKNOWN : report.identitySnapshotPresent ? "present" : "absent"}
        </span>
      </div>
      {report.memoriesByCategory.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
            Memory categories
          </p>
          <div className="flex flex-wrap gap-2">
            {report.memoriesByCategory.map((item) => (
              <span key={item.category} className="rounded border border-edge px-2 py-1 text-[10px] text-fg-secondary">
                {item.category} · {item.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {[...report.decisions.map((item) => ({ id: item.id, kind: "decision", text: item.title })),
        ...report.reflections.map((item) => ({ id: item.id, kind: "reflection", text: item.insight })),
        ...report.brainDumps.map((item) => ({ id: item.id, kind: "brain dump", text: item.text }))]
        .slice(0, 8)
        .map((item) => (
          <div key={`${item.kind}:${item.id}`} className="rounded-md border border-edge bg-void/50 p-3">
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-tertiary">{item.kind}</p>
            <p className="mt-1 text-xs leading-5 text-fg-secondary">{item.text}</p>
          </div>
        ))}
    </div>
  );
}
