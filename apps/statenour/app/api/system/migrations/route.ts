/**
 * GET /api/system/migrations · Phase Q.3 · 2026-05-18 PM ·
 * slimmed straggler-pages REST→tRPC slice (2026-05-22).
 *
 * Live migration tracker. Reads:
 *   1. Static MIGRATIONS registry (one entry per migration in
 *      docs/migrations/) · the things we said we'd do
 *   2. Scanned counts from the live source tree · the actual state
 *
 * Combining the two gives an honest "% complete" per migration.
 *
 * The registry + scanner + flag-board logic moved to
 * lib/services/migrations-tracker.ts so this route and the new
 * `system.migrationsTracker` tRPC procedure call ONE function · drift
 * impossible. This route is the thin REST shell that stays mounted.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import {
  buildMigrationsTracker,
  type MigrationsPayload,
} from "@/lib/services/migrations-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async (): Promise<MigrationsPayload> => buildMigrationsTracker(),
  { auth: "owner" },
);
