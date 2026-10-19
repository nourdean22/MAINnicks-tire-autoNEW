/**
 * UI v3 W5b, consumer 4: the F2 correlation nudges (HQ pulse ticker, /brain/continuity) read the
 * newest correlation_alert rows directly and ignored both the category mute and a dismissal, so a
 * pair Nour dismissed as "expected" kept nudging. They now read the shared suppression
 * (lib/brain/alert-suppression.ts); an unknown suppression never hides a real alert.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadIdentitySnapshot: vi.fn(),
  state: {
    corr: [] as { key: string; content: string; metadata: null }[],
    suppression: [] as { category: string; key: string }[],
    suppressionFails: false,
  },
}));

vi.mock("@/lib/brain/identity-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/identity-snapshot")>();
  return { ...actual, loadIdentitySnapshot: h.loadIdentitySnapshot };
});
vi.mock("@/lib/brain/contradiction-surfacer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/contradiction-surfacer")>();
  return { ...actual, countUnresolved: vi.fn(async () => 0) };
});
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: vi.fn() }));
vi.mock("@/lib/brain/ghost-nick", () => ({ loadGhostAccuracy: vi.fn(async () => null) }));
vi.mock("@/lib/brain/skill-extractor", () => ({
  loadActiveSkills: vi.fn(async () => []),
  loadPendingSkills: vi.fn(async () => []),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async (a: { where: { category: unknown }; take?: number }) => {
        const c = a.where.category;
        if (c === "correlation_alert") return h.state.corr.slice(0, a.take ?? Infinity);
        if (typeof c === "object" && c && "in" in c && (c as { in: string[] }).in.includes("alert_dismiss")) {
          if (h.state.suppressionFails) throw new Error("db down");
          return h.state.suppression;
        }
        return [];
      }),
    },
  },
}));

import { computeNudges } from "@/lib/brain/cross-system-nudge";
import { invalidate } from "@/lib/utils/cache";

const axis = () => ({ value: 70, manual: null, direction: "stable", evidence: [], updated_at: new Date().toISOString() });
const SNAPSHOT = {
  axes: Object.fromEntries(
    ["velocity", "patience_horizon", "promise_integrity", "dopamine_discipline", "business_vs_personal", "risk_appetite", "social_battery", "reflection_cadence"].map((k) => [k, axis()]),
  ),
  computed_at: new Date().toISOString(),
  data_horizon_days: 30,
};

const corrTexts = async () => (await computeNudges()).filter((n) => n.source === "correlation").map((n) => n.text);

beforeEach(() => {
  invalidate("brain_nudges_v1");
  h.loadIdentitySnapshot.mockResolvedValue(SNAPSHOT);
  h.state.corr = [
    { key: "sleep__revenue", content: "Pair sleep revenue", metadata: null },
    { key: "focus__mood", content: "Pair focus mood", metadata: null },
  ];
  h.state.suppression = [];
  h.state.suppressionFails = false;
});

describe("F2 correlation nudges honour the shared alert suppression", () => {
  it("a dismissed pair does not nudge; an undismissed pair in the same call still does", async () => {
    h.state.suppression = [{ category: "alert_dismiss", key: "correlation_alert:signal:sleep__revenue" }];
    const got = await corrTexts();
    expect(got).not.toContain("Pair sleep revenue");
    expect(got).toContain("Pair focus mood");
  });

  it("a muted correlation category produces no correlation nudge", async () => {
    h.state.suppression = [{ category: "alert_mute", key: "correlation_alert" }];
    expect(await corrTexts()).toEqual([]);
  });

  it("dismissed pairs do not crowd out the three it shows", async () => {
    h.state.corr = Array.from({ length: 6 }, (_, i) => ({ key: `a${i}__b${i}`, content: `Pair ${i}`, metadata: null }));
    h.state.suppression = [0, 1].map((i) => ({ category: "alert_dismiss", key: `correlation_alert:signal:a${i}__b${i}` }));
    expect(await corrTexts()).toEqual(["Pair 2", "Pair 3", "Pair 4"]);
  });

  it("a failed suppression read still shows the nudge (unknown never hides a real alert)", async () => {
    h.state.suppressionFails = true;
    const got = await corrTexts();
    expect(got).toContain("Pair sleep revenue");
    expect(got).toContain("Pair focus mood");
  });

  it("CONTROL: with nothing suppressed both pairs nudge", async () => {
    expect(await corrTexts()).toEqual(["Pair sleep revenue", "Pair focus mood"]);
  });
});
