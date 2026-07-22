/**
 * lib/validators/settings.ts · Phase UU.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC settings slice).
 *
 * The single source of truth for the settings-domain payload shapes that
 * carry real structure. The tRPC procedures in `system` / `operator`
 * import these so a client payload that TypeScript accepts but the
 * server Zod input would reject can't slip through (the typed-payload-
 * mismatch class · the /tasks quick-add bug, 2026-05-21).
 *
 * The thin scalar inputs (jobName · path · axis key · skill action) are
 * declared inline in the routers — only the genuinely structured shapes
 * live here: the AI-config patch and the skill-curation PATCH body, both
 * of which are open-ish maps the client builds field-by-field.
 *
 * NOTE on `aiConfigPatchSchema`: every field is `.optional()` because the
 * settings panel fires a single-field PATCH per slider/toggle. The
 * `updateAiConfig` service merges the patch over the current config, so a
 * one-key payload is the genuine common case — but each key is still
 * individually typed (NOT `z.record`/`z.unknown`), which is the whole
 * point: a bad value type fails at the procedure boundary.
 */

import { z } from "zod";

// ──────────────────────────── AI config ────────────────────────────
//
// Mirrors the `AiConfig` interface in `lib/settings/ai-config.ts`. The
// PATCH is partial-by-design (panel sends one field at a time); the
// schema pins the *type* of every field so e.g. a string temperature or
// a non-enum reasoningEffort is rejected before reaching the service.

export const aiConfigPatchSchema = z
  .object({
    // The provider / mode / task-type enums mirror the `ProviderName`,
    // `ChatMode` and `TaskType` unions from lib/ai/* exactly — so the
    // inferred patch type is assignable to `Partial<AiConfig>` with no
    // cast. A drift in those source unions surfaces here as a type
    // error, which is the contract working as intended.
    defaultProvider: z
      .enum(["gemini", "ollama", "openai", "anthropic", "openrouter", "emergency"])
      .optional(),
    defaultMode: z.enum(["standard", "deep"]).optional(),
    defaultTaskType: z
      .enum([
        "fast",
        "reason",
        "deep",
        "vision",
        "embed",
        "code",
        "sql",
        "math",
        "creative",
        "summary",
        "classify",
        "extract",
      ])
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]).optional(),
    repetitionPenalty: z.number().min(1).max(2).optional(),
    minP: z.number().min(0).max(0.5).optional(),
    webSearch: z.enum(["auto", "on", "off"]).optional(),
    webScraping: z.boolean().optional(),
    disabledTools: z.array(z.string().max(120)).max(200).optional(),
    alwaysOnTools: z.array(z.string().max(120)).max(200).optional(),
    showSpeedRibbon: z.boolean().optional(),
    hapticFeedback: z.boolean().optional(),
    nightModeDim: z.boolean().optional(),
    promptCacheTtlMs: z.number().int().min(0).max(600_000).optional(),
    toolEmbeddingsEnabled: z.boolean().optional(),
    maxSystemChars: z.number().int().min(1000).max(200_000).optional(),
  })
  // The panel never PATCHes provider/mode as `undefined` over the wire;
  // when "auto" is picked it sends the field absent. `.strip()` (default)
  // keeps unknown keys out without throwing — but every key the panel
  // *can* send is enumerated above.
  .strict();

export type AiConfigPatchInput = z.infer<typeof aiConfigPatchSchema>;

// ────────────────────────── Skill curation ──────────────────────────
//
// PATCH /api/skills body. The endpoint multiplexes 6 actions over one
// body; `key` is required for all but `extract_now`, and that conditional
// is enforced inside the router/service (a thin `extract_now` payload
// legitimately omits `key`). The schema pins the structural shape so the
// action enum can't drift and the optional edit fields stay typed.

export const skillActionSchema = z.enum([
  "promote",
  "drop",
  "graduate",
  "ungraduate",
  "edit",
  "extract_now",
]);

export const skillKindSchema = z.enum(["skill", "skill_pending"]);

export const skillCurationSchema = z.object({
  action: skillActionSchema,
  key: z.string().min(1).max(200).optional(),
  kind: skillKindSchema.optional(),
  note: z.string().max(2000).optional(),
  trigger: z.string().max(2000).optional(),
  actionText: z.string().max(2000).optional(),
});

export type SkillCurationInput = z.infer<typeof skillCurationSchema>;
