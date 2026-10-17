/**
 * Admin UI v1 Wave 3: Approve stops looking like a destructive act (PLAN.md section 3, W3).
 *
 * Approving a held item is the job this page exists for, so its confirm uses the default (primary)
 * tone; it keeps two taps and its "This runs immediately" message. Reject stays the destructive one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_opts: Record<string, unknown>) => false),
  approve: vi.fn(),
  rows: [] as unknown[],
}));
vi.mock("@/lib/trpc", () => {
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery")
          return () => ({ data: path === "proposals.list" ? h.rows : [], isLoading: false, isError: false, error: null, refetch: () => {} });
        if (key === "useMutation")
          return () => ({ mutate: path === "proposals.approve" ? h.approve : () => {}, isPending: false });
        if (key === "invalidate") return async () => {};
        return node(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return {
    trpc: new Proxy({}, {
      get(_t, key) {
        if (key === "useUtils" || key === "useContext") return () => node("utils");
        return node(String(key));
      },
    }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: () => null }));
import ApprovalsSection from "@/pages/admin/ApprovalsSection";

const now = new Date().toISOString();
h.rows = [
  { id: "p-1", source: "ai", actor: "nick-agent", actionType: "create_callback", entityType: "lead", entityId: "1", title: "Call Aisha Brooks back", payloadJson: {}, contextJson: {}, confidence: 82, status: "pending_review", reviewedBy: null, reviewedAt: null, reviewNote: null, executedAt: null, executionResultJson: null, idempotencyKey: null, createdAt: now, updatedAt: now, downstream: null },
];

afterEach(() => {
  h.confirm.mockClear();
  h.approve.mockClear();
});

describe("Approve confirm", () => {
  it("is not a red, destructive confirm, and keeps its runs-immediately warning", async () => {
    render(<ApprovalsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Approve & execute" }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    const opts = h.confirm.mock.calls[0][0];
    expect(opts.tone ?? "default").toBe("default");
    expect(String(opts.message)).toContain("This runs immediately after approval.");
  });

  it("still takes two taps: a cancelled confirm executes nothing", async () => {
    render(<ApprovalsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Approve & execute" }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.approve).not.toHaveBeenCalled();
  });

  it("Reject stays the destructive control", () => {
    render(<ApprovalsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("button", { name: "Confirm reject" }).className).toContain("bg-destructive");
  });
});
