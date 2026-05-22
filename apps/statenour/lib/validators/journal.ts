/**
 * lib/validators/journal.ts · Phase TT.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC journal slice).
 *
 * The single source of truth for the journal-domain payload shapes that
 * have non-trivial structure (reflect submission · memory calibration).
 * Both the legacy REST route and the tRPC `journal` router import these
 * — the schema IS the contract, so sharing it makes client/server drift
 * structurally impossible. This is the guard against the typed-payload-
 * mismatch class (the /tasks quick-add bug, 2026-05-21): a permissive
 * `z.record()` tRPC input let a thin payload reach a stricter downstream
 * `.parse()`. Here the tRPC input and the route's `safeParseBody` parse
 * the SAME object.
 *
 * Note: the thread / convergence procedures don't need a file here —
 * their inputs are bare scalars (key · hash · name) declared inline in
 * the router, and the heavy lifting already lives in shared services
 * (journal-threads.ts · journal-convergence.ts).
 */

import { z } from "zod";

/** The four structured-reflection templates the ReflectComposer offers. */
export const reflectTemplateSchema = z.enum(["soap", "driscoll", "ssc", "aar"]);

/**
 * POST /api/ultron/reflect body · also the `journal.reflect` tRPC input.
 *
 * Per-template required-field enforcement (each template has a different
 * field set) happens inside the `createReflection` service · the schema
 * only pins the structural shape. Field values capped at 5000 chars to
 * match the legacy route verbatim.
 */
export const reflectSubmitSchema = z.object({
  template: reflectTemplateSchema,
  fields: z.record(z.string(), z.string().max(5000)),
  mood: z.string().max(64).optional(),
  askPushback: z.boolean().optional(),
  // Opt-in extraction · defaults OFF so existing operator flows are
  // unchanged. When true the reflection text also flows through
  // ingestJournal (AI extraction → task INBOX → commitments → embeddings).
  extractIntelligence: z.boolean().optional(),
});

export type ReflectSubmitInput = z.infer<typeof reflectSubmitSchema>;

/** The three rulings the operator can apply to an aging brain memory. */
export const calibrationActionSchema = z.enum(["verify", "update", "retire"]);

/**
 * PATCH /api/ultron/calibrate body · also the `journal.calibrate` tRPC
 * input. `newContent` is required at runtime for `update` only — the
 * service enforces that conditional (a thin payload from a `verify` /
 * `retire` ruling legitimately omits it).
 */
export const calibrationRulingSchema = z.object({
  id: z.string().min(1).max(64),
  action: calibrationActionSchema,
  newContent: z.string().max(5000).optional(),
});

export type CalibrationRulingInput = z.infer<typeof calibrationRulingSchema>;
