/**
 * NourState.staleLeads / overdueCommitments (audit 08-F6b, 2026-10-10).
 *
 * loadAll read `cmd.brief.staleLeads` and `cmd.brief.overdueCommitments` with
 * `?? 0`, but /api/command/data's brief carries neither key (it sends topTasks,
 * primaryMission, driftState, personalWinTarget, avoidThis, counts). Both were a
 * fabricated 0 on every load, and @critical told Nick "0 stale leads".
 *
 * Same harness as nour-state-pending-callbacks.test.tsx: React's hooks are
 * stubbed so the real loadAll runs and the state it commits is captured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  initial: undefined as unknown,
  committed: [] as unknown[],
  apiFetch: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      h.initial = init;
      return [init, (next: unknown) => h.committed.push(next)];
    },
    useEffect: (fn: () => unknown) => {
      h.effects.push(fn);
    },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});
vi.mock("@/lib/events/data-change", () => ({
  notifyDataChanged: vi.fn(),
  onDataChanged: vi.fn(() => () => {}),
}));
vi.mock("@/lib/utils/api-fetch", () => ({
  apiFetch: (url: string) => h.apiFetch(url),
}));

import { NourStateProvider } from "@/lib/state/nour-state";

type Loaded = { staleLeads: number | null; overdueCommitments: number | null };

/** The brief exactly as app/api/command/data/route.ts builds it. */
const REAL_BRIEF = {
  topTasks: [],
  primaryMission: null,
  driftState: { level: "low" },
  personalWinTarget: "",
  avoidThis: "",
  counts: { activeMissions: 1, openTasks: 3, urgentLeads: 0, atRiskCustomers: 0 },
};

async function load(cmd: unknown): Promise<Loaded> {
  h.apiFetch.mockImplementation((url: string) =>
    url === "/api/command/data" ? Promise.resolve(cmd) : Promise.resolve(null),
  );
  NourStateProvider({ children: null });
  await h.effects[0]!();
  await vi.waitFor(() => expect(h.committed.length).toBeGreaterThan(0));
  return h.committed.at(-1) as Loaded;
}

beforeEach(() => {
  h.effects = [];
  h.committed = [];
  h.initial = undefined;
  h.apiFetch.mockReset();
});

describe("NourState brief counts the route never sends", () => {
  it("the real brief shape leaves staleLeads and overdueCommitments unknown (null), never 0", async () => {
    const s = await load({ shop: {}, brief: REAL_BRIEF });
    expect(s.staleLeads).toBeNull();
    expect(s.overdueCommitments).toBeNull();
  });

  it("before the first load both are null, never 0", () => {
    NourStateProvider({ children: null });
    expect((h.initial as Loaded).staleLeads).toBeNull();
    expect((h.initial as Loaded).overdueCommitments).toBeNull();
  });

  it("CONTROL: a brief that does carry the counts keeps them, a measured 0 included", async () => {
    const s = await load({ shop: {}, brief: { ...REAL_BRIEF, staleLeads: 2, overdueCommitments: 0 } });
    expect(s.staleLeads).toBe(2);
    expect(s.overdueCommitments).toBe(0);
  });
});
