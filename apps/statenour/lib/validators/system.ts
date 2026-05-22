/**
 * lib/validators/system.ts · Phase VV (2026-05-22 · legacy-modernizer
 * REST→tRPC system slice).
 *
 * The single source of truth for the one system-domain payload shape
 * with non-trivial structure: the anti-pattern create/update body.
 * Both the legacy REST route (app/api/system/anti-patterns/route.ts)
 * and the tRPC `system.createAntiPattern` procedure import this — the
 * schema IS the contract, so sharing it makes client/server drift
 * structurally impossible.
 *
 * This is the guard against the typed-payload-mismatch class (the
 * /tasks quick-add bug, 2026-05-21): a permissive `z.record()` tRPC
 * input let a thin payload reach a stricter downstream `.parse()`.
 * Here the tRPC `.input()` and the route's `CreateSchema.parse()` are
 * the SAME object.
 *
 * Note: every OTHER system procedure takes a bare scalar input (limit ·
 * days · key · range · entityId) declared inline in the router — no
 * file here, the inline `z.object({...})` is sufficient.
 */

import { z } from "zod";

/**
 * POST /api/system/anti-patterns body · also the
 * `system.createAntiPattern` tRPC input.
 *
 * The `key` regex is the guard the QualityLessonsView relies on — the
 * panel normalizes free text to `lowercase-hyphens` before sending, so
 * a malformed key is a client bug, not user input. Field bounds match
 * the legacy route verbatim.
 */
export const antiPatternCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  attempt: z.string().min(3).max(400),
  outcome: z.string().min(3).max(400),
  lesson: z.string().min(3).max(600),
  severity: z.enum(["info", "warn", "critical"]).default("warn"),
  domain: z
    .enum(["business", "personal", "tech", "health", "relationships", "other"])
    .default("other"),
  tags: z.array(z.string().max(40)).default([]),
});

export type AntiPatternCreateInput = z.infer<typeof antiPatternCreateSchema>;
