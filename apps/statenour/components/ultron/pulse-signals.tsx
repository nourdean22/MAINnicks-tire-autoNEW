"use client";

/**
 * Pulse signals (home-pulse W3, 2026-10-31): the coach channel at the top of the Pulse sheet.
 *
 * The coach channel (lib/services/coach-events.ts) is the one store for "the system noticed something".
 * It surfaced only in per-page banners; here every active event shows in one place, grouped by source,
 * with a why-now line. Done and Snooze write the server row (operator.pulseAct), so the phone and the
 * desktop agree and a writer re-firing does not bring a done item back.
 * Three states: measured, loading (nothing added), failed (says unknown, never "all clear").
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PULSE_SOURCE_LABEL, type PulseFeed } from "@/lib/home/pulse-feed";

export type PulseSignalsRead = PulseFeed | "loading" | "error";

/** The strip's chip: how many signals wait, and whether any is urgent (P0/P1). Null = say nothing. */
export function signalChip(read: PulseSignalsRead): { text: string; urgent: boolean } | null {
  if (read === "loading") return null;
  if (read === "error") return { text: "signals unknown", urgent: false };
  if (read.total === 0) return null;
  const urgent = read.groups.some((g) => g.items.some((i) => i.level !== "P2"));
  return { text: `${read.total} to look at`, urgent };
}

const ACTION = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-[11px] disabled:opacity-40 sm:min-h-9 sm:min-w-9";

export function PulseSignalsView({
  read,
  onAct,
  busyKey,
  actError,
}: {
  read: PulseSignalsRead;
  onAct: (key: string, action: "done" | "snooze") => void;
  /** The key whose action is in flight, so its own row shows busy. */
  busyKey: string | null;
  actError: string | null;
}) {
  if (read === "loading") return null;
  if (read === "error") {
    return (
      <p role="status" className="border-b border-edge-subtle px-3 py-2 text-[13px] text-amber-300">
        Signals unknown, couldn&apos;t load.
      </p>
    );
  }
  if (read.total === 0) return null;

  return (
    <section aria-label="Signals" className="border-b border-edge-default">
      {actError && (
        <p role="alert" className="border-b border-edge-subtle px-3 py-2 text-[13px] text-red-300">
          {actError}
        </p>
      )}
      {read.groups.map((group) => (
        <div key={group.source}>
          <h3 className="px-3 pt-2 font-mono text-[11px] font-normal text-fg-tertiary">{PULSE_SOURCE_LABEL[group.source]}</h3>
          <ul>
            {group.items.map((item) => {
              const busy = busyKey === item.key;
              const text = (
                <>
                  <span className={cn("block text-[13px]", item.level === "P0" ? "text-amber-300" : "text-fg")}>{item.title}</span>
                  {item.whyNow && <span className="block text-[12px] text-fg-secondary">{item.whyNow}</span>}
                </>
              );
              return (
                <li key={item.key} className="flex items-center gap-2 border-b border-edge-subtle px-3 min-h-[44px] last:border-b-0">
                  {item.href ? (
                    <Link href={item.href} className="min-w-0 flex-1 py-2 rounded-control hover:bg-surface-hover">
                      {text}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1 py-2">{text}</div>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAct(item.key, "done")}
                    aria-label={`Done: ${item.title}`}
                    className={cn(ACTION, "text-emerald-400 hover:text-emerald-300")}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAct(item.key, "snooze")}
                    aria-label={`Snooze for an hour: ${item.title}`}
                    className={cn(ACTION, "text-fg-tertiary hover:text-fg-secondary")}
                  >
                    Snooze 1h
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
