"use client";

import { useEffect, useState } from "react";
import { Compass, ArrowRight, BookOpen } from "lucide-react";
import { parseDirectiveLines } from "@/lib/services/journal-directive";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export function HomeJournalHub() {
  const [brief, setBrief] = useState<string | null>(null);
  const [isBriefLoading, setIsBriefLoading] = useState(true);

  // 1. Fetch daily journal brief/directive
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/journal-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("journal_brief_failed");
        const data = (await res.json()) as { brief: string };
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // Silent
      } finally {
        if (!cancelled) setIsBriefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Fetch extracted next action
  const { data: nextAction, isLoading: isActionLoading } = trpc.journal.latestNextAction.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = isBriefLoading || isActionLoading;

  if (isLoading) {
    return (
      <div 
        className="relative overflow-hidden glass-card rounded-xl border border-white/5 bg-zinc-900/40 backdrop-blur-md p-4 space-y-3 animate-pulse" 
        aria-hidden
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold)]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="h-3.5 w-32 rounded bg-white/5" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-white/5" />
            <div className="h-2.5 w-3/4 rounded bg-white/5" />
            <div className="h-2.5 w-5/6 rounded bg-white/5" />
          </div>
          <div className="h-16 rounded bg-white/5" />
        </div>
      </div>
    );
  }

  // If both brief and next action are null, self-hide completely
  if (!brief && !nextAction) return null;

  const lines = brief ? parseDirectiveLines(brief) : null;

  return (
    <section
      aria-label="Journal Alignment & Actions"
      className="relative overflow-hidden glass-card rounded-xl border border-white/10 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 p-4 shadow-xl space-y-4 animate-fade-in-scale"
    >
      <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--gold)]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Title block */}
      <div className="relative z-10 flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 text-[var(--gold)]">
            <Compass size={14} strokeWidth={2} />
          </div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-zinc-200">
            Journal Alignment
          </h3>
        </div>
        <a
          href="/journal"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-zinc-400 hover:bg-[var(--gold)]/10 hover:text-[var(--gold)] hover:border-[var(--gold)]/30 transition-all"
        >
          <BookOpen size={10} />
          <span>open journal</span>
        </a>
      </div>

      {/* Grid container */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Directive details */}
        <div className={cn(
          "min-w-0 space-y-3",
          nextAction ? "md:col-span-7 border-b md:border-b-0 md:border-r border-white/5 pb-4 md:pb-0 md:pr-5" : "md:col-span-12"
        )}>
          {brief && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--gold)]/60 block mb-2.5">
                daily directive
              </p>
              {lines ? (
                <dl className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.label} className="flex items-baseline gap-3">
                      <dt
                        className={cn(
                          "w-20 shrink-0 text-[10px] font-mono uppercase tracking-wider",
                          l.label === "MOVE" ? "text-[var(--gold)] font-bold" : "text-zinc-500"
                        )}
                      >
                        {l.label}
                      </dt>
                      <dd
                        className={cn(
                          "min-w-0 text-[13px] leading-relaxed",
                          l.label === "MOVE" ? "font-medium text-zinc-200" : "text-zinc-400"
                        )}
                      >
                        {l.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[13px] leading-relaxed text-zinc-400 whitespace-pre-line">
                  {brief}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Next Move Block */}
        {nextAction && (
          <div className="md:col-span-5 flex flex-col justify-center">
            <a
              href={nextAction.entryId ? `/journal#bd-${nextAction.entryId}` : "/journal"}
              className="group flex flex-col h-full justify-between p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-[var(--gold)]/30 transition-all"
            >
              <div className="space-y-2">
                <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--gold)]/60 group-hover:text-[var(--gold)]/90 transition-colors block">
                  extracted next move (projected)
                  {nextAction.domain && <span className="ml-1.5 text-zinc-500">#{nextAction.domain}</span>}
                </span>
                <p className="text-[14px] font-medium text-zinc-200 leading-snug break-words group-hover:text-white transition-colors">
                  {nextAction.action}
                </p>
              </div>
              
              <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--gold)] font-semibold uppercase tracking-wider">
                act on reflection <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
