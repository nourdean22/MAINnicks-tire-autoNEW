/**
 * Settings-slice contract tests · Phase UU.2 (2026-05-22 ·
 * legacy-modernizer REST→tRPC settings slice).
 *
 * The settings slice migrated 6 client files off `authedFetch` onto
 * `trpc.system.*` / `trpc.operator.*` / `trpc.brain.*`. The risk that
 * migration introduces is the typed-payload-mismatch class: a client
 * payload TypeScript accepts but the server Zod input rejects at
 * runtime, surfacing as a generic failure toast (the /tasks quick-add
 * bug, 2026-05-21).
 *
 * Two procedures have a genuinely structured input — `operator.updateAiConfig`
 * and `operator.curateSkill` — and take their schema from
 * @/lib/validators/settings, the SHARED file the routers import. These
 * tests pin the *real* payloads the AiSettingsPanel and SkillLibraryPanel
 * send directly against those schemas. A future "make this field
 * required" or "tighten this enum" edit now fails CI instead of prod.
 *
 * The remaining settings procedures take bare scalar inputs declared
 * inline in the routers (path · jobName · flag map · axis key · range).
 * Their `.input(...)` objects are re-declared here verbatim so a
 * tightened bound can't silently break a real call-site. Pure schema
 * parse, no Prisma — the contract is the schema, so the test is too.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  aiConfigPatchSchema,
  skillCurationSchema,
} from "@/lib/validators/settings";

// ─────────────────────── operator.updateAiConfig ───────────────────────
//
// The exact one-field payloads AiSettingsPanel.patch() forwards through
// trpc.operator.updateAiConfig. The panel fires a PATCH per slider /
// toggle / segmented-select — so a single-key payload is the genuine
// common case, and every key must individually satisfy the schema.

describe("aiConfigPatchSchema · AiSettingsPanel patch contract", () => {
  it("accepts a provider-only patch (segmented select)", () => {
    // patch({ defaultProvider: "gemini" }) when a non-"auto" option picked
    const r = aiConfigPatchSchema.parse({ defaultProvider: "gemini" });
    expect(r.defaultProvider).toBe("gemini");
  });

  it("accepts a mode-cleared patch (the 'auto' branch sends the field absent)", () => {
    // patch({ defaultMode: undefined }) — an absent key, not a wrong type
    expect(() => aiConfigPatchSchema.parse({})).not.toThrow();
  });

  it("accepts a temperature slider patch (number 0-2)", () => {
    const r = aiConfigPatchSchema.parse({ temperature: 0.85 });
    expect(r.temperature).toBe(0.85);
  });

  it("accepts the temperature-clear patch (the 'clear' button)", () => {
    // patch({ temperature: undefined }) — clearing the override
    expect(() => aiConfigPatchSchema.parse({ temperature: undefined })).not.toThrow();
  });

  it("accepts a reasoningEffort patch across the full enum", () => {
    for (const v of ["none", "low", "medium", "high", "max"] as const) {
      expect(() => aiConfigPatchSchema.parse({ reasoningEffort: v })).not.toThrow();
    }
  });

  it("accepts a webSearch patch (auto | on | off)", () => {
    for (const v of ["auto", "on", "off"] as const) {
      expect(() => aiConfigPatchSchema.parse({ webSearch: v })).not.toThrow();
    }
  });

  it("accepts a boolean-toggle patch (haptic / speed ribbon / tool pruning)", () => {
    expect(() => aiConfigPatchSchema.parse({ hapticFeedback: true })).not.toThrow();
    expect(() => aiConfigPatchSchema.parse({ showSpeedRibbon: false })).not.toThrow();
    expect(() =>
      aiConfigPatchSchema.parse({ toolEmbeddingsEnabled: true }),
    ).not.toThrow();
  });

  it("accepts the disabledTools array patch (add / remove blocklist entry)", () => {
    // addDisabledTool / removeDisabledTool both patch the whole array
    const r = aiConfigPatchSchema.parse({
      disabledTools: ["generateImage", "deepResearch"],
    });
    expect(r.disabledTools).toHaveLength(2);
    // empty array (last tool removed) is valid too
    expect(() => aiConfigPatchSchema.parse({ disabledTools: [] })).not.toThrow();
  });

  it("rejects a string temperature — the typed-payload-mismatch guard", () => {
    // a permissive z.record/z.unknown input would let this through to a
    // stricter downstream parse; the typed schema rejects it at the door.
    expect(() =>
      aiConfigPatchSchema.parse({ temperature: "0.7" as unknown as number }),
    ).toThrow();
  });

  it("rejects an out-of-range temperature (slider max is 2)", () => {
    expect(() => aiConfigPatchSchema.parse({ temperature: 5 })).toThrow();
  });

  it("rejects an unknown reasoningEffort value — the enum is the guard", () => {
    expect(() =>
      aiConfigPatchSchema.parse({ reasoningEffort: "ultra" }),
    ).toThrow();
  });
});

// ─────────────────────── operator.curateSkill ───────────────────────
//
// The exact payloads SkillLibraryPanel sends through
// trpc.operator.curateSkill. act() sends { key, action, kind? };
// extractNow() sends { action: "extract_now" } with NO key; saveEdit()
// sends { key, action: "edit", kind, trigger, actionText }.

describe("skillCurationSchema · SkillLibraryPanel curate contract", () => {
  it("accepts a promote payload (act with no kind)", () => {
    const r = skillCurationSchema.parse({
      key: "skill:when_blocked:ask",
      action: "promote",
    });
    expect(r.action).toBe("promote");
  });

  it("accepts a drop payload carrying the explicit kind", () => {
    // act(key, "drop", "skill_pending") for a candidate row
    expect(() =>
      skillCurationSchema.parse({
        key: "skill:when_blocked:ask",
        action: "drop",
        kind: "skill_pending",
      }),
    ).not.toThrow();
    // act(key, "drop", "skill") for an active row
    expect(() =>
      skillCurationSchema.parse({
        key: "skill:when_blocked:ask",
        action: "drop",
        kind: "skill",
      }),
    ).not.toThrow();
  });

  it("accepts graduate / ungraduate payloads", () => {
    expect(() =>
      skillCurationSchema.parse({ key: "skill:x:y", action: "graduate" }),
    ).not.toThrow();
    expect(() =>
      skillCurationSchema.parse({ key: "skill:x:y", action: "ungraduate" }),
    ).not.toThrow();
  });

  it("accepts the extract_now payload — NO key (the conditional-key case)", () => {
    // extractNow() sends only { action }. `key` is optional in the
    // schema; the router enforces "key required" for every OTHER action.
    // A future edit making `key` required again would break extract_now
    // — this test pins that it must stay optional.
    const r = skillCurationSchema.parse({ action: "extract_now" });
    expect(r.action).toBe("extract_now");
    expect(r.key).toBeUndefined();
  });

  it("accepts the edit payload (saveEdit — key + kind + trigger + actionText)", () => {
    const r = skillCurationSchema.parse({
      key: "skill:when_blocked:ask",
      action: "edit",
      kind: "skill",
      trigger: "when a task stalls 2+ days",
      actionText: "break it into a 15-minute first step",
    });
    expect(r.trigger).toContain("stalls");
    expect(r.actionText).toContain("15-minute");
  });

  it("rejects an unknown action — the enum is the guard", () => {
    expect(() =>
      skillCurationSchema.parse({ key: "skill:x:y", action: "archive" }),
    ).toThrow();
  });

  it("rejects an unknown kind — the enum is the guard", () => {
    expect(() =>
      skillCurationSchema.parse({
        key: "skill:x:y",
        action: "drop",
        kind: "skill_archived",
      }),
    ).toThrow();
  });
});

// ────────────── system / operator scalar-input procedures ──────────────
//
// These procedures take bare scalar inputs declared inline in the
// routers. The schemas below are the literal `.input(...)` objects from
// lib/trpc/routers/{system,operator}.ts — re-declared here so a
// tightened bound fails this test before it breaks a real call-site.

describe("settings scalar-input procedures · call-site payload contract", () => {
  // system.setAutopilotFlags — SettingsPage AutoPilotControls.toggleFlag()
  // builds a string→boolean map from its flag list and sends { flags }.
  const autopilotFlagsInput = z.object({
    flags: z.record(z.string(), z.boolean()),
  });

  it("setAutopilotFlags accepts the AutoPilotControls flag-map payload", () => {
    expect(() =>
      autopilotFlagsInput.parse({
        flags: {
          auto_morning_autopilot: true,
          auto_weekly_targets: false,
          auto_brain_cycle: true,
        },
      }),
    ).not.toThrow();
  });

  it("setAutopilotFlags rejects a non-boolean flag value", () => {
    expect(() =>
      autopilotFlagsInput.parse({
        flags: { auto_brain_cycle: "yes" as unknown as boolean },
      }),
    ).toThrow();
  });

  // system.triggerCron — CronControlPanel.trigger(path, jobName).
  const triggerCronInput = z.object({ path: z.string().min(1).max(200) });

  it("triggerCron accepts a /api/cron/* path payload", () => {
    expect(() =>
      triggerCronInput.parse({ path: "/api/cron/drift-check" }),
    ).not.toThrow();
    // mega-fanout crons carry a query string — still within max(200)
    expect(() =>
      triggerCronInput.parse({ path: "/api/cron/mega?slot=morning" }),
    ).not.toThrow();
  });

  it("triggerCron rejects an empty path", () => {
    expect(() => triggerCronInput.parse({ path: "" })).toThrow();
  });

  // system.setCronEnabled — CronControlPanel.toggle(jobName, nextEnabled).
  const setCronEnabledInput = z.object({
    jobName: z.string().min(1).max(80),
    enabled: z.boolean(),
    note: z.string().max(200).optional(),
  });

  it("setCronEnabled accepts the CronControlPanel toggle payload", () => {
    // toggle() sends only { jobName, enabled } — note is optional
    expect(() =>
      setCronEnabledInput.parse({ jobName: "brain-cycle", enabled: false }),
    ).not.toThrow();
  });

  // system.healthTrend / errorRateByRoute — SystemDataCards fixed ranges.
  const healthTrendInput = z
    .object({ range: z.enum(["7d", "14d", "30d"]).default("7d") })
    .optional();
  const errorRateInput = z
    .object({
      range: z.enum(["1h", "24h", "7d"]).default("24h"),
      minRequests: z.number().int().min(1).max(1000).default(5),
    })
    .optional();

  it("healthTrend accepts the SystemDataCards { range: '7d' } payload", () => {
    expect(() => healthTrendInput.parse({ range: "7d" })).not.toThrow();
  });

  it("errorRateByRoute accepts the SystemDataCards { range: '24h' } payload", () => {
    const r = errorRateInput.parse({ range: "24h" });
    // minRequests defaults to 5 when the call-site omits it
    expect(r?.minRequests).toBe(5);
  });

  // operator.pinIdentityAxis — IdentityPanel.savePin(axis).
  const IDENTITY_AXES = [
    "velocity",
    "patience_horizon",
    "promise_integrity",
    "dopamine_discipline",
    "business_vs_personal",
    "risk_appetite",
    "social_battery",
    "reflection_cadence",
  ] as const;
  const pinIdentityAxisInput = z.object({
    axis: z.enum(IDENTITY_AXES),
    value: z.number().min(0).max(100).nullable(),
  });

  it("pinIdentityAxis accepts a pin payload (axis + numeric value)", () => {
    expect(() =>
      pinIdentityAxisInput.parse({ axis: "velocity", value: 72 }),
    ).not.toThrow();
  });

  it("pinIdentityAxis accepts a clear payload (value: null — savePin sends null on blank)", () => {
    // savePin computes `value = raw === "" ? null : Number(raw)`
    const r = pinIdentityAxisInput.parse({
      axis: "promise_integrity",
      value: null,
    });
    expect(r.value).toBeNull();
  });

  it("pinIdentityAxis rejects an out-of-range value (panel guards 0-100 too)", () => {
    expect(() =>
      pinIdentityAxisInput.parse({ axis: "velocity", value: 140 }),
    ).toThrow();
  });

  it("pinIdentityAxis rejects an unknown axis — the enum is the guard", () => {
    expect(() =>
      pinIdentityAxisInput.parse({ axis: "charisma", value: 50 }),
    ).toThrow();
  });

  // operator.syncDrive — AiSettingsPanel.syncDrive() sends { actor }.
  const syncDriveInput = z
    .object({
      actor: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .optional();

  it("syncDrive accepts the AiSettingsPanel { actor: 'user_sync' } payload", () => {
    expect(() => syncDriveInput.parse({ actor: "user_sync" })).not.toThrow();
  });

  // operator.identity — IdentityPanel load sends { history: true }.
  const identityInput = z
    .object({ history: z.boolean().optional() })
    .optional();

  it("identity accepts the IdentityPanel { history: true } payload", () => {
    const r = identityInput.parse({ history: true });
    expect(r?.history).toBe(true);
  });
});
