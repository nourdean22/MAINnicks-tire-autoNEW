"use client";

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

export function NicksHomeBrief() {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/home-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("brief_failed");
        const data = (await res.json()) as { brief: string };
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // Silent · home page renders without it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section
        aria-label="nick's home brief"
        aria-busy="true"
        className="relative overflow-hidden rounded-xl bg-zinc-900/40 backdrop-blur-md border border-white/5 p-5 shadow-lg"
      >
        <div className="absolute top-0 left-0 w-1 bg-zinc-800 h-full" />
        
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-zinc-800/50 mt-1 animate-pulse">
            <div className="h-4 w-4 bg-zinc-700/50 rounded" />
          </div>
          <div className="flex-1 space-y-3 mt-1.5">
            <div className="h-2 w-24 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-full animate-pulse rounded bg-zinc-800/70" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-800/70" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-800/70" />
          </div>
        </div>
      </section>
    );
  }

  if (!brief) return null;

  return (
    <section
      aria-label="nick's home brief"
      className="relative overflow-hidden rounded-xl bg-zinc-900/40 backdrop-blur-md border border-white/10 p-5 shadow-lg group hover:bg-zinc-900/60 transition-colors"
    >
      <div className="absolute top-0 left-0 w-1 bg-gradient-to-b from-amber-400 to-amber-600 h-full opacity-80" />
      
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 mt-1 shadow-[0_0_15px_rgba(245,158,11,0.15)] group-hover:shadow-[0_0_20px_rgba(245,158,11,0.25)] transition-shadow">
          <Brain size={18} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500/80 mb-2 flex items-center gap-2">
            Intelligence Brief
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          </p>
          <p className="text-[14px] text-zinc-300 leading-relaxed max-w-[65ch] whitespace-pre-line font-medium group-hover:text-zinc-200 transition-colors">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
