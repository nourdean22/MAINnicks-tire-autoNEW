"use client";

/**
 * components/brain/related-wisdom-links.tsx · v10.0.409
 *
 * "See also" expander for a wisdom card · click to load the top 5
 * related wisdoms via /api/brain/wisdom/[id]/related (v10.0.402).
 *
 * Click-to-load (NOT auto-load) · prevents N+1 fetches when
 * /brain/wisdom renders 991 cards. Only fires when operator
 * actually wants the graph traversal.
 *
 * Renders compactly · just the related-wisdom keys + similarity ·
 * each links back to /brain?tab=wisdom&focus=<key> so the operator can
 * jump between related wisdoms without leaving the page.
 *
 * Auto-collapses on second click. Errors render as a small note
 * (not a toast) · failures here are non-blocking and the operator
 * may not even notice if their session is fine.
 */

import { useState } from "react";
import { ApiError, rawFetch } from "@/lib/utils/api-fetch";

interface RelatedWisdom {
  id: string;
  key: string;
  content: string;
  origin: string;
  similarity: number;
  topics: string[];
  topicLabels: string[];
}

interface RelatedResp {
  related?: RelatedWisdom[];
  cached?: boolean;
  reason?: string;
}

const ORIGIN_BADGE: Record<string, string> = {
  "steve-jobs": "Jobs",
  "satori": "Satori",
  "warren-buffett": "Buffett",
  "bill-gates": "Gates",
  "elon-musk": "Musk",
  "greene-laws": "Greene",
  "distiller": "Distilled",
  "consolidation": "Synthesis",
  "uncategorized": "Wisdom",
};

export function RelatedWisdomLinks({ wisdomId }: { wisdomId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [related, setRelated] = useState<RelatedWisdom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (related) {
      // Already loaded · just toggle
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    // v10.0.415 · telemetry · fire-and-forget so click latency is unchanged
    void fetch("/api/brain/telemetry", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "see_also_click", tags: { wisdomId } }),
    }).catch(() => null);
    try {
      const data = await rawFetch<RelatedResp>(`/api/brain/wisdom/${wisdomId}/related`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      setRelated(data.related ?? []);
      setExpanded(true);
    } catch (err) {
      // `ApiError.message` is already `HTTP <status>` for a failed response, so
      // the operator-visible text is unchanged for the case this used to handle.
      // Envelope drift arrives here too, carrying its own descriptive message
      // instead of being silently rendered as an empty list.
      setError(err instanceof ApiError ? err.message : "network");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!expanded) {
      void load();
    } else {
      setExpanded(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        // v10.0.419 · py-2 on mobile gives a 36-40px tap zone (text + padding);
        // py-0 on desktop keeps it inline-tight. min-w expansion ensures the
        // hit target isn't just the 6 letters of "see also".
        className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors py-2 sm:py-0 px-1 -mx-1"
        aria-expanded={expanded}
      >
        {loading
          ? "loading…"
          : expanded
            ? "hide see-also ↑"
            : "see also →"}
      </button>

      {expanded && error && (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)] italic">
          could not load related wisdoms ({error})
        </p>
      )}

      {expanded && related && related.length === 0 && (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)] italic">
          no related wisdoms above 0.40 similarity
        </p>
      )}

      {expanded && related && related.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {related.map((r) => (
            <li
              key={r.id}
              className="flex gap-2 text-[11px] leading-snug"
            >
              <span className="font-mono text-[var(--text-tertiary)] text-[9px] w-16 shrink-0 uppercase tracking-wider pt-0.5">
                {ORIGIN_BADGE[r.origin] ?? r.origin}
              </span>
              <span className="text-[var(--text-secondary)] flex-1" style={{ maxWidth: "60ch" }}>
                {r.content.slice(0, 140)}
                {r.content.length > 140 ? "…" : ""}
              </span>
              <span className="font-mono text-[9px] text-[var(--text-tertiary)] tabular-nums shrink-0 pt-0.5" title={`cosine ${r.similarity}`}>
                {(r.similarity * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
