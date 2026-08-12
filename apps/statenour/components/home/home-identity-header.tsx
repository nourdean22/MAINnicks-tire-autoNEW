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
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-[var(--gold)]/20 p-6 md:p-8 shadow-2xl mb-6 mt-2 animate-fade-in-scale"
    >
      {/* Decorative background glow */}
      <div className="absolute -top-24 -right-24 w-72 h-72 bg-[var(--gold)]/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 border border-[var(--gold)]/30 backdrop-blur-xl shadow-[0_0_20px_rgba(255,215,0,0.1)]">
            <Brain size={14} className="text-[var(--gold)] shrink-0 pulse-live drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]" strokeWidth={2} />
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--gold)]/90 font-bold">
              Cognitive Command Center
            </span>
          </div>
          
          <div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-zinc-400">
              {greeting}, Nour.
            </h1>
            <div className="mt-2 flex items-center h-6">
              <HomeStatePulse />
            </div>
          </div>
        </div>

        <div className="flex flex-row md:flex-col gap-4 md:items-end">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-zinc-300 bg-black/60 px-4 py-2 rounded-lg border border-[var(--gold)]/20 backdrop-blur-md shadow-inner">
            <Clock size={14} className="text-[var(--gold)]/80" />
            {todayStr} {timeStr && <span className="text-[var(--gold)]">· {timeStr}</span>}
          </div>
          
          <div className="flex items-center gap-2">
            {inboxCount > 0 && (
              <Link
                href="/missions"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-400 hover:bg-amber-500/20 hover:border-amber-400 transition-all uppercase tracking-wider font-mono cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.1)]"
              >
                <Activity size={12} className="animate-pulse" />
                Inbox ({inboxCount})
              </Link>
            )}
            {captureInboxCount > 0 && (
              <Link
                href="/brain?tab=board"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[10px] font-bold text-blue-400 hover:bg-blue-500/20 hover:border-blue-400 transition-all uppercase tracking-wider font-mono cursor-pointer shadow-[0_0_10px_rgba(59,130,246,0.1)]"
              >
                <Inbox size={12} />
                Captures ({captureInboxCount})
              </Link>
            )}
            {pendingApprovalsCount > 0 && (
              <Link
                href="/system/actions"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[10px] font-bold text-rose-400 hover:bg-rose-500/20 hover:border-rose-400 transition-all uppercase tracking-wider font-mono cursor-pointer shadow-[0_0_10px_rgba(244,63,94,0.1)] animate-pulse"
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
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--gold)]/10 border border-[var(--gold)]/30 text-[10px] font-mono font-bold text-[var(--gold)] uppercase tracking-widest shadow-[0_0_15px_rgba(255,215,0,0.1)]">
                <Zap size={14} className="pulse-live drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]" />
                QUEUES CLEAR
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
