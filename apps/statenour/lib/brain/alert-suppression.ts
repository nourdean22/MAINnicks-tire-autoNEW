/**
 * lib/brain/alert-suppression.ts · UI v3 W5b (2026-10-18).
 *
 * The ONE reader of alert suppression, used by every consumer that lists alerts:
 *   - buildActiveAlerts (lib/services/brain-domain.ts): /system/alerts, the /brain card, the inspector
 *   - the Telegram /alerts command (app/api/telegram/webhook/route.ts, cmdAlerts)
 *   - Nick's command-center state (lib/ai/context/command-center-state.ts)
 * Two kinds of live BrainMemory rows suppress an alert: a category mute (category alert_mute,
 * key = the category, written by trpc.brain.muteAlertCategory) and a dismissal (category
 * alert_dismiss, key = alertDismissKey(category, key), written by trpc.brain.dismissAlert).
 * Both expire through expiresAt; neither deletes the alert row (Resolve does that).
 */

import { prisma } from "@/lib/prisma";
import { alertDismissKey } from "@/lib/brain/alert-lanes";

export interface AlertSuppression {
  mutedCategories: ReadonlySet<string>;
  dismissedKeys: ReadonlySet<string>;
}

export const NO_ALERT_SUPPRESSION: AlertSuppression = {
  mutedCategories: new Set(),
  dismissedKeys: new Set(),
};

/** Throws when the read fails; each caller decides what an unknown suppression means for it. */
export async function getAlertSuppression(): Promise<AlertSuppression> {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: { in: ["alert_mute", "alert_dismiss"] },
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { category: true, key: true },
  });
  const mutedCategories = new Set<string>();
  const dismissedKeys = new Set<string>();
  for (const r of rows) (r.category === "alert_mute" ? mutedCategories : dismissedKeys).add(r.key);
  return { mutedCategories, dismissedKeys };
}

/**
 * Live (unsuppressed) alert rows, newest first, for a reader that prints or implies an all-clear.
 * Pages through the alert query until `want` live rows are found or the query is exhausted, so a
 * run of dismissed rows can never hide an older live alert (Codex P2 on #3161). Bounded at
 * maxPages x pageSize rows; `truncated` = the bound was hit with fewer than `want` live and the
 * last page was full, so more rows may remain: the caller must say "more not shown", never "none".
 */
export async function collectLiveAlerts<R extends { category: string; key: string }>(
  fetchPage: (skip: number, take: number) => Promise<R[]>,
  suppression: AlertSuppression,
  want: number,
  { pageSize = 50, maxPages = 10 }: { pageSize?: number; maxPages?: number } = {},
): Promise<{ rows: R[]; truncated: boolean }> {
  const rows: R[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(page * pageSize, pageSize);
    for (const r of batch) {
      if (isAlertSuppressed(r, suppression)) continue;
      rows.push(r);
      if (rows.length >= want) return { rows, truncated: false };
    }
    if (batch.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export function isAlertSuppressed(row: { category: string; key: string }, s: AlertSuppression): boolean {
  return s.mutedCategories.has(row.category) || s.dismissedKeys.has(alertDismissKey(row.category, row.key));
}
