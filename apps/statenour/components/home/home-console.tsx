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
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pb-10 sm:px-6">
      <BriefStateLine
        state={brief?.state ?? null}
        loading={briefQ.isLoading}
        unreadable={unreadable}
      />

      {refreshFailed && (
        <p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-rose-300/80">
          refresh failed · showing last confirmed brief
        </p>
      )}

      {unreadable ? (
        <section
          aria-label="brief unreadable"
          className="mt-6 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4"
        >
          <p role="heading" aria-level={2} className="text-sm font-semibold text-rose-300">
            The brief couldn&apos;t be built
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
            The read failed — state unknown, not empty. Nick still works below.
          </p>
          <button
            type="button"
            onClick={() => void briefQ.refetch()}
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-edge px-3 text-[11px] font-mono uppercase tracking-wider text-fg-secondary transition-colors duration-150 hover:border-edge-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Retry
          </button>
        </section>
      ) : (
        <BriefLead lead={brief?.lead ?? null} loading={briefQ.isLoading} />
      )}

      <section aria-label="Nick" className="mt-7">
        <NickCommandLine />
      </section>

      <JudgmentQueue judgment={brief?.judgment ?? null} loading={briefQ.isLoading} />

      <HorizonLine horizon={brief?.horizon ?? null} />

      <ChangeLine />
    </div>
  );
}
