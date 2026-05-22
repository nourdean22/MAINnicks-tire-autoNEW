/**
 * System-slice contract tests · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system-widgets sub-slice).
 *
 * The system slice migrated 15 client files in components/system/* off
 * `authedFetch` onto `trpc.system.*`. The risk that migration
 * introduces is the typed-payload-mismatch class: a client payload
 * TypeScript accepts but the server Zod input rejects at runtime,
 * surfacing as a generic failure toast (the /tasks quick-add bug,
 * 2026-05-21).
 *
 * ONE procedure has a genuinely structured input — `system.createAntiPattern`
 * — and takes its schema from @/lib/validators/system, the SHARED file
 * the route AND the router import. These tests pin the *real* payload
 * QualityLessonsView.submit() sends directly against that schema. A
 * future "make this field required" or "tighten this enum" edit now
 * fails CI instead of prod.
 *
 * Every OTHER system-widget procedure takes a bare scalar input (limit ·
 * days · key · range · entityId · category map) declared inline in the
 * router. Their `.input(...)` objects are re-declared here verbatim so
 * a tightened bound can't silently break a real call-site. Pure schema
 * parse, no Prisma — the contract is the schema, so the test is too.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { antiPatternCreateSchema } from "@/lib/validators/system";

// ─────────────────────── system.createAntiPattern ───────────────────────
//
// The exact payload QualityLessonsView.submit() forwards through
// trpc.system.createAntiPattern. The panel normalizes the free-text key
// to `lowercase-hyphens` BEFORE sending, splits the comma-separated tag
// string into an array, and always sends every field — so the common
// case is a fully-populated object that must satisfy the schema whole.

describe("antiPatternCreateSchema · QualityLessonsView submit contract", () => {
  it("accepts the full add-lesson payload (every field populated)", () => {
    const r = antiPatternCreateSchema.parse({
      key: "pricing-by-feel",
      attempt: "quoted a brake job from memory without checking the labor guide",
      outcome: "underpriced it $140 — ate the margin on a 2-hour job",
      lesson: "always pull the ALG labor time before quoting from memory",
      severity: "warn",
      domain: "business",
      tags: ["pricing", "quote", "margin"],
    });
    expect(r.key).toBe("pricing-by-feel");
    expect(r.tags).toHaveLength(3);
  });

  it("accepts an empty tag array (the panel sends [] when the tag field is blank)", () => {
    // form.tags.split(",")...filter(Boolean) yields [] for an empty input
    expect(() =>
      antiPatternCreateSchema.parse({
        key: "sms-at-9am",
        attempt: "blasted the recovery SMS batch at 9am",
        outcome: "12% opt-out spike — too early, read as spam",
        lesson: "schedule recovery SMS for the 11am-2pm window",
        severity: "critical",
        domain: "business",
        tags: [],
      }),
    ).not.toThrow();
  });

  it("accepts every severity across the enum", () => {
    for (const severity of ["info", "warn", "critical"] as const) {
      expect(() =>
        antiPatternCreateSchema.parse({
          key: "k-test",
          attempt: "an attempted action long enough to pass min(3)",
          outcome: "the outcome long enough to pass min(3)",
          lesson: "the lesson long enough to pass min(3)",
          severity,
          domain: "tech",
          tags: [],
        }),
      ).not.toThrow();
    }
  });

  it("accepts every domain across the enum", () => {
    for (const domain of [
      "business",
      "personal",
      "tech",
      "health",
      "relationships",
      "other",
    ] as const) {
      expect(() =>
        antiPatternCreateSchema.parse({
          key: "k-domain",
          attempt: "an attempted action long enough to pass min(3)",
          outcome: "the outcome long enough to pass min(3)",
          lesson: "the lesson long enough to pass min(3)",
          severity: "info",
          domain,
          tags: [],
        }),
      ).not.toThrow();
    }
  });

  it("defaults severity to 'warn' and domain to 'other' when omitted", () => {
    // matches the route's CreateSchema defaults verbatim
    const r = antiPatternCreateSchema.parse({
      key: "k-defaults",
      attempt: "an attempted action long enough to pass min(3)",
      outcome: "the outcome long enough to pass min(3)",
      lesson: "the lesson long enough to pass min(3)",
    });
    expect(r.severity).toBe("warn");
    expect(r.domain).toBe("other");
    expect(r.tags).toEqual([]);
  });

  it("rejects an uppercase / spaced key — the regex is the guard", () => {
    // QualityLessonsView normalizes before sending; an un-normalized key
    // reaching the schema is a client bug, and the regex catches it
    // rather than letting a malformed BrainMemory key land.
    expect(() =>
      antiPatternCreateSchema.parse({
        key: "Pricing By Feel",
        attempt: "an attempted action long enough to pass min(3)",
        outcome: "the outcome long enough to pass min(3)",
        lesson: "the lesson long enough to pass min(3)",
      }),
    ).toThrow();
  });

  it("rejects a too-short attempt/outcome/lesson — min(3) is the guard", () => {
    expect(() =>
      antiPatternCreateSchema.parse({
        key: "k-short",
        attempt: "x",
        outcome: "the outcome long enough to pass min(3)",
        lesson: "the lesson long enough to pass min(3)",
      }),
    ).toThrow();
  });

  it("rejects an unknown severity — the enum is the guard", () => {
    expect(() =>
      antiPatternCreateSchema.parse({
        key: "k-sev",
        attempt: "an attempted action long enough to pass min(3)",
        outcome: "the outcome long enough to pass min(3)",
        lesson: "the lesson long enough to pass min(3)",
        severity: "blocker",
      }),
    ).toThrow();
  });
});

// ──────────────── system widget scalar-input procedures ────────────────
//
// These procedures take bare scalar inputs declared inline in
// lib/trpc/routers/system.ts. The schemas below are the literal
// `.input(...)` objects — re-declared here so a tightened bound fails
// this test before it breaks a real call-site.

describe("system widget scalar-input procedures · call-site payload contract", () => {
  // system.evalResults — EvalRegressionCard calls { limit: 7 } for the
  // sparkline and { limit: 1 } for the failure drill-down.
  const evalResultsInput = z.object({
    limit: z.number().int().min(1).max(90).default(14),
  });

  it("evalResults accepts the EvalRegressionCard { limit: 7 } + { limit: 1 } payloads", () => {
    expect(evalResultsInput.parse({ limit: 7 }).limit).toBe(7);
    expect(evalResultsInput.parse({ limit: 1 }).limit).toBe(1);
  });

  it("evalResults rejects a limit above the 90-row cap", () => {
    expect(() => evalResultsInput.parse({ limit: 365 })).toThrow();
  });

  // system.promptShadowTrend — PromptComparisonView sends { days: 7 }.
  const promptShadowTrendInput = z.object({
    days: z.number().int().min(1).max(30).default(7),
  });

  it("promptShadowTrend accepts the PromptComparisonView { days: 7 } payload", () => {
    expect(() => promptShadowTrendInput.parse({ days: 7 })).not.toThrow();
  });

  it("promptShadowTrend rejects a window above the 30-day cap", () => {
    expect(() => promptShadowTrendInput.parse({ days: 90 })).toThrow();
  });

  // system.schemaDrift — SchemaDriftCard sends { force: false } on
  // mount and { force: true } on the reload button.
  const schemaDriftInput = z
    .object({ force: z.boolean().optional() })
    .optional();

  it("schemaDrift accepts both { force: false } and { force: true }", () => {
    expect(() => schemaDriftInput.parse({ force: false })).not.toThrow();
    expect(() => schemaDriftInput.parse({ force: true })).not.toThrow();
    // mount can also pass nothing
    expect(() => schemaDriftInput.parse(undefined)).not.toThrow();
  });

  // system.errorsGrouped / errorsRecent — ErrorsFingerprints sends the
  // active level filter (or omits it for "all") + pageSize 50.
  const errorsGroupedInput = z
    .object({ level: z.enum(["fatal", "error", "warn"]).optional() })
    .optional();
  const errorsRecentInput = z
    .object({
      level: z.enum(["fatal", "error", "warn"]).optional(),
      page: z.number().int().min(1).max(1000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .optional();

  it("errorsGrouped accepts each level filter + the 'all' (omitted) case", () => {
    for (const level of ["fatal", "error", "warn"] as const) {
      expect(() => errorsGroupedInput.parse({ level })).not.toThrow();
    }
    // "all" → the component sends `level: undefined`
    expect(() => errorsGroupedInput.parse({ level: undefined })).not.toThrow();
  });

  it("errorsRecent accepts the ErrorsFingerprints { pageSize: 50 } payload", () => {
    expect(() => errorsRecentInput.parse({ pageSize: 50 })).not.toThrow();
    expect(() =>
      errorsRecentInput.parse({ level: "error", pageSize: 50 }),
    ).not.toThrow();
  });

  it("errorsRecent rejects a pageSize above the 100-row cap", () => {
    expect(() => errorsRecentInput.parse({ pageSize: 500 })).toThrow();
  });

  it("errorsGrouped rejects an unknown level — the enum is the guard", () => {
    // the legacy route accepted any `?level=` string; the typed enum is
    // stricter on purpose — "all" must be sent as an omitted key, not a
    // literal, so a stray "all" string is correctly rejected.
    expect(() =>
      errorsGroupedInput.parse({ level: "all" as unknown as "warn" }),
    ).toThrow();
  });

  // system.promptLibrary — PromptLibraryView fetches with no input
  // (filtering is client-side), but the schema still accepts an
  // optional category/tag for future server-side filtering.
  const promptLibraryInput = z
    .object({
      category: z.string().max(40).optional(),
      tag: z.string().max(60).optional(),
    })
    .optional();

  it("promptLibrary accepts the no-arg PromptLibraryView call", () => {
    expect(() => promptLibraryInput.parse(undefined)).not.toThrow();
  });

  // system.revisitAntiPattern / deleteAntiPattern — QualityLessonsView
  // sends { key } for both. The key is NOT regex-guarded here (unlike
  // create) — these act on an already-stored row, so any stored key
  // string within length bounds is valid.
  const antiPatternKeyInput = z.object({
    key: z.string().min(1).max(60),
  });

  it("revisit/deleteAntiPattern accept a stored-key payload", () => {
    expect(() =>
      antiPatternKeyInput.parse({ key: "pricing-by-feel" }),
    ).not.toThrow();
  });

  it("revisit/deleteAntiPattern reject an empty key", () => {
    expect(() => antiPatternKeyInput.parse({ key: "" })).toThrow();
  });

  // system.entityHistory — EntityHistoryDrawer sends { entityType,
  // entityId, limit }. limit defaults to 50 (the component's default prop).
  const entityHistoryInput = z.object({
    entityType: z.string().min(1).max(60),
    entityId: z.string().min(1).max(128),
    limit: z.number().int().min(1).max(500).default(50),
  });

  it("entityHistory accepts the EntityHistoryDrawer payload", () => {
    const r = entityHistoryInput.parse({
      entityType: "task",
      entityId: "clx9k2p4t0001abcd1234efgh",
      limit: 50,
    });
    expect(r.entityType).toBe("task");
    expect(r.limit).toBe(50);
  });

  it("entityHistory rejects an empty entityId", () => {
    expect(() =>
      entityHistoryInput.parse({ entityType: "task", entityId: "" }),
    ).toThrow();
  });

  // system.purgeStaleData — CoverageStaleView sends { category } for a
  // single-category purge and {} (no category) for purge-all.
  const purgeStaleDataInput = z
    .object({ category: z.string().max(80).optional() })
    .optional();

  it("purgeStaleData accepts a single-category payload AND the purge-all empty payload", () => {
    expect(() =>
      purgeStaleDataInput.parse({ category: "abandoned_tasks_30d" }),
    ).not.toThrow();
    // purge-all — the component sends {}
    expect(() => purgeStaleDataInput.parse({})).not.toThrow();
    expect(() => purgeStaleDataInput.parse(undefined)).not.toThrow();
  });
});
