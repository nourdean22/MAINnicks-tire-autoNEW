// @vitest-environment jsdom
/**
 * Upgrade 3 of the Home maxim, rendered (2026-10-30, manager review of 3373): the real /system/actions and
 * /decisions/[id] pages, with every tRPC read answered by a table (unlisted reads stay pending). Pins:
 *   - two pending approvals give exactly ONE Maxim region, after the cards (no line pushes Approve/Reject down);
 *   - the decision page shows one Maxim region, after the edit controls;
 *   - both send tags plus `require: "decisions"`, never the decision or approval text;
 *   - in a card the verbs say "maxim", so Skip and Keep cannot read as acting on the approval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  inputs: {} as Record<string, unknown[]>,
}));

vi.mock("@/lib/trpc/client", () => {
  const query = (path: string) => (input: unknown) => {
    (h.inputs[path] ??= []).push(input);
    const data = h.data[path];
    return {
      data,
      isLoading: data === undefined,
      isPending: data === undefined,
      isError: false,
      isFetching: false,
      isPlaceholderData: false,
      isSuccess: data !== undefined,
      status: data === undefined ? "pending" : "success",
      fetchStatus: "idle",
      error: null,
      dataUpdatedAt: data === undefined ? 0 : 1,
      refetch: async () => ({}),
    };
  };
  const mutation = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, reset: () => {} });
  const utils: unknown = new Proxy(() => Promise.resolve(), { get: () => utils, apply: () => Promise.resolve() });
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, key: string) {
          if (key === "useQuery" || key === "useSuspenseQuery") return query(path.join("."));
          if (key === "useMutation") return mutation;
          if (key === "useUtils" || key === "useContext") return () => utils;
          return node([...path, key]);
        },
      },
    );
  return { trpc: node([]) };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {}, prefetch: () => {} }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }) }));

import ActionsPage from "@/app/(mastery)/system/actions/page";
import DecisionDetailPage from "@/app/(mastery)/decisions/[id]/page";

const MAXIM = { id: "demo-maxims:1", text: "Demo maxim: sleep on a big call.", source: "Demo Book", topic: "money", position: 1, total: 9 };
const approval = (id: string, reason: string) => ({
  id,
  toolId: "demo_tool",
  riskClass: "low",
  requestedBy: "nick",
  reason,
  payload: { demo: true },
  expired: false,
  expiresAt: null,
  createdAt: "2026-10-30T05:00:00.000Z",
});

let root: Root;
let host: HTMLDivElement;
async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(el);
    await Promise.resolve();
  });
}
const regions = () => Array.from(host.querySelectorAll('section[aria-label="Maxim"]'));
/** Every control outside the maxim comes before it: loading the line can push nothing down (the decision page). */
const maximIsLast = () => {
  const region = regions()[0]!;
  const others = Array.from(host.querySelectorAll("button, a[href], textarea, input")).filter((el) => !region.contains(el));
  return others.length > 0 && others.every((el) => el.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING);
};
const buttonsNamed = (name: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === name);

beforeEach(() => {
  h.inputs = {};
  h.data = { "operator.maxim": MAXIM };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/system/actions", () => {
  it("two pending approvals render ONE maxim, after every Approve button, from the top approval's tags", async () => {
    h.data["systemAutomation.getPendingApprovals"] = [
      approval("a1", "Pay the demo supplier invoice for Mrs Smith"),
      approval("a2", "Hire the demo helper"),
    ];
    await mount(<ActionsPage />);
    expect(regions()).toHaveLength(1);
    expect(buttonsNamed("Approve")).toHaveLength(2);
    // After both cards' controls, so loading it never moves an Approve or Reject under a finger.
    const cardControls = [...buttonsNamed("Approve"), ...buttonsNamed("Reject"), ...buttonsNamed("Edit args")];
    expect(cardControls).toHaveLength(6);
    expect(cardControls.every((b) => b.compareDocumentPosition(regions()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(h.inputs["operator.maxim"]?.[0]).toEqual({ step: 0, tags: ["money"], require: "decisions" });
    expect(JSON.stringify(h.inputs["operator.maxim"])).not.toContain("Smith");
    expect(regions()[0]!.textContent).toContain("Demo Book · for this approval: money");
  });

  it("in the card the verbs name the maxim, not the approval", async () => {
    h.data["systemAutomation.getPendingApprovals"] = [approval("a1", "Pay the demo invoice")];
    await mount(<ActionsPage />);
    const labels = Array.from(regions()[0]!.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Next maxim", "Keep maxim", "Skip maxim"]);
  });

  it("no pending approval, no maxim", async () => {
    h.data["systemAutomation.getPendingApprovals"] = [];
    await mount(<ActionsPage />);
    expect(regions()).toHaveLength(0);
  });
});

describe("/decisions/[id]", () => {
  it("shows one maxim, last on the page, from the decision's tags, never its words", async () => {
    h.data["operator.decisionDetail"] = {
      decision: {
        id: 1,
        date: "2026-10-20",
        title: "Demo: lease the second bay for Mrs Smith",
        domain: "business",
        stakes: "high",
        context: "Demo cash is tight this month",
        optionsConsidered: null,
        chosen: null,
        reasoning: null,
        predictedOutcome: null,
        emotionalState: null,
        reviewDate: null,
        actualOutcome: null,
        grade: null,
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
      lineage: {
        siblings: [{ id: 2, date: "2026-09-01", title: "Demo: the first bay call", grade: "B", actualOutcome: "Demo outcome", reviewDate: null }],
        antiPatterns: [],
      },
      timeline: { ageDays: 10, reviewDueDays: null, isReviewed: false, isOverdue: false },
    };
    await mount(<DecisionDetailPage />);
    expect(regions()).toHaveLength(1);
    expect(buttonsNamed("Grade decision")).toHaveLength(1);
    expect(maximIsLast()).toBe(true);
    expect(h.inputs["operator.maxim"]?.[0]).toEqual({ step: 0, tags: ["money"], require: "decisions" });
    expect(JSON.stringify(h.inputs["operator.maxim"])).not.toMatch(/Smith|lease|bay/);
    expect(regions()[0]!.textContent).toContain("for this decision: money");
  });
});
