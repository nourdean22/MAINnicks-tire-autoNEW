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
import { z } from "zod";
import {
  resolveDriftEvent,
  type DriftResolution,
} from "@/lib/brain/persona-drift-detector";

const bodySchema = z.object({
  resolution: z.enum(["dismiss", "snooze", "acknowledge"]),
  note: z.string().max(200).optional(),
});

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const key = params?.key;
    if (!key || typeof key !== "string") {
      throw new ServiceError("key required", 400);
    }

    let body: z.infer<typeof bodySchema>;
    try {
      const json = await req.json();
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) throw new ServiceError("invalid_body", 400);
      body = parsed.data;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("invalid_json", 400);
    }

    const result = await resolveDriftEvent(
      key,
      body.resolution as DriftResolution,
      body.note?.trim() || undefined,
    );
    if (!result.ok) throw new ServiceError("not_found", 404);

    return { ok: true, key, resolution: body.resolution };
  },
  { auth: "owner" },
);
