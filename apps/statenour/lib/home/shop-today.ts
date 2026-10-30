/**
 * lib/home/shop-today.ts · today's Nick's Tire sales for the Home card (2026-10-30, home-pulse W2).
 *
 * Nour, 13:53 EDT: "u can put a small nicks tire card on there with total sales for the day". This
 * supersedes his 2026-09-02 "no shop surfaces on the personal Home" verdict for this one card.
 * Sales = the shop's counter invoices for the shop day (each is a closed job; payment status means
 * nothing), from the bridge's revenue_today, which keys the ET shop day on the nickstire side.
 * Read through readNickRevenue, the one reader for that payload. A failed read is unknown, never $0.
 */
import { queryNick, readBridge } from "@/lib/nickstire/query";
import { readNickRevenue } from "@/lib/nickstire/revenue";

export type ShopToday =
  | { status: "ok"; dollars: number; jobs: number; asOf: string }
  | { status: "unknown"; reason: string };

/** Pure: a bridge answer to the Home card's reading. */
export function shopTodayFrom(res: unknown, now: Date = new Date()): ShopToday {
  const read = readBridge<Record<string, unknown>>(res);
  if (read.status !== "ok") return { status: "unknown", reason: read.reason };
  const rev = readNickRevenue(read.data);
  if (!rev.hasToday) return { status: "unknown", reason: "the answer carried no sales figure" };
  return { status: "ok", dollars: rev.todayDollars, jobs: rev.jobs, asOf: now.toISOString() };
}

export async function buildShopToday(): Promise<ShopToday> {
  try {
    return shopTodayFrom(await queryNick("revenue_today"));
  } catch (err) {
    return { status: "unknown", reason: err instanceof Error ? err.message.slice(0, 120) : "bridge read failed" };
  }
}
