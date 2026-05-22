import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { getPowerSettings, type PowerSettings } from "@/lib/services/power-panel";
import { applyPowerSetting } from "@/lib/services/system-pages-b";

/**
 * GET  /api/system/power           → full settings snapshot
 * POST /api/system/power           → patch a single setting
 * POST /api/system/power/pause-all → flip every cron off (emergency stop)
 * POST /api/system/power/resume-all → flip every cron back on
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the POST patch logic (incl. the `pauseAllCrons` per-cron
 * kill-switch fan-out) moved to the shared
 * `lib/services/system-pages-b.applyPowerSetting` service · this route
 * AND the new `trpc.system.setPowerSetting` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path.
 */

const PatchSchema = z.object({
  key: z.enum([
    "quietMode",
    "providerPin",
    "strictMode",
    "dailyCostCapCents",
    "pauseAllCrons",
    "shadowMode",
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]),
  note: z.string().max(280).optional(),
});

export const GET = apiHandler(async () => {
  const settings = await getPowerSettings();
  return { settings };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts

export const POST = apiHandler(async (req) => {
  const body = PatchSchema.parse(await req.json());
  // Validate provider pin ⊆ accepted enum.
  if (body.key === "providerPin") {
    if (!["venice", "openai", "anthropic", "gemini", "auto"].includes(String(body.value))) {
      throw Object.assign(new Error("invalid providerPin"), { status: 400, code: "PROVIDER_INVALID" });
    }
  }
  if (body.key === "quietMode") {
    if (!["off", "nudges", "all"].includes(String(body.value))) {
      throw Object.assign(new Error("invalid quietMode"), { status: 400, code: "QUIET_INVALID" });
    }
  }
  return applyPowerSetting({
    key: body.key as keyof PowerSettings,
    value: body.value,
    note: body.note,
  });
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts
