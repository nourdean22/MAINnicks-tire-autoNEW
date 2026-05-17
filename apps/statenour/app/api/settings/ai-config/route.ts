/**
 * GET / PATCH / DELETE /api/settings/ai-config
 *
 * The HTTP surface for the global AI configuration. Backs the Settings
 * page sliders and toggles, and is also consumed by the Nick chat
 * control bar for live mutation.
 *
 * GET    — returns the current config (merged with defaults)
 * PATCH  — applies a partial update, returns the new merged config
 * DELETE — resets to defaults (used by the "Reset to Nick's tuning" btn)
 */

import {
  getAiConfig,
  updateAiConfig,
  resetAiConfig,
  type AiConfig,
} from "@/lib/settings/ai-config";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

// v10.0.44 — auth gate added to GET to match PATCH/DELETE gating.
// Pre-fix the full AI configuration (model preferences, temperature,
// context settings) was readable unauthed.
export async function GET(req: Request) {
  await requireSession(req);
  try {
    const config = await getAiConfig();
    return Response.json(config);
  } catch (err) {
    recordError("api:unknown", err, { route: "ai-config:get" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as Partial<AiConfig>;
    const updated = await updateAiConfig(body, "settings_ui");
    return Response.json(updated);
  } catch (err) {
    recordError("api:unknown", err, { route: "ai-config:patch" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  await requireSession(req);
  try {
    const reset = await resetAiConfig("settings_ui");
    return Response.json(reset);
  } catch (err) {
    recordError("api:unknown", err, { route: "ai-config:reset" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
