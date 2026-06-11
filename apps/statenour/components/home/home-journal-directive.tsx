"use client";

/**
 * HomeJournalDirective · delivery-layer pass · 2026-06-10.
 *
 * The journal's 4-line operator directive (COMPOUNDING / STALLED /
 * WATCH / MOVE — journal-advancement item F) is composed daily,
 * grounded in real threads + drift + active goals/missions + entry
 * summaries, and cached in BrainMemory — but it rendered ONLY on
 * /journal. That is the evolution audit's core failure mode:
 * intelligence computed but never delivered. This strip lands the
 * directive on the home page, where the day starts.
 *
 * Same data, zero new compute: POSTs the existing daily-cached
 * /api/ai/journal-brief (the first caller of the day composes; every
 * later caller — including /journal's own brief — reads the cache).
 * Self-hides when the route returns empty: no fabricated directive,
 * no synthetic urgency. Falls back to the raw brief text when the
 * model ignored the 4-label contract (parser in
 * lib/services/journal-directive.ts).
 *
 * Mirrors the NicksHomeBrief / NicksJournalBrief gold-eyebrow family.
 */

import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { parseDirectiveLines } from "@/lib/services/journal-directive";

export function HomeJournalDirective() {
  const [brief, setBrief] = useState<string | null>(null);

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
        // Silent · home renders without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brief) return null;
  const lines = parseDirectiveLines(brief);

  return (
    <section
      aria-label="journal operator directive"
      className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <Compass
          size={12}
          className="text-[var(--gold)] mt-0.5 shrink-0"
          strokeWidth={1.75}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
              directive · from your journal
            </p>
            <a
              href="/journal"
              className="shrink-0 text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/50 transition hover:text-[var(--gold)]/80"
            >
              journal →
            </a>
          </div>
          {lines ? (
            <dl className="mt-1.5 space-y-1">
              {lines.map((l) => (
                <div key={l.label} className="flex items-baseline gap-2">
                  <dt
                    className={`w-[5.5rem] shrink-0 text-[9px] font-mono uppercase tracking-[0.14em] ${
                      l.label === "MOVE"
                        ? "text-[var(--gold)]"
                        : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {l.label}
                  </dt>
                  <dd
                    className={`min-w-0 text-[12.5px] leading-snug ${
                      l.label === "MOVE"
                        ? "font-medium text-[var(--text-primary)]"
                        : "text-[var(--text-primary)]/85"
                    }`}
                  >
                    {l.text}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-[var(--text-primary)]">
              {brief}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
