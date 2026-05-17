/**
 * GET /api/audit/entity?type=<entityType>&id=<entityId>
 *
 * v8.0 · Apr 29 · Phase 2A — Universal entity-audit API.
 *
 * Returns the field-level provenance log for a single entity, newest
 * first. Drives:
 *   · Admin "history" tab on Mission / Task / Goal / BrainMemory
 *   · "Who changed this?" inline tooltip
 *   · Brain layer's "what did Nick do this week?" mining
 *
 * Query params:
 *   type     — required. Entity type (lowerCamel Prisma model key).
 *              Examples: task, mission, lifeGoal, brainMemory.
 *   id       — required. Entity id.
 *   limit    — optional. 1-500, defaults to 50.
 *   offset   — optional. Pagination skip; defaults to 0.
 *   actor    — optional. Filter by actor string ("nick", "user",
 *              "cron:weekly-review", etc).
 *   action   — optional. Filter by action: created | updated |
 *              soft_deleted | restored | purged.
 *   since    — optional. ISO datetime; only return entries after this.
 *   firehose — optional. When set with `actor` (no entityId), returns
 *              recent activity by that actor across all entities.
 *
 * Response shape:
 *   { count, entries: AuditEntry[] }
 *
 * Auth: v9.1.14 · `auth: "owner"` enforced. The earlier "open inside
 * the trusted perimeter" comment was misleading — the perimeter is
 * the network boundary, not a NextAuth gate, and the perimeter has
 * cracks (middleware bypasses for specific prefixes). This route
 * returns the entity-audit firehose (every write across the OS) so
 * defense-in-depth at the route level is mandatory.
 */

import { apiHandler } from "@/lib/utils/http";
import {
  getEntityHistory,
  getActorActivity,
  getGlobalActivity,
  type AuditAction,
} from "@/lib/db/entity-audit";

const ALLOWED_ACTIONS: ReadonlyArray<AuditAction> = [
  "created",
  "updated",
  "soft_deleted",
  "restored",
  "purged",
];

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || undefined;
  const id = url.searchParams.get("id") || undefined;
  const actor = url.searchParams.get("actor") || undefined;
  const actionRaw = url.searchParams.get("action") || undefined;
  const sinceRaw = url.searchParams.get("since") || undefined;
  const limit = Number(url.searchParams.get("limit")) || 50;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const firehose = url.searchParams.get("firehose") === "1";

  const action: AuditAction | undefined =
    actionRaw && (ALLOWED_ACTIONS as readonly string[]).includes(actionRaw)
      ? (actionRaw as AuditAction)
      : undefined;

  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (since && isNaN(since.getTime())) {
    throw Object.assign(new Error("since must be a valid ISO datetime"), {
      status: 400,
      code: "BAD_SINCE",
    });
  }

  // Mode 1: firehose. With ?actor, scoped to that actor. Without
  // (?firehose=1 alone), returns the global activity stream — drives
  // /brain/continuity's "what's happening across the system" surface.
  if (firehose) {
    const entries = actor
      ? await getActorActivity(actor, { limit, since })
      : await getGlobalActivity({ limit, since });
    return { count: entries.length, entries, mode: actor ? "actor-firehose" : "global-firehose" };
  }

  // Mode 2: per-entity history (the default).
  if (!type || !id) {
    throw Object.assign(new Error("type and id query params required"), {
      status: 400,
      code: "TYPE_ID_REQUIRED",
    });
  }

  const entries = await getEntityHistory(type, id, {
    limit,
    offset,
    actor,
    action,
    since,
  });

  return { count: entries.length, entries, mode: "entity" };
}, { auth: "owner" }); // v9.1.14 · was open. Entity-audit firehose contains EVERY write across the OS — operator-private.
