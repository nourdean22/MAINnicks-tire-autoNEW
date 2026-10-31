"use client";

/**
 * HomeConsole — the StateNour Command Surface (2026-09-01 rewrite).
 *
 * Home is a compiled view of the operator's state, not a dashboard. One
 * server brief (`operator.brief`, built by lib/home/operator-brief.ts)
 * feeds a FIXED six-section structure whose CONTENT adapts:
 *
 *   1 · State line — date · measured health · one sentence of state (the
 *       verdict; since UI v3 W2 the hero of the page)
 *   2 · Nick — a single command line (slash routing; power hidden until asked);
 *       since W2 it sits right under the verdict
 *   3+4 · The brief (W2: components/home/brief-rows.tsx) — one ruled list of at
 *       most seven rows: the recommended move, then what needs judgment, then the
 *       horizon; Keep / Less per row; approvals in place
 *   5 · Horizon — one pointer per time scope, never a task list
 *   6 · Since last visit — a semantic diff, not a timeline
 *   7 · Waiting on others (rail, 2026-10-02) — who owes the operator what,
 *       from the WaitingSummary read model; decisions stay in section 4 and
 *       the shop's queues stay on nickstire.org/admin
 *
 * Structure never rearranges itself (adaptive-UI research: layout churn
 * destroys the user's mental model); sections render nothing — not empty
 * chrome — when they have nothing true to say. Reasoning lives server-side;
 * this tree renders decisions, it does not manufacture them. The attention
 * budget (≤7 actionable objects) is enforced in the builder and carried in
 * the payload as a receipt.
 *
 * Absent by design: dashboard grid, stat gauges, glass-glow chrome, nested
 * mini-apps. Shop surfaces live at nickstire.org/admin (/business was deleted
 * 2026-09-02 on operator verdict: nothing of Nick's Tire on the personal command
 * surface). One exception since 2026-10-30, Nour 13:53 EDT: "u can put a small
 * nicks tire card on there with total sales for the day" (ShopTodayCard, which
 * links out to the shop dashboard).
 *
 * 2026-09-16 · Visible Transformation wave: same six sections, same data,
 * recomposed. The state sentence is the NOW region (one display line the
 * page is allowed to shout), the brief is THE MOVE (one gold rule, one
 * primary action), Nick is a command bar rather than a card, judgment is a
 * ledger of rows, and the context rail is a timeline. Zero cards.
 */

import { trpc } from "@/lib/trpc/client";
import { BriefStateLine } from "./brief-state-line";
import { BriefRows } from "./brief-rows";
import { NickCommandLine } from "./nick-command-line";
import { HorizonLine } from "./horizon-line";
import { WaitingLine } from "./waiting-line";
import { ChangeLine } from "./change-line";
import { ContextRail } from "./context-rail";
import { MaximLine } from "@/components/wisdom/maxim-line";
import { LoveMapLine } from "@/components/relationships/love-map-line";
import { HomeShortcuts } from "./home-shortcuts";
import { ShopTodayCard } from "./shop-today-card";
import { HomeCards } from "./home-cards";

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
    <div className="mx-auto w-full max-w-[760px] px-4 sm:px-6 xl:grid xl:max-w-[1260px] xl:grid-cols-[minmax(0,780px)_minmax(320px,1fr)] xl:items-start xl:gap-x-14">
      <div className="flex min-w-0 flex-col" data-home-column="queue">
        <BriefStateLine
          state={brief?.state ?? null}
          loading={briefQ.isLoading}
          unreadable={unreadable}
        />

        {refreshFailed && (
          <p className="mt-3 text-[13px] text-rose-300/80">
            Refresh failed · showing last confirmed brief
          </p>
        )}

        {/* UI v3 W2: Nick sits right under the verdict, above the brief, so "ask Nick" stays in the
            first screen at 390 and 1440 (the brief's seven rows would otherwise push it below the fold).
            The PLAN's W2 row lists only the verdict and the brief; this is the order that keeps the
            five phone jobs in reach. */}
        <section aria-label="Nick" className="mt-8">
          <NickCommandLine />
        </section>

        {/* home-pulse W2 (2026-10-30): shortcuts to the surfaces the tab bar lacks, then today's shop sales. */}
        <section aria-label="Shortcuts and shop" className="mt-5 flex flex-col gap-3">
          <HomeShortcuts />
          <HomeCards />
          <ShopTodayCard />
        </section>

        {unreadable ? (
          <section aria-label="brief unreadable" className="mt-10 border-l-2 border-rose-500/60 pl-5 sm:pl-6">
            <h2 className="vt-eyebrow text-rose-300">The brief couldn&apos;t be built</h2>
            <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-fg-secondary">
              The read failed. State unknown, not empty. Nick still works below.
            </p>
            <button
              type="button"
              onClick={() => void briefQ.refetch()}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
            >
              Retry
            </button>
          </section>
        ) : (
          // UI v3 W2 (2026-10-16): sections 2 and 4 are one finite brief under the verdict:
          // at most seven ruled rows, Keep / Less per row (device-local), approvals in place.
          <BriefRows brief={brief} loading={briefQ.isLoading} />
        )}

        {/* 2026-10-29 · one plain maxim from every book pack, leaning toward the brief's lead line. */}
        <MaximLine context={brief?.lead?.headline ?? null} ready={!!brief || unreadable} />

        {/* People W2c (2026-10-30): one question a day about someone with no notes; renders nothing when no one is left. */}
        <LoveMapLine />
      </div>

      {/* Section 5.4 (2026-09-08): at >=1280px the horizon and the change line form a context rail
          beside the queue; below that width they keep today's order under it. Appearance wave B
          (2026-10-23): below xl the rail is one closed "Context (N)" fold (components/home/context-rail.tsx),
          which also owns the empty-rail rule (no summary and no lone border when no line rendered). */}
      <ContextRail>
        <HorizonLine horizon={brief?.horizon ?? null} />
        <WaitingLine />
        <ChangeLine />
      </ContextRail>
    </div>
  );
}
