/**
 * W6 PR 2 · /now is behind W6_INTENT_SURFACE: off, the page is a 404 (Next notFound), never an empty shell.
 */
import { describe, it, expect, vi } from "vitest";

const { flag, notFound } = vi.hoisted(() => ({
  flag: { on: false },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/intent/compose", () => ({ isIntentSurfaceOn: async () => flag.on }));
vi.mock("@/components/now/intent-surface", () => ({ IntentSurface: () => null }));

import NowPage from "@/app/(mastery)/now/page";

describe("/now page flag", () => {
  it("flag off: notFound", async () => {
    flag.on = false;
    await expect(NowPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("CONTROL · flag on: renders the surface", async () => {
    flag.on = true;
    notFound.mockClear();
    const el = await NowPage();
    expect(notFound).not.toHaveBeenCalled();
    expect(el).toBeTruthy();
  });
});
