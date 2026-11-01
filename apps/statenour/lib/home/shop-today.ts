/**
 * lib/home/shop-today.ts · today's Nick's Tire sales for the Home card (2026-10-30, home-pulse W2).
 *
 * Nour, 13:53 EDT: "u can put a small nicks tire card on there with total sales for the day". This
 * supersedes his 2026-09-02 "no shop surfaces on the personal Home" verdict for this one card.
 * Sales = the shop's counter invoices for the shop day (each is a closed job; payment status means
 * nothing), from the bridge's revenue_today, which keys the ET shop day on the nickstire side.
 * Read through readNickRevenue, the one reader for that payload. A failed read is unknown, never $0.
 *
 * `syncedAt` is the shop's own sync time from the payload (nickstire PR 3482), null when the shop sent none.
 * It replaced `asOf: now.toISOString()` (2026-10-31, missed-asks row 48): that stamped the READ, so a sync
 * from yesterday looked fresh. The card renders it through shopSyncLabel.
 */
import { queryNick, readBridge } from "@/lib/nickstire/query";
import { readNickRevenue } from "@/lib/nickstire/revenue";

export type ShopToday =
  | { status: "ok"; dollars: number; jobs: number; syncedAt: string | null }
  | { status: "unknown"; reason: string };

/** Pure: a bridge answer to the Home card's reading. */
export function shopTodayFrom(res: unknown): ShopToday {
  const read = readBridge<Record<string, unknown>>(res);
  if (read.status !== "ok") return { status: "unknown", reason: read.reason };
  const rev = readNickRevenue(read.data);
  if (!rev.hasToday) return { status: "unknown", reason: "the answer carried no sales figure" };
  return { status: "ok", dollars: rev.todayDollars, jobs: rev.jobs, syncedAt: rev.syncedAt };
}

/**
 * Home's first reads share one httpBatchLink request, and queryNick retries a timeout three times at its
 * own timeout each, so an unbounded shop read held the NOW line and the brief for about 50 s when the shop
 * was slow (Codex P1 on #3405). Past this deadline the card says unknown and the batch answers.
 */
export const SHOP_READ_DEADLINE_MS = 3_000;

export async function buildShopToday(): Promise<ShopToday> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ShopToday>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "unknown", reason: `the shop did not answer within ${SHOP_READ_DEADLINE_MS / 1000} s` }),
      SHOP_READ_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([queryNick("revenue_today", {}, SHOP_READ_DEADLINE_MS).then((r) => shopTodayFrom(r)), deadline]);
  } catch (err) {
    return { status: "unknown", reason: err instanceof Error ? err.message.slice(0, 120) : "bridge read failed" };
  } finally {
    clearTimeout(timer);
  }
}
