/**
 * Instagram Settings: a FAILED read is UNKNOWN, never "not configured".
 *
 * The three reads behind the page are dbAdminProcedures that throw when TiDB
 * is unreachable. The page handled only isLoading, so a database blip rendered
 * three red "fix your keys" cards over a configuration that was fine, and the
 * form seeded itself from blank data (2026-10-10 Instagram audit, C1). The
 * page must say the read failed and offer a retry, and must NOT print the
 * "incomplete identifiers" verdict it cannot know.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => Promise<unknown> };
const h = vi.hoisted(() => ({
  queries: {} as Record<string, QueryResult>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// A path-keyed stand-in for the tRPC client: every `trpc.a.b.useQuery()` reads
// h.queries["a.b"]; mutations return an inert handle; useUtils invalidates nothing.
vi.mock("@/lib/trpc", () => {
  const ok = (): QueryResult => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });
  const utils = (): unknown => new Proxy({}, { get: (_t, prop) => (prop === "invalidate" ? async () => {} : utils()) });
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        if (prop === "useQuery") return () => h.queries[path.join(".")] ?? ok();
        if (prop === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });
        if (prop === "useUtils") return () => utils();
        return make([...path, prop]);
      },
    });
  return { trpc: make([]) };
});

import Settings from "../pages/admin/instagram/Settings";

const healthy = (): QueryResult => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => Promise.resolve() });

afterEach(cleanup);
beforeEach(() => {
  h.queries = {
    "instagramAdmin.getConnectionStatus": healthy(),
    "instagramAdmin.getPipelineHealth": healthy(),
    "instagramAdmin.getMetaConfig": healthy(),
  };
});

describe("a failed settings read", () => {
  it("renders UNKNOWN with a retry, not the 'incomplete identifiers' verdict", () => {
    const refetch = vi.fn(() => Promise.resolve());
    h.queries["instagramAdmin.getConnectionStatus"] = { data: undefined, isLoading: false, isError: true, error: new Error("TiDB unreachable"), refetch };
    render(<Settings />);

    expect(screen.getByText(/could not read/i)).toBeTruthy();
    expect(screen.getByText(/TiDB unreachable/)).toBeTruthy();
    expect(screen.queryByText(/Meta identifiers or access token are incomplete/)).toBeNull();
    expect(screen.queryByText("NEEDS ATTENTION")).toBeNull();

    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry.className).toContain("min-h-11");
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("PLANTED CANARY: a successful read with nothing configured still says NEEDS ATTENTION", () => {
    h.queries["instagramAdmin.getConnectionStatus"] = { ...healthy(), data: { configured: false, facebookReady: false, instagramReady: false, token: { present: false } } };
    render(<Settings />);
    expect(screen.getByText(/Meta identifiers or access token are incomplete/)).toBeTruthy();
    expect(screen.queryByText(/could not read/i)).toBeNull();
  });
});
