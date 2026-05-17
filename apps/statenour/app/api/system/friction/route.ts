// /api/system/friction — friction summary for /system/friction page.
//
// v7 · BATCH 5 · Apr 28. Reads brain_memory category=friction over the
// last 30d, returns aggregate + top recurring patterns.
//
// v10.0.529.106 · Wave 79 · migrated to apiHandler. No external fetch
// consumers · returning unwrapped data lets the envelope wrap cleanly.

import { apiHandler } from "@/lib/utils/http";
import { summarizeFriction } from "@/lib/personal/friction-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(180, Number(searchParams.get("days") ?? "30")));
    const summary = await summarizeFriction(days);
    return { ok: true, window: { days }, ...summary };
  },
  { auth: "owner" },
);
