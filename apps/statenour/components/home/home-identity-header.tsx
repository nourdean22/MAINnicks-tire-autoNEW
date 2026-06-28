"use client";

import { Brain, Activity, Clock, Zap, ShieldAlert, Inbox } from "lucide-react";
import { today } from "@/lib/utils/datetime";
import { trpc } from "@/lib/trpc/client";
import { useEffect, useState } from "react";
import Link from "next/link";

export function HomeIdentityHeader() {
  const todayStr = today();
  
  const { data: inboxCount = 0 } = trpc.task.inboxCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const { data: captureInboxCount = 0 } = trpc.task.captureInboxCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const { data: pendingRequests = [] } = trpc.system.getPendingApprovals.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: approvalsData } = trpc.system.approvals.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const pendingApprovalsCount = pendingRequests.length + (approvalsData?.rows.length ?? 0);

  const [timeStr, setTimeStr] = useState<string>("");
  const [greeting, setGreeting] = useState<string>("Welcome");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
      
      const hour = now.getHours();
      if (hour < 12) setGreeting("Good Morning");
      else if (hour < 17) setGreeting("Good Afternoon");
      else setGreeting("Good Evening");
    };
    
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section
      aria-label="home identity"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900/80 via-black to-zinc-950 border border-white/5 p-6 md:p-8 shadow-2xl mb-6 mt-2"
    >
      {/* Decorative background glow */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-800/50 border border-white/5 backdrop-blur-md">
            <Brain size={12} className="text-[var(--gold)] shrink-0" strokeWidth={2} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--gold)]/90">
              Nour Command Center
            </span>
          </div>
          
          <div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-zinc-500">
              {greeting}, Nour.
            </h1>
            <p className="mt-2 text-sm text-zinc-400 max-w-xl">
              All systems online. Your empire is ready for commands.
            </p>
          </div>
        </div>

        <div className="flex flex-row md:flex-col gap-3 md:items-end">
          <div className="flex items-center gap-2 text-sm font-mono text-zinc-300 bg-zinc-900/50 px-3 py-1.5 rounded-lg border border-white/5">
            <Clock size={14} className="text-zinc-500" />
            {todayStr} {timeStr && <span className="text-zinc-500">· {timeStr}</span>}
          </div>
          
          <div className="flex items-center gap-2">
            {inboxCount > 0 && (
              <Link
                href="/missions"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition uppercase tracking-wider font-mono cursor-pointer"
              >
                <Activity size={12} />
                Inbox ({inboxCount})
              </Link>
            )}
            {captureInboxCount > 0 && (
              <Link
                href="/brain?tab=board"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition uppercase tracking-wider font-mono cursor-pointer"
              >
                <Inbox size={12} />
                Captures ({captureInboxCount})
              </Link>
            )}
            {pendingApprovalsCount > 0 && (
              <Link
                href="/system/actions"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition uppercase tracking-wider font-mono cursor-pointer animate-pulse"
              >
                <ShieldAlert size={12} />
                Approvals ({pendingApprovalsCount})
              </Link>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400 uppercase tracking-wider">
              <Zap size={12} />
              Ready
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
