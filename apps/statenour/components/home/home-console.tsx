"use client";

/**
 * HomeConsole — the StateNour Command Surface (2026-09-01 rewrite).
 *
 * Home is a compiled view of the operator's state, not a dashboard. One
 * server brief (`operator.brief`, built by lib/home/operator-brief.ts)
 * feeds a FIXED six-section structure whose CONTENT adapts:
 *
 *   1 · State line — date · measured health · one sentence of state
 *   2 · The brief — one recommended move, real reasons, ≤2 alternatives
 *   3 · Nick — a single command line (slash routing; power hidden until asked)
 *   4 · Needs judgment — the only queue: things only Nour can decide
 *   5 · Horizon — one pointer per time scope, never a task list
 *   6 · Since last visit — a semantic diff, not a timeline
 *
 * Structure never rearranges itself (adaptive-UI research: layout churn
 * destroys the user's mental model); sections render nothing — not empty
 * chrome — when they have nothing true to say. Reasoning lives server-side;
 * this tree renders decisions, it does not manufacture them. The attention
 * budget (≤7 actionable objects) is enforced in the builder and carried in
 * the payload as a receipt.
 *
 * Absent by design: dashboard grid, stat gauges, glass-glow chrome, nested
 * mini-apps, Nick's Tire anything (shop surfaces live at nickstire.org/admin;
 * /business was deleted 2026-09-02 on operator verdict — never on the personal
 * command surface).
 *
 * 2026-09-16 · Visible Transformation wave: same six sections, same data,
 * recomposed. The state sentence is the NOW region (one display line the
 * page is allowed to shout), the brief is THE MOVE (one gold rule, one
 * primary action), Nick is a command bar rather than a card, judgment is a
 * ledger of rows, and the context rail is a timeline. Zero cards.
 */

import { trpc } from "@/lib/trpc/client";
import { BriefStateLine } from "./brief-state-line";
import { BriefLead } from "./brief-lead";
import { NickCommandLine } from "./nick-command-line";
import { JudgmentQueue } from "./judgment-queue";
import { HorizonLine } from "./horizon-line";
import { ChangeLine } from "./change-line";

export function HomeConsole() {
  const briefQ = trpc.operator.brief.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const brief = briefQ.data ?? null;
  // First-load failure only (TanStack v5 doctrine): a failed background
  // refetch keeps the cached brief and gets the compact stale badge below.
  const unreadable = briefQ.isError && !brief;
  const refreshFailed = briefQ.isError && !!brief;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-16 sm:px-6 xl:grid xl:max-w-[1260px] xl:grid-cols-[minmax(0,780px)_minmax(320px,1fr)] xl:items-start xl:gap-x-14">
      <div className="flex min-w-0 flex-col" data-home-column="queue">
        <BriefStateLine
          state={brief?.state ?? null}
          loading={briefQ.isLoading}
          unreadable={unreadable}
        />

        {refreshFailed && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-300/80">
            refresh failed · showing last confirmed brief
          </p>
        )}

        {unreadable ? (
          <section aria-label="brief unreadable" className="mt-10 border-l-2 border-rose-500/60 pl-5 sm:pl-6">
            <h2 className="vt-eyebrow text-rose-300">The brief couldn&apos;t be built</h2>
            <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-fg-secondary">
              The read failed — state unknown, not empty. Nick still works below.
            </p>
            <button
              type="button"
              onClick={() => void briefQ.refetch()}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Retry
            </button>
          </section>
        ) : (
          <BriefLead lead={brief?.lead ?? null} loading={briefQ.isLoading} />
        )}

        <section aria-label="Nick" className="mt-12">
          <NickCommandLine />
        </section>

        <JudgmentQueue judgment={brief?.judgment ?? null} loading={briefQ.isLoading} />
      </div>

      {/* Section 5.4 (2026-09-08): at >=1280px the horizon and the change line form a context rail
          beside the queue; below that width they keep today's order under it. */}
      <aside
        aria-label="context"
        data-home-column="context"
        // An empty rail (no horizon, no change line) used to render as a lone
        // 8px stub of its left rule at >=1280px (hermetic render, 2026-09-16).
        // It keeps its grid cell — tests/e2e/desktop-density.spec.ts measures
        // the rail beside the queue — but loses its rules when empty.
        className="mt-12 border-t border-edge pt-8 empty:border-t-0 xl:sticky xl:top-8 xl:mt-0 xl:border-l xl:border-t-0 xl:border-edge xl:pl-10 xl:pt-2 xl:empty:border-l-0"
      >
        <HorizonLine horizon={brief?.horizon ?? null} />
        <ChangeLine />
      </aside>
    </div>
  );
}
