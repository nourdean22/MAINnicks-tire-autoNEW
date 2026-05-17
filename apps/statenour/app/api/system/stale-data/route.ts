/**
 * GET /api/system/stale-data  ·  owner-auth
 *
 * Scans for "looks-live-but-is-actually-stale" rows across the system:
 *   · Unresolved drift alerts older than 14 days
 *   · Autonomous actions pending > 7 days
 *   · Skill candidates stuck > 30 days
 *   · Contradictions unresolved > 60 days
 *   · Tasks abandoned > 30 days (still READY/DOING)
 *   · Orphan 1-message conversations (X-Conversation-Id bug fallout)
 *   · Decisions past review with no outcome
 *   · DeviceEvent rows older than 180 days
 *
 * Returns per-category counts, example rows, and a purgeAction string
 * describing exactly what the companion POST endpoint will do. No
 * writes — safe to hit on every /system page load.
 */

import { apiHandler } from "@/lib/utils/http";
import { scanStaleData } from "@/lib/system/stale-data-scanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiHandler(
  async () => scanStaleData(),
  { auth: "owner" },
);
