"use client";

/**
 * LensFireTicker · v10.0.300 · live "Pareto fired on /chat · 2m ago"
 * stream on Ultron HQ.
 *
 * Reads /api/system/lens-recent · cycles through the last 10 lens
 * fires every 4s. Renders silently when no fires yet (fresh OS or
 * lens-injection-not-yet-tripped state).
 *
 * Proof-of-thought · the ticker shows the AI is actively applying
 * strategic frameworks to live operator queries · not just labelled
 * generic generation. Compounds the TOP LENS chip: that one summarizes
 * today's hot framework, this one streams individual fire events.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface FireRow {
  id: string;
  surface: string;
  framework: string;
  at: string;
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

export function LensFireTicker() {
  const [fires, setFires] = useState<FireRow[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await authedFetch("/api/system/lens-recent?limit=10");
        if (!r.ok) return;
        const d = await r.json();
        const next: FireRow[] = (d?.data?.fires ?? d?.fires ?? []) as FireRow[];
        if (alive) setFires(next);
      } catch {
        // best-effort · silent failure leaves the ticker silent
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Cycle through fires every 4s when there's more than one to rotate.
  useEffect(() => {
    if (fires.length < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % fires.length), 4_000);
    return () => clearInterval(id);
  }, [fires.length]);

  if (fires.length === 0) return null;
  const fire = fires[idx % fires.length];

  return (
    <Link
      href="/system/lens-stats"
      data-no-anchor
      className="flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-mono text-[var(--text-tertiary)] hover:bg-violet-500/[0.04] transition-colors group"
    >
      <Sparkles
        size={10}
        className="text-violet-400/70 shrink-0 group-hover:text-violet-300 transition-colors"
      />
      <span className="truncate">
        <span className="text-violet-300/90 font-semibold">
          {fire.framework}
        </span>
        <span className="opacity-50"> fired on </span>
        <span className="text-[var(--text-secondary)]">{fire.surface}</span>
        <span className="opacity-50"> · {ageLabel(fire.at)} ago</span>
      </span>
    </Link>
  );
}
