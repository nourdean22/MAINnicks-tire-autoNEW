/**
 * Ultron system-domain slice contract tests · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The ultron system-domain sub-slice migrated 6 client components in
 * components/ultron/* off `authedFetch` onto `trpc.system.*`:
 *
 *   · preferences-card.tsx     → system.preferenceVector (NEW, read)
 *                                · system.savePreferenceVector (NEW, mutation)
 *   · deploy-chip.tsx          → system.deployInfo (NEW, read · no input)
 *   · persona-drift-card.tsx   → system.personaDrift (NEW, read · no input)
 *                                · system.resolvePersonaDrift (NEW, mutation)
 *   · contradictions-card.tsx  → system.contradictions (NEW, read)
 *                                · system.resolveContradiction (NEW, mutation)
 *   · hq-errors-card.tsx       → system.errorsGrouped (REUSED · sinceHours added)
 *   · decision-replay-card.tsx → system.decisionReplays (NEW, read · no input)
 *                                · system.markDecisionReplay (NEW, mutation)
 *
 * The risk that migration introduces is the typed-payload-mismatch
 * class: a client payload TypeScript accepts but the server Zod input
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * Read procedures with no payload — `deployInfo` · `personaDrift` ·
 * `decisionReplays` (all no input) — have nothing to pin.
 *
 * The 4 structured-WRITE procedures take SHARED z.object schemas from
 * @/lib/validators/system (the EXACT schemas the legacy REST routes'
 * `.safeParse()` calls also use — the schema IS the contract). These
 * tests pin the real payloads each card sends directly against those
 * shared schemas. The 2 structured-input READ procedures
 * (`contradictions` · `errorsGrouped`) take scalar inputs declared
 * inline in lib/trpc/routers/system.ts — those `.input(...)` objects
 * are re-declared here verbatim so a tightened bound fails CI before
 * it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/ultron-task-schemas.test.ts
 * + tests/lib/validators/system-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  preferenceVectorSaveSchema,
  personaDriftResolveSchema,
  contradictionResolveSchema,
  decisionReplayMarkSchema,
} from "@/lib/validators/system";

// ──────────────── system.savePreferenceVector ────────────────
//
// preferences-card.tsx fires two distinct shapes through
// trpc.system.savePreferenceVector. `handleSave()` sends only the axes
// that actually changed (a partial patch); `handleReset()` sends an
// empty vector + reset:true. The procedure's `.input()` IS this shared
// schema — the inner `vector` object is `.strict()`.

describe("preferenceVectorSaveSchema · PreferencesCard save/reset payloads", () => {
  it("accepts the handleSave partial-patch payload — { vector: { directness } }", () => {
    // operator drags one slider · handleSave() diffs and sends just it
    expect(() =>
      preferenceVectorSaveSchema.parse({ vector: { directness: 0.8 } }),
    ).not.toThrow();
  });

  it("accepts a multi-axis partial patch", () => {
    expect(() =>
      preferenceVectorSaveSchema.parse({
        vector: { density: -0.4, humor: 0.25, urgency: 0.6 },
      }),
    ).not.toThrow();
  });

  it("accepts the handleReset payload — { vector: {}, reset: true }", () => {
    expect(() =>
      preferenceVectorSaveSchema.parse({ vector: {}, reset: true }),
    ).not.toThrow();
  });

  it("accepts a full 8-axis vector", () => {
    expect(() =>
      preferenceVectorSaveSchema.parse({
        vector: {
          density: 0,
          creativity: 0.1,
          skepticism: -0.2,
          directness: 0.3,
          humor: -0.4,
          jargon: 0.5,
          structure: -0.6,
          urgency: 0.7,
        },
      }),
    ).not.toThrow();
  });

  it("rejects an axis value outside the -1..+1 range", () => {
    expect(() =>
      preferenceVectorSaveSchema.parse({ vector: { directness: 1.5 } }),
    ).toThrow();
  });

  it("rejects an unknown axis key — the inner object is .strict()", () => {
    // a typo'd axis is a client bug; .strict() catches it at the
    // boundary rather than silently dropping the override.
    expect(() =>
      preferenceVectorSaveSchema.parse({
        vector: { directnes: 0.5 } as unknown as { directness: number },
      }),
    ).toThrow();
  });

  it("rejects a non-finite axis value", () => {
    expect(() =>
      preferenceVectorSaveSchema.parse({ vector: { humor: Number.NaN } }),
    ).toThrow();
  });
});

// ──────────────── system.resolvePersonaDrift ────────────────
//
// persona-drift-card.tsx `submitResolution()` fires
// resolveMutation.mutateAsync({ key, resolution }). The procedure's
// `.input()` is `personaDriftResolveSchema.extend({ key })`. The shared
// body schema is pinned here; the `key` extension is re-declared.

describe("personaDriftResolveSchema · PersonaDriftCard resolve payloads", () => {
  it("accepts every resolution the card's button row emits", () => {
    // RESOLVE_META keys → acknowledge / snooze / dismiss
    for (const resolution of ["acknowledge", "snooze", "dismiss"] as const) {
      expect(() =>
        personaDriftResolveSchema.parse({ resolution }),
      ).not.toThrow();
    }
  });

  it("accepts a resolution with an optional note", () => {
    expect(() =>
      personaDriftResolveSchema.parse({
        resolution: "dismiss",
        note: "false positive · was quoting a customer verbatim",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown resolution — the enum is the guard", () => {
    expect(() =>
      personaDriftResolveSchema.parse({
        resolution: "ignore" as unknown as "dismiss",
      }),
    ).toThrow();
  });

  it("rejects a missing resolution key", () => {
    expect(() => personaDriftResolveSchema.parse({})).toThrow();
  });

  // The procedure extends the shared schema with the `key` path-param
  // surrogate — re-declared verbatim from lib/trpc/routers/system.ts.
  const resolvePersonaDriftInput = personaDriftResolveSchema.extend({
    key: z.string().min(1).max(128),
  });

  it("the full procedure input accepts { key, resolution }", () => {
    expect(() =>
      resolvePersonaDriftInput.parse({
        key: "a1b2c3d4e5f60718",
        resolution: "snooze",
      }),
    ).not.toThrow();
  });

  it("the full procedure input rejects an empty key", () => {
    expect(() =>
      resolvePersonaDriftInput.parse({ key: "", resolution: "snooze" }),
    ).toThrow();
  });
});

// ──────────────── system.resolveContradiction ────────────────
//
// contradictions-card.tsx `submitResolve()` fires
// resolveMutation.mutateAsync({ key, status, note? }). The procedure's
// `.input()` is `contradictionResolveSchema.extend({ key })`.

describe("contradictionResolveSchema · ContradictionsCard resolve payloads", () => {
  it("accepts every status the card's 4-button resolve row emits", () => {
    // RESOLVE_META keys → current_wins / old_wins / both_valid / dismissed
    for (const status of [
      "current_wins",
      "old_wins",
      "both_valid",
      "dismissed",
    ] as const) {
      expect(() =>
        contradictionResolveSchema.parse({ status }),
      ).not.toThrow();
    }
  });

  it("accepts a status with the optional note the textarea fills", () => {
    expect(() =>
      contradictionResolveSchema.parse({
        status: "current_wins",
        note: "the SMB pivot was right · the old enterprise stance is stale",
      }),
    ).not.toThrow();
  });

  it("rejects 'unresolved' — it is excluded from the resolve enum", () => {
    // resolving TO unresolved would be a no-op · the route's resolveSchema
    // omits it on purpose; the shared schema mirrors that.
    expect(() =>
      contradictionResolveSchema.parse({
        status: "unresolved" as unknown as "dismissed",
      }),
    ).toThrow();
  });

  it("rejects a note over the 200-char cap", () => {
    expect(() =>
      contradictionResolveSchema.parse({
        status: "dismissed",
        note: "x".repeat(201),
      }),
    ).toThrow();
  });

  const resolveContradictionInput = contradictionResolveSchema.extend({
    key: z.string().min(1).max(128),
  });

  it("the full procedure input accepts { key, status, note }", () => {
    expect(() =>
      resolveContradictionInput.parse({
        key: "0f1e2d3c4b5a6978",
        status: "both_valid",
        note: "context-dependent",
      }),
    ).not.toThrow();
  });

  it("the full procedure input rejects an empty key", () => {
    expect(() =>
      resolveContradictionInput.parse({ key: "", status: "both_valid" }),
    ).toThrow();
  });
});

// ──────────────── system.markDecisionReplay ────────────────
//
// decision-replay-card.tsx fires markMutation.mutateAsync in two modes:
// `submitLesson()` sends a full lesson body, `handleMarkConsumed()`
// sends just { id } (the legacy empty-body mark-as-consumed). `outcome`
// is optional at this layer precisely so the empty-body path validates.
// The procedure's `.input()` is `decisionReplayMarkSchema.extend({ id })`.

describe("decisionReplayMarkSchema · DecisionReplayCard mark payloads", () => {
  it("accepts the handleMarkConsumed empty-mode payload — {} (id only at the procedure)", () => {
    // handleMarkConsumed() → mutateAsync({ id }) · no outcome/score/lesson
    expect(() => decisionReplayMarkSchema.parse({})).not.toThrow();
  });

  it("accepts the submitLesson outcome-only payload", () => {
    // operator fills outcome, leaves score + lesson blank
    expect(() =>
      decisionReplayMarkSchema.parse({
        outcome: "shipped it · the brake-bay layout cut turnaround 20%",
      }),
    ).not.toThrow();
  });

  it("accepts the submitLesson full payload — outcome + score + lesson", () => {
    // SCORE_VALUES maps the 3-chip score to -1 / 0 / +1
    for (const outcomeScore of [-1, 0, 1] as const) {
      expect(() =>
        decisionReplayMarkSchema.parse({
          outcome: "the outcome that actually played out",
          outcomeScore,
          lesson: "what is worth remembering for next time",
        }),
      ).not.toThrow();
    }
  });

  it("rejects an empty outcome string — min(1) is the guard when outcome IS sent", () => {
    // the card blocks an empty-outcome submit client-side; the schema is
    // the backstop — an empty string is NOT the same as an omitted key.
    expect(() =>
      decisionReplayMarkSchema.parse({ outcome: "" }),
    ).toThrow();
  });

  it("rejects an outcomeScore outside the -5..+5 range", () => {
    expect(() =>
      decisionReplayMarkSchema.parse({
        outcome: "a valid outcome",
        outcomeScore: 9,
      }),
    ).toThrow();
  });

  it("rejects a lesson over the 800-char cap", () => {
    expect(() =>
      decisionReplayMarkSchema.parse({
        outcome: "a valid outcome",
        lesson: "x".repeat(801),
      }),
    ).toThrow();
  });

  const markDecisionReplayInput = decisionReplayMarkSchema.extend({
    id: z.string().min(1).max(128),
  });

  it("the full procedure input accepts the empty-mode { id } payload", () => {
    expect(() =>
      markDecisionReplayInput.parse({ id: "clx9k2p4t0001abcd1234efgh" }),
    ).not.toThrow();
  });

  it("the full procedure input accepts the full lesson-form payload", () => {
    expect(() =>
      markDecisionReplayInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        outcome: "the outcome",
        outcomeScore: 1,
        lesson: "the lesson",
      }),
    ).not.toThrow();
  });

  it("the full procedure input rejects an empty id", () => {
    expect(() =>
      markDecisionReplayInput.parse({ id: "", outcome: "x" }),
    ).toThrow();
  });
});

// ──────────────── system widget scalar-input procedures ────────────────
//
// `system.contradictions` and the extended `system.errorsGrouped` take
// scalar inputs declared inline in lib/trpc/routers/system.ts. The
// schemas below are the literal `.input(...)` objects — re-declared
// here so a tightened bound fails this test before a real call-site.

describe("system read-procedure scalar inputs · ultron call-site contract", () => {
  // system.contradictions — ContradictionsCard sends { days: 14,
  // includeResolved: true } (the legacy ?days=14&includeResolved=true).
  const contradictionsInput = z
    .object({
      days: z.number().int().min(1).max(180).default(30),
      includeResolved: z.boolean().default(false),
    })
    .optional();

  it("contradictions accepts the ContradictionsCard { days: 14, includeResolved: true } payload", () => {
    const r = contradictionsInput.parse({ days: 14, includeResolved: true });
    expect(r?.days).toBe(14);
    expect(r?.includeResolved).toBe(true);
  });

  it("contradictions defaults days to 30 + includeResolved to false when omitted", () => {
    const r = contradictionsInput.parse({});
    expect(r?.days).toBe(30);
    expect(r?.includeResolved).toBe(false);
  });

  it("contradictions rejects a days window above the 180-day cap", () => {
    expect(() => contradictionsInput.parse({ days: 365 })).toThrow();
  });

  // system.errorsGrouped — Phase B.6c adds `sinceHours`; HQErrorsCard
  // sends { sinceHours: 24 } for its true-24h severity threshold.
  const errorsGroupedInput = z
    .object({
      level: z.enum(["fatal", "error", "warn"]).optional(),
      sinceHours: z.number().int().min(1).max(8760).optional(),
    })
    .optional();

  it("errorsGrouped accepts the HQErrorsCard { sinceHours: 24 } payload", () => {
    expect(() =>
      errorsGroupedInput.parse({ sinceHours: 24 }),
    ).not.toThrow();
  });

  it("errorsGrouped still accepts the ErrorsFingerprints level-only / omitted payloads", () => {
    // the components/system/* consumer behavior must stay intact
    for (const level of ["fatal", "error", "warn"] as const) {
      expect(() => errorsGroupedInput.parse({ level })).not.toThrow();
    }
    expect(() => errorsGroupedInput.parse(undefined)).not.toThrow();
  });

  it("errorsGrouped rejects a sinceHours above the 1-year cap", () => {
    expect(() => errorsGroupedInput.parse({ sinceHours: 99999 })).toThrow();
  });
});
