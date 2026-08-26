"use client";

import { Brain, Activity, Clock, Zap, ShieldAlert, Inbox } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useCommanderGreeting } from "@/lib/hooks/use-commander-greeting";
import { HomeStatePulse } from "@/components/home/home-state-pulse";

export function HomeIdentityHeader() {
  const { todayStr, timeStr, greeting } = useCommanderGreeting();
  
  const inboxQ = trpc.task.inboxCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const inboxCount = inboxQ.data ?? 0;

  const capturesQ = trpc.task.captureInboxCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const captureInboxCount = capturesQ.data ?? 0;

  const pendingQ = trpc.systemAutomation.getPendingApprovals.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const pendingRequests = pendingQ.data ?? [];

  const approvalsQ = trpc.systemAutomation.approvals.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const approvalsData = approvalsQ.data;

  const pendingApprovalsCount = pendingRequests.length + (approvalsData?.rows.length ?? 0);
  // "Clear" is a MEASURED claim: every queue query answered, and every
  // count is zero. While any query is still loading the state is unknown,
  // not clear (same rule HomeHealthChip enforces for health).
  const queuesMeasured =
    inboxQ.isSuccess && capturesQ.isSuccess && pendingQ.isSuccess && approvalsQ.isSuccess;
  const queuesClear =
    queuesMeasured && inboxCount === 0 && captureInboxCount === 0 && pendingApprovalsCount === 0;

  return (
    <section
      aria-label="home identity"
      className="relative overflow-hidden rounded-xl border border-edge bg-raised p-5 shadow-lg md:p-6"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono font-semibold uppercase tracking-[0.18em] text-gold">
            <Brain size={14} className="shrink-0" strokeWidth={2} />
            <span>
              Today
            </span>
          </div>
          
          <div>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-fg md:text-4xl">
              {greeting}, Nour.
            </h1>
            <div className="mt-2 flex min-h-6 items-center">
              <HomeStatePulse />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-fg-secondary">
            <Clock size={14} className="text-gold" />
            <span>{todayStr}</span>
            {timeStr && <span className="text-gold">· {timeStr}</span>}
          </div>
          
          <div className="flex flex-wrap gap-2 md:justify-end">
            {inboxCount > 0 && (
              <Link
                href="/missions"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-edge bg-base-layer px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-colors duration-150 hover:border-amber-300 hover:bg-raised font-mono"
              >
                <Activity size={12} />
                Inbox ({inboxCount})
              </Link>
            )}
            {captureInboxCount > 0 && (
              <Link
                href="/brain?tab=board"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-edge bg-base-layer px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-300 transition-colors duration-150 hover:border-sky-300 hover:bg-raised font-mono"
              >
                <Inbox size={12} />
                Captures ({captureInboxCount})
              </Link>
            )}
            {pendingApprovalsCount > 0 && (
              <Link
                href="/system/actions"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-300 transition-colors duration-150 hover:border-rose-300 hover:bg-rose-400/15 font-mono"
              >
                <ShieldAlert size={12} />
                Approvals ({pendingApprovalsCount})
              </Link>
            )}
            {/* 2026-08-12 honest-copy fix (BDN-006): this said "SYSTEMS
                OPTIMAL" — a health claim — off queue counts alone, could
                render beside a live "Captures (n)" badge, and defaulted
                to green while the queries were still loading. Queue
                emptiness is the only thing measured here; say that, and
                only once it IS measured. Health claims stay with
                HomeHealthChip. */}
            {queuesClear && (
              <span className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-gold">
                <Zap size={14} />
                QUEUES CLEAR
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
