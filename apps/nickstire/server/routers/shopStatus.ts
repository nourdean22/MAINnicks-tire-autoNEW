/**
 * Shop Status Router — Real-time bay availability and wait times
 */
import { router, publicProcedure } from "../_core/trpc";
import { getShopStatus } from "../services/shopStatus";

export const shopStatusRouter = router({
  getStatus: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("shop:status", 60, async () => await getShopStatus());
  }),

  /**
   * ShopState — the privacy-safe projection the storefront reads (bands +
   * weather risk + recommendation + evidence lines). Replaces the client-side
   * weather fetch that had been disabled since 2026-05-19. Cached 60s.
   */
  getState: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    const { getShopState } = await import("../services/shopState");
    return cached("shop:state", 60, async () => getShopState());
  }),
});
