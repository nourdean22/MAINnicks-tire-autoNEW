import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * People tracker close-out (2026-10-31): the people backfill wrote 36 ledger rows and one embed failed
 * ("Response from the Engine was empty"). enqueueLedgerEmbed runs once, fire-and-forget, and only logs a
 * failure, and this cron had no relationship_ledger lane, so that note stayed out of /people search for good.
 * The lane retries any live ledger note (>= 20 chars, person not deleted) that has no vector row.
 */

const { mockPrisma, enqueueLedgerEmbed, enqueuePersonEmbed } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    vectorEmbedding: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn() },
    brainDump: { findMany: vi.fn() },
    reflection: { findMany: vi.fn() },
    situationLog: { findMany: vi.fn() },
    decisionReplay: { findMany: vi.fn() },
    strategicLaw: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
  },
  enqueueLedgerEmbed: vi.fn(),
  enqueuePersonEmbed: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeGenericEmbedding: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/brain/people-embed-hook", () => ({ enqueueLedgerEmbed, enqueuePersonEmbed }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

import { GET } from "@/app/api/cron/embed-backfill/route";

const LEDGER_ROWS = [
  { id: "L1", note: "Talked about his new job and the move next spring" },
  { id: "L2", note: "Promised to send the photos from the wedding" },
];
const isLedgerLane = (strings: TemplateStringsArray) => /FROM relationship_ledger/i.test(strings.join("?"));
const isPersonLane = (strings: TemplateStringsArray) => /FROM person_profiles/i.test(strings.join("?"));
const PEOPLE = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
const ledgerSql = () => {
  const call = mockPrisma.$queryRaw.mock.calls.find((c) => isLedgerLane(c[0]));
  return call ? (call[0] as string[]).join("?") : "";
};
const invoke = async () =>
  (await (GET as unknown as (r: Request, c: unknown) => Promise<unknown>)(
    new Request("http://test/api/cron/embed-backfill"),
    { params: Promise.resolve({}) },
  )) as { report: Record<string, { processed: number; success: number; remaining: number }>; resultCount: number };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    if (isLedgerLane(strings)) return LEDGER_ROWS;
    if (isPersonLane(strings)) return PEOPLE;
    return /COUNT\(\*\)/i.test(strings.join("?")) ? [{ n: 0n }] : [];
  });
  for (const k of ["vectorEmbedding", "brainMemory", "brainDump", "reflection", "situationLog", "decisionReplay", "strategicLaw", "chatMessage"] as const) {
    mockPrisma[k].findMany.mockResolvedValue([]);
  }
  enqueueLedgerEmbed.mockResolvedValue(true);
  enqueuePersonEmbed.mockResolvedValue(true);
});

describe("cron/embed-backfill · relationship_ledger lane", () => {
  it("re-embeds ledger notes that have no vector row, through the people embed hook", async () => {
    const out = await invoke();
    expect(enqueueLedgerEmbed).toHaveBeenCalledWith("L1", LEDGER_ROWS[0].note);
    expect(enqueueLedgerEmbed).toHaveBeenCalledWith("L2", LEDGER_ROWS[1].note);
    expect(out.report.relationship_ledger).toEqual({ processed: 2, success: 2, remaining: 0 });
    expect(out.resultCount).toBe(5); // 2 ledger notes + 3 people
  });

  it("selects by actual missing-ness, skips short notes and deleted people, and is bounded", () =>
    invoke().then(() => {
      const sql = ledgerSql();
      expect(sql).toMatch(/NOT EXISTS/i);
      expect(sql).toMatch(/"sourceType" = 'relationship_ledger'/);
      expect(sql).toMatch(/length\(rl\.note\) >= 20/i);
      expect(sql).toMatch(/deleted_at IS NULL/i);
      expect(sql).toMatch(/LIMIT/i);
    }));

  it("a failed retry is processed but not counted, so the next run tries again", async () => {
    enqueueLedgerEmbed.mockResolvedValueOnce(false);
    const out = await invoke();
    expect(out.report.relationship_ledger).toEqual({ processed: 2, success: 1, remaining: 0 });
    expect(out.resultCount).toBe(4);
  });

  it("CONTROL: nothing missing -> the hook is never called", async () => {
    mockPrisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      /COUNT\(\*\)/i.test(strings.join("?")) ? [{ n: 0n }] : [],
    );
    const out = await invoke();
    expect(enqueueLedgerEmbed).not.toHaveBeenCalled();
    expect(out.report.relationship_ledger).toEqual({ processed: 0, success: 0, remaining: 0 });
  });
});

// Same hole one function up: enqueuePersonEmbed also only logs a failure. Read-only prod read 2026-10-31:
// 12 of 20 live people had no person_profile vector, so /people semantic search could not rank them.
describe("cron/embed-backfill · person_profile lane", () => {
  const personSql = () => {
    const call = mockPrisma.$queryRaw.mock.calls.find((c) => isPersonLane(c[0]));
    return call ? (call[0] as string[]).join("?") : "";
  };

  it("embeds live people that have no vector row, through the people embed hook", async () => {
    const out = await invoke();
    for (const p of PEOPLE) expect(enqueuePersonEmbed).toHaveBeenCalledWith(p.id);
    expect(out.report.person_profile).toEqual({ processed: 3, success: 3, remaining: 0 });
  });

  it("selects by actual missing-ness, skips deleted people, and is bounded", async () => {
    await invoke();
    const sql = personSql();
    expect(sql).toMatch(/NOT EXISTS/i);
    expect(sql).toMatch(/"sourceType" = 'person_profile'/);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(sql).toMatch(/LIMIT/i);
  });

  it("a failed retry is processed but not counted", async () => {
    enqueuePersonEmbed.mockResolvedValueOnce(false);
    const out = await invoke();
    expect(out.report.person_profile).toEqual({ processed: 3, success: 2, remaining: 0 });
  });
});
