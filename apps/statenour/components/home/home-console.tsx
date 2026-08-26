"use client";

/**
 * HomeConsole — an attention-first daily router.
 *
 * Order is intentional: establish context, surface the measured system state,
 * show the single best action, then expose decisions and conversation. The
 * existing child components keep their data, routes, and honest loading/error
 * behavior; this file owns the page hierarchy only.
 */

import Link from "next/link";
import { HomeIdentityHeader } from "./home-identity-header";
import { CognitivePartner } from "./cognitive-partner";
import { FollowUpsList } from "./follow-ups-list";
import { ContradictionSlot } from "./contradiction-slot";
import { ProposedCommitments } from "./proposed-commitments";
import { ExecutiveActionMatrix } from "./executive-action-matrix";
import { HomeHealthChip } from "./home-health-chip";
import { SinceLastVisitCard } from "@/components/ultron/since-last-visit-card";

export function HomeConsole() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-3 pb-8 sm:px-6">
      <section aria-label="Today" className="space-y-3">
        <HomeIdentityHeader />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
          <HomeHealthChip />
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em]">
            <Link
              href="/brain"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-edge bg-base-layer px-3 text-fg-tertiary transition-colors duration-150 hover:border-edge-hover hover:text-fg"
            >
              Brain graph →
            </Link>
            <Link
              href="/system"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-edge bg-base-layer px-3 text-fg-tertiary transition-colors duration-150 hover:border-edge-hover hover:text-fg"
            >
              System →
            </Link>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-start">
        {/* #1897 review · mobile order is deliberate. Below lg the grid stacks
            in DOM-then-order order, and the first cut put the whole sidebar
            LAST — Ask Nick, the primary interface on the phone-first surface,
            fell below the matrix and three decision queues. `order-first`
            restores chat as the second element on mobile (matching the page
            this replaces), and `lg:order-none` hands placement back to DOM
            order on desktop so the left column stays first.
            SinceLastVisitCard moved OUT of the sidebar for the same reason:
            riding along at order-first would put up to 20 history rows above
            the matrix on a phone — history reads last, so it renders last. */}
        <aside className="min-w-0 order-first lg:order-none lg:sticky lg:top-4">
          <section aria-label="Ask Nick" className="rounded-xl border border-edge bg-raised p-3 sm:p-4">
            <div className="mb-2 px-1">
              <h2 className="text-balance text-sm font-semibold text-fg">Ask Nick</h2>
              <p className="mt-1 text-pretty text-xs text-fg-tertiary">Think, decide, or act from here.</p>
            </div>
            <CognitivePartner />
          </section>
        </aside>

        <div className="min-w-0 space-y-5 lg:order-first">
          {/* The highest-leverage surface comes before every queue. */}
          <section aria-label="What matters now" className="min-w-0">
            <ExecutiveActionMatrix />
          </section>

          <section aria-label="Decisions awaiting" className="min-w-0 space-y-4">
            <ContradictionSlot />
            <FollowUpsList />
            <ProposedCommitments />
          </section>

          <section aria-label="Since last visit" className="min-w-0">
            <SinceLastVisitCard limit={20} />
          </section>
        </div>
      </div>
    </div>
  );
}
