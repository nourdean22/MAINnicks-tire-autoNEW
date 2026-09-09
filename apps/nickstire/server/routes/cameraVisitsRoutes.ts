/**
 * Camera visit ingest — the write side of nickstire.org/admin's Lot section.
 *
 * `camera-bridge/visitd` owns visit truth and persists it locally with a SQLite
 * ledger and an ordered outbox. This endpoint is the shop-side SINK for that
 * outbox: one row per visit in `vehicle_visits` (migration 0119), which the Lot
 * admin section reads.
 *
 * ⚠ NO PRODUCER IS WIRED YET. `visitd/cloud_client.py` posts to
 * `{baseUrl}/api/devices/{id}/events` on its StateNour base URL, and nothing in
 * `camera-bridge/` references this route. Until visitd gains a second sink (the
 * path AND the body differ from the device-events contract), the table stays empty
 * and the Lot section correctly reports "awaiting first event". The vision lab
 * runner can already post here via `python -m vision.run_live --post-to`.
 *
 * Design rules, each for a specific failure mode:
 *
 *  · **Monotonic `seq`, enforced ATOMICALLY.** visitd emits an increasing sequence
 *    per visit and the outbox retries, so a replayed or reordered delivery must not
 *    walk a visit backwards. This is one `INSERT ... ON DUPLICATE KEY UPDATE` whose
 *    every assignment is guarded by `VALUES(seq) >= seq`. A read-then-write could
 *    not hold the invariant it claimed: two concurrent deliveries both read the old
 *    seq, and the later-arriving older one won.
 *  · **`seq` is REQUIRED.** It used to default to 0, which made the guard vacuous
 *    for any sender that omitted it — every stale full-state replay overwrote the
 *    current row.
 *  · **Fail closed.** No shared secret configured means 401, never "allow".
 *  · **A batch where nothing applied is not a success.** 207 has `res.ok === true`,
 *    so a caller using the standard idiom would mark an all-failed batch delivered
 *    and drop it.
 *  · **A malformed timestamp is a 400, not a silent null.** Coercing garbage into
 *    "not observed" is the mirror image of inventing a plausible time, and it feeds
 *    straight into the day-bucket and ordering logic downstream.
 *  · **Plate text is stored only when the read is CONFIRMED**, a `customerId` only
 *    for an EXACT match, and plates are never logged in the clear.
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { maskPlate, normalizePlate, PLATE_MATCH_CLASSES } from "../lib/plate";

/** Timing-safe, matching the sibling bridge routes. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const PLATE_STATUS = ["NONE", "UNREADABLE", "CANDIDATE", "CONFIRMED", "AMBIGUOUS"] as const;

/**
 * ISO-8601 or epoch seconds. `null` stays null — an unobserved time is NOT "now".
 * A value that is present but unparseable REJECTS rather than degrading to null.
 */
const tsField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unparseable timestamp: ${String(v)}` });
      return z.NEVER;
    }
    return d;
  });

const visitSchema = z.object({
  visitId: z.string().min(1).max(64),
  camera: z.string().min(1).max(64),
  state: z.string().min(1).max(32),
  /** REQUIRED. A default made the monotonicity guard a no-op. */
  seq: z.number().int().min(0),

  arrivedAt: tsField,
  waitStartedAt: tsField,
  bayEnteredAt: tsField,
  bayExitedAt: tsField,
  departedAt: tsField,
  bay: z.string().max(32).nullish(),

  plateText: z.string().max(16).nullish(),
  plateStatus: z.enum(PLATE_STATUS).default("NONE"),
  customerMatch: z.enum(PLATE_MATCH_CLASSES).default("NONE"),
  customerId: z.number().int().nullish(),

  preexisting: z.boolean().default(false),
  entryEvidence: z.string().max(191).nullish(),
  estimatedFields: z.array(z.string()).nullish(),
  evidenceRef: z.string().max(255).nullish(),
  sourceGeneration: z.string().max(64).nullish(),
  cameraPose: z.string().max(64).nullish(),
  detectorName: z.string().max(128).nullish(),
  calibrationVersion: z.string().max(32).nullish(),
});

const bodySchema = z.object({
  visits: z.array(visitSchema).min(1).max(100),
});

/** Only a CONFIRMED read is durable. Everything else keeps its status, loses its text. */
export function plateTextToStore(
  plateStatus: string,
  plateText: string | null | undefined,
): string | null {
  if (plateStatus !== "CONFIRMED") return null;
  const n = normalizePlate(plateText);
  return n || null;
}

/** Columns written on insert, in order. `seq` leads so the guard reads naturally. */
export const COLUMNS = [
  "visitId", "camera", "state", "seq",
  "arrivedAt", "waitStartedAt", "bayEnteredAt", "bayExitedAt", "departedAt", "bay",
  "plateText", "plateStatus", "customerMatch", "customerId",
  "preexisting", "entryEvidence", "estimatedFields", "evidenceRef",
  "sourceGeneration", "cameraPose", "detectorName", "calibrationVersion",
] as const;

/** Every column updates only when the incoming seq is at least the stored one. */
export const GUARDED_SET = COLUMNS.filter((c) => c !== "visitId")
  .map((c) => `\`${c}\` = IF(VALUES(\`seq\`) >= \`seq\`, VALUES(\`${c}\`), \`${c}\`)`)
  .join(", ");

