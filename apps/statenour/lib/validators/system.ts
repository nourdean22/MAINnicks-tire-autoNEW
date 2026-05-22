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

// ════════════════ Phase B.6c · ultron system-domain sub-slice ════════════════
//
// The 4 structured payload shapes the ultron/* cards send to /api/system/*.
// Each is imported by BOTH the legacy REST route AND the matching tRPC
// `system.*` procedure — the schema IS the contract, so client/server
// drift is structurally impossible. NOT permissive z.record — every
// field strictly typed (the typed-payload-mismatch guard · the /tasks
// quick-add bug, 2026-05-21).

/**
 * The 8-axis preference vector · all axes optional so the operator can
 * override one axis without touching the others (a partial patch). The
 * `.strict()` on the inner object mirrors `overrideSchema` in
 * app/api/system/preference-vector/route.ts verbatim — an unknown axis
 * key is rejected, not silently dropped.
 */
export const preferenceVectorPatchSchema = z
  .object({
    density: z.number().finite().min(-1).max(1).optional(),
    creativity: z.number().finite().min(-1).max(1).optional(),
    skepticism: z.number().finite().min(-1).max(1).optional(),
    directness: z.number().finite().min(-1).max(1).optional(),
    humor: z.number().finite().min(-1).max(1).optional(),
    jargon: z.number().finite().min(-1).max(1).optional(),
    structure: z.number().finite().min(-1).max(1).optional(),
    urgency: z.number().finite().min(-1).max(1).optional(),
  })
  .strict();

/**
 * POST /api/system/preference-vector body · also the
 * `system.savePreferenceVector` tRPC input. `reset: true` zeros every
 * axis and ignores any partial values in `vector`.
 */
export const preferenceVectorSaveSchema = z.object({
  vector: preferenceVectorPatchSchema,
  reset: z.boolean().optional(),
});

export type PreferenceVectorSaveInput = z.infer<
  typeof preferenceVectorSaveSchema
>;

/**
 * POST /api/system/persona-drift/[key]/resolve body · also the
 * `system.resolvePersonaDrift` tRPC input (minus the `key` path param,
 * which the procedure carries as a separate scalar arg). The
 * 3-resolution enum mirrors `bodySchema` in the resolve route verbatim.
 */
export const personaDriftResolveSchema = z.object({
  resolution: z.enum(["dismiss", "snooze", "acknowledge"]),
  note: z.string().max(200).optional(),
});

export type PersonaDriftResolveInput = z.infer<
  typeof personaDriftResolveSchema
>;

/**
 * POST /api/system/contradictions/[key]/resolve body · also the
 * `system.resolveContradiction` tRPC input (minus the `key` path
 * param). The 4-status enum mirrors `resolveSchema` in the resolve
 * route verbatim — "unresolved" is excluded (it would be a no-op).
 */
export const contradictionResolveSchema = z.object({
  status: z.enum(["current_wins", "old_wins", "both_valid", "dismissed"]),
  note: z.string().max(200).optional(),
});

export type ContradictionResolveInput = z.infer<
  typeof contradictionResolveSchema
>;

/**
 * POST /api/system/decision-replays/[id]/mark body · also the
 * `system.markDecisionReplay` tRPC input (minus the `id` path param).
 * `outcome` optional at THIS layer: the legacy route is dual-mode — an
 * empty body marks-as-consumed, a populated body dual-writes the
 * DecisionReplay row. The DecisionReplayCard fires both shapes, so the
 * procedure accepts both; `markDecisionReplay` decides the mode.
 */
export const decisionReplayMarkSchema = z.object({
  outcome: z.string().min(1).max(500).optional(),
  outcomeScore: z.number().int().min(-5).max(5).optional(),
  lesson: z.string().max(800).optional(),
});

export type DecisionReplayMarkInput = z.infer<
  typeof decisionReplayMarkSchema
>;
