"use client";

/**
 * ContextualGreeneSidebar · Wave AB.b · 2026-05-28.
 *
 * Mounts inside the dossier panel for a selected person. Reads
 * /api/relationships/[id]/contextual-laws and shows the top 3 Greene
 * laws Nick thinks apply RIGHT NOW + their verbatim action strings
 * from the Wave Z corpus.
 *
 * Replaces the previous static GreeneLawSidebar for the day-to-day path
 * (legacy sidebar still renders below if `applicableLaws` is set on
 * PersonProfile · operator can compare static vs contextual picks).
 */

import { useEffect, useState } from "react";
import { rawFetch } from "@/lib/utils/api-fetch";

interface ContextualLaw {
  key: string;
  book: string;
  title: string;
  summary: string;
  rationale: string;
  actions: string[];
}

interface ContextualLawsResponse {
  laws: ContextualLaw[];
  source: "cache" | "fresh" | "empty";
  generatedAt: string;
}

const BOOK_LABEL: Record<string, string> = {
  "48LP": "48 Laws",
  "33SW": "33 Strategies",
  "50L": "50th Law",
  Mastery: "Mastery",
  Seduction: "Seduction",
  HN: "Human Nature",
};

export function ContextualGreeneSidebar({
  personId,
}: {
  personId: string;
}) {
  const [data, setData] = useState<ContextualLawsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // wave-AB.b-audit · personId is locked by the parent via `key={person.id}`
  // so this effect runs once per mount · no setState-in-effect needed
  // for loading/error state transitions (useState initializers seed them
  // to the in-flight starting values on every fresh mount).
  useEffect(() => {
    if (!personId) return;
    let cancelled = false;
    void (async () => {
      try {
        // `ApiError.message` is `HTTP <status>` on a failed response, so the
        // error text this surfaces is unchanged from the hand-rolled throw.
        const body = await rawFetch<ContextualLawsResponse>(
          `/api/relationships/${encodeURIComponent(personId)}/contextual-laws`,
          { credentials: "include" },
        );
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (loading) {
    return (
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-3 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        nick is choosing laws…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.04] px-3 py-2 text-[11px] text-rose-300/90">
        could not load contextual laws · {error}
      </div>
    );
  }
  if (!data || data.laws.length === 0) return null;

  return (
    <section
      aria-label="contextual greene laws"
      className="space-y-2"
    >
      <header className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
          greene · applicable now
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]/60">
          ·
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
          {data.source === "cache" ? "cached today" : "fresh"}
        </span>
      </header>

      <div className="space-y-2">
        {data.laws.map((law) => (
          <article
            key={law.key}
            className="rounded-md border border-[var(--gold)]/25 bg-[var(--bg-base)] p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <span className="shrink-0 inline-flex items-center rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
                {BOOK_LABEL[law.book] ?? law.book}
              </span>
              <h4 className="flex-1 text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--text-primary)] truncate">
                {law.title}
              </h4>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
              {law.rationale}
            </p>
            {law.actions.length > 0 && (
              <ul className="space-y-1 pl-2 border-l border-[var(--gold)]/20">
                {law.actions.map((action, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-[var(--text-primary)] leading-snug before:content-['▸'] before:text-[var(--gold)]/60 before:mr-1.5"
                  >
                    {action}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
