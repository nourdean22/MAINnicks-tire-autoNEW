"use client";

/**
 * FinanceTab — retired-state notice (2026-07-28 wiring audit).
 *
 * The 2026-06-21 schema purge removed the FinancialTransaction model,
 * deleted GET/PATCH /api/finance, and stubbed syncTransactions to
 * {imported: 0, skipped: N} — which this tab's upload flow rendered as
 * "Successfully synced!" while writing NOTHING for five weeks. The full
 * pre-purge implementation (CSV upload · transaction list · category
 * edit) is in git history at this path, pre-2026-07-28, if WP-9 decides
 * to rebuild; until then a broken flow must say so instead of pretending.
 */

export function FinanceTab() {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-[13px] leading-relaxed text-fg-secondary">
      <p className="font-semibold text-amber-300">Personal finance ledger is retired</p>
      <p className="mt-1">
        The transaction model behind this tab was removed in the 2026-06-21
        schema purge; its list/edit routes are gone and CSV sync has been a
        silent no-op since. This notice replaces a flow that falsely reported
        successful imports.
      </p>
      <p className="mt-1 text-fg-tertiary">
        Decide in the blueprint (WP-9): rebuild on a fresh model, or remove
        the tab. Shop money stays live in Business.
      </p>
    </div>
  );
}
