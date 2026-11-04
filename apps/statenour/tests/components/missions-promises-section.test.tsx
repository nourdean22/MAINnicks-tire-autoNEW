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
  invList: vi.fn(async () => {}),
  invProposed: vi.fn(async () => {}),
  invTaskList: vi.fn(async () => {}),
  invDeck: vi.fn(async () => {}),
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
        operator: { promisesList: { invalidate: h.invList }, commitmentsProposed: { invalidate: h.invProposed } },
        task: { list: { invalidate: h.invTaskList }, deck: { invalidate: h.invDeck } },
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
  for (const f of [h.resolve, h.edit, h.toTask, h.accept, h.dismiss, h.invList, h.invProposed, h.invTaskList, h.invDeck, h.toastError, h.toastSuccess, h.toastMessage, h.confirm]) f.mockClear();
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
    expect(h.invList).toHaveBeenCalled();
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

  it("Edit sends only what changed, so a legacy deadline the date field cannot show is never wiped", async () => {
    h.query = { ...h.query, data: { ...LIST, active: [{ ...LIST.active[0], deadline: "next Friday", deadlineDays: null }] } };
    await mount();
    await open();
    expect(rowOf(1)!.textContent).toContain("due next Friday");
    await click(button("Edit", rowOf(1)!));
    await type(rowOf(1)!.querySelector("textarea"), "Send Mash the quote");
    await click(button("Save", rowOf(1)!));
    expect(h.edit).toHaveBeenCalledWith({ id: 1, description: "Send Mash the quote" });
  });

  it("a Done that finds the promise already closed says so instead of claiming it was kept", async () => {
    h.resolve.mockResolvedValueOnce({ resolved: false });
    await mount();
    await open();
    await click(button("Done", rowOf(1)!));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastMessage).toHaveBeenCalledWith("Already closed elsewhere.");
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
    // the task-done close (checkTask) is what keeps the promise now; the toast says so
    expect(h.toastSuccess).toHaveBeenLastCalledWith("Task made. The promise closes when the task is done.");
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

  it("an accepted proposal shows up in the active list once the read returns it", async () => {
    await mount();
    await open();
    await click(button("Accept", rowOf(9)!));
    expect(rowOf(9)).toBeNull();
    h.query = { ...h.query, data: { ...LIST, active: [...LIST.active, { ...LIST.proposed[0] }], proposed: [], activeCount: 3, proposedCount: 466 } };
    await mount();
    expect(button("Done", rowOf(9)!)).toBeTruthy();
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

  it("an overdue row and a due-today row say so exactly, and only the overdue one is amber", async () => {
    h.query = {
      ...h.query,
      data: {
        ...LIST,
        active: [
          { ...LIST.active[1], id: 5, toWhom: "self", deadline: "2026-11-01", deadlineDays: -2, ageDays: 3 },
          { ...LIST.active[1], id: 6, toWhom: "self", deadline: "2026-11-03", deadlineDays: 0, ageDays: 0 },
        ],
      },
    };
    await mount();
    await open();
    const meta = (id: number) => rowOf(id)!.querySelector("p.font-mono") as HTMLElement;
    expect(meta(5).textContent).toBe("was due Nov 1 · 3 d");
    expect(meta(5).className).toContain("text-amber-300/90");
    expect(meta(6).textContent).toBe("due today · today");
    expect(meta(6).className).not.toContain("text-amber");
  });

  it("a row whose age could not be read shows no age, never a made-up one", async () => {
    h.query = { ...h.query, data: { ...LIST, active: [{ ...LIST.active[0], ageDays: null }] } };
    await mount();
    await open();
    expect((rowOf(1)!.querySelector("p.font-mono") as HTMLElement).textContent).toBe("to Mash · no date");
  });

  it("opens when the hash changes to #promises after the page loaded", async () => {
    await mount();
    expect(rowOf(1)).toBeNull();
    await act(async () => {
      window.location.hash = "#promises";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await flush();
    expect(rowOf(1)).not.toBeNull();
  });

  it("a failed Make it a task toasts an error and keeps the row", async () => {
    h.toTask.mockRejectedValueOnce(new Error("db down"));
    await mount();
    await open();
    await click(button("Make it a task", rowOf(1)!));
    await click(button("Make the task", rowOf(1)!));
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(rowOf(1)).not.toBeNull();
  });

  it("a lost response rechecks instead of claiming the write failed (Done and Make it a task)", async () => {
    h.resolve.mockRejectedValueOnce(new Error("socket hang up"));
    await mount();
    await open();
    await click(button("Done", rowOf(1)!));
    expect(h.toastError).toHaveBeenLastCalledWith("Could not confirm the save; rechecking.");
    expect(h.invList).toHaveBeenCalledTimes(1);

    h.toTask.mockRejectedValueOnce(new Error("socket hang up"));
    await click(button("Make it a task", rowOf(2)!));
    await click(button("Make the task", rowOf(2)!));
    expect(h.toastError).toHaveBeenLastCalledWith("Could not confirm the save; rechecking.");
    expect(h.invList).toHaveBeenCalledTimes(2);
  });

  it("Make it a task says when a task is still being made, or the promise closed meanwhile", async () => {
    h.toTask.mockResolvedValueOnce({ taskId: null, reason: "in_flight" }).mockResolvedValueOnce({ taskId: null, reason: "not_active" });
    await mount();
    await open();
    await click(button("Make it a task", rowOf(1)!));
    await click(button("Make the task", rowOf(1)!));
    expect(h.toastMessage).toHaveBeenCalledWith("That task is still being made.");
    await click(button("Make it a task", rowOf(2)!));
    await click(button("Make the task", rowOf(2)!));
    expect(h.toastError).toHaveBeenCalledWith("This promise is no longer open.");
  });

  it("a failed edit keeps the form and says so; an edit that matched nothing says the promise closed", async () => {
    h.edit.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ ok: false });
    await mount();
    await open();
    await click(button("Edit", rowOf(2)!));
    await type(rowOf(2)!.querySelector("textarea"), "Walk every morning");
    await click(button("Save", rowOf(2)!));
    expect(h.toastError).toHaveBeenLastCalledWith("That did not save. Your edit is still here.");
    expect(rowOf(2)!.querySelector("textarea")).not.toBeNull();
    await click(button("Save", rowOf(2)!));
    expect(h.toastError).toHaveBeenLastCalledWith("This promise is no longer open.");
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
