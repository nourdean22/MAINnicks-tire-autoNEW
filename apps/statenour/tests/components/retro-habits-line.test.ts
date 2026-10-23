/**
 * The retro modal names how many habits stay open (Codex P2, PR 3257: the
 * line rendered " daily or weekly  open in Rhythms." with no count or noun).
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/trpc/client", () => ({ trpc: { useUtils: () => ({}) } }));
import { habitsKeptLine } from "@/components/missions/mission-retro-modal";

describe("habitsKeptLine", () => {
  it("1 habit: singular", () => {
    expect(habitsKeptLine(1)).toBe("1 daily or weekly habit stays open in Rhythms.");
  });
  it("3 habits: plural", () => {
    expect(habitsKeptLine(3)).toBe("3 daily or weekly habits stay open in Rhythms.");
  });
  it("unknown count: the general sentence; zero: no line", () => {
    expect(habitsKeptLine(null)).toBe("Daily and weekly habits in this mission stay open in Rhythms.");
    expect(habitsKeptLine(0)).toBeNull();
  });
});
