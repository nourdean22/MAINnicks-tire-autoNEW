// @vitest-environment jsdom
/**
 * R3 · 2026-11-03 · the Promises section on /missions (Nour: "i have no where to even see the
 * commitments or edit them"). The consumer end of the promises server path: the list renders
 * active + proposed from the read, collapsed to one count line; Done / Drop / Edit / Make it a
 * task reach the right mutation with the right input; Drop goes through the house confirm, never
 * window.confirm (iOS PWA suppresses it); a rejected read renders unknown, never "No open
 * promises."; a failed write toasts and keeps the row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = {
  id: number;
  description: string;
  toWhom: string;
  deadline: string | null;
  ageDays: number;
  deadlineDays: number | null;
  task: { id: string; status: string } | null;
};
const LIST = {
  active: [
    { id: 1, description: "Send Mash the alignment quote", toWhom: "Mash", deadline: null, ageDays: 61, deadlineDays: null, task: null },
    { id: 2, description: "Walk every morning this week", toWhom: "self", deadline: "2026-11-12", ageDays: 3, deadlineDays: 9, task: null },
  ] as Row[],
  proposed: [{ id: 9, description: "Call the insurance agent back", toWhom: "self", deadline: null, ageDays: 7, deadlineDays: null, task: null }] as Row[],
  activeCount: 2,
  proposedCount: 467,
};

const h = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  resolve: vi.fn(async (_i: unknown): Promise<unknown> => ({ resolved: true })),
  edit: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true })),
  toTask: vi.fn(async (_i: unknown): Promise<unknown> => ({ taskId: "t9", created: true })),
  accept: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true })),
  dismiss: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true })),
  invalidate: vi.fn(async () => {}),
  confirm: vi.fn(async (_o: unknown) => true),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, message: h.toastMessage } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: h.confirm, dialog: <div data-testid="house-dialog" /> }),
}));
vi.mock("@/lib/trpc/client", () => {
  const mutation = (fn: (i: unknown) => Promise<unknown>) => ({ useMutation: () => ({ mutateAsync: fn, isPending: false }) });
  const inv = { invalidate: h.invalidate };
  return {
    trpc: {
      operator: {
        promisesList: { useQuery: () => h.query },
        promiseResolve: mutation(h.resolve),
        promiseEdit: mutation(h.edit),
        promiseToTask: mutation(h.toTask),
        commitmentAccept: mutation(h.accept),
        commitmentDismiss: mutation(h.dismiss),
      },
      useUtils: () => ({
        operator: { promisesList: inv, commitmentsProposed: inv },
        task: { list: inv, deck: inv },
      }),
    },
  };
});

import { PromisesSection } from "@/components/missions/promises-section";

const MISSIONS = [
  { id: "m1", title: "Shop OS", status: "ACTIVE" },
  { id: "m-inbox", title: "Inbox", status: "ACTIVE" },
];

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
async function mount() {
  await act(async () => {
    root.render(<PromisesSection missions={MISSIONS} />);
  });
  await flush();
}
const text = () => container.textContent ?? "";
const button = (label: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const rowOf = (id: number) => container.querySelector(`[data-promise="${id}"]`) as HTMLElement | null;
async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}
async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, value: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function open() {
  await click(container.querySelector("[aria-controls='promises-body']"));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.query = { data: LIST, isLoading: false, isError: false, refetch: vi.fn() };
  for (const f of [h.resolve, h.edit, h.toTask, h.accept, h.dismiss, h.invalidate, h.toastError, h.toastSuccess, h.toastMessage, h.confirm]) f.mockClear();
  h.confirm.mockImplementation(async () => true);
  window.location.hash = "";
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PromisesSection", () => {
  it("is collapsed to one count line, then lists active and proposed with who, date and age", async () => {
    await mount();
    expect(text()).toContain("2 promises · 467 proposed");
    expect(rowOf(1)).toBeNull();

    await open();
    expect(text()).toContain("Promises Nick caught in your chats and journal");
    const one = rowOf(1)!.textContent!;
    expect(one).toContain("Send Mash the alignment quote");
    expect(one).toContain("to Mash");
    expect(one).toContain("no date");
    expect(one).toContain("2 mo");
    const two = rowOf(2)!.textContent!;
    expect(two).not.toContain("to self");
    expect(two).toContain("due Nov 12");
    const nine = rowOf(9)!;
    expect(nine.textContent).toContain("Call the insurance agent back");
    expect(button("Accept", nine)).toBeTruthy();
    expect(button("Dismiss", nine)).toBeTruthy();
    expect(text()).toContain("Newest 1 of 467");
  });

  it("opens itself when the page lands on #promises", async () => {
    window.location.hash = "#promises";
    await mount();
    expect(rowOf(1)).not.toBeNull();
  });

  it("Done sends completed through promiseResolve and the row leaves at once", async () => {
    await mount();
    await open();
    await click(button("Done", rowOf(1)!));
    expect(h.resolve).toHaveBeenCalledWith({ id: 1, action: "done" });
    expect(rowOf(1)).toBeNull();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("Drop asks the house confirm in its danger tone, never window.confirm, then drops", async () => {
    const native = vi.spyOn(window, "confirm");
    await mount();
    await open();
    await click(button("Drop", rowOf(1)!));
    expect(native).not.toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ tone: "danger", confirmLabel: "Drop" });
    expect(h.resolve).toHaveBeenCalledWith({ id: 1, action: "drop" });
    native.mockRestore();
  });

  it("a declined Drop changes nothing", async () => {
    h.confirm.mockResolvedValueOnce(false);
    await mount();
    await open();
    await click(button("Drop", rowOf(1)!));
    expect(h.resolve).not.toHaveBeenCalled();
    expect(rowOf(1)).not.toBeNull();
  });

  it("Edit saves text, to whom and a cleared deadline through promiseEdit", async () => {
    await mount();
    await open();
    await click(button("Edit", rowOf(2)!));
    const row = rowOf(2)!;
    await type(row.querySelector("textarea"), "Walk every morning");
    await type(row.querySelector("input[name='toWhom']"), "Dr. Lee");
    await click(button("No date", row));
    await click(button("Save", row));
    expect(h.edit).toHaveBeenCalledWith({ id: 2, description: "Walk every morning", toWhom: "Dr. Lee", deadline: null });
  });

  it("Make it a task files into the chosen mission, Inbox by default, and leaves the promise open", async () => {
    await mount();
    await open();
    await click(button("Make it a task", rowOf(1)!));
    const row = rowOf(1)!;
    const select = row.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Inbox", "Shop OS"]);
    await click(button("Make the task", row));
    expect(h.toTask).toHaveBeenLastCalledWith({ id: 1, missionId: null });
    expect(rowOf(1)).not.toBeNull();

    await click(button("Make it a task", rowOf(2)!));
    await type(rowOf(2)!.querySelector("select"), "m1");
    await click(button("Make the task", rowOf(2)!));
    expect(h.toTask).toHaveBeenLastCalledWith({ id: 2, missionId: "m1" });
  });

  it("a second Make it a task that finds the same task says so", async () => {
    h.toTask.mockResolvedValueOnce({ taskId: "t9", created: false });
    await mount();
    await open();
    await click(button("Make it a task", rowOf(1)!));
    await click(button("Make the task", rowOf(1)!));
    expect(h.toastMessage).toHaveBeenCalledWith("Already a task.");
  });

  it("a promise with a task links to it instead of offering a second one", async () => {
    h.query = {
      ...h.query,
      data: { ...LIST, active: [{ ...LIST.active[0], task: { id: "t9", status: "READY" } }], activeCount: 1 },
    };
    await mount();
    await open();
    expect(button("Make it a task", rowOf(1)!)).toBeUndefined();
    expect(rowOf(1)!.querySelector("a[href='/missions#task-row-t9']")).not.toBeNull();
  });

  it("Accept reaches the existing proposal mutation", async () => {
    await mount();
    await open();
    await click(button("Accept", rowOf(9)!));
    expect(h.accept).toHaveBeenCalledWith({ id: 9 });
  });

  it("Dismiss reaches the existing proposal mutation", async () => {
    await mount();
    await open();
    await click(button("Dismiss", rowOf(9)!));
    expect(h.dismiss).toHaveBeenCalledWith({ id: 9 });
  });

  it("a rejected read renders unknown, never the empty state", async () => {
    h.query = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    await mount();
    expect(text()).toContain("Couldn't load promises (state unknown, not empty)");
    await open();
    expect(text()).not.toContain("No open promises.");
    expect(text()).not.toMatch(/\d+ promises/);
  });

  it("an empty read says so plainly", async () => {
    h.query = { ...h.query, data: { active: [], proposed: [], activeCount: 0, proposedCount: 0 } };
    await mount();
    expect(text()).toContain("0 promises · 0 proposed");
    await open();
    expect(text()).toContain("No open promises.");
  });

  it("a failed write toasts and keeps the row", async () => {
    h.resolve.mockRejectedValueOnce(new Error("db down"));
    await mount();
    await open();
    await click(button("Done", rowOf(1)!));
    expect(h.toastError).toHaveBeenCalled();
    expect(rowOf(1)).not.toBeNull();
  });
});
