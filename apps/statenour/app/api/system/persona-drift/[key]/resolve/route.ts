/**
 * POST /api/system/persona-drift/[key]/resolve · v10.0.529.38 · Arc B F4
 *
 * Operator action surface for drift events. Body { resolution, note? }:
 *   · dismiss     · false positive · soft-deletes the row · gone
 *   · snooze      · stamps snoozeUntil = now + 7d · re-surfaces after
 *                   that window if the underlying drift hasn't resolved
 *   · acknowledge · stamps acknowledgedAt · row stays visible until it
 *                   naturally expires from the 7d window · "I saw it"
 *
 * Idempotent · re-resolving overwrites the prior resolution metadata.
 * Owner-gated · drift events are personal data.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
// Phase B.6c · the resolve wrapper moved to a shared service + the body
// schema is the SHARED validator the tRPC `system.resolvePersonaDrift`
// procedure also imports · drift impossible.
import { resolvePersonaDrift } from "@/lib/services/persona-drift";
import { personaDriftResolveSchema } from "@/lib/validators/system";

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const key = params?.key;
    if (!key || typeof key !== "string") {
      throw new ServiceError("key required", 400);
    }

    let body: import("@/lib/validators/system").PersonaDriftResolveInput;
    try {
      const json = await req.json();
      const parsed = personaDriftResolveSchema.safeParse(json);
      if (!parsed.success) throw new ServiceError("invalid_body", 400);
      body = parsed.data;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("invalid_json", 400);
    }

    // `resolvePersonaDrift` throws ServiceError(404) on a missing key —
    // apiHandler maps it to the 404 response.
    return resolvePersonaDrift({
      key,
      resolution: body.resolution,
      note: body.note,
    });
  },
  { auth: "owner" },
);
