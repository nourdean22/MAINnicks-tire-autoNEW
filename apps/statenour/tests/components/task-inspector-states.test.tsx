/**
 * TaskInspector wiring (2026-09-15): the breakdown when task.byId carries
 * one, the manual-override line when the row is overridden, the stored
 * explanation string as the deploy-window fallback, and the page's lent
 * actions only when a page registered them.
 *
 * Static markup (Node, no DOM). The store is stubbed the way
 * evidence-mark-modes.test.tsx does: zustand serves getInitialState() to a
 * static render, so a real store could never show registered actions here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PriorityBreakdown } from "@/lib/scoring/task-priority";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({ data: undefined, isLoading: false, isError: false, error: null });
  return { query: blank(), blank };
});

const store = vi.hoisted(() => {
  const state: { pageActions: Record<string, unknown[]>; realityMode: boolean } = { pageActions: {}, realityMode: false };
  const setState = (patch: Partial<typeof state>) => Object.assign(state, patch);
  const useInspectorStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    setState,
    getState: () => state,
  });
  return { state, useInspectorStore, setState };
});

vi.mock("@/lib/state/inspector-store", () => ({ useInspectorStore: store.useInspectorStore }));
vi.mock("@/lib/state/workset-store", () => ({
  useWorksetStore: (sel: (s: unknown) => unknown) => sel({ entries: [], add: () => {}, remove: () => {}, has: () => false }),
}));
vi.mock("@/lib/trpc/client", () => {
  // 2026-10-29 · the detail children (steps, notes, photos, recall line) read their own procedures.
  const idle = () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: async () => {} });
  const mutation = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isError: false, error: null, variables: undefined });
  const invalidate = { invalidate: async () => {} };
  return {
    trpc: {
      task: {
        byId: { useQuery: () => stubs.query },
        subtasks: { useQuery: () => ({ ...idle(), data: [] }) },
        attachments: { useQuery: () => ({ ...idle(), data: [] }) },
        recallLine: { useQuery: () => ({ ...idle(), data: { state: "none" } }) },
        subtaskAdd: { useMutation: mutation },
        update: { useMutation: mutation },
        notesSave: { useMutation: mutation },
        attachmentDelete: { useMutation: mutation },
      },
      useUtils: () => ({ task: { byId: invalidate, subtasks: invalidate, attachments: invalidate } }),
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/missions",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { TaskInspector } from "@/components/inspector/panels/task-inspector";

const ENTITY = { kind: "task", id: "t1" } as const;

const BREAKDOWN: PriorityBreakdown = {
  terms: [
    { key: "roi", label: "roi", input: 55, weight: 0.13, contribution: 7.15, note: "roi 55 (hand-assigned)" },
    { key: "dueUrgency", label: "deadline", input: 73, weight: 0.27, contribution: 19.71, note: "due in 0d" },
  ],
  weightedSum: 26.86,
  multipliers: [],
  score: 27,
};

const TASK = {
  id: "t1",
  title: "Call Eddy about the lift",
  status: "READY",
  autoPriority: 27,
  autoPriorityExplanation: "picked because: due in 0d · roi 55 → 27",
  mission: { title: "Shop", domain: "BUSINESS" },
};

beforeEach(() => {
  stubs.query = stubs.blank();
  store.setState({ pageActions: {} });
});

const render = () => renderToStaticMarkup(<TaskInspector entity={ENTITY} mode="inspect" />);

describe("TaskInspector · why this priority", () => {
  it("renders the scorer's breakdown when the read carries one", () => {
    stubs.query.data = { ...TASK, priorityBreakdown: BREAKDOWN, priorityManual: false };
    const html = render();
    expect(html).toContain('data-priority-breakdown="27"');
    expect(html).toContain('data-priority-term="dueUrgency"');
    expect(html).not.toContain("picked because");
  });

  it("a manual override says so and shows no terms", () => {
    stubs.query.data = { ...TASK, priorityBreakdown: null, priorityManual: true, manualPriorityOverride: 88 };
    const html = render();
    expect(html).toContain('data-priority-manual="88"');
    expect(html).toContain("set by you");
    expect(html).not.toContain("data-priority-breakdown");
  });

  it("falls back to the stored explanation string when the payload has no breakdown (deploy window)", () => {
    stubs.query.data = TASK;
    const html = render();
    expect(html).toContain("due in 0d · roi 55");
    expect(html).toContain("→ 27");
    expect(html).not.toContain("data-priority-breakdown");
  });
});

describe("TaskInspector · page actions", () => {
  it("shows no page actions and points at the board when nothing is registered", () => {
    stubs.query.data = { ...TASK, priorityBreakdown: BREAKDOWN };
    const html = render();
    expect(html).not.toContain("data-inspector-page-actions");
    expect(html).toContain("open it there to act");
  });

  it("renders the actions the page lent, 44px on phones, and drops the pointer", () => {
    store.setState({
      pageActions: {
        task: [
          { id: "complete", label: "complete", tone: "primary", run: () => {} },
          { id: "snooze-tomorrow", label: "snooze · tomorrow 6am", run: () => {} },
        ],
      },
    });
    stubs.query.data = { ...TASK, priorityBreakdown: BREAKDOWN };
    const html = render();
    expect(html).toContain('data-inspector-page-actions="2"');
    expect(html).toContain("snooze · tomorrow 6am");
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain("open it there to act");
  });

  it("the not-found state carries no page actions (there is no task to act on)", () => {
    store.setState({ pageActions: { task: [{ id: "complete", label: "complete", run: () => {} }] } });
    stubs.query.data = null;
    const html = render();
    expect(html).toContain('data-inspector-state="not-found"');
    expect(html).not.toContain("data-inspector-page-actions");
  });
});

describe("TaskInspector · detail sections (2026-10-29)", () => {
  it("renders notes with the stored text, and photos", () => {
    stubs.query = { ...stubs.blank(), data: { ...TASK, notes: "fixture note" } };
    const html = render();
    expect(html).toContain('data-task-notes="t1"');
    expect(html).toContain("fixture note");
    expect(html).toContain('data-task-photos="t1"');
    expect(html).toContain("No photos yet");
  });
});
