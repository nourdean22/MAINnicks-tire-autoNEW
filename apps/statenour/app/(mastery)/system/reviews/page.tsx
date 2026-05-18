"use client";

/**
 * /system/reviews · Phase K (2026-05-18 PM)
 *
 * The operator review surface · paste an errorId from a 500 response
 * and see the full sanitized stack + classification + raw error
 * message · OR browse the last N sanitized errors when no specific
 * errorId is at hand.
 *
 * Closes the H.7.1 loop · the sanitizer returns errorId to the wire
 * (operator sees "Reference: err_xyz" in a toast) · they navigate
 * here · paste the id · get the full context without grepping Railway
 * runtime logs.
 *
 * Aesthetic · editorial-minimalist · matches /system/* surfaces.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface LookupRow {
  id: string;
  errorId: string | null;
  level: string;
  message: string;
  route: string | null;
  op: string | null;
  classified: string | null;
  rawMsg: string | null;
  stack: string | null;
  createdAt: string;
}

function ReviewsPageInner() {
  const searchParams = useSearchParams();
  const initialErrorId = searchParams?.get("errorId") ?? "";

  const [query, setQuery] = useState(initialErrorId);
  const [matches, setMatches] = useState<LookupRow[]>([]);
  const [recent, setRecent] = useState<LookupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/system/error-lookup?recent=30", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { recent: LookupRow[] };
      setRecent(body.recent ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const fetchById = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    setMatches([]);
    try {
      const res = await fetch(
        `/api/system/error-lookup?errorId=${encodeURIComponent(id.trim())}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { matches: LookupRow[] };
      setMatches(body.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecent();
    if (initialErrorId) {
      void fetchById(initialErrorId);
    }
  }, [fetchRecent, fetchById, initialErrorId]);

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <header className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
            System · operator review
          </p>
          <h1 className="text-2xl font-medium text-[var(--text-primary)]">
            Error lookup
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Paste an <code className="text-[var(--gold)]">errorId</code> from any
            500 response (e.g. <code>err_lk3m2a_a7c9bd</code>) to see the full
            sanitized stack, classification, and raw error message.
          </p>
        </header>

        {/* Search */}
        <section className="space-y-2">
          <div className="flex gap-2 items-stretch">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchById(query);
              }}
              placeholder="err_lk3m2a_a7c9bd"
              className="flex-1 min-h-[44px] px-3 rounded-md border border-white/15 bg-transparent text-sm font-mono text-[var(--text-primary)] placeholder:text-white/30 focus:outline-none focus:border-[var(--gold)]/60"
            />
            <button
              type="button"
              onClick={() => void fetchById(query)}
              disabled={busy || query.trim().length === 0}
              className="text-xs font-mono uppercase tracking-[0.14em] px-4 min-h-[44px] rounded bg-[var(--gold)] text-black font-medium hover:bg-[var(--gold)]/90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              lookup
            </button>
          </div>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </section>

        {/* Match results */}
        {matches.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Matches ({matches.length})
            </h2>
            <ul className="space-y-3">
              {matches.map((m) => (
                <ErrorRow key={m.id} row={m} expanded />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Recent */}
        <section className="space-y-3">
          <header className="flex items-baseline justify-between gap-3">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Recent sanitized errors
            </h2>
            <button
              type="button"
              onClick={() => void fetchRecent()}
              disabled={busy}
              className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--gold)] disabled:opacity-50"
            >
              refresh →
            </button>
          </header>
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              No sanitized errors persisted yet. They'll appear here once any
              500 response goes through the sanitizer.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((r) => (
                <ErrorRow key={r.id} row={r} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function ErrorRow({ row, expanded = false }: { row: LookupRow; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  return (
    <li className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-baseline justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.14em]"
      >
        <span className="text-[var(--gold)] truncate">
          {row.errorId ?? "(no errorId)"}
        </span>
        <span className="text-[var(--text-tertiary)] tabular-nums shrink-0">
          {new Date(row.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </button>
      <p className="text-sm text-[var(--text-primary)] truncate">{row.message}</p>
      {row.classified ? (
        <p className="text-xs text-[var(--text-secondary)] italic">
          {row.classified}
        </p>
      ) : null}
      {row.route ? (
        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          route · {row.route} {row.op ? `· ${row.op}` : ""}
        </p>
      ) : null}
      {open ? (
        <>
          {row.rawMsg ? (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
                raw message
              </p>
              <pre className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono bg-white/[0.02] border border-white/5 rounded-sm p-2.5 max-h-48 overflow-auto">
                {row.rawMsg}
              </pre>
            </div>
          ) : null}
          {row.stack ? (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
                stack
              </p>
              <pre className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono bg-white/[0.02] border border-white/5 rounded-sm p-2.5 max-h-64 overflow-auto">
                {row.stack}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={null}>
      <ReviewsPageInner />
    </Suspense>
  );
}
