/**
 * creditFromSignal routing tests · 2026-05-31. The single write-time XP
 * door — verifies it routes habit→rule-based, text→AI, and holds the
 * noise floor. Deps (attributors + creditStatXp) are mocked; they're
 * proven elsewhere — this pins the ROUTING + the floor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mastery/credit", () => ({
  creditStatXp: vi.fn(async () => true),
}));
vi.mock("@/lib/mastery/attribution", () => ({
  attributeHabit: vi.fn(),
  attributeText: vi.fn(),
}));

import { creditFromSignal } from "@/lib/mastery/credit-signal";
import { creditStatXp } from "@/lib/mastery/credit";
import { attributeHabit, attributeText } from "@/lib/mastery/attribution";

const mockCredit = vi.mocked(creditStatXp);
const mockHabit = vi.mocked(attributeHabit);
const mockText = vi.mocked(attributeText);

describe("creditFromSignal · the single XP door", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCredit.mockResolvedValue(true);
  });

  it("habit → rule-based attributeHabit → credits SIGNAL_XP.habit (0.5)", async () => {
    mockHabit.mockReturnValue("physical");
    const ok = await creditFromSignal("habit", { habitKey: "workout", sourceKey: "habit:t1:2026-05-31" });
    expect(ok).toBe(true);
    expect(mockHabit).toHaveBeenCalledWith("workout");
    expect(mockText).not.toHaveBeenCalled();
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "physical", xp: 0.5, signal: "habit", sourceKey: "habit:t1:2026-05-31" }),
    );
  });

  it("journal → AI attributeText → credits the attributed stat + its xp", async () => {
    mockText.mockResolvedValue({ stat: "wisdom", xp: 2, evidence: "a real insight" });
    const ok = await creditFromSignal("journal", {
      text: "a genuinely meaningful reflection about patience and the long game",
      sourceKey: "journal:r1",
    });
    expect(ok).toBe(true);
    expect(mockText).toHaveBeenCalledWith(expect.stringContaining("meaningful"), "journal");
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "wisdom", xp: 2, signal: "journal", evidence: "a real insight", sourceKey: "journal:r1" }),
    );
  });

  it("noise → attributeText null → no credit (the floor)", async () => {
    mockText.mockResolvedValue(null);
    const ok = await creditFromSignal("chat", { text: "ok thanks sounds good lol", sourceKey: "chat:c1" });
    expect(ok).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it("too-short text → no credit and no AI call", async () => {
    const ok = await creditFromSignal("journal", { text: "hi", sourceKey: "journal:r2" });
    expect(ok).toBe(false);
    expect(mockText).not.toHaveBeenCalled();
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it("unknown habit → attributeHabit null → no credit", async () => {
    mockHabit.mockReturnValue(null);
    const ok = await creditFromSignal("habit", { habitKey: "does_not_exist", sourceKey: "habit:x" });
    expect(ok).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it("missing sourceKey → no-op", async () => {
    const ok = await creditFromSignal("journal", { text: "a long enough body to attribute", sourceKey: "" });
    expect(ok).toBe(false);
    expect(mockText).not.toHaveBeenCalled();
  });
});
