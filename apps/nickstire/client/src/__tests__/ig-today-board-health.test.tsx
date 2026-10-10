/**
 * Today reads the SAME "needs attention" the Board does.
 *
 * Today built its broken list from `instagramStudio.list` with its own rule
 * (status ambiguous or failed). The Board's Attention lane reads the server's
 * classifier (`computeStudioItemState`), which also flags STALLED: a row marked
 * scheduled with no pending publish to ever fire it, or a publish claim older
 * than 15 minutes. A stalled schedule was red on the Board and "Nothing needs
 * you — verified" on Today (2026-10-10 Instagram audit, C3). One query, one
 * rule: Today reads `instagramStudio.board` and keys on `health`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => Promise<unknown> };
const h = vi.hoisted(() => ({
  queries: {} as Record<string, QueryResult>,
  asked: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

vi.mock("@/lib/trpc", () => {
  const ok = (): QueryResult => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
  const utils = (): unknown => new Proxy({}, { get: (_t, prop) => (prop === "invalidate" ? async () => {} : utils()) });
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        if (prop === "useQuery") return () => { h.asked.push(path.join(".")); return h.queries[path.join(".")] ?? ok(); };
        if (prop === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
        if (prop === "useUtils") return () => utils();
        return make([...path, prop]);
      },
    });
  return { trpc: make([]) };
});

import Today from "../pages/admin/instagram/Today";

const q = (data: unknown): QueryResult => ({ data, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
const boardItem = (over: Record<string, unknown>) => ({
  id: "ig_1", version: 2, lifecycle: "scheduled", health: "healthy", scheduledAt: null, publishedAt: null, error: null,
  updatedAt: "2026-10-10T12:00:00.000Z", runId: null,
  draft: { topic: "Winter tire swap timing", format: "post", imageUrls: [], quality: { overall: 82 } },
  ...over,
});

afterEach(cleanup);
beforeEach(() => {
  h.asked = [];
  h.queries = {
    "instagramStudio.board": q([]),
    "instagramStudio.diagnostics": q({ connected: true, counts: {} }),
    // HQ (rendered inside Today) dereferences storage/generator/meta, so the
    // health shape is complete even though only `meta` matters here.
    "instagramAdmin.getPipelineHealth": q({
      meta: { connected: true, live: true },
      storage: { configured: true, permanentUrls: true },
      generator: { configured: true, enabled: true, provider: "higgsfield" },
      failedJobs: 0,
    }),
    "contentAdmin.reelJobsNeedingAttention": q({ count: 0, jobs: [] }),
    "instagramAdmin.getDeliveryIssues": q({ issues: [] }),
    "instagramAdmin.getReelReliability": q({ total: 0 }),
  };
});

describe("the decision list", () => {
  it("lists a STALLED schedule the Board's Attention lane shows, instead of 'Nothing needs you'", () => {
    h.queries["instagramStudio.board"] = q([boardItem({ lifecycle: "scheduled", health: "stalled" })]);
    render(<Today onNavigate={() => {}} />);
    expect(screen.getByText(/Winter tire swap timing/)).toBeTruthy();
    expect(screen.getByText(/stalled|will never fire|nothing will fire/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing needs you right now/)).toBeNull();
  });

  it("reads the Board's read-model, not the list its own rule used to filter", () => {
    render(<Today onNavigate={() => {}} />);
    expect(h.asked).toContain("instagramStudio.board");
    expect(h.asked).not.toContain("instagramStudio.list");
  });

  it("PLANTED CANARY: an empty, readable board still prints the verified all-clear", () => {
    render(<Today onNavigate={() => {}} />);
    expect(screen.getByText(/Nothing needs you right now/)).toBeTruthy();
  });

  it("an unreadable board prints incomplete, never clear", () => {
    h.queries["instagramStudio.board"] = { data: undefined, isLoading: false, isError: true, error: new Error("outage"), refetch: () => Promise.resolve() };
    render(<Today onNavigate={() => {}} />);
    expect(screen.getByText(/incomplete/)).toBeTruthy();
    expect(screen.queryByText(/Nothing needs you right now/)).toBeNull();
  });
});
