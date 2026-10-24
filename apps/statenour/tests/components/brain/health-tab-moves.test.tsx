/**
 * tests/components/brain/health-tab-moves.test.tsx - bdnick wave D (2026-10-24).
 *
 * assert-the-consumer for the moves out of the Memory tab: each moved panel must render where it
 * moved, not only stop rendering where it was (the other half is memory-tab-structure.test.tsx).
 *   - Health: learning velocity, persona drift, tool telemetry and suggestion telemetry join the
 *     health view and the continuity view.
 *   - Review: the approved-actions outcomes list lives inside the review queue body.
 * Plus the cards-to-rows ratchet: GlassCard uses under components/brain and the brain page stay at
 * 10 or fewer (46 at 91884c05b; SYSTEM.md "NO tile because a number exists").
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) =>
  function Stub() {
    return <section data-testblock={name}>{name}</section>;
  };

vi.mock("@/components/brain/health-view", () => ({ BrainHealthView: stub("BrainHealthView") }));
vi.mock("@/components/brain/continuity-view", () => ({ BrainContinuityView: stub("BrainContinuityView") }));
vi.mock("@/components/brain/learning-velocity-scoreboard", () => ({ LearningVelocityScoreboard: stub("LearningVelocityScoreboard") }));
vi.mock("@/components/ultron/persona-drift-card", () => ({ PersonaDriftCard: stub("PersonaDriftCard") }));
vi.mock("@/components/brain/tool-telemetry-panel", () => ({ ToolTelemetryPanel: stub("ToolTelemetryPanel") }));
vi.mock("@/components/brain/suggestion-telemetry-panel", () => ({ SuggestionTelemetryPanel: stub("SuggestionTelemetryPanel") }));
vi.mock("@/components/brain/knowledge-action-outcomes", () => ({ KnowledgeActionOutcomes: stub("KnowledgeActionOutcomes") }));
// The review queue reads over apiFetch; a read that never answers keeps it in its loading state.
vi.mock("@/lib/utils/api-fetch", () => ({ apiFetch: () => new Promise(() => undefined) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const blocks = () => [...host.querySelectorAll<HTMLElement>("[data-testblock]")].map((el) => el.dataset.testblock!);

describe("Health tab takes the four moved panels", () => {
  it("renders health, continuity, then the moved panels as rows", async () => {
    const { BrainHealthTab } = await import("@/components/brain/health-tab");
    await mount(<BrainHealthTab />);
    expect(blocks()).toEqual([
      "BrainHealthView",
      "BrainContinuityView",
      "LearningVelocityScoreboard",
      "PersonaDriftCard",
      "ToolTelemetryPanel",
      "SuggestionTelemetryPanel",
    ]);
  });
});

describe("Review tab body holds the knowledge action outcomes", () => {
  it("mounts KnowledgeActionOutcomes inside KnowledgeReviewTab", async () => {
    const { KnowledgeReviewTab } = await import("@/components/brain/knowledge-review-tab");
    await mount(<KnowledgeReviewTab />);
    expect(blocks()).toContain("KnowledgeActionOutcomes");
  });

  it("the brain page no longer mounts it a second time beside the review tab", () => {
    const page = readFileSync(path.resolve(__dirname, "../../../app/(mastery)/brain/page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
    expect(page).not.toContain("<KnowledgeActionOutcomes");
  });
});

describe("cards to rows", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const files = [
    ...readdirSync(path.join(ROOT, "components/brain"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => path.join(ROOT, "components/brain", f)),
    path.join(ROOT, "app/(mastery)/brain/page.tsx"),
  ];
  const uses = files.reduce((n, f) => n + (readFileSync(f, "utf8").match(/<GlassCard\b/g) ?? []).length, 0);

  it("scans the brain files at all (positive control)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("memory-tab.tsx"))).toBe(true);
  });

  it("keeps GlassCard uses in components/brain and the brain page at 10 or fewer", () => {
    expect(uses).toBeLessThanOrEqual(10);
  });
});
