/**
 * Camera visit ingest — the write side of nickstire.org/admin's Lot section.
 *
 * `camera-bridge/visitd` owns visit truth and already persists it locally with a
 * SQLite ledger and an ordered outbox. This endpoint is the shop-side SINK for
 * that outbox: one row per visit in `vehicle_visits` (migration 0119), which the
 * Lot admin section reads. Without it the table stays empty forever and the admin
 * correctly reports "awaiting first event" indefinitely.
 *
 * Design rules, each of which exists because of a specific failure mode:
 *
 *  · **Monotonic `seq`.** visitd emits an increasing sequence per visit, and the
 *    outbox retries. A replayed or out-of-order delivery must never walk a visit
 *    backwards, so a row is updated only when the incoming `seq` is at least the
 *    stored one. Retries are therefore free, and the response says per visit
 *    whether it applied.
 *  · **Fail closed.** No shared secret configured means 401, never "allow".
 *  · **Plate text is stored only when the read is CONFIRMED.** A CANDIDATE or
 *    AMBIGUOUS string persisted to a database becomes a fact in someone's head,
 *    and a wrong plate attaches the wrong customer. The status is always kept;
 *    only the unproven text is dropped.
 *  · **Plates are never logged in the clear** — `lint:pii` cannot see log output,
 *    so redaction has to happen here.
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";

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

/** ISO-8601 or epoch seconds; null stays null. An unobserved time is NOT "now". */
const tsField = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
});

const visitSchema = z.object({
  visitId: z.string().min(1).max(64),
  camera: z.string().min(1).max(64),
  state: z.string().min(1).max(32),
  seq: z.number().int().min(0).default(0),

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

export function registerCameraVisitsRoute(app: Express): void {
  app.post("/api/camera/visits", async (req: Request, res: Response) => {
    // Prefer a dedicated edge key; fall back to the provisioned bridge key so the
    // endpoint is usable before a new secret is rolled out. Neither set = 401.
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

    const { vehicleVisits } = await import("../../drizzle/schema");
    const results: Array<{ visitId: string; applied: boolean; reason?: string }> = [];

    for (const v of parsed.data.visits) {
      try {
        const existing = await d
          .select({ seq: vehicleVisits.seq })
          .from(vehicleVisits)
          .where(eq(vehicleVisits.visitId, v.visitId))
          .limit(1);

        const row = {
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
          preexisting: v.preexisting,
          entryEvidence: v.entryEvidence ?? null,
          estimatedFields: v.estimatedFields ?? null,
          evidenceRef: v.evidenceRef ?? null,
          sourceGeneration: v.sourceGeneration ?? null,
          cameraPose: v.cameraPose ?? null,
          detectorName: v.detectorName ?? null,
          calibrationVersion: v.calibrationVersion ?? null,
        };

        if (existing.length === 0) {
          await d.insert(vehicleVisits).values(row);
          results.push({ visitId: v.visitId, applied: true });
          continue;
        }

        const storedSeq = Number(existing[0].seq ?? 0);
        if (v.seq < storedSeq) {
          // A retry or a reordered delivery. Dropping it is the correct outcome.
          results.push({ visitId: v.visitId, applied: false, reason: `stale seq ${v.seq} < ${storedSeq}` });
          continue;
        }
        await d.update(vehicleVisits).set(row).where(eq(vehicleVisits.visitId, v.visitId));
        results.push({ visitId: v.visitId, applied: true });
      } catch (err) {
        results.push({
          visitId: v.visitId,
          applied: false,
          reason: err instanceof Error ? err.message : "write failed",
        });
      }
    }

    const applied = results.filter((r) => r.applied).length;
    // Plates are masked: the route logs every call and lint:pii cannot read logs.
    console.info(
      `[camera-visits] ${applied}/${results.length} applied`,
      parsed.data.visits.map((v) => ({ visitId: v.visitId, state: v.state, plate: maskPlate(v.plateText) })),
    );

    // 207: a batch can be partially applied, and the caller needs to know which
    // rows to retry rather than resending the whole batch blindly.
    return res.status(applied === results.length ? 200 : 207).json({ applied, results });
  });
}
