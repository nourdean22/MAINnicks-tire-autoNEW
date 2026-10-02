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
      <div className="rounded-control border border-edge-subtle bg-content px-3 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        nick is choosing laws…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-control border border-rose-500/30 bg-rose-500/[0.04] px-3 py-2 text-[12px] text-rose-300/90">
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
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          greene · applicable now
        </span>
        <span className="text-[11px] font-mono text-fg-tertiary">
          ·
        </span>
        <span className="text-[11px] font-mono text-fg-tertiary">
          {data.source === "cache" ? "cached today" : "fresh"}
        </span>
      </header>

      <div className="space-y-2">
        {data.laws.map((law) => (
          <article
            key={law.key}
            className="rounded-surface border border-edge-subtle bg-content p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <span className="shrink-0 inline-flex items-center rounded-micro border border-edge-default bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
                {BOOK_LABEL[law.book] ?? law.book}
              </span>
              <h4 className="flex-1 text-[13px] font-semibold text-fg truncate">
                {law.title}
              </h4>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
              {law.rationale}
            </p>
            {law.actions.length > 0 && (
              <ul className="space-y-1 pl-2 border-l border-edge-default">
                {law.actions.map((action, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-[var(--text-primary)] leading-snug before:content-['▸'] before:text-fg-tertiary before:mr-1.5"
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
