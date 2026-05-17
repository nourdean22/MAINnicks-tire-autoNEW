/**
 * Prompt library tests · v10.0.165
 *
 * Verifies the registry contract:
 *   · every entry has id + body + category + version
 *   · listPrompts filtering works
 *   · fillTemplate replaces variables and fails on missing
 *   · stats roll up correctly
 *   · the verifier prompts that the production fabrication-defense
 *     stack relies on are present (don't break L1-L4 by accident)
 */

import { describe, it, expect } from "vitest";
import {
  PROMPTS,
  listPrompts,
  getPrompt,
  fillTemplate,
  getRegistryStats,
} from "@/lib/prompts/library";

describe("PROMPTS registry · contract", () => {
  it("every entry has required fields", () => {
    for (const [id, p] of Object.entries(PROMPTS)) {
      expect(p.id).toBe(id);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.category).toBeTruthy();
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(p.tags)).toBe(true);
      expect(p.body.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique (Object key + p.id match was the implicit guarantee)", () => {
    const ids = Object.values(PROMPTS).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("variables declared in templates appear in the body", () => {
    for (const p of Object.values(PROMPTS)) {
      for (const v of p.variables ?? []) {
        expect(p.body).toContain(`{{${v}}}`);
      }
    }
  });
});

describe("the production fabrication-defense prompts are present", () => {
  // These prompts are wired into the production system prompt /
  // sanitize-history / truth-grounding pipeline. If someone deletes
  // them by accident, the test catches it.
  it("verifier.anti-fabrication-rule exists", () => {
    expect(getPrompt("verifier.anti-fabrication-rule")).not.toBeNull();
  });
  it("verifier.fabrication-banner exists", () => {
    expect(getPrompt("verifier.fabrication-banner")).not.toBeNull();
  });
  it("verifier.history-neutralization exists", () => {
    expect(getPrompt("verifier.history-neutralization")).not.toBeNull();
  });
  it("ground.truth-grounding-header exists", () => {
    expect(getPrompt("ground.truth-grounding-header")).not.toBeNull();
  });
});

describe("listPrompts · filtering", () => {
  it("returns all when no filter passed", () => {
    expect(listPrompts().length).toBe(Object.keys(PROMPTS).length);
  });

  it("filters by category", () => {
    const verifiers = listPrompts({ category: "verifier" });
    expect(verifiers.length).toBeGreaterThan(0);
    expect(verifiers.every((p) => p.category === "verifier")).toBe(true);
  });

  it("filters by tag", () => {
    const fabrication = listPrompts({ tag: "fabrication" });
    expect(fabrication.length).toBeGreaterThan(0);
    expect(fabrication.every((p) => p.tags.includes("fabrication"))).toBe(true);
  });

  it("intersects category + tag", () => {
    const verifierFab = listPrompts({ category: "verifier", tag: "fabrication" });
    expect(verifierFab.length).toBeGreaterThan(0);
    expect(
      verifierFab.every((p) => p.category === "verifier" && p.tags.includes("fabrication")),
    ).toBe(true);
  });
});

describe("fillTemplate", () => {
  it("replaces all declared variables", () => {
    const filled = fillTemplate("verifier.fabrication-banner", {
      COUNT: "3",
      VERBS: "added, sent, scheduled",
    });
    expect(filled).toContain("3 action");
    expect(filled).toContain("added, sent, scheduled");
    expect(filled).not.toContain("{{COUNT}}");
    expect(filled).not.toContain("{{VERBS}}");
  });

  it("throws on missing required variable", () => {
    expect(() =>
      fillTemplate("verifier.fabrication-banner", { COUNT: "3" }),
    ).toThrow(/missing required variable.*VERBS/);
  });

  it("throws on unknown prompt id", () => {
    expect(() => fillTemplate("nonexistent.prompt", {})).toThrow(/not found/);
  });

  it("ignores extra unrecognized values (forward-compat)", () => {
    const filled = fillTemplate("verifier.fabrication-banner", {
      COUNT: "1",
      VERBS: "added",
      EXTRA_FIELD: "ignored",
    });
    expect(filled).toContain("1 action");
  });
});

describe("getRegistryStats", () => {
  it("returns total + breakdown", () => {
    const stats = getRegistryStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.wired + stats.libraryOnly).toBe(stats.total);
    const sumByCategory = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
    expect(sumByCategory).toBe(stats.total);
  });
});
