// @vitest-environment jsdom
/**
 * UI v3 W2 (2026-10-16): BriefRows as rendered and as clicked (react-dom/client in jsdom, the
 * bottom-tab-bar-pinned pattern). Pins what a source grep cannot: Less removes the kind, persists
 * under nour:brief-feedback and announces it; Show hidden is there while anything is hidden; the
 * three empty states; Approve goes through the house confirm in its danger tone (never
 * window.confirm) and then the right existing mutation per source, with a failed run, a conflict
 * and a rejection each reading honestly; owner-gated rows offer Review; the lead CTA records
 * `accepted`; "N more" expands instead of dropping rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_o: unknown) => true),
  approveRequest: vi.fn(async (_i: unknown) => ({ ok: true })),
  decideAction: vi.fn(async (_i: unknown) => ({ result: null as string | null })),
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

// The feedback hook hydrates from localStorage on a 0 ms timer, so a flush is a macrotask.
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
const buttons = (text: string) =>
  Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text) as HTMLButtonElement[];
const button = (text: string) => buttons(text)[0] as HTMLButtonElement | undefined;
const buttonStartingWith = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
const approvalsItem = HOME_BRIEF.judgment.items.find((i) => i.kind === "approvals");
const pending = approvalsItem?.kind === "approvals" ? approvalsItem.pending : [];
const live = () => container.querySelector('[aria-live="polite"]')?.textContent ?? "";
const alertIn = (kind: string) => container.querySelector(`[data-brief-row="${kind}"] [role="alert"]`)?.textContent ?? "";
const hideAll = () =>
  window.localStorage.setItem(
    BRIEF_FEEDBACK_KEY,
    JSON.stringify(Object.fromEntries(["lead", "approval", "commitment", "followup", "contradiction"].map((k) => [k, { verdict: "less", at: Date.now() }]))),
  );
/** Ten candidate rows: the DEMO seven plus three follow-ups, so the cap has something to hold back. */
const TEN_ROWS = {
  ...HOME_BRIEF,
  judgment: {
    ...HOME_BRIEF.judgment,
    items: [...HOME_BRIEF.judgment.items, ...Array.from({ length: 3 }, (_, i) => ({ kind: "followup" as const, id: `extra-${i}`, title: `Demo extra follow-up ${i}` }))],
  },
};

