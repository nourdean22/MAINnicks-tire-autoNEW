/**
 * createDraft platform contract (2026-07-12).
 *
 * A social-publish draft with platforms:[] can never be approved+published
 * (publish requires ≥1 platform). The persona-ghostwrite endpoint and the
 * Telegram /draft path both omitted platforms → every draft they produced
 * was un-publishable, which is why the content flywheel never turned. This
 * locks the contract: suggestedPlatforms flows straight to the row, and its
 * absence yields the un-publishable [] (so callers know they must pass it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { socialPublishQueue: { create: (args: unknown) => createMock(args) } },
}));

import { createDraft } from "@/lib/content/drafts";

describe("createDraft platform contract", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockImplementation(async (args: any) => ({ id: args.data.id }));
  });

  it("passes suggestedPlatforms straight through to the row (publishable)", async () => {
    await createDraft({ content: "Winter tire tips reel", suggestedPlatforms: ["instagram"] });
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data.platforms).toEqual(["instagram"]);
    expect(data.status).toBe("pending");
  });

  it("defaults to [] when no platforms given — the un-publishable case callers must avoid", async () => {
    await createDraft({ content: "some content" });
    expect(createMock.mock.calls[0][0].data.platforms).toEqual([]);
  });
});
