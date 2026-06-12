/**
 * Feature Flags Router — Admin-only endpoints to list and toggle feature flags.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { logAdminAction } from "../services/auditTrail";

export const featureFlagsRouter = router({
  list: adminProcedure.query(async () => {
    const { getAllFlags } = await import("../services/featureFlags");
    return getAllFlags();
  }),

  toggle: adminProcedure
    .input(z.object({ key: z.string(), value: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { setFlag, FLAG_DEFINITIONS } = await import("../services/featureFlags");
        
        // Validation gate: verify the flag key is defined in FLAG_DEFINITIONS
        const isValidKey = FLAG_DEFINITIONS.some((f) => f.key === input.key);
        if (!isValidKey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unknown feature flag key: "${input.key}"`,
          });
        }

        await setFlag(input.key as any, input.value);
        // Audit the flag toggle — the #1 operator control lever (gates bulk
        // SMS, voice, auto-revenue, etc.). Records who flipped what + new
        // value. Fire-and-forget so an audit miss never blocks the toggle.
        logAdminAction({
          action: "flag.toggled",
          entityType: "feature_flag",
          entityId: input.key,
          details: `Feature flag "${input.key}" set to ${input.value}`,
          newValue: String(input.value),
          actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        }).catch(() => { /* audit must never break the toggle */ });
        return { key: input.key, value: input.value };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
});
