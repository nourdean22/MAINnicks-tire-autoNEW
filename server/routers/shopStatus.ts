/**
 * Shop Status Router — Real-time bay availability and wait times
 */
import { router, publicProcedure } from "../_core/trpc";
import { getShopStatus } from "../services/shopStatus";

export const shopStatusRouter = router({
  getStatus: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("shop:status", 60, async () => getShopStatus());
  }),
});
