/**
 * Reel Queue: a REFUSED reject is reported, not swallowed.
 *
 * rejectDraft is the one mutation on the page whose server refusals carry a
 * specific instruction ("unschedule first", "resolve the ambiguity first", a
 * version mismatch), and it was the one mutation with no onError. The confirm
 * panel closed, the draft stayed as it was, and nothing said why (2026-10-10
 * Instagram audit, C2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => Promise<unknown> };
const h = vi.hoisted(() => ({
  queries: {} as Record<string, QueryResult>,
  mutations: {} as Record<string, { onSuccess?: (...a: unknown[]) => void; onError?: (err: Error) => void } | undefined>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// Path-keyed tRPC stand-in. useMutation CAPTURES its options so the test can
// drive the handler the server would call on a refusal.
vi.mock("@/lib/trpc", () => {
  const ok = (): QueryResult => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
  const utils = (): unknown => new Proxy({}, { get: (_t, prop) => (prop === "invalidate" ? async () => {} : utils()) });
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        if (prop === "useQuery") return () => h.queries[path.join(".")] ?? ok();
        if (prop === "useMutation") return (opts: unknown) => {
          h.mutations[path.join(".")] = opts as (typeof h.mutations)[string];
          return { mutate: () => {}, mutateAsync: async () => {}, isPending: false };
        };
        if (prop === "useUtils") return () => utils();
        return make([...path, prop]);
      },
    });
  return { trpc: make([]) };
});

import ReelQueue from "../pages/admin/instagram/ReelQueue";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  h.mutations = {};
  h.queries = {
    "instagramAdmin.getAllDrafts": { data: [], isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() },
    "instagramAdmin.reelPublishQueue": { data: undefined, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() },
  };
});

describe("rejectDraft", () => {
  it("surfaces the server's refusal as a toast with the server's own message", () => {
    render(<ReelQueue />);
    const reject = h.mutations["instagramAdmin.rejectDraft"];
    expect(reject).toBeDefined();
    expect(typeof reject?.onError).toBe("function");

    reject!.onError!(new Error("Unschedule it first — a pending publish still points at this draft."));

    expect(toast.error).toHaveBeenCalledWith(
      "Reject refused",
      expect.objectContaining({ description: "Unschedule it first — a pending publish still points at this draft." }),
    );
  });

  it("PLANTED CANARY: the page's other mutations already report their errors the same way", () => {
    render(<ReelQueue />);
    const approve = h.mutations["instagramAdmin.approveDraft"];
    approve!.onError!(new Error("hash mismatch"));
    expect(toast.error).toHaveBeenCalledWith("Approval Failed", expect.objectContaining({ description: "hash mismatch" }));
  });
});
