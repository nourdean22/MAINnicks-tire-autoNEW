/**
 * useWeatherCTA — weather-conditional CTA hint for the storefront banner.
 *
 * 2026-09-15 · REWIRED. From 2026-05-19 this hook returned null: it fetched
 * a retired Vercel deploy and was CSP-blocked on every page load. It now
 * reads ShopState from this app's own server (`shopStatus.getState`, same
 * origin, cached 60s) and projects it through `weatherCtaFromShopState` —
 * the pure function in shared/shopState.ts, where the copy rules and the
 * "only snow, ice or heat" gate are tested.
 *
 * Returns null on any failure, while loading, and on ordinary weather. No
 * manufactured urgency: the banner is absent far more often than present.
 */
import { trpc } from "@/lib/trpc";
import { weatherCtaFromShopState, type ShopState, type WeatherCTA } from "@shared/shopState";

export type { WeatherCTA };

function useShopState(): ShopState | null {
  const { data } = trpc.shopStatus.getState.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return data ?? null;
}

export function useWeatherCTA(): WeatherCTA | null {
  return weatherCtaFromShopState(useShopState());
}
