/**
 * The deep-mode chip used to open /brain?tab=reason. That tab was cut 2026-10-19 (wave 2V), so a tap now opens
 * Chat. Audit 02-F6 (2026-10-10) keeps the operator's typed question out of URLs, server logs and history, so the
 * text travels through sessionStorage and the URL carries only a marker (?pq=1); Chat consumes the handoff,
 * prefills the draft and never sends. A blocked sessionStorage opens plain /chat: losing the text beats leaking it.
 *
 * No DOM in this vitest env: React's hooks are stubbed with a slot store so the chip renders in one pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, push: vi.fn(), store: new Map<string, string>() }));

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
import { CHAT_PENDING_PROMPT_KEY } from "@/features/chat-v2/hooks/use-chat-deep-link-prefill";

type El = ReactElement<{ onClick?: () => void }>;
const QUESTION = "should I hire a second tech this quarter?";

beforeEach(() => {
  h.slots = [];
  h.i = 0;
  h.push.mockReset();
  h.store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => h.store.get(k) ?? null,
    setItem: (k: string, v: string) => void h.store.set(k, v),
    removeItem: (k: string) => void h.store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("DeepModeNudge hands the question to Chat without putting it in the URL", () => {
  it("a tap stores the text in sessionStorage and opens /chat?pq=1, never the text and never the Reason tab", () => {
    h.slots[0] = { tier: "deep", text: QUESTION };
    (DeepModeNudge() as El).props.onClick!();
    expect(h.store.get(CHAT_PENDING_PROMPT_KEY)).toBe(QUESTION);
    expect(h.push).toHaveBeenCalledWith("/chat?pq=1");
    const url = String(h.push.mock.calls[0][0]);
    expect(url).not.toContain("hire");
    expect(url).not.toContain("q=" + encodeURIComponent(QUESTION));
    expect(url).not.toContain("/brain");
  });

  it("a blocked sessionStorage opens plain /chat: no question text in the URL, ever", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("blocked"); } });
    h.slots[0] = { tier: "deep", text: QUESTION };
    (DeepModeNudge() as El).props.onClick!();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith("/chat");
    expect(String(h.push.mock.calls[0][0])).not.toContain("hire");
  });

  it("CONTROL: with no verdict the chip renders nothing, so nothing can be tapped", () => {
    h.slots[0] = null;
    expect(DeepModeNudge()).toBeNull();
  });
});
