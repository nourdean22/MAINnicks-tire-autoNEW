"use client";

/**
 * <LedgerTimeline> · 2026-05-27 · Power Atlas Phase 1 + Phase 3 polish
 *
 * Displays the 20 most recent RelationshipLedger entries for a person.
 * Each row · signed amount in monospace + note + relative time + source
 * chip. Positive amounts render in emerald, negative in amber/rose.
 *
 * 2026-05-27 Phase 3 polish · added "pin as alpha moment" text-link per
 * row. Click opens an inline kind selector (peak/shift/insight) + a
 * one-line moment input. Submit calls `markAlphaMoment`. After successful
 * pin, the link slot becomes a non-clickable "pinned · {kind}" amber
 * chip. We seed the list of already-pinned ledger ids from
 * `listAlphaMoments` so re-mount reflects prior pins.
 *
 * No emoji per Power Atlas mandate.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";

interface LedgerEntry {
  id: string;
  createdAt: string | Date;
  amount: number;
  note: string;
  source: string;
}

interface LedgerTimelineProps {
  entries: LedgerEntry[];
  personId: string;
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

type AlphaKind = "peak" | "shift" | "insight";

function PinControl({
  personId,
  ledgerId,
  initialKind,
}: {
  personId: string;
  ledgerId: string;
  initialKind: AlphaKind | null;
}) {
  const [pinnedKind, setPinnedKind] = useState<AlphaKind | null>(initialKind);
  const [opening, setOpening] = useState(false);
  const [kind, setKind] = useState<AlphaKind>("peak");
  const [moment, setMoment] = useState("");
  const utils = trpc.useUtils();
  const mutation = trpc.task.markAlphaMoment.useMutation({
    onSuccess: (_data, vars) => {
      setPinnedKind(vars.kind as AlphaKind);
      setOpening(false);
      setMoment("");
      void utils.task.listAlphaMoments.invalidate({ personId });
    },
  });

  if (pinnedKind) {
    return (
      <span
        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/[0.08] text-amber-200"
        aria-label={`already pinned as ${pinnedKind}`}
      >
        pinned · {pinnedKind}
      </span>
    );
  }

  if (!opening) {
    return (
      <button
        type="button"
        onClick={() => setOpening(true)}
        className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-amber-300 underline-offset-2 hover:underline transition-colors"
      >
        pin as alpha moment
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!moment.trim()) return;
        mutation.mutate({
          personId,
          ledgerId,
          moment: moment.trim().slice(0, 1000),
          kind,
        });
      }}
      className="mt-1 flex flex-wrap items-center gap-1.5"
    >
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as AlphaKind)}
        disabled={mutation.isPending}
        className="text-[10px] uppercase tracking-wider bg-transparent border rounded px-1.5 py-0.5 text-[var(--text-secondary)] focus:outline-none disabled:opacity-50"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        aria-label="alpha moment kind"
      >
        <option value="peak">peak</option>
        <option value="shift">shift</option>
        <option value="insight">insight</option>
      </select>
      <input
        type="text"
        value={moment}
        onChange={(e) => setMoment(e.target.value)}
        disabled={mutation.isPending}
        placeholder="one-line moment…"
        maxLength={1000}
        className="flex-1 min-w-0 text-xs bg-transparent border rounded px-2 py-0.5 text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-amber-500/40 disabled:opacity-50"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
        autoFocus
      />
      <button
        type="submit"
        disabled={mutation.isPending || !moment.trim()}
        className="text-[10px] uppercase tracking-wider text-amber-300/80 hover:text-amber-300 disabled:opacity-50"
      >
        {mutation.isPending ? "pinning…" : "pin"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpening(false);
          setMoment("");
        }}
        disabled={mutation.isPending}
        className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
      >
        cancel
      </button>
    </form>
  );
}

export default function LedgerTimeline({
  entries,
  personId,
}: LedgerTimelineProps) {
  // Seed already-pinned ledger ids so the row renders the chip on first paint
  const { data: alphaMoments = [] } = trpc.task.listAlphaMoments.useQuery({
    personId,
  });

  const pinnedByLedgerId = useMemo(() => {
    const map = new Map<string, AlphaKind>();
    for (const m of alphaMoments) {
      if (m.ledgerId) map.set(m.ledgerId, m.kind);
    }
    return map;
  }, [alphaMoments]);

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
            const pinned = pinnedByLedgerId.get(entry.id) ?? null;
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
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums flex-wrap">
                    <span>{relativeTime(entry.createdAt)}</span>
                    <span>·</span>
                    <span className="px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.06)]">
                      {sourceLabel(entry.source)}
                    </span>
                    <span>·</span>
                    <PinControl
                      personId={personId}
                      ledgerId={entry.id}
                      initialKind={pinned}
                    />
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
