/**
 * TIME TRAVEL MUST NOT SHOW A FAILED READ AS A REAL ZERO -- 2026-10-01.
 *
 * GET /api/brain/time-travel runs eleven reads for one ET day, each ending
 * in `.catch(() => 0 | [] | null)` with no record of which one failed. The
 * panel (components/brain/time-travel-panel.tsx) then printed
 * "0 tasks done", "identity snapshot absent", "emotion not logged" for a day
 * that may well have had activity -- a database hiccup rendered as a quiet day.
 *
 * Fix: the route reports `degradedReads` (which reads failed), and the panel
 * renders "—" for those values plus one visible "some of this day could not
 * be read" banner. Asserted end-to-end: the REAL route runs against a mocked
 * Prisma, and its REAL output is rendered by the panel's snapshot view.
 *
 * The CONTROL proves a genuinely empty day still renders as a measured zero
 * and "absent" -- so the fix did not just replace every zero with a dash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const ok = <T,>(v: T) => () => Promise.resolve(v);
const fail = () => Promise.reject(new Error("db hiccup"));

const m = {
  brainMemoryCount: vi.fn(ok(0)),
  brainMemoryGroupBy: vi.fn(ok([] as unknown[])),
  brainMemoryFindFirst: vi.fn(ok(null as unknown)),
  brainMemoryFindMany: vi.fn(ok([] as unknown[])),
  chatFindMany: vi.fn(ok([] as unknown[])),
  taskCount: vi.fn(ok(0)),
  brainDumpFindMany: vi.fn(ok([] as unknown[])),
  reflectionFindMany: vi.fn(ok([] as unknown[])),
  decisionFindMany: vi.fn(ok([] as unknown[])),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      count: () => m.brainMemoryCount(),
      groupBy: () => m.brainMemoryGroupBy(),
      findFirst: () => m.brainMemoryFindFirst(),
      findMany: () => m.brainMemoryFindMany(),
    },
    chatConversation: { findMany: () => m.chatFindMany() },
    task: { count: () => m.taskCount() },
    brainDump: { findMany: () => m.brainDumpFindMany() },
    reflection: { findMany: () => m.reflectionFindMany() },
    masteryDecision: { findMany: () => m.decisionFindMany() },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/utils/http", () => ({
  apiHandler: (fn: (req: Request, ctx: unknown) => unknown) => (req: Request) => fn(req, {}),
}));

import { GET } from "@/app/api/brain/time-travel/route";
import { TimeTravelSnapshot, type TimeTravelReport } from "@/components/brain/time-travel-panel";

async function snapshot(): Promise<TimeTravelReport & { degradedReads?: string[] }> {
  // JSON round-trip: the panel receives what the wire carries, not live Dates.
  const raw = await GET(new Request("http://x/api/brain/time-travel?date=2026-09-30"), {} as never);
  return JSON.parse(JSON.stringify(raw));
}

/** The text of the stat tile whose label is `label`, e.g. "tasks done". */
function tile(html: string, label: string): string | undefined {
  const re = new RegExp(`<div[^>]*>([^<]*)</div><div[^>]*>${label}</div>`);
  return html.match(re)?.[1];
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.brainMemoryCount.mockImplementation(ok(0));
  m.brainMemoryGroupBy.mockImplementation(ok([]));
  m.brainMemoryFindFirst.mockImplementation(ok(null));
  m.brainMemoryFindMany.mockImplementation(ok([]));
  m.chatFindMany.mockImplementation(ok([]));
  m.taskCount.mockImplementation(ok(0));
  m.brainDumpFindMany.mockImplementation(ok([]));
  m.reflectionFindMany.mockImplementation(ok([]));
  m.decisionFindMany.mockImplementation(ok([]));
});

describe("route · names the reads that failed", () => {
  it("CONTROL - every read succeeds: degradedReads is present and empty", async () => {
    const report = await snapshot();
    expect(report.degradedReads).toEqual([]);
  });

  it("a failed task count is reported, not silently zeroed", async () => {
    m.taskCount.mockImplementation(fail);
    m.brainMemoryFindFirst.mockImplementation(fail);
    const report = await snapshot();
    expect(report.degradedReads).toEqual(
      expect.arrayContaining(["tasksCreated", "tasksCompleted", "identitySnapshot", "healthDigest"]),
    );
    expect(report.degradedReads).not.toContain("memoriesCreated");
  });
});

describe("panel · unknown never renders as zero or as 'absent'", () => {
  it("CONTROL - a genuinely empty day renders measured zeros and 'absent', no banner", async () => {
    const html = renderToStaticMarkup(<TimeTravelSnapshot report={await snapshot()} />);
    expect(tile(html, "tasks done")).toBe("0");
    expect(tile(html, "memories")).toBe("0");
    expect(html).toContain("identity snapshot absent");
    expect(html).toContain("emotion not logged");
    expect(html).not.toContain("could not be read");
  });

  it("failed reads render as — with one visible banner", async () => {
    m.taskCount.mockImplementation(fail);
    m.brainMemoryFindFirst.mockImplementation(fail);
    m.brainMemoryFindMany.mockImplementation(fail);
    const html = renderToStaticMarkup(<TimeTravelSnapshot report={await snapshot()} />);

    expect(tile(html, "tasks done")).toBe("—");
    expect(tile(html, "tasks made")).toBe("—");
    // A read that SUCCEEDED with a real zero is still a zero.
    expect(tile(html, "memories")).toBe("0");

    expect(html).not.toContain("identity snapshot absent");
    expect(html).toContain("identity snapshot —");
    expect(html).not.toContain("emotion not logged");
    expect(html).toContain("emotion —");
    expect(html).toContain("health —");

    expect(html.match(/could not be read/g)).toHaveLength(1);
  });

  it("a report from a server without degradedReads still renders (deploy skew)", async () => {
    const report = await snapshot();
    delete report.degradedReads;
    const html = renderToStaticMarkup(<TimeTravelSnapshot report={report} />);
    expect(tile(html, "tasks done")).toBe("0");
  });
});
