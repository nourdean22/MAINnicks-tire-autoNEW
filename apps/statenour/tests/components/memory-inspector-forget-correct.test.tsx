/**
 * 05-M12: the inspector can forget or correct the memory it shows.
 *
 * Forget is two-tap in the DOM (an iOS PWA gets no window.confirm): the first
 * tap only swaps in "Tap again to forget"; the mutation lives in that armed
 * step. Correct opens an inline editor prefilled with the current text. A
 * superseded memory is history, so it can be forgotten but not corrected.
 *
 * Node env, renderToStaticMarkup, tRPC stubbed (pattern of
 * memory-inspector-states.test.tsx).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryDetail } from "@/lib/services/brain/memory-detail";

const stubs = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null },
  mutation: { mutate: () => {}, isPending: false },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ brain: { memoryById: { invalidate: () => {} } } }),
    brain: {
      memoryById: { useQuery: () => stubs.query },
      forgetMemory: { useMutation: () => stubs.mutation },
      correctMemory: { useMutation: () => stubs.mutation },
    },
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/brain",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import {
  CorrectMemoryEditor,
  ForgetMemoryConfirm,
  MemoryInspector,
} from "@/components/inspector/panels/memory-inspector";

const ISO = "2026-09-01T00:00:00.000Z";
const MEMORY: MemoryDetail = {
  id: "mem-1",
  category: "identity",
  key: "home_city",
  content: "Lives in Lakewood.",
  source: "manual",
  evidence: "operator_stated",
  trustTier: "OPERATOR",
  confidence: 1,
  seenCount: 1,
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
  lastSeen: ISO,
  expiresAt: null,
  validFrom: null,
  validUntil: null,
  lastVerifiedAt: null,
  supersededBy: null,
  supersedes: [],
  discoveryVerdict: null,
};

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[0]);
}

describe("MemoryInspector / forget and correct", () => {
  it("a current memory offers Forget and Correct, both at least 44px tall", () => {
    stubs.query.data = MEMORY;
    const html = renderToStaticMarkup(<MemoryInspector entity={{ kind: "memory", id: "mem-1" }} mode="inspect" />);
    const actions = buttons(html).filter((b) => />(Forget|Correct)</.test(b));
    expect(actions).toHaveLength(2);
    for (const b of actions) expect(b).toContain("min-h-11");
  });

  it("a superseded memory can be forgotten but not corrected", () => {
    stubs.query.data = { ...MEMORY, supersededBy: { id: "m2", content: "newer", createdAt: ISO } };
    const html = renderToStaticMarkup(<MemoryInspector entity={{ kind: "memory", id: "mem-1" }} mode="inspect" />);
    expect(buttons(html).some((b) => />Forget</.test(b))).toBe(true);
    expect(buttons(html).some((b) => />Correct</.test(b))).toBe(false);
  });

  it("the armed forget step asks for a second tap and offers a way out", () => {
    const html = renderToStaticMarkup(<ForgetMemoryConfirm id="mem-1" onCancel={() => {}} />);
    expect(html).toContain("Tap again to forget");
    expect(html).toContain(">Keep<");
  });

  it("the correct editor is prefilled with the current text and labelled", () => {
    const html = renderToStaticMarkup(
      <CorrectMemoryEditor id="mem-1" initial="Lives in Lakewood." onCancel={() => {}} />,
    );
    expect(html).toMatch(/<textarea[^>]*aria-label="Corrected memory"[^>]*>Lives in Lakewood\.<\/textarea>/);
    expect(html).toContain("Save correction");
  });
});
