/**
 * The deep-mode chip used to open /brain?tab=reason. That tab was cut 2026-10-19 (wave 2V), so a tap now opens
 * Chat with the text prefilled. Chat only prefills from ?q= and never auto-sends
 * (features/chat-v2/hooks/use-chat-deep-link-prefill.ts), so the tap still starts no paid run on its own.
 *
 * No DOM in this vitest env: React's hooks are stubbed with a slot store so the chip renders in one pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, push: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const k = h.i++;
      if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => unknown)() : init;
      return [h.slots[k], (v: unknown) => { h.slots[k] = v; }];
    },
    useEffect: () => undefined,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));

import { DeepModeNudge } from "@/components/operator/deep-mode-nudge";

type El = ReactElement<{ onClick?: () => void }>;

beforeEach(() => {
  h.slots = [];
  h.i = 0;
  h.push.mockReset();
});

describe("DeepModeNudge hands the question to Chat", () => {
  it("a tap opens /chat with the text in ?q=, and never the cut Reason tab", () => {
    h.slots[0] = { tier: "deep", text: "should I hire a second tech this quarter?" };
    const chip = DeepModeNudge() as El;
    chip.props.onClick!();
    expect(h.push).toHaveBeenCalledWith(`/chat?q=${encodeURIComponent("should I hire a second tech this quarter?")}`);
    expect(String(h.push.mock.calls[0][0])).not.toContain("/brain");
  });

  it("CONTROL: with no verdict the chip renders nothing, so nothing can be tapped", () => {
    h.slots[0] = null;
    expect(DeepModeNudge()).toBeNull();
  });
});
