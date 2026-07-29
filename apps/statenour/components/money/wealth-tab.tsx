"use client";

/**
 * WealthTab — retired-state notice (2026-07-28 wiring audit).
 *
 * Every endpoint the pre-purge tab called (/api/wealth GET/POST/DELETE,
 * /api/wealth/refresh-prices) was deleted with the 2026-06-21 schema
 * purge — the tab rendered spinner→error over 404s for five weeks. The
 * full holdings/portfolio implementation is in git history at this path,
 * pre-2026-07-28, if WP-9 decides to rebuild.
 */

export function WealthTab() {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-[13px] leading-relaxed text-fg-secondary">
      <p className="font-semibold text-amber-300">Wealth tracking is retired</p>
      <p className="mt-1">
        The portfolio models behind this tab were removed in the 2026-06-21
        schema purge; its API routes no longer exist. Nothing here has
        fetched real data since then — this notice replaces a broken loading
        state, not a working feature.
      </p>
      <p className="mt-1 text-fg-tertiary">
        Decide in the blueprint (WP-9): rebuild on a fresh model, or remove
        the tab. Shop money stays live in Business.
      </p>
    </div>
  );
}
