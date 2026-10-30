// @vitest-environment jsdom
/**
 * MaximLine on Home: shows the line, its source and the reason; Next asks for the next step; Keep and Skip
 * send the shown maxim's id; every verb is a 44 px target; no data renders nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  inputs: [] as Array<{ step: number; context: string | null }>,
  keep: vi.fn(),
  skip: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ operator: { maxim: { invalidate: async () => {} } } }),
    operator: {
      maxim: {
        useQuery: (input: { step: number; context: string | null }) => {
          h.inputs.push(input);
          return { data: h.data, isFetching: false };
        },
      },
      maximKeep: { useMutation: () => ({ mutate: h.keep, isPending: false }) },
      maximSkip: { useMutation: () => ({ mutate: h.skip, isPending: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { MaximLine } from "@/components/home/maxim-line";

let root: Root;
let host: HTMLDivElement;
const button = (name: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name)!;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<MaximLine context="Send the Smith estimate follow-up" ready />));
}

beforeEach(() => {
  h.inputs = [];
  h.keep.mockClear();
  h.skip.mockClear();
  h.data = { id: "greene-maxims:law_1", text: "Let a big customer feel smart.", source: "Greene · 48 Laws", reason: "for today: customers", position: 3, total: 40 };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MaximLine", () => {
  it("shows the maxim, its source and the reason, and passes the brief's lead line as context", () => {
    mount();
    expect(host.textContent).toContain("Let a big customer feel smart.");
    expect(host.textContent).toContain("Greene · 48 Laws · for today: customers");
    expect(h.inputs[0]).toEqual({ step: 0, context: "Send the Smith estimate follow-up" });
  });

  it("Next asks for the next step; Keep and Skip send the shown maxim's id", () => {
    mount();
    act(() => button("Next").click());
    expect(h.inputs.at(-1)).toEqual({ step: 1, context: "Send the Smith estimate follow-up" });
    act(() => button("Keep").click());
    expect(h.keep).toHaveBeenCalledWith({ id: "greene-maxims:law_1" });
    act(() => button("Skip").click());
    expect(h.skip).toHaveBeenCalledWith({ id: "greene-maxims:law_1" });
  });

  it("every verb is a 44 px target", () => {
    mount();
    for (const name of ["Next", "Keep", "Skip"]) {
      expect(button(name).className).toContain("min-h-[44px]");
      expect(button(name).className).toContain("min-w-[44px]");
    }
  });

  it("no maxim (loading, failed or all skipped) renders nothing", () => {
    h.data = undefined;
    mount();
    expect(host.innerHTML).toBe("");
  });
});
