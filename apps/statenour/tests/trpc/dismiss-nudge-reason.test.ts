/**
 * 06-F5 = 06-H3: a nudge SNOOZE is not an operator correction.
 *
 * dismissNudge recorded every dismissal as `nudge:<source>`, which
 * CORRECTION_WHERE counts toward the 200-correction gate. "today" and "7d"
 * mean "not now"; only "forever" says the nudge itself was not useful. The
 * timing reason uses the existing NON_CORRECTION_DISMISS_REFS vocabulary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ dismissNudge: vi.fn(), recordDecisionByContent: vi.fn() }));

// No DB in this test: a stub with no models, so nothing can open a connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/brain/cross-system-nudge", () => ({
  computeNudges: vi.fn(),
  dismissNudge: m.dismissNudge,
}));
vi.mock("@/lib/services/outcome-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/outcome-ledger")>()),
  recordDecisionByContent: m.recordDecisionByContent,
}));

import { brainRouter } from "@/lib/trpc/routers/brain";
import { NON_CORRECTION_DISMISS_REFS } from "@/lib/services/outcome-ledger";

const caller = brainRouter.createCaller({
  session: { id: "op", email: "op@statenour.local", role: "owner" },
} as never);

/** The ledger write is fire-and-forget behind a dynamic import. */
const flush = () => vi.waitFor(() => expect(m.recordDecisionByContent).toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  m.dismissNudge.mockResolvedValue({ ok: true });
  m.recordDecisionByContent.mockResolvedValue(true);
});

describe("brain.dismissNudge: the ledger reason follows `until`", () => {
  for (const until of ["7d", "today", undefined] as const) {
    it(`a snooze (until ${until ?? "default"}) is recorded as timing, not a correction`, async () => {
      await caller.dismissNudge({ source: "calendar", text: "Call Sam back", ...(until ? { until } : {}) });
      await flush();
      expect(m.recordDecisionByContent).toHaveBeenCalledWith("Call Sam back", "dismissed", "dismiss:timing");
      expect(NON_CORRECTION_DISMISS_REFS).toContain("dismiss:timing");
    });
  }

  it("CONTROL: dismissing forever is still a verdict on the nudge", async () => {
    await caller.dismissNudge({ source: "calendar", text: "Call Sam back", until: "forever" });
    await flush();
    expect(m.recordDecisionByContent).toHaveBeenCalledWith("Call Sam back", "dismissed", "nudge:calendar");
  });
});
