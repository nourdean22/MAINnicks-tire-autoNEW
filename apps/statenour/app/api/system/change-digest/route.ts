/**
 * GET /api/system/change-digest · F2 "what changed?" digest.
 *
 * Owner-only, read-only. Crisp operational answer to "what changed since last
 * time?" — latest RECONCILIATION wave, truth scoreboard, runbook health, and an
 * HONEST deploy status (never asserts a deploy it can't verify).
 */

import { apiHandler } from "@/lib/utils/http";
import { buildSystemChangeDigest } from "@/lib/services/system-change-digest";

export const GET = apiHandler(async () => buildSystemChangeDigest(), { auth: "owner" });
