/**
 * Epistemic age stamp at the recall boundary · doctrine tests.
 *
 * The bug this pins: the recall block's age came from last_seen, and the
 * recall path BUMPS last_seen on every hit — so a fact recalled daily
 * rendered "today" forever regardless of when it was recorded. The stamp now
 * renders created_at-derived fact age with a STALE / verify-first marker,
 * and the kill-switch restores the legacy rendering byte-for-byte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFlag: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: mocks.getFlag,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { formatRecallForPrompt, renderFactStatus, type RecallHit } from "@/lib/brain/memory-recall";

const hit = (over: Partial<RecallHit> = {}): RecallHit => ({
  memoryId: "m1",
  category: "domain_knowledge",
  key: "k",
  content: "The supplier gate is 100% markup.",
  confidence: 0.8,
  ageDays: 0, // recalled today — the bump makes this ~always 0
  factAgeDays: 200, // but the fact itself is 200 days old
  knnDistance: 0.2,
  finalScore: 1.1,
  ...over,
});

describe("renderFactStatus", () => {
  it("renders TRUE fact age, not the bumped last_seen age", () => {
    const s = renderFactStatus(hit());
    expect(s).toContain("recorded 200d ago");
    expect(s).not.toContain("today");
  });

  it("marks facts past 120d STALE with a verify-first instruction", () => {
    expect(renderFactStatus(hit({ factAgeDays: 121 }))).toContain("STALE — verify");
    expect(renderFactStatus(hit({ factAgeDays: 119 }))).not.toContain("STALE");
  });

  it("wisdom-tier categories get the 365d threshold — durable by design", () => {
    expect(renderFactStatus(hit({ category: "wisdom", factAgeDays: 200 }))).not.toContain("STALE");
    expect(renderFactStatus(hit({ category: "wisdom", factAgeDays: 400 }))).toContain("STALE");
  });
});

describe("formatRecallForPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFlag.mockReturnValue({ isOn: false });
  });

  it("the perpetually-fresh lie is dead: a daily-recalled old fact shows its real age", () => {
    const block = formatRecallForPrompt([hit({ ageDays: 0, factAgeDays: 300 })]);
    expect(block).toContain("recorded 300d ago");
    expect(block).toContain("STALE — verify");
    expect(block).not.toMatch(/\(today,/);
  });

  it("kill-switch restores the legacy last_seen rendering exactly", () => {
    mocks.getFlag.mockReturnValue({ isOn: true });
    const block = formatRecallForPrompt([hit({ ageDays: 0, factAgeDays: 300 })]);
    expect(block).toContain("(today, conf=0.80)");
    expect(block).not.toContain("recorded");
  });

  it("flag infra failure fails toward the truthful rendering", () => {
    mocks.getFlag.mockImplementation(() => {
      throw new Error("registry down");
    });
    const block = formatRecallForPrompt([hit()]);
    expect(block).toContain("recorded 200d ago");
  });

  it("empty hits → empty string", () => {
    expect(formatRecallForPrompt([])).toBe("");
  });
});