export function registerCameraVisitsRoute(app: Express): void {
  app.post("/api/camera/visits", async (req: Request, res: Response) => {
    // Prefer a dedicated edge key. The StateNour bridge key remains a fallback so the
    // endpoint is usable before a new secret is rolled out, but it widens what that key
    // authorizes — provision CAMERA_INGEST_KEY and the fallback stops being used.
    const key = process.env.CAMERA_INGEST_KEY || process.env.STATENOUR_SYNC_KEY || "";
    const provided = (req.headers["x-sync-key"] as string) || "";
    if (!key || !provided || !safeCompare(provided, key)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", issues: parsed.error.issues.slice(0, 8) });
    }

    const { getDbTyped } = await import("../db");
    const d = await getDbTyped();
    if (!d) return res.status(503).json({ error: "database unavailable" });

    type Outcome = "applied" | "stale" | "failed";
    const results: Array<{ visitId: string; outcome: Outcome; reason?: string }> = [];

    for (const v of parsed.data.visits) {
      const values: Record<string, unknown> = {
        visitId: v.visitId,
        camera: v.camera,
        state: v.state,
        seq: v.seq,
        arrivedAt: v.arrivedAt ?? null,
        waitStartedAt: v.waitStartedAt ?? null,
        bayEnteredAt: v.bayEnteredAt ?? null,
        bayExitedAt: v.bayExitedAt ?? null,
        departedAt: v.departedAt ?? null,
        bay: v.bay ?? null,
        plateText: plateTextToStore(v.plateStatus, v.plateText),
        plateStatus: v.plateStatus,
        customerMatch: v.customerMatch,
        // Only an EXACT match may carry a customer id into the read model.
        customerId: v.customerMatch === "EXACT" ? (v.customerId ?? null) : null,
        preexisting: v.preexisting ? 1 : 0,
        entryEvidence: v.entryEvidence ?? null,
        estimatedFields: v.estimatedFields ? JSON.stringify(v.estimatedFields) : null,
        evidenceRef: v.evidenceRef ?? null,
        sourceGeneration: v.sourceGeneration ?? null,
        cameraPose: v.cameraPose ?? null,
        detectorName: v.detectorName ?? null,
        calibrationVersion: v.calibrationVersion ?? null,
      };

      try {
        const placeholders = COLUMNS.map((c) => sql`${values[c]}`);
        const result = await d.execute(sql`
          INSERT INTO vehicle_visits (${sql.raw(COLUMNS.map((c) => `\`${c}\``).join(", "))})
          VALUES (${sql.join(placeholders, sql`, `)})
          ON DUPLICATE KEY UPDATE ${sql.raw(GUARDED_SET)}
        `);
        // mysql2 affectedRows: 1 = inserted, 2 = updated, 0 = matched but nothing changed.
        // A guarded no-op (stale delivery) and an identical re-delivery both land on 0,
        // which is the correct outcome for each: the row already reflects the newer state.
        const info = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
        const affected = Number(info?.affectedRows ?? 0);
        results.push({
          visitId: v.visitId,
          outcome: affected === 0 ? "stale" : "applied",
          ...(affected === 0 ? { reason: `seq ${v.seq} not newer than the stored row` } : {}),
        });
      } catch (err) {
        results.push({
          visitId: v.visitId,
          outcome: "failed",
          reason: err instanceof Error ? err.message : "write failed",
        });
      }
    }

    const applied = results.filter((r) => r.outcome === "applied").length;
    const failed = results.filter((r) => r.outcome === "failed").length;

    // Plates are masked: this logs every call and lint:pii cannot read log output.
    console.info(
      `[camera-visits] ${applied} applied, ${results.length - applied - failed} stale, ${failed} failed`,
      parsed.data.visits.map((v) => ({ visitId: v.visitId, state: v.state, plate: maskPlate(v.plateText) })),
    );

    // A batch in which EVERY write failed is a server-side failure, not a partial
    // success. 207 carries res.ok === true, so returning it here would let a caller
    // mark the batch delivered and drop it — silent loss on the fail-loudly path.
    if (failed === results.length) {
      return res.status(502).json({ error: "every write failed", applied: 0, results });
    }
    return res.status(failed === 0 ? 200 : 207).json({ applied, failed, results });
  });
}
