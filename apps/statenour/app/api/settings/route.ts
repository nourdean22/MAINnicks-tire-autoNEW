import { apiHandler } from "@/lib/utils/http";
import { getAllSettings, setSetting } from "@/lib/services/settings";

// v10.0.44 — auth: "owner" added. Pre-fix bare apiHandler() with no
// auth option meant GET leaked all system settings + PATCH could
// bulk-update any setting. apiHandler defaults to no auth — the
// option is opt-in. CRITICAL privacy hole flagged in v10.0.44 audit.

/** GET /api/settings — All settings grouped by category */
export const GET = apiHandler(async () => {
  return getAllSettings();
}, { auth: "owner" });

/** PATCH /api/settings — Bulk update settings { "key": value, ... } */
export const PATCH = apiHandler(async (req) => {
  const body = await req.json();
  const updates: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    // Determine category from key prefix (ai.xxx → ai, ui.xxx → ui)
    const category = key.split(".")[0] || "system";
    await setSetting(key, value, category);
    updates.push(key);
  }

  return { updated: updates };
}, { auth: "owner" });
