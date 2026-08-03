/**
 * Today's cross-domain exception strip.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────
 *
 * Today already has an action queue (bookings / leads / callbacks / work
 * orders), a Decision Inbox, a Promise Ledger and a closed-loop panel. This is
 * NOT another list of work — duplicating any of those would make the screen
 * noisier, which is the opposite of the goal.
 *
 * It shows the exceptions Today has never shown: signals from domains the
 * action queue does not read at all (publishing holds, tire orders, membership
 * warnings), and — the part nothing else on this screen does — the ones the
 * system COULD NOT READ.
 *
 * ── WHY "UNKNOWN" IS LISTED AS AN EXCEPTION ────────────────────────────────
 *
 * `exceptionFeed()` deliberately includes unknown readings and ranks them above
 * a counted sibling of equal severity, because an unreadable queue could be any
 * size. Filtering them out would rebuild the exact silence this whole model
 * exists to end: the operator would see a short, calm list and have no way to
 * know it was short because a query died.
 *
 * ── THE THREE EMPTY STATES ─────────────────────────────────────────────────
 *
 * An empty feed is ambiguous unless you say why it is empty, so this renders
 * three different sentences:
 *   - exceptions present  -> list them
 *   - everything counted, all zero -> "Nothing outstanding"  (a real all-clear)
 *   - nothing counted at all       -> "Nothing measured yet" (NOT an all-clear)
 *
 * The third is the case the old `return 0` was hiding. Saying "All clear" when
 * no source reported is the single most dangerous sentence this screen can say.
 */
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

import type { AdminSection } from "../shared";
import { navigateToAdminSection } from "../shared";
import { type AdminSignal, exceptionFeed } from "@shared/adminSignal";

export interface ExceptionFeedProps {
  signals?: readonly AdminSignal[];
  /**
   * Signal ids already rendered elsewhere on Today, by id rather than by
   * section so the exclusion is explicit and testable. `todayExceptionFeed.test.ts`
   * fails if one of these stops existing, which is what stops this list from
   * silently hiding a signal that moved.
   */
  hideIds?: readonly string[];
}

function severityClass(signal: AdminSignal): string {
  if (signal.reading.state === "unknown") return "text-amber-600";
  return signal.severity === "urgent" ? "text-red-400" : "text-foreground";
}

export type FeedState = "exceptions" | "nothing_outstanding" | "nothing_measured";

/**
 * Which of the three sentences this strip is entitled to say.
 *
 * Pure and exported so the distinction that matters most — "we looked and there
 * is nothing" versus "nobody reported" — is asserted directly rather than
 * inferred from rendered text. An empty feed is NOT evidence of an all-clear;
 * it is only an all-clear if at least one source actually produced a count.
 */
export function resolveFeedState(
  visible: readonly AdminSignal[],
  feed: readonly AdminSignal[],
): FeedState {
  if (feed.length > 0) return "exceptions";
  if (visible.length === 0) return "nothing_measured";
  /**
   * EVERY visible source must have reported, not just one.
   *
   * A first draft used `.some(counted)`, which handed out an all-clear as soon
   * as a single source reported zero — so tire and membership stats finishing
   * before `operationsSignal` produced "Nothing outstanding" while publishing
   * had not been read at all. That is the same defect this strip exists to
   * remove, rebuilt inside the sentence that announces its absence.
   *
   * Unknowns cannot reach here (they land in `feed`, which returns "exceptions"
   * above), so the only remaining states are counted and not_measured.
   */
  return visible.every((s) => s.reading.state === "counted") ? "nothing_outstanding" : "nothing_measured";
}

/**
 * `signals` defaults to empty so the component is safe to mount with no props —
 * the admin render matrix in `admin.test.tsx` instantiates every component it
 * globs. The default renders "Nothing measured yet", which is the honest state
 * for a feed that received no signals, and deliberately NOT an all-clear.
 */
export default function ExceptionFeed({ signals = [], hideIds = [] }: ExceptionFeedProps) {
  const hidden = new Set(hideIds);
  const visible = signals.filter((s) => !hidden.has(s.id));
  const feed = exceptionFeed(visible);
  const state = resolveFeedState(visible, feed);

  return (
    <section aria-label="Exceptions" className="rounded-lg border border-border/40 bg-card">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-muted-foreground/70" aria-hidden />
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Needs a decision
        </h2>
      </div>

      {state !== "exceptions" ? (
        <div className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
          {state === "nothing_outstanding" ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden />
              Nothing outstanding across publishing, tires and memberships.
            </>
          ) : (
            <>
              <HelpCircle className="w-4 h-4 text-amber-600" aria-hidden />
              <span className="text-amber-600">
                Nothing measured yet — this is not an all-clear. No source has reported.
              </span>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/30">
          {feed.map((signal) => {
            const unknown = signal.reading.state === "unknown";
            return (
              <li key={signal.id}>
                <button
                  type="button"
                  onClick={() => navigateToAdminSection(signal.section as AdminSection)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/30 flex items-center gap-3"
                  title={unknown ? (signal.reading as { reason: string }).reason : `Source: ${signal.source}`}
                >
                  <span
                    className={`text-lg font-bold tabular-nums min-w-[2.5rem] ${severityClass(signal)}`}
                    aria-label={unknown ? "unknown" : undefined}
                  >
                    {unknown ? "?" : (signal.reading as { count: number }).count}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-foreground truncate">{signal.label}</span>
                    <span className="block text-[10px] text-muted-foreground/70 truncate">
                      {unknown
                        ? (signal.reading as { reason: string }).reason
                        : `via ${signal.source}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
