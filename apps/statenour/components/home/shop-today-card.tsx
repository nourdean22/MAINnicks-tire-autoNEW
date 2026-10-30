"use client";

/**
 * Nick's Tire today: one small card with the shop's sales for the day (2026-10-30, home-pulse W2).
 * Nour, 13:53 EDT: "u can put a small nicks tire card on there with total sales for the day". It opens
 * the shop dashboard; the shop's queues stay there. Three states: measured, loading, unknown (never $0).
 */
import { GlassCard } from "@/components/ui/glass-card";
import { trpc } from "@/lib/trpc/client";
import type { ShopToday } from "@/lib/home/shop-today";

const SHOP_ADMIN = "https://nickstire.org/admin";

export function ShopTodayCardView({ read }: { read: ShopToday | "loading" | "error" }) {
  const unknown = read === "error" || (typeof read === "object" && read.status === "unknown");
  return (
    <GlassCard as="a" ruled href={SHOP_ADMIN} target="_blank" className="block min-h-11 py-2">
      <div className="flex items-baseline justify-between gap-4" aria-busy={read === "loading"}>
        {/* "so far": the bridge sends no sync time yet (a nickstire follow-up adds syncedAt, then "as of HH:MM"). */}
        <p className="text-[13px] text-fg-secondary">Nick&apos;s Tire · today so far</p>
        {read === "loading" ? (
          <span className="h-5 w-20 animate-pulse rounded-micro bg-raised" aria-hidden />
        ) : unknown ? (
          <p className="text-[13px] text-amber-300">Sales unknown, couldn&apos;t read the shop</p>
        ) : (
          typeof read === "object" &&
          read.status === "ok" && (
            <p className="text-fg">
              <span className="text-[20px] font-semibold tabular-nums">${read.dollars.toLocaleString("en-US")}</span>
              <span className="ml-2 text-[13px] text-fg-secondary">
                {read.jobs} {read.jobs === 1 ? "job" : "jobs"}
              </span>
            </p>
          )
        )}
      </div>
    </GlassCard>
  );
}

export function ShopTodayCard() {
  const q = trpc.operator.shopToday.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
  });
  // A failed refetch keeps the last good reading (TanStack keeps data beside isError).
  const read = q.data ?? (q.isError ? "error" : "loading");
  return <ShopTodayCardView read={read} />;
}
