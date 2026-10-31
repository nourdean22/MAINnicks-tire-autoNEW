/**
 * The Home love-map line (people W2c, 2026-10-30): a failed read says so
 * (skill empty-vs-error); no one to ask about renders nothing, which is the
 * positive control; a question shows with Save and Skip.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ task: { loveMapQuestion: { invalidate: vi.fn() } } }),
    task: {
      loveMapQuestion: { useQuery: h.query },
      answerLoveMap: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LoveMapLine } from "@/components/relationships/love-map-line";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<LoveMapLine />);
  });
  return host;
}

describe("LoveMapLine", () => {
  it("a failed read says the question could not be read", async () => {
    h.query.mockReturnValue({ data: undefined, isError: true, isLoading: false });
    const el = await mount();
    expect(el.textContent).toMatch(/couldn.t read today.s people question/i);
  });

  it("POSITIVE CONTROL: no one to ask about renders nothing", async () => {
    h.query.mockReturnValue({ data: null, isError: false, isLoading: false });
    const el = await mount();
    expect(el.textContent).toBe("");
  });

  it("shows the question with Save and Skip", async () => {
    h.query.mockReturnValue({
      data: { personId: "p1", name: "Sam Rivers", question: "What is Sam Rivers working toward right now?", dayKey: "2026-10-30" },
      isError: false,
      isLoading: false,
    });
    const el = await mount();
    expect(el.textContent).toContain("What is Sam Rivers working toward right now?");
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Save", "Skip today"]));
  });
});
