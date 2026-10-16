// @vitest-environment jsdom
/**
 * UI v3 W2 (2026-10-16): BriefRows as rendered and as clicked (react-dom/client in jsdom, the
 * bottom-tab-bar-pinned pattern). Pins the four behaviours a source grep cannot: Less removes the
 * kind and persists under nour:brief-feedback, Approve goes through the house confirm (never
 * window.confirm) and then the existing approve mutation, the lead CTA records `accepted`, and an
 * empty brief reads "Done for today." with a way back when Less hid everything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  approveRequest: vi.fn(async () => ({ ok: true })),
  decideAction: vi.fn(async () => ({ ok: true })),
  decide: vi.fn(),
  invalidateBrief: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: h.confirm, dialog: <div data-testid="house-dialog" /> }),
}));
vi.mock("@/lib/trpc/client", () => {
  const mutation = (fn: (...a: unknown[]) => unknown) => ({ mutate: fn, mutateAsync: fn, isPending: false });
  return {
    trpc: {
      useUtils: () => ({ operator: { brief: { invalidate: h.invalidateBrief } }, task: { inboxCount: { invalidate: vi.fn() } } }),
      operator: {
        recordRecommendationDecision: { useMutation: () => mutation(h.decide) },
        recordHomeSignal: { useMutation: () => mutation(vi.fn()) },
        commitmentAccept: { useMutation: () => mutation(vi.fn(async () => ({ ok: true }))) },
        commitmentDismiss: { useMutation: () => mutation(vi.fn(async () => ({ ok: true }))) },
        agendaConvertFollowUp: { useMutation: () => mutation(vi.fn(async () => ({ ok: true }))) },
        agendaDismissFollowUp: { useMutation: () => mutation(vi.fn(async () => ({ ok: true }))) },
        agendaSyncFollowUps: { useMutation: () => mutation(vi.fn()) },
        nickRemembersContext: { useQuery: () => ({ data: { anticipatedQuestions: [], followUps: [] } }) },
      },
      system: { approveApprovalRequest: { useMutation: () => mutation(h.approveRequest) } },
      systemAutomation: { decideApproval: { useMutation: () => mutation(h.decideAction) } },
    },
  };
});

import { BriefRows } from "@/components/home/brief-rows";
import { BRIEF_FEEDBACK_KEY } from "@/lib/ui/brief-feedback";
import { HOME_BRIEF } from "../e2e/fixtures/home";

let container: HTMLDivElement;
let root: Root;

// The feedback hook hydrates from localStorage on a 0 ms timer (the use-local-storage-state
// precedent), so a flush is a macrotask, not a microtask. A microtask flush made the "stored Less"
// case pass or fail on timing (seen once each way on 2026-10-16).
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

async function mount(brief: typeof HOME_BRIEF | null, loading = false) {
  await act(async () => {
    root.render(<BriefRows brief={brief} loading={loading} />);
  });
  await flush();
}

const rows = () => Array.from(container.querySelectorAll("[data-brief-row]")).map((el) => el.getAttribute("data-brief-row"));
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  window.localStorage.clear();
  h.confirm.mockClear();
  h.approveRequest.mockClear();
  h.decideAction.mockClear();
  h.decide.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BriefRows", () => {
  it("renders the DEMO brief as seven ruled rows, lead first, each with Keep and Less", async () => {
    await mount(HOME_BRIEF);
    expect(rows()).toEqual(["lead", "approval", "approval", "approval", "commitment", "followup", "contradiction"]);
    expect(container.querySelectorAll('button[data-brief-verdict="less"]')).toHaveLength(7);
    expect(container.querySelectorAll('button[data-brief-verdict="keep"]')).toHaveLength(7);
    expect(container.textContent).toContain(HOME_BRIEF.lead.headline);
  });

  it("Less on a follow-up row removes the kind at once and persists it under nour:brief-feedback", async () => {
    await mount(HOME_BRIEF);
    const less = container.querySelector('[data-brief-row="followup"] button[data-brief-verdict="less"]') as HTMLButtonElement;
    await act(async () => less.click());
    expect(rows()).not.toContain("followup");
    const stored = JSON.parse(window.localStorage.getItem(BRIEF_FEEDBACK_KEY) ?? "{}");
    expect(stored.followup?.verdict).toBe("less");
    expect(typeof stored.followup?.at).toBe("number");
  });

  it("a Less stored on the device hides that kind on the next mount, and the horizon moves up into the freed slot", async () => {
    window.localStorage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify({ commitment: { verdict: "less", at: Date.now() } }));
    await mount(HOME_BRIEF);
    expect(rows()).not.toContain("commitment");
    expect(rows()).toContain("horizon");
  });

  it("a Less older than seven days no longer hides anything", async () => {
    window.localStorage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify({ commitment: { verdict: "less", at: Date.now() - 8 * 86_400_000 } }));
    await mount(HOME_BRIEF);
    expect(rows()).toContain("commitment");
  });

  it("Approve on a request row asks the house dialog, never window.confirm, then calls the existing approve mutation", async () => {
    const native = vi.spyOn(window, "confirm");
    await mount(HOME_BRIEF);
    const approve = button("Approve");
    expect(approve, "an Approve button on the first pending request").toBeTruthy();
    await act(async () => approve!.click());
    await flush();
    expect(native).not.toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.approveRequest).toHaveBeenCalledWith({ id: HOME_BRIEF.judgment.items[0].kind === "approvals" ? HOME_BRIEF.judgment.items[0].pending[0].id : "" });
    expect(h.invalidateBrief).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="house-dialog"]')).toBeTruthy();
  });

  it("a declined confirm approves nothing", async () => {
    h.confirm.mockResolvedValueOnce(false);
    await mount(HOME_BRIEF);
    await act(async () => button("Approve")!.click());
    await flush();
    expect(h.approveRequest).not.toHaveBeenCalled();
  });

  it("the lead CTA records accepted with the task as resultRef (the ledger wiring survives the recomposition)", async () => {
    await mount(HOME_BRIEF);
    const cta = container.querySelector('[data-lead-decision="accepted"]') as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe(HOME_BRIEF.lead.cta!.href);
    await act(async () => cta.click());
    expect(h.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "accepted", resultRef: `task:${HOME_BRIEF.lead.taskId}` }));
  });

  it("Done for today: an empty brief is one line, with no Show hidden when nothing is hidden", async () => {
    const empty = { ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, cta: null }, judgment: { ...HOME_BRIEF.judgment, items: [], totalCount: 0 }, horizon: { slots: [], measured: true } };
    await mount(empty);
    expect(container.textContent).toContain("Done for today.");
    expect(button("Show hidden")).toBeUndefined();
  });

  it("when Less hid everything, Done for today offers Show hidden, which clears the map and brings the rows back", async () => {
    window.localStorage.setItem(
      BRIEF_FEEDBACK_KEY,
      JSON.stringify(Object.fromEntries(["lead", "approval", "commitment", "followup", "contradiction", "horizon"].map((k) => [k, { verdict: "less", at: Date.now() }]))),
    );
    await mount(HOME_BRIEF);
    expect(rows()).toEqual([]);
    expect(container.textContent).toContain("Done for today.");
    await act(async () => button("Show hidden")!.click());
    expect(rows()).toHaveLength(7);
    expect(window.localStorage.getItem(BRIEF_FEEDBACK_KEY)).toBe("{}");
  });

  it("loading renders a busy skeleton, never the Done line", async () => {
    await mount(null, true);
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(container.textContent).not.toContain("Done for today");
  });
});
