/**
 * The ticker's contradiction chip is a count from the contradictions table (2026-10-23).
 *
 * Reader: lib/services/contradictions.ts countUnresolvedContradictions, the panel's
 * own open total. The chip never carries row text or a row key (80 open rows would
 * flood the ticker); it links to the panel. A failed count renders an "unreadable"
 * chip, never "0 open" and never silence that reads as all clear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/services/contradictions", () => ({ countUnresolvedContradictions: h.count }));
vi.mock("@/lib/brain/cross-system-nudge", () => ({ computeNudges: async () => [] }));
vi.mock("@/lib/brain/identity-snapshot", () => ({ loadIdentitySnapshot: async () => null }));
vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/ultron/timelines", () => ({ computeInputs: vi.fn(), generateTimelines: vi.fn() }));
vi.mock("@/lib/nickstire/query", () => ({ queryNickBatch: vi.fn(), readBridge: vi.fn() }));

import { fetchBrainPulseItems } from "@/lib/services/ultron-ticker";

beforeEach(() => {
  h.count.mockReset();
});

describe("ticker contradiction chip", () => {
  it("shows the table count and links to the panel", async () => {
    h.count.mockResolvedValue(80);
    const chip = (await fetchBrainPulseItems()).find((i) => i.id === "brain-contradict");
    expect(chip?.label).toBe("⚠ 80 open contradictions");
    expect(chip?.href).toBe("/brain?tab=memory#contradictions");
  });

  it("singular for one", async () => {
    h.count.mockResolvedValue(1);
    const chip = (await fetchBrainPulseItems()).find((i) => i.id === "brain-contradict");
    expect(chip?.label).toBe("⚠ 1 open contradiction");
  });

  it("shows no chip on a measured zero", async () => {
    h.count.mockResolvedValue(0);
    expect((await fetchBrainPulseItems()).find((i) => i.id === "brain-contradict")).toBeUndefined();
  });

  it("a failed count is an unreadable chip, not a zero and not silence", async () => {
    h.count.mockRejectedValue(new Error("db down"));
    const chip = (await fetchBrainPulseItems()).find((i) => i.id === "brain-contradict");
    expect(chip?.label).toMatch(/unreadable/i);
    expect(chip?.label).not.toMatch(/\b0\b/);
  });
});
