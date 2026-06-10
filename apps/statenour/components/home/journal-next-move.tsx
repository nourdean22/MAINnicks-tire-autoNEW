"use client";

/**
 * JournalNextMove · journal-advancement item G (2026-06-10) · Feed-OS.
 *
 * The journal loop's "Act" output, surfaced where the day starts. The
 * async Journal Brain extracts ONE concrete next move (with timing)
 * from each entry that implies action; this strip shows the freshest
 * one from the last 48h on the home page, deep-linked back to the
 * entry that produced it.
 *
 * Honest by construction: the backend returns null when no entry
 * implied a real action (the extractor is told blank beats fabricated),
 * and the strip renders nothing. No synthetic urgency.
 */

import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function JournalNextMove() {
  const { data } = trpc.journal.latestNextAction.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;

  return (
    <a
      href={data.entryId ? `/journal#bd-${data.entryId}` : "/journal"}
      className="flex items-start gap-2 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-3 py-2.5 transition hover:bg-[var(--gold)]/[0.09]"
      aria-label="Next move extracted from your journal"
    >
      <ArrowRight size={12} className="mt-0.5 shrink-0 text-[var(--gold)]" strokeWidth={2} />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
          next move · from your journal
          {data.domain && <span className="ml-1 text-[var(--gold)]/50">#{data.domain}</span>}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--text-primary)]">
          {data.action}
        </span>
      </span>
    </a>
  );
}
