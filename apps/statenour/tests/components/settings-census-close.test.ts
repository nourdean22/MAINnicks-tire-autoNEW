/**
 * tests/components/settings-census-close.test.ts · 2026-10-02
 *
 * The settings census's "not done here" list, closed. Behaviour where it can
 * be exercised (the "auto" mapping, the REST twin's validation), source pins
 * where the defect was copy or a duplicated constant.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const { updateAiConfig } = vi.hoisted(() => ({ updateAiConfig: vi.fn() }));
vi.mock("@/lib/settings/ai-config", () => ({
  getAiConfig: vi.fn(),
  updateAiConfig,
  resetAiConfig: vi.fn(),
}));
vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn().mockResolvedValue({ id: "op" }) }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { aiConfigPatchToConfig } from "@/lib/validators/settings";
import { JOURNAL_SETTING_BOUNDS } from "@/lib/validators/journal";
import { PATCH } from "@/app/api/settings/ai-config/route";

beforeEach(() => {
  updateAiConfig.mockReset();
  updateAiConfig.mockImplementation(async (patch: unknown) => patch);
});

describe("Default Mode 'auto' is reachable (finding 2)", () => {
  it("null becomes a PRESENT undefined key, so the merge overwrites the stored mode", () => {
    const out = aiConfigPatchToConfig({ defaultMode: null });
    expect(Object.prototype.hasOwnProperty.call(out, "defaultMode")).toBe(true);
    expect(out.defaultMode).toBeUndefined();
    expect({ ...{ defaultMode: "deep" as const }, ...out }.defaultMode).toBeUndefined();
  });

  it("an absent key leaves the stored mode alone; a real mode passes through", () => {
    expect(Object.prototype.hasOwnProperty.call(aiConfigPatchToConfig({ temperature: 1 }), "defaultMode")).toBe(false);
    expect(aiConfigPatchToConfig({ defaultMode: "standard" }).defaultMode).toBe("standard");
  });

  it("the panel sends null for auto, not undefined", () => {
    const panel = read("components/settings/ai-settings-panel.tsx");
    expect(panel).toContain('defaultMode: v === "auto" ? null : (v as "standard" | "deep")');
    expect(panel).not.toContain('v === "auto" ? undefined');
  });
});

describe("the REST twin takes only what the tRPC mutation takes", () => {
  const req = (body: unknown) =>
    new Request("http://x/api/settings/ai-config", { method: "PATCH", body: JSON.stringify(body) });

  it("rejects an unknown key and a wrong type with 400 and writes nothing", async () => {
    expect((await PATCH(req({ evilKey: 1 }))).status).toBe(400);
    expect((await PATCH(req({ temperature: "hot" }))).status).toBe(400);
    expect(updateAiConfig).not.toHaveBeenCalled();
  });

  it("applies a valid patch through the same 'auto' mapping", async () => {
    const res = await PATCH(req({ defaultMode: null }));
    expect(res.status).toBe(200);
    const patch = updateAiConfig.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(patch, "defaultMode")).toBe(true);
    expect(patch.defaultMode).toBeUndefined();
  });
});

describe("Journal sliders and the server share one set of bounds", () => {
  it("the server's floors are the ones the census found the sliders violating", () => {
    expect(JOURNAL_SETTING_BOUNDS.baselineXp.min).toBe(0.1);
    expect(JOURNAL_SETTING_BOUNDS.groundedXpMultiplier.min).toBe(1);
  });

  it("the router and the panel both read the constant; no literal slider bound is left", () => {
    expect(read("lib/trpc/routers/journal.ts")).toContain("JOURNAL_SETTING_BOUNDS.baselineXp.min");
    const panel = read("components/settings/journal-brain-panel.tsx");
    for (const k of ["baselineXp", "qualityFloorChars", "groundedXpMultiplier", "autoConfirmThreshold"]) {
      expect(panel).toContain(`min={B.${k}.min}`);
    }
    expect(panel).not.toMatch(/type="range"\s*\n\s*min=\{0\}/);
  });
});

describe("Settings copy says what the system does", () => {
  it("the push toggle no longer promises alerts nothing sends, and those senders are gone", () => {
    expect(read("components/settings/push-notification-toggle.tsx")).not.toContain("leads, revenue milestones");
    const push = read("lib/notifications/push.ts");
    for (const dead of ["pushLeadAlert", "pushRevenueAlert", "pushScoreReminder", "pushPipelineAging"]) {
      expect(push).not.toContain(`export async function ${dead}`);
    }
    expect(push).toContain("export async function pushDriftAlert");
  });

  it("the ticker card names the one ticker that exists", () => {
    expect(read("components/settings/ticker-dismissal-card.tsx")).not.toContain("top or bottom ticker");
  });
});
