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
        className="rounded-xl border border-[var(--gold)]/20 bg-[var(--gold)]/[0.02] p-4 space-y-3 animate-pulse" 
        aria-hidden
      >
        <div className="h-3.5 w-32 rounded bg-[var(--bg-elevated)]" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-[var(--bg-elevated)]" />
            <div className="h-2.5 w-3/4 rounded bg-[var(--bg-elevated)]" />
            <div className="h-2.5 w-5/6 rounded bg-[var(--bg-elevated)]" />
          </div>
          <div className="h-16 rounded bg-[var(--bg-elevated)]" />
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
      className="rounded-xl border border-[var(--gold)]/25 bg-[var(--gold)]/[0.02] p-4 shadow-md space-y-3 animate-fade-in-scale"
    >
      {/* Title block */}
      <div className="flex items-center justify-between border-b border-[var(--gold)]/10 pb-2">
        <div className="flex items-center gap-1.5">
          <Compass size={13} className="text-[var(--gold)] shrink-0" strokeWidth={2} />
          <h3 className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--gold)]/90">
            Journal Alignment
          </h3>
        </div>
        <a
          href="/journal"
          className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[var(--gold)]/50 hover:text-[var(--gold)] transition"
        >
          <BookOpen size={10} />
          <span>open journal →</span>
        </a>
      </div>

      {/* Grid container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Directive details */}
        <div className={cn(
          "min-w-0 space-y-2",
          nextAction ? "md:col-span-7 border-b md:border-b-0 md:border-r border-[var(--gold)]/10 pb-4 md:pb-0 md:pr-4" : "md:col-span-12"
        )}>
          {brief && (
            <div>
              <p className="text-[8px] font-mono uppercase tracking-widest text-[var(--gold)]/50 block mb-1">
                daily directive
              </p>
              {lines ? (
                <dl className="space-y-1">
                  {lines.map((l) => (
                    <div key={l.label} className="flex items-baseline gap-2">
                      <dt
                        className={cn(
                          "w-20 shrink-0 text-[9px] font-mono uppercase tracking-wider",
                          l.label === "MOVE" ? "text-[var(--gold)] font-bold" : "text-white/40"
                        )}
                      >
                        {l.label}
                      </dt>
                      <dd
                        className={cn(
                          "min-w-0 text-[12px] leading-snug",
                          l.label === "MOVE" ? "font-semibold text-white" : "text-white/80"
                        )}
                      >
                        {l.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[12px] leading-relaxed text-white/85 whitespace-pre-line">
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
              className="group flex flex-col h-full justify-between p-3 rounded-lg border border-[var(--gold)]/15 bg-[var(--gold)]/[0.03] hover:bg-[var(--gold)]/[0.08] hover:border-[var(--gold)]/35 transition"
            >
              <div className="space-y-1">
                <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--gold)]/60 group-hover:text-[var(--gold)] transition-colors">
                  extracted next move
                  {nextAction.domain && <span className="ml-1 text-[var(--gold)]/40">#{nextAction.domain}</span>}
                </span>
                <p className="text-[12.5px] font-medium text-white leading-snug break-words">
                  {nextAction.action}
                </p>
              </div>
              
              <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-mono text-[var(--gold)] font-semibold uppercase tracking-wider">
                act on reflection <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
