// @vitest-environment jsdom
/**
 * /system/actions tap targets (lens B review P2, 2026-10-25): on a phone the Refresh button (px-4 py-2
 * text-xs, about 32 px), the window chips, the approval chips and "Clear rule filter" (px-3 py-1
 * text-xs, about 24 px) sat under the 44 px house floor (tests/e2e/target-size.spec.ts measures 44 px on
 * both axes; /system/actions is not one of its pages and its History fold is closed by default).
 *
 * jsdom does not lay out Tailwind, so, as in tests/components/journal-system-44px-controls.test.tsx, the
 * floor is read from the class of the measured element: min-h-11 (44 px) or larger on every control, and
 * a width floor on the chips ("24h" measured 43 px wide with px-3 alone). The page is rendered with
 * seeded data because the chips and the leaderboard only mount with a feed, and "Clear rule filter" only
 * exists after a rule row is clicked.
 *
 * P3 follow-up (lens B row 10): the pending queue's "Edit args" (32 px), "Approve edited" (visible only
 * while editing) and the deferred row's `<summary>payload</summary>` toggle are measured too; the test
 * opens the edit state to reach "Approve edited".
 *
 * Positive control: a planted px-3 py-1 control fails the same check, and the sweep must locate all twelve
 * controls (a scanner that matched nothing would pass on a deleted chip).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=logs"),
  usePathname: () => "/system/actions",
}));
vi.mock("@/lib/trpc/client", () => {
  const q = (data: unknown) => () => ({ data, isError: false, isPending: false, isFetching: false, refetch: () => {} });
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: { useQuery: q({
          totalInWindow: 3,
          generatedAt: "2026-10-25T12:00:00Z",
          rules: [{ ruleName: "rule.alpha", total: 3, success: 3, failed: 0, skipped: 0, successRate: 100, lastFiredAt: "2026-10-25T11:00:00Z" }],
          recent: [],
          approvalBreakdown: { auto: 1, pending: 1, approved: 1, rejected: 0, processing: 0, needs_review: 0, other: 0 },
        }) },
        getCurrentUser: { useQuery: q({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: q([]) },
        dismissApprovalReview: { useMutation: m },
      },
      systemAutomation: {
        // One pending approval (its "Edit args" control) and one deferred row (its payload toggle).
        getPendingApprovals: {
          useQuery: q([{ id: "a1", toolId: "sendSms", riskClass: "high", requestedBy: "nick", reason: "test", payload: { to: "x" } }]),
        },
        approvals: {
          useQuery: q({
            summary: { live: 1, expired: 0 },
            rows: [{ id: "r1", ruleName: "rule.beta", actionType: "sms", targetType: null, targetId: null, expired: false, expiresAt: "2026-10-26T12:00:00Z", policyObjective: null, payload: { b: 2 } }],
          }),
        },
        approvalWindows: { useQuery: q({ source: "default", defaultDays: 7, windows: [] }) },
        decideApproval: { useMutation: m },
      },
    },
  };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ actions, children }: { actions?: ReactNode; children?: ReactNode }) => (
    <main>
      <div data-page-actions>{actions}</div>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

/** Height floor: min-h-11 / min-h-[44px] / h-11 or taller. A later, smaller min-h would win, so it is read last. */
const HEIGHT_PX = (cls: string): number => {
  let px = 0;
  for (const m of cls.matchAll(/(?:^|\s)(?:min-h|h)-(\d+|\[(\d+)px\])(?=\s|$)/g)) {
    px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  }
  return px;
};
const WIDTH_PX = (cls: string): number => {
  let px = 0;
  for (const m of cls.matchAll(/(?:^|\s)(?:min-w|w)-(\d+|\[(\d+)px\])(?=\s|$)/g)) {
    px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  }
  return px;
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ActionsPage />);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// "Approve edited" renders only while a payload is being edited and parses; the seeded payload is valid JSON.
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const byText = (re: RegExp) => buttons().filter((b) => re.test((b.textContent ?? "").trim()));

/** The controls the reviews named, located by what they say. */
function subjects(): { label: string; el: HTMLElement; wide: boolean }[] {
  const out: { label: string; el: HTMLElement; wide: boolean }[] = [];
  for (const el of byText(/^Refresh$/)) out.push({ label: "Refresh", el, wide: false });
  for (const el of byText(/^(24h|7d|30d)$/)) out.push({ label: `window ${el.textContent}`, el, wide: true });
  for (const el of byText(/^(auto|pending|approved|rejected) ·/)) out.push({ label: `approval ${el.textContent}`, el, wide: true });
  for (const el of byText(/^Clear rule filter/)) out.push({ label: "Clear rule filter", el, wide: false });
  // P3 follow-up (lens B row 10): the pending-queue edit controls and the deferred row's payload toggle.
  for (const el of byText(/^(Edit args|Cancel edit)$/)) out.push({ label: el.textContent!.trim(), el, wide: true });
  for (const el of byText(/^Approve edited$/)) out.push({ label: "Approve edited", el, wide: true });
  for (const el of container.querySelectorAll<HTMLElement>("summary")) {
    if ((el.textContent ?? "").trim() === "payload") out.push({ label: "payload toggle", el, wide: true });
  }
  return out;
}

const selectRule = () => {
  const row = byText(/rule\.alpha/)[0];
  expect(row, "the seeded rule row rendered").toBeTruthy();
  act(() => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const openEdit = () => {
  const edit = byText(/^Edit args$/)[0];
  expect(edit, "the seeded approval's Edit args rendered").toBeTruthy();
  act(() => {
    edit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("/system/actions controls reach the 44 px floor", () => {
  it("renders Refresh, three window chips, four approval chips, Edit args and the payload toggle", () => {
    expect(subjects().length).toBe(10);
  });

  it("Clear rule filter and Approve edited exist only after their state is opened, and the sweep sees all twelve", () => {
    selectRule();
    expect(subjects().map((s) => s.label)).toContain("Clear rule filter");
    expect(subjects().length).toBe(11);
    openEdit();
    const labels = subjects().map((s) => s.label);
    expect(labels).toContain("Approve edited");
    expect(labels).toContain("Cancel edit");
    expect(labels).not.toContain("Edit args");
    expect(subjects().length).toBe(12);
  });

  it("every one is at least 44 px tall; the chips are at least 44 px wide", () => {
    // Collect every violation so a red run names all of them, not the first.
    const under: string[] = [];
    const measure = (stage: string) => {
      for (const { label, el, wide } of subjects()) {
        const cls = el.getAttribute("class") ?? "";
        if (HEIGHT_PX(cls) < 44) under.push(`${stage} ${label}: under 44 px tall`);
        if (wide && WIDTH_PX(cls) < 44) under.push(`${stage} ${label}: under 44 px wide`);
      }
    };
    selectRule();
    expect(subjects().length, "the subject rendered no controls").toBe(11);
    measure("closed:"); // includes "Edit args" and the payload toggle
    openEdit();
    expect(subjects().length).toBe(12);
    measure("editing:"); // includes "Cancel edit" and "Approve edited"
    expect(under).toEqual([]);
  });

  it("positive control: a planted px-3 py-1 control fails the same check", () => {
    const planted = "rounded-full px-3 py-1 text-xs transition";
    expect(HEIGHT_PX(planted)).toBe(0);
    expect(HEIGHT_PX("min-h-[32px] rounded-control")).toBe(32);
    expect(HEIGHT_PX("min-h-11 rounded-full")).toBe(44);
    expect(HEIGHT_PX("min-h-11 min-h-[32px]")).toBe(32);
    expect(WIDTH_PX("min-h-11 min-w-11")).toBe(44);
  });
});
