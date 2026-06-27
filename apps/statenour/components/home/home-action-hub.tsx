"use client";

import { useState, useEffect } from "react";
import { InboxTasksTriage } from "./inbox-tasks-triage";
import { InboxTriageCard } from "./inbox-triage-card";
import { HomeOneTapMoves } from "./home-one-tap-moves";
import { trpc } from "@/lib/trpc/client";
import { Inbox, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function HomeActionHub() {
  const [activeTab, setActiveTab] = useState<"inbox" | "hygiene" | "suggested">("inbox");
  const [hasSetDefault, setHasSetDefault] = useState(false);

  // 1. Inbox counts
  const { data: inboxTasks, isLoading: isInboxLoading } = trpc.task.list.useQuery({
    status: "INBOX",
  });
  const inboxCount = inboxTasks?.length ?? 0;

  // 2. Hygiene counts
  const { data: hygieneData, isLoading: isHygieneLoading } = trpc.task.missionsHygiene.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
  const findingsCount = hygieneData?.rescue?.findings?.length ?? 0;

  // 3. One-tap moves counts
  const [movesCount, setMovesCount] = useState(0);
  const [isMovesLoading, setIsMovesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/home-moves", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("moves_failed");
        const data = (await res.json()) as { moves?: unknown[] };
        if (!cancelled) {
          setMovesCount(data.moves?.length ?? 0);
        }
      } catch {
        // Fallback
      } finally {
        if (!cancelled) setIsMovesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Heuristic: Auto-select the tab that actually needs attention on mount
  useEffect(() => {
    if (hasSetDefault || isInboxLoading || isHygieneLoading || isMovesLoading) return;

    if (inboxCount > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("inbox");
    } else if (findingsCount > 0) {
      setActiveTab("hygiene");
    } else if (movesCount > 0) {
      setActiveTab("suggested");
    }
    setHasSetDefault(true);
  }, [inboxCount, findingsCount, movesCount, isInboxLoading, isHygieneLoading, isMovesLoading, hasSetDefault]);

  const tabs = [
    {
      id: "inbox" as const,
      label: "Triage Inbox",
      count: inboxCount,
      Icon: Inbox,
      badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    {
      id: "hygiene" as const,
      label: "Hygiene",
      count: findingsCount,
      Icon: ShieldAlert,
      badgeColor: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    },
    {
      id: "suggested" as const,
      label: "Suggestions",
      count: movesCount,
      Icon: Sparkles,
      badgeColor: "bg-[var(--gold)]/10 text-[var(--gold)] border-[var(--gold)]/20",
    },
  ];

  return (
    <section
      aria-label="Action Center"
      className="glass-card relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 border border-white/10 rounded-xl p-4 shadow-xl space-y-4 animate-fade-in-scale"
    >
      {/* Background ambient glow matching active tab */}
      <div 
        className={cn(
          "absolute top-0 right-0 w-32 h-32 rounded-full blur-2xl pointer-events-none transition-all duration-500",
          activeTab === "inbox" && "bg-amber-500/5",
          activeTab === "hygiene" && "bg-rose-500/5",
          activeTab === "suggested" && "bg-[var(--gold)]/5"
        )}
      />

      {/* Tab Switcher Headers */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-1.5 md:gap-3">
          {tabs.map((tab) => {
            const Icon = tab.Icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={isActive ? "true" : "false"}
                className={cn(
                  "relative flex items-center gap-1.5 py-1 px-2.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all",
                  isActive 
                    ? "bg-white/5 text-white font-medium border border-white/10" 
                    : "text-white/45 hover:text-white/80 hover:bg-white/[0.02]"
                )}
              >
                <Icon size={12} className={cn(
                  isActive && activeTab === "inbox" && "text-amber-400",
                  isActive && activeTab === "hygiene" && "text-rose-400",
                  isActive && activeTab === "suggested" && "text-[var(--gold)]"
                )} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={cn("inline-flex px-1.5 py-0.25 text-[9px] font-bold rounded border", tab.badgeColor)}>
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <span 
                    className={cn(
                      "absolute -bottom-[11px] left-0 right-0 h-[2px] rounded-full",
                      activeTab === "inbox" && "bg-amber-400",
                      activeTab === "hygiene" && "bg-rose-400",
                      activeTab === "suggested" && "bg-[var(--gold)]"
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
        <span className="hidden sm:inline text-[9px] font-mono text-white/30 tracking-wider">
          ACTION CENTER
        </span>
      </div>

      {/* Tab Contents */}
      <div className="min-h-[120px] transition-all duration-300">
        {activeTab === "inbox" && (
          inboxCount > 0 ? (
            <InboxTasksTriage isNested />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
              <Inbox size={20} className="text-white/20" />
              <p className="text-xs text-white/90 font-medium">Inbox is clear</p>
              <p className="text-[10px] text-white/40 font-mono">ALL CAPTURED IDEAS HAVE BEEN TRIAGED</p>
            </div>
          )
        )}

        {activeTab === "hygiene" && (
          findingsCount > 0 ? (
            <InboxTriageCard isNested />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
              <ShieldAlert size={20} className="text-white/20" />
              <p className="text-xs text-white/90 font-medium">No hygiene issues</p>
              <p className="text-[10px] text-white/40 font-mono">ALL RUNNING MISSIONS COMPLY WITH STANDARDS</p>
            </div>
          )
        )}

        {activeTab === "suggested" && (
          movesCount > 0 ? (
            <HomeOneTapMoves isNested />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
              <Sparkles size={20} className="text-white/20" />
              <p className="text-xs text-white/90 font-medium">No suggestions today</p>
              <p className="text-[10px] text-white/40 font-mono">REPS & OUTREACH LIST IS FULLY CACHED</p>
            </div>
          )
        )}
      </div>
    </section>
  );
}
