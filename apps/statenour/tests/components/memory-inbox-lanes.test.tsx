/**
 * UI v3 W5b, /system/inbox: Priority (conflicting, needs a ruling) first, Other behind a closed
 * "Other, N" disclosure. Resolve, reject and coexist stay exactly as they were.
 *
 * THE DEFECT. One flat list in arrival order: a quarantined item that contradicts a saved memory
 * (the only status that needs Nour's ruling) sat among items that only wait for review.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown>, mutateAsync: vi.fn(async () => {}) }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      getQuarantinedItems: { useQuery: () => h.q },
      resolveInboxItem: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false }) },
    },
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import MemoryInboxPage from "@/app/(mastery)/system/inbox/page";

const item = (id: string, status: string, text: string) => ({
  id,
  sourceUrl: null,
  sourceType: "gmail",
  rawTextFenced: text,
  extractedClaims: [{ text: `claim of ${id}` }],
  contradictionLogs: [],
  privacyClass: "private",
  status,
  createdAt: new Date().toISOString(),
});
const ITEMS = [
  item("i1", "pending_review", "Pending note one"),
  item("i2", "conflicting", "Conflicting note"),
  item("i3", "pending_review", "Pending note two"),
];
const q = (over: Record<string, unknown>) => ({
  data: undefined,
  isError: false,
  isPending: false,
  isFetching: false,
  error: null,
  dataUpdatedAt: 1,
  refetch: () => {},
  ...over,
});

let root: Root | null = null;
let host: HTMLDivElement;
function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<MemoryInboxPage />));
}
const list = () => host.querySelector('[data-inbox-list=""]') as HTMLElement;
const button = (name: RegExp) =>
  Array.from(host.querySelectorAll("button")).find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  h.q = q({ data: ITEMS });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("/system/inbox: conflicting first, the rest behind Other", () => {
  it("the Priority lane holds the conflicting item; Other is closed with its count", () => {
    render();
    expect(list().textContent).toContain("Priority");
    expect(list().textContent).toContain("Conflicting note");
    expect(list().textContent).not.toContain("Pending note one");
    const other = button(/^Other, 2/);
    expect(other?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opening Other shows the remaining items", () => {
    render();
    act(() => button(/^Other, 2/)!.click());
    expect(button(/^Other, 2/)!.getAttribute("aria-expanded")).toBe("true");
    expect(list().textContent).toContain("Pending note one");
    expect(list().textContent).toContain("Pending note two");
  });

  it("the detail opens on the conflicting item and keeps all three verdicts", async () => {
    render();
    expect(button(/^Overwrite Conflicting$/)).toBeTruthy();
    expect(button(/^Reject$/)).toBeTruthy();
    expect(button(/^Coexist$/)).toBeTruthy();
    await act(async () => button(/^Coexist$/)!.click());
    expect(h.mutateAsync).toHaveBeenCalledWith({ id: "i2", verdict: "coexist" });
  });

  // 2026-10-29 sync audit, finding 6: Overwrite replaces a saved memory, so it asks first, in the DOM.
  it("Overwrite asks first: Cancel writes nothing, Overwrite in the dialog sends the verdict", async () => {
    render();
    const inDialog = (name: RegExp) =>
      Array.from(document.body.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')).find((b) =>
        name.test(b.textContent ?? ""),
      ) as HTMLButtonElement | undefined;
    await act(async () => button(/^Overwrite Conflicting$/)!.click());
    expect(h.mutateAsync).not.toHaveBeenCalled();
    await act(async () => inDialog(/^Cancel$/)!.click());
    expect(h.mutateAsync).not.toHaveBeenCalled();
    await act(async () => button(/^Overwrite Conflicting$/)!.click());
    await act(async () => inDialog(/^Overwrite$/)!.click());
    expect(h.mutateAsync).toHaveBeenCalledWith({ id: "i2", verdict: "overwrite" });
  });

  // Codex P2 on #3161: with only Other items the detail pane opened on a hidden item, showing its
  // raw text and its Reject / Coexist verbs while Other was still collapsed.
  it("only-Other inbox: no detail until Other is opened and an item tapped; collapsing clears it", () => {
    h.q = q({ data: [ITEMS[0], ITEMS[2]] });
    render();
    expect(host.textContent).not.toContain("Memory Review");
    expect(button(/^Reject$/)).toBeUndefined();
    act(() => button(/^Other, 2/)!.click());
    expect(host.textContent).not.toContain("Memory Review");
    const pick = Array.from(list().querySelectorAll("button")).find((b) => /Pending note two/.test(b.textContent ?? ""))!;
    act(() => pick.click());
    expect(host.textContent).toContain("Memory Review");
    expect(button(/^Reject$/)).toBeTruthy();
    act(() => button(/^Other, 2/)!.click());
    expect(host.textContent).not.toContain("Memory Review");
    act(() => button(/^Other, 2/)!.click());
    expect(host.textContent).not.toContain("Memory Review");
  });

  it("CONTROL: a Priority item still opens the detail by itself", () => {
    render();
    expect(host.textContent).toContain("Memory Review");
    expect(button(/^Overwrite Conflicting$/)).toBeTruthy();
  });

  it("CONTROL: with nothing conflicting, Priority says so and Other still lists the rest", () => {
    h.q = q({ data: [ITEMS[0], ITEMS[2]] });
    render();
    expect(list().textContent).toContain("Nothing needs a ruling.");
    expect(button(/^Other, 2/)).toBeTruthy();
  });
});
