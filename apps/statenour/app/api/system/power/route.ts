import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { getPowerSettings, setPowerSetting, type PowerSettings } from "@/lib/services/power-panel";
import { setCronEnabled } from "@/lib/services/cron-control";
import { CRONS } from "@/config/crons";

/**
 * GET  /api/system/power           → full settings snapshot
 * POST /api/system/power           → patch a single setting
 * POST /api/system/power/pause-all → flip every cron off (emergency stop)
 * POST /api/system/power/resume-all → flip every cron back on
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
  // pauseAllCrons is a pseudo-setting — also fans out to per-cron kill switches
  // so the existing /system/crons respects it too.
  if (body.key === "pauseAllCrons") {
    const enable = !body.value;
    await Promise.all(
      CRONS.filter((c) => c.mode === "active").map((c) =>
        setCronEnabled(c.name, enable, "bulk via /system/power"),
      ),
    );
  }
  await setPowerSetting(body.key as keyof PowerSettings, body.value as never, body.note);
  const settings = await getPowerSettings();
  return { settings };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts