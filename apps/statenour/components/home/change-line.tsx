"use client";

/**
 * ChangeLine — section 6: "since last visit" as a semantic diff, one line.
 * Replaces SinceLastVisitCard's 20-row audit timeline: the operator should
 * not inspect system history to discover change — the system interprets
 * the history (operator.briefChanges runs REAL domain queries server-side;
 * lib/home/operator-brief.ts documents which).
 *
 * Cursor semantics carried over from the old card so his existing cursor
 * survives the swap: same localStorage key ("nour:hq-last-visit"), same
 * settle rule (the cursor advances to NOW only after SETTLE_MS on the
 * page — long enough to have READ the line), read only inside effects
 * (home-hydration-safety.test).
 *
 * Honesty: parts the server couldn't read are named; "no recorded errors"
 * renders only when the error read SUCCEEDED — an unread table is not a
 * quiet night.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

const STORAGE_KEY = "nour:hq-last-visit";
const SETTLE_MS = 5_000;

function readCursor(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function ChangeLine() {
  // 0 = not yet read (SSR-safe); the effect fills the real cursor.
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    // Deferred a tick (react-compiler cascading-render rule) — the same
    // idiom the morning-brief chip uses. Cleanup prevents a
    // set-after-unmount on fast nav.
    const t = setTimeout(() => {
      const c = readCursor();
      if (c > 0) setCursor(c);
      else {
        // First visit ever: start the clock so the NEXT visit has a diff.
        try {
          window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
        } catch {}
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const changesQ = trpc.operator.briefChanges.useQuery(
    { since: cursor },
    { enabled: cursor > 0, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  // Advance the cursor after the operator has had time to read the line.
  const loaded = changesQ.isSuccess;
  useEffect(() => {
    if (cursor === 0 || !loaded) return;
    const t = window.setTimeout(() => {
      const now = Date.now();
      try {
        window.localStorage.setItem(STORAGE_KEY, String(now));
      } catch {}
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [cursor, loaded]);

  if (cursor === 0) return null;

  if (changesQ.isError) {
    return (
      <section aria-label="since last visit" className="mt-8 border-t border-edge pt-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300/90">
          change read failed — unknown, not quiet
        </p>
      </section>
    );
  }
  const data = changesQ.data;
  if (!data) return null;

  const sinceLabel = new Date(data.since).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const bits: string[] = data.parts.map((p) => `${p.count} ${p.label}`);
  if (data.errors.measured) {
    bits.push(data.errors.count === 0 ? "no recorded errors" : `${data.errors.count} errors logged`);
  }
  if (data.failedSources.length > 0) bits.push(`${data.failedSources.join("/")} unread`);

  if (bits.length === 0) return null;

  return (
    <section aria-label="since last visit" className="mt-8 border-t border-edge pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          role="heading"
          aria-level={2}
          className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-fg-secondary"
        >
          Since {sinceLabel}
          {data.clamped && <span className="text-fg-tertiary"> (last 7d)</span>}
        </p>
        <Link
          href="/system"
          className="ml-auto inline-flex min-h-[32px] items-center gap-1 text-[11px] text-fg-tertiary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Activity →
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-fg-secondary">{bits.join(" · ")}</p>
    </section>
  );
}
