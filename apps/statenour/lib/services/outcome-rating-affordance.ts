/**
 * The rating affordance a ledgered recommendation carries to the operator.
 *
 * ONE owner for the two shapes that were hand-built in three places
 * (morning-brief.ts, proactive-pushes.ts, and nowhere for the combined
 * daily brief — docs/design/outcome-ledger-coverage-2026-10-02.md, finding 6):
 *
 *   · web push  → `data.ledgerId` + `oc_useful` / `oc_not_useful` actions;
 *     public/sw.js routes an `oc_*` action to POST /api/outcomes/rate and
 *     deliberately does NOT navigate.
 *   · Telegram  → inline buttons with callback_data `oc:u:<id>` / `oc:n:<id>`;
 *     app/api/telegram/webhook/route.ts parses `oc:<u|n>:<ledgerId>` (the id
 *     travels in callback_data, capped at 64 bytes — a cuid fits, a brief does not).
 *
 * No ledger id → no affordance (`{}` / `null`), never a button that rates nothing.
 */
import type { InlineButton } from "@/lib/services/telegram";

export interface RatingPushFields {
  data: { ledgerId: string };
  actions: Array<{ action: string; title: string }>;
}

/** Spread into a sendPush payload. Empty when there is no row to rate. */
export function ratingPushActions(ledgerId: string | null | undefined): RatingPushFields | Record<string, never> {
  if (!ledgerId) return {};
  return {
    data: { ledgerId },
    actions: [
      { action: "oc_useful", title: "👍 Useful" },
      { action: "oc_not_useful", title: "👎 Not useful" },
    ],
  };
}

/** One row of two buttons for sendTelegramWithButtons. Null when there is no row to rate. */
export function ratingTelegramButtons(ledgerId: string | null | undefined): InlineButton[][] | null {
  if (!ledgerId) return null;
  return [
    [
      { text: "👍 Useful", callback_data: `oc:u:${ledgerId}` },
      { text: "👎 Not useful", callback_data: `oc:n:${ledgerId}` },
    ],
  ];
}
