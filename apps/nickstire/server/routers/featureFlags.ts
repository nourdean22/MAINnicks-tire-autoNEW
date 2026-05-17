/**
 * Feature Flags Router — Admin-only endpoints to list and toggle feature flags.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";

export const featureFlagsRouter = router({
  list: adminProcedure.query(async () => {
    const { getAllFlags } = await import("../services/featureFlags");
    return getAllFlags();
  }),

  toggle: adminProcedure
    .input(z.object({ key: z.string(), value: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const { setFlag } = await import("../services/featureFlags");
        await setFlag(input.key as any, input.value);
        return { key: input.key, value: input.value };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
});
