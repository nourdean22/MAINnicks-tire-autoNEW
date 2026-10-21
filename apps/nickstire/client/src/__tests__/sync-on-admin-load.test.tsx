/**
 * Sync on a full admin page load (Nour, 2026-10-21: "whenever i login or refresh the admin").
 *
 * The trigger lives in the admin SHELL, after adminReady, so /admin?tab=revenue and every other
 * tab syncs on a refresh, not only the Today page. It asks once per document (a browser refresh
 * is a new document; a tab change or an in-app return is not). The marker is "pending" while the
 * call is out, "done" once the server accepted it, and cleared when the call is rejected: with
 * MFA on, the first call is refused by adminProcedure, and a marker set before the answer would
 * swallow the only sync of the load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  calls: 0,
  invalidated: 0,
  started: true,
  /** "reject": the server refuses the call (MFA not cleared); "hang": no answer yet. */
  mode: "accept" as "accept" | "reject" | "hang",
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      controlCenter: { shopSales: { invalidate: () => { h.invalidated++; return Promise.resolve(); } } },
    }),
    shopdriver: {
      syncOnAdminLoad: {
        useMutation: (opts?: { onSuccess?: (r: { started: boolean }) => void; onError?: (e: Error) => void }) => ({
          mutate: () => {
            h.calls++;
            if (h.mode === "reject") opts?.onError?.(new Error("MFA required"));
            else if (h.mode === "accept") opts?.onSuccess?.({ started: h.started });
          },
        }),
      },
    },
  },
}));

import { useSyncOnAdminLoad } from "@/lib/useSyncOnAdminLoad";

/** A new document: a browser refresh clears the once-per-load marker on window. */
const newDocument = () => {
  delete (window as unknown as Record<string, unknown>).__adminLoadSyncAsked;
};

beforeEach(() => {
  h.calls = 0;
  h.invalidated = 0;
  h.started = true;
  h.mode = "accept";
  newDocument();
});

describe("the admin shell syncs once per page load, after adminReady", () => {
  it("does nothing until the shell is ready, then asks once", () => {
    const { rerender } = renderHook(({ ready }) => useSyncOnAdminLoad(ready), { initialProps: { ready: false } });
    expect(h.calls).toBe(0);
    rerender({ ready: true });
    expect(h.calls).toBe(1);
    rerender({ ready: true });
    expect(h.calls).toBe(1);
  });

  it("does not ask again for a tab change, a re-render or coming back in the same document", () => {
    const first = renderHook(() => useSyncOnAdminLoad(true));
    first.rerender();
    first.unmount();
    renderHook(() => useSyncOnAdminLoad(true));
    expect(h.calls).toBe(1);
  });

  it("a browser refresh (a new document) asks again", () => {
    renderHook(() => useSyncOnAdminLoad(true)).unmount();
    newDocument();
    renderHook(() => useSyncOnAdminLoad(true));
    expect(h.calls).toBe(2);
  });

  it("a first call the server refuses (MFA not cleared) does not use up the page load", () => {
    h.mode = "reject";
    renderHook(() => useSyncOnAdminLoad(true)).unmount();
    expect(h.calls).toBe(1);
    h.mode = "accept"; // MFA cleared
    renderHook(() => useSyncOnAdminLoad(true)).unmount();
    expect(h.calls).toBe(2);
    renderHook(() => useSyncOnAdminLoad(true)); // accepted now: the page load is used up
    expect(h.calls).toBe(2);
  });

  it("a call still waiting for its answer is not doubled by a second mount", () => {
    h.mode = "hang";
    renderHook(() => useSyncOnAdminLoad(true)).unmount();
    renderHook(() => useSyncOnAdminLoad(true));
    expect(h.calls).toBe(1);
  });

  it("re-reads the sales card once the call is accepted, so the card can see the probe it started", () => {
    renderHook(() => useSyncOnAdminLoad(true));
    expect(h.invalidated).toBe(1);
  });

  it("does not re-read on a refused call", () => {
    h.mode = "reject";
    renderHook(() => useSyncOnAdminLoad(true));
    expect(h.invalidated).toBe(0);
  });
});

describe("the consumer: the shell calls it, the Billed card does not", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("Admin.tsx calls the hook with adminReady, outside any section", () => {
    const admin = read("client/src/pages/Admin.tsx");
    expect(admin).toMatch(/import \{ useSyncOnAdminLoad \} from "@\/lib\/useSyncOnAdminLoad"/);
    expect(admin).toMatch(/useSyncOnAdminLoad\(adminReady\)/);
  });

  it("SalesCard shows and polls only: it no longer triggers a sync", () => {
    const card = read("client/src/pages/admin/SalesCard.tsx");
    expect(card).not.toMatch(/syncOnAdminLoad/);
    expect(card).not.toMatch(/deep link/i);
  });
});
