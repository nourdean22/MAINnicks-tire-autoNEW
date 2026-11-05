/**
 * The nicknames block in the /people edit drawer. Each add or remove saves at once through the one writer; a failed
 * save stays on screen and leaves the list as it was. iOS standalone drops window.confirm/prompt, so neither is used.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ task: { personProfile: { invalidate: h.invalidate } } }),
    task: { editPersonNicknames: { useMutation: () => ({ isPending: false, mutateAsync: h.mutateAsync }) } },
  },
}));

import { PersonNicknamesField } from "@/components/relationships/person-nicknames-field";
import { rankCandidates } from "@/components/command-palette/relationship-log-action";

let root: Root;
let host: HTMLDivElement;
const render = async (initial: string[]) => {
  await act(async () => root.render(<PersonNicknamesField personId="y" initial={initial} />));
};
const input = () => host.querySelector("input") as HTMLInputElement;
const button = (name: string) => host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
const type = async (value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (el: HTMLElement) => {
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("PersonNicknamesField", () => {
  it("adds through the writer, shows what the server saved, clears the box", async () => {
    h.mutateAsync.mockResolvedValue({ nicknames: ["mom"], dead: [] });
    await render([]);
    await type(" mom ");
    await click(button("add nickname"));
    expect(h.mutateAsync).toHaveBeenCalledWith({ personId: "y", add: ["mom"] });
    expect(host.textContent).toContain("mom");
    expect(input().value).toBe("");
    expect(h.invalidate).toHaveBeenCalledWith({ personId: "y" });
  });

  it("Enter adds, and never reaches a surrounding form", async () => {
    h.mutateAsync.mockResolvedValue({ nicknames: ["mom"], dead: [] });
    await render([]);
    await type("mom");
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => input().dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("removes one nickname with its own 44 px button", async () => {
    h.mutateAsync.mockResolvedValue({ nicknames: [], dead: [] });
    await render(["mom"]);
    const remove = button("remove nickname mom");
    expect(remove.className).toMatch(/min-h-11/);
    expect(remove.className).toMatch(/min-w-11/);
    await click(remove);
    expect(h.mutateAsync).toHaveBeenCalledWith({ personId: "y", remove: ["mom"] });
    expect(host.querySelector("li")).toBeNull();
  });

  it("a failed save shows the error and keeps the list and the typed word", async () => {
    h.mutateAsync.mockRejectedValue(new Error("db down"));
    await render(["ma"]);
    await type("mom");
    await click(button("add nickname"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("db down");
    expect(input().value).toBe("mom");
    expect(host.querySelectorAll("li")).toHaveLength(1);
  });

  it("says when a saved nickname links nobody", async () => {
    h.mutateAsync.mockResolvedValue({ nicknames: ["mom"], dead: ["mom"] });
    await render([]);
    await type("mom");
    await click(button("add nickname"));
    expect(host.textContent).toMatch(/"mom".*links nobody/);
  });

  it("the Add button needs a word", async () => {
    await render([]);
    expect(button("add nickname").disabled).toBe(true);
  });

  it("never calls the dialogs iOS standalone drops", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const confirm = vi.spyOn(window, "confirm");
    h.mutateAsync.mockResolvedValue({ nicknames: [], dead: [] });
    await render(["mom"]);
    await click(button("remove nickname mom"));
    expect(prompt).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("rankCandidates", () => {
  const people = [
    { id: "y", name: "Yummah", role: "family", nicknames: ["mom"] },
    { id: "m", name: "Momo", role: "friend" },
  ];

  it("an exact nickname ranks as an exact name, above a prefix match", () => {
    const out = rankCandidates("mom", people);
    expect(out.map((p) => [p.id, p.score])).toEqual([
      ["y", 1],
      ["m", 0.85],
    ]);
  });

  it("people with no nicknames rank as before", () => {
    expect(rankCandidates("yum", people).map((p) => p.id)).toEqual(["y"]);
  });
});
