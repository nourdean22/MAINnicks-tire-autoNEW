/**
 * OwnerPanel states (Q-24, 2026-09-23). The panel renders what the server
 * decided, so this pins only the render boundary: a failed first read is
 * "state unknown, not empty"; an unreadable approvals source never prints a
 * decisions count of 0; an UNMEASURED tile renders a dash and its reason,
 * never a zero; a clean read renders the rows with their evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { composeOwnerPanel, type OwnerPanelInput } from "@/lib/system/owner-panel";

const stub = vi.hoisted(() => ({ q: { data: undefined as unknown, isError: false } }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: { system: { ownerPanel: { useQuery: () => stub.q } } },
}));

import { OwnerPanel } from "@/components/system/owner-panel";

const now = new Date("2026-09-23T16:00:00Z");
const base: OwnerPanelInput = {
  now,
  todayYmd: "2026-09-23",
  cronRows: [],
  deployPages: [],
  pendingActions: [],
  approvalRequests: [],
  expiredRequests: { count: 0, oldest: null },
  commitments: [],
  lanes: [],
  outboxHealth: {
    pending: 0,
    processing: 0,
    done24h: 0,
    dead: 0,
    oldestDeadAt: null,
    lastDeadError: null,
  },
  actionAttempts: [],
  spend: { costCents: 500, calls: 10, unpricedCalls: 0 },
  tasksDone: 0,
};

beforeEach(() => {
  stub.q = { data: undefined, isError: false };
});

describe("OwnerPanel render states", () => {
  it("renders a failed first read as unknown, never as a clear", () => {
    stub.q = { data: undefined, isError: true };
    const html = renderToStaticMarkup(<OwnerPanel />);
    expect(html).toContain("state unknown, not empty");
    expect(html).not.toContain("nothing needs you");
  });

  it("does not print a decisions count of 0 when approvals were unreadable", () => {
    stub.q = { data: composeOwnerPanel({ ...base, pendingActions: null }), isError: false };
    const html = renderToStaticMarkup(<OwnerPanel />);
    expect(html).toContain("decisions waiting · unknown");
    expect(html).toContain("Decision sources unreadable — state unknown.");
    expect(html).toContain("Unreadable, so not cleared: approvals");
    expect(html).toContain('data-owner-panel="unknown"');
  });

  it("renders an UNMEASURED ratio as a dash with its reason, not $0.00", () => {
    stub.q = { data: composeOwnerPanel(base), isError: false };
    const html = renderToStaticMarkup(<OwnerPanel />);
    expect(html).toContain("a ratio over zero outcomes is not a number");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("decisions waiting · 0");
  });

  it("renders an exception with its evidence and a link to the surface", () => {
    stub.q = {
      data: composeOwnerPanel({
        ...base,
        cronRows: [{ id: "c1", jobName: "sync", status: "failed", error: "timeout", skipReason: null, createdAt: new Date(now.getTime() - 90 * 60_000) }],
      }),
      isError: false,
    };
    const html = renderToStaticMarkup(<OwnerPanel />);
    expect(html).toContain("cron sync failed");
    expect(html).toContain("cron_job_logs c1");
    expect(html).toContain('href="/system/crons"');
    expect(html).toContain(">1h<");
  });
});
