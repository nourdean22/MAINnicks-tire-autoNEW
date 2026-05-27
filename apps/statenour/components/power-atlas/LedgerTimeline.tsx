"use client";

/**
 * <LedgerTimeline> · 2026-05-27 · Power Atlas Phase 1
 *
 * Displays the 20 most recent RelationshipLedger entries for a person.
 * Each row · signed amount in monospace + note + relative time + source
 * chip. Positive amounts render in emerald, negative in amber/rose.
 *
 * Pure render component · the parent fetches the ledger via
 * `task.personProfile`. No emoji per Power Atlas mandate.
 */

interface LedgerEntry {
  id: string;
  createdAt: string | Date;
  amount: number;
  note: string;
  source: string;
}

interface LedgerTimelineProps {
  entries: LedgerEntry[];
}

function relativeTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3600000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, " ");
}

export default function LedgerTimeline({ entries }: LedgerTimelineProps) {
  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          Ledger
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm italic text-[var(--text-tertiary)]">
          No ledger entries yet. Use Cmd+K or the deposit/withdraw buttons to
          log effort.
        </p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => {
            const positive = entry.amount > 0;
            const negative = entry.amount < 0;
            const amountColor = positive
              ? "text-emerald-300"
              : negative
                ? "text-amber-300"
                : "text-[var(--text-tertiary)]";
            const amountStr =
              entry.amount > 0
                ? `+${entry.amount}`
                : entry.amount.toString();
            return (
              <li
                key={entry.id}
                className="flex items-start gap-3 py-1.5 border-b last:border-b-0"
                style={{ borderColor: "rgba(255,255,255,0.04)" }}
              >
                <span
                  className={`font-mono text-sm tabular-nums w-12 shrink-0 ${amountColor}`}
                >
                  {amountStr}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--text-secondary)] leading-snug break-words">
                    {entry.note}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
                    <span>{relativeTime(entry.createdAt)}</span>
                    <span>·</span>
                    <span className="px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.06)]">
                      {sourceLabel(entry.source)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