beforeEach(() => {
  window.localStorage.clear();
  h.confirm.mockClear();
  h.confirm.mockImplementation(async () => true);
  h.approveRequest.mockClear();
  h.approveRequest.mockImplementation(async () => ({ ok: true }));
  h.decideAction.mockClear();
  h.decideAction.mockImplementation(async () => ({ result: null }));
  h.decide.mockClear();
  h.invalidateBrief.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BriefRows", () => {
  it("renders the DEMO brief as seven ruled rows, lead first, each with Keep and Less, no horizon rows and no N more", async () => {
    await mount(HOME_BRIEF);
    expect(rows()).toEqual(["lead", "approval", "approval", "approval", "commitment", "followup", "contradiction"]);
    expect(container.querySelectorAll('button[data-brief-verdict="less"]')).toHaveLength(7);
    expect(container.querySelectorAll('button[data-brief-verdict="keep"]')).toHaveLength(7);
    expect(container.textContent).toContain(HOME_BRIEF.lead.headline);
    expect(container.textContent).not.toContain("7 of 7");
    expect(container.querySelector("[data-brief-more]"), "seven candidates, seven shown: nothing to expand").toBeNull();
    expect(container.textContent, "the horizon is the rail's, not a row").not.toContain(HOME_BRIEF.horizon.slots[0].label);
  });

  it("N more expands the brief in place instead of dropping rows", async () => {
    await mount(TEN_ROWS);
    expect(rows()).toHaveLength(7);
    await act(async () => button("3 more")!.click());
    expect(rows()).toHaveLength(10);
    expect(button("Show fewer")).toBeTruthy();
  });

  it("decision detail sits on its own line: the contradiction's Before side and the commitment's domain and evidence", async () => {
    await mount(HOME_BRIEF);
    expect(container.querySelector('[data-brief-row="contradiction"]')?.textContent).toContain("Before: Demo: the quote ships on Friday");
    expect(container.querySelector('[data-brief-row="commitment"]')?.textContent).toContain("work · proposed from a demo conversation");
  });

  it("Less on a follow-up row removes the kind at once, persists it under nour:brief-feedback and announces it", async () => {
    await mount(HOME_BRIEF);
    const less = container.querySelector('[data-brief-row="followup"] button[data-brief-verdict="less"]') as HTMLButtonElement;
    expect(less.getAttribute("aria-label")).toBe("Fewer follow-ups: hide them for seven days");
    await act(async () => less.click());
    expect(rows()).not.toContain("followup");
    const stored = JSON.parse(window.localStorage.getItem(BRIEF_FEEDBACK_KEY) ?? "{}");
    expect(stored.followup?.verdict).toBe("less");
    expect(typeof stored.followup?.at).toBe("number");
    expect(live()).toContain("Hidden: follow-ups");
    expect(document.activeElement?.textContent, "focus moved to the section heading").toBe("The brief");
  });

  it("Show hidden is offered while rows remain, not only when the brief is empty (review round 1: a 7-day lockout)", async () => {
    window.localStorage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify({ commitment: { verdict: "less", at: Date.now() } }));
    await mount(HOME_BRIEF);
    expect(rows()).not.toContain("commitment");
    expect(rows()).toHaveLength(6);
    await act(async () => button("Show hidden (1)")!.click());
    expect(rows()).toContain("commitment");
    expect(window.localStorage.getItem(BRIEF_FEEDBACK_KEY)).toBe("{}");
  });

  it("two Less taps both hold when the device refuses to store them (quota or private mode)", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      await mount(HOME_BRIEF);
      await act(async () => (container.querySelector('[data-brief-row="followup"] button[data-brief-verdict="less"]') as HTMLButtonElement).click());
      await act(async () => (container.querySelector('[data-brief-row="commitment"] button[data-brief-verdict="less"]') as HTMLButtonElement).click());
      expect(rows()).not.toContain("followup");
      expect(rows()).not.toContain("commitment");
      expect(button("Show hidden (2)")).toBeTruthy();
    } finally {
      setItem.mockRestore();
    }
  });

  it("a Less older than seven days no longer hides anything", async () => {
    window.localStorage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify({ commitment: { verdict: "less", at: Date.now() - 8 * 86_400_000 } }));
    await mount(HOME_BRIEF);
    expect(rows()).toContain("commitment");
  });

  it("an error lead stays visible with no Less button even when the lead kind is hidden on the device", async () => {
    window.localStorage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify({ lead: { verdict: "less", at: Date.now() } }));
    await mount({ ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, kind: "error", headline: "Board unreadable" } });
    expect(rows()[0]).toBe("lead");
    expect(container.querySelector('[data-brief-row="lead"] button[data-brief-verdict="less"]')).toBeNull();
  });

  it("Approve on a request row asks the house dialog in its danger tone, never window.confirm, then calls the request mutation", async () => {
    const native = vi.spyOn(window, "confirm");
    await mount(HOME_BRIEF);
    const approve = button("Approve");
    expect(approve, "an Approve button on the first pending request").toBeTruthy();
    await act(async () => approve!.click());
    await flush();
    expect(native).not.toHaveBeenCalled();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ tone: "danger", confirmLabel: "Approve" });
    expect(h.approveRequest).toHaveBeenCalledWith({ id: pending[0].id });
    expect(h.decideAction).not.toHaveBeenCalled();
    expect(h.invalidateBrief).toHaveBeenCalled();
    expect(live()).toContain("Approved");
    expect(container.querySelector('[data-testid="house-dialog"]')).toBeTruthy();
  });

  it("an autonomous-action row offers Review, never Approve: its payload is a deferred side effect Home does not show (Codex 4291673580)", async () => {
    await mount(HOME_BRIEF);
    expect(pending[1].source).toBe("action");
    const actionRow = container.querySelectorAll('[data-brief-row="approval"]')[1]!;
    expect(actionRow.textContent).toContain(pending[1].title);
    expect(actionRow.querySelector("a")?.getAttribute("href")).toBe("/system/actions?tab=approvals");
    expect(actionRow.querySelector("a")?.textContent).toBe("Review");
    expect(Array.from(actionRow.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Approve")).toBe(false);
    expect(buttons("Approve"), "only the request row approves in place").toHaveLength(1);
    expect(h.decideAction).not.toHaveBeenCalled();
  });

  it("a rejected approve shows the failure in the row as an alert; a CONFLICT reads Already decided", async () => {
    h.approveRequest.mockRejectedValueOnce(new Error("boom"));
    await mount(HOME_BRIEF);
    await act(async () => button("Approve")!.click());
    await flush();
    expect(alertIn("approval")).toContain("That did not save");

    h.approveRequest.mockRejectedValueOnce(Object.assign(new Error("decided"), { data: { code: "CONFLICT" } }));
    await act(async () => button("Approve")!.click());
    await flush();
    expect(alertIn("approval")).toContain("Already decided");
  });

  it("a declined confirm approves nothing", async () => {
    h.confirm.mockResolvedValueOnce(false);
    await mount(HOME_BRIEF);
    await act(async () => button("Approve")!.click());
    await flush();
    expect(h.approveRequest).not.toHaveBeenCalled();
  });

  it("a server refusal (the owner gate, a message with a code) shows its message verbatim in the row; no client-side gate decides for the one user", async () => {
    h.approveRequest.mockRejectedValueOnce(Object.assign(new Error("Owner privilege is required to approve this action"), { data: { code: "FORBIDDEN" } }));
    await mount(HOME_BRIEF);
    expect(container.textContent).not.toContain("Owner approval");
    await act(async () => button("Approve")!.click());
    await flush();
    expect(alertIn("approval")).toContain("Owner privilege is required to approve this action");
  });

  it("the lead CTA records accepted with the task as resultRef (the ledger wiring survives the recomposition)", async () => {
    await mount(HOME_BRIEF);
    const cta = container.querySelector('[data-lead-decision="accepted"]') as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe(HOME_BRIEF.lead.cta!.href);
    await act(async () => cta.click());
    expect(h.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "accepted", resultRef: `task:${HOME_BRIEF.lead.taskId}` }));
  });

  it("Done for today: nothing failed and nothing hidden, one line, no Show hidden", async () => {
    const empty = { ...HOME_BRIEF, lead: { ...HOME_BRIEF.lead, cta: null }, judgment: { ...HOME_BRIEF.judgment, items: [], totalCount: 0 }, horizon: { slots: [], measured: true } };
    await mount(empty);
    expect(container.textContent).toContain("Done for today.");
    expect(buttonStartingWith("Show hidden")).toBeUndefined();
  });

  it("zero rows with a failed source is State unknown, never Done (empty-vs-error)", async () => {
    const failed = {
      ...HOME_BRIEF,
      lead: { ...HOME_BRIEF.lead, cta: null },
      judgment: { ...HOME_BRIEF.judgment, items: [], totalCount: 0, failedSources: ["approvals"] },
      horizon: { slots: [], measured: true },
    };
    await mount(failed);
    expect(container.textContent).toContain("State unknown: approvals unavailable, not empty.");
    expect(container.textContent).not.toContain("Done for today");
  });

  it("when Less hid everything the line is Nothing shown, and Show hidden brings the rows back", async () => {
    hideAll();
    await mount(HOME_BRIEF);
    expect(rows()).toEqual([]);
    expect(container.textContent).toContain("Nothing shown.");
    expect(container.textContent).not.toContain("Done for today");
    await act(async () => buttonStartingWith("Show hidden")!.click());
    expect(rows()).toHaveLength(7);
    expect(window.localStorage.getItem(BRIEF_FEEDBACK_KEY)).toBe("{}");
  });

  it("loading renders a busy skeleton, never the Done line", async () => {
    await mount(null, true);
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(container.textContent).not.toContain("Done for today");
  });
});
