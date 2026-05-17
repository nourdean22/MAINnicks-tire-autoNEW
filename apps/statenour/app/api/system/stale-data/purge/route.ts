/**
 * POST /api/system/stale-data/purge  ·  owner-auth
 *
 * Body: { category?: StaleCategoryId }
 *   · Omit `category` → purges EVERY category (big red button)
 *   · With `category` → purges only that one
 *
 * Returns per-category purge results with a row count + human-readable
 * note explaining what each purge actually did. See
 * lib/system/stale-data-purger.ts for the exact per-category behavior
 * (resolved vs deleted vs archived — varies by category so history
 * isn't irreversibly lost).
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  purgeStaleCategory,
  purgeAllStale,
} from "@/lib/system/stale-data-purger";
import type { StaleCategoryId } from "@/lib/system/stale-data-scanner";

const KNOWN: ReadonlySet<StaleCategoryId> = new Set<StaleCategoryId>([
  "drift_alerts_unresolved_14d",
  "pending_actions_7d",
  "skill_candidates_30d",
  "open_contradictions_60d",
  "abandoned_tasks_30d",
  "orphan_conversations",
  "overdue_decisions_reviews",
  "ancient_device_events",
]);

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as {
      category?: string;
    };

    if (body.category) {
      if (!KNOWN.has(body.category as StaleCategoryId)) {
        throw new ServiceError(
          `Unknown category: ${body.category}. Valid: ${[...KNOWN].join(", ")}`,
          400,
        );
      }
      const result = await purgeStaleCategory(body.category as StaleCategoryId);
      return { ok: true, mode: "single", result };
    }

    const all = await purgeAllStale();
    return { ok: true, mode: "all", ...all };
  },
  { auth: "owner" },
);
