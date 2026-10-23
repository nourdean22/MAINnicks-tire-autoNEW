/**
 * tests/cron/data-cleanup-shadow-sweep-failure.test.ts · truth sweep 2026-10-23, acceptance 4.
 *
 * THE DEFECT. cron_job_logs filed data-cleanup as failed on 2026-10-21 and 2026-10-23 with the
 * reason "embedding shadow sweep threw — see error_logs", and error_logs held no row a search for
 * "shadow sweep" could find. The reason was a pointer, not an error: the real text never reached
 * cron_job_logs, and the row logError wrote read "[cron.data-cleanup] <driver text>" with the words
 * "shadow sweep" only in context.fn, so the pointer led nowhere a reader would look.
 *
 * Now: the real error text (first 200 chars) is the failure reason, the error_logs row carries the
 * same text under the words the reason uses, the write is AWAITED so its own failure is reported
 * instead of lost, and a green sweep writes no error row.
 *
 * Nothing about WHAT the cron deletes is touched; the delete wiring tests beside this one pin that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  errorRows: [] as Array<{ data: { level: string; message: string; stack: string | null; context: Record<string, unknown> } }>,
  errorLogWriteFails: false,
}));

const shadowMocks = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock("@/lib/db/embedding-shadow", () => ({ sweepEmbeddingShadow: shadowMocks.sweep }));
vi.mock("@/lib/brain/memory-tombstone", () => ({ dropEmbeddingsForMemories: () => Promise.resolve(0) }));
vi.mock("@/lib/system/stale-data-purger", () => ({
  purgeStaleCategory: () => Promise.resolve({ category: "pending_actions_7d", purged: 0, note: "" }),
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    deleteMany: () => Promise.resolve({ count: 0 }),
    updateMany: () => Promise.resolve({ count: 0 }),
    create: () => Promise.resolve({}),
    count: () => Promise.resolve(0),
    findMany: () => Promise.resolve([]),
  });
  const errorLog = {
    deleteMany: () => Promise.resolve({ count: 0 }),
    create: (row: (typeof h.errorRows)[number]) => {
      if (h.errorLogWriteFails) return Promise.reject(new Error("errorLog insert refused"));
      h.errorRows.push(row);
      return Promise.resolve({});
    },
  };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "errorLog") return errorLog;
        if (prop === "$queryRaw") return () => Promise.resolve([]);
        if (prop === "$executeRaw") return () => Promise.resolve(0);
        if (prop === "$queryRawUnsafe") return () => Promise.resolve([{ n: 0 }]);
        if (prop === "$executeRawUnsafe") return () => Promise.resolve(0);
        return generic();
      },
    },
  );
  return { prisma };
});

type Out = { ok?: boolean; reason?: string; embeddingShadow?: { error?: string } };

async function runRoute(): Promise<Out> {
  vi.resetModules();
  const { GET } = await import("@/app/api/cron/data-cleanup/route");
  return (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as Out;
}

const DRIVER_TEXT = "canceling statement due to statement timeout";

beforeEach(() => {
  h.errorRows.length = 0;
  h.errorLogWriteFails = false;
  shadowMocks.sweep.mockReset();
  shadowMocks.sweep.mockResolvedValue({ sources: [], totalMarked: 0, totalCleared: 0, refused: false, dryRun: false });
});

describe("data-cleanup · a shadow sweep that throws", () => {
  it("files the run as failed with the REAL error text, not a pointer to error_logs", async () => {
    shadowMocks.sweep.mockRejectedValue(new Error(DRIVER_TEXT));
    const out = await runRoute();
    expect(out.ok).toBe(false);
    expect(out.reason).toContain(`embedding shadow sweep threw: ${DRIVER_TEXT}`);
    expect(out.reason).not.toContain("see error_logs");
  });

  it("keeps only the first 200 characters of a long error", async () => {
    const long = "x".repeat(200) + "TAIL_MARKER";
    shadowMocks.sweep.mockRejectedValue(new Error(long));
    const out = await runRoute();
    expect(out.reason).toContain("x".repeat(200));
    expect(out.reason).not.toContain("TAIL_MARKER");
  });

  it("the response payload names the same text instead of 'see error_logs'", async () => {
    shadowMocks.sweep.mockRejectedValue(new Error(DRIVER_TEXT));
    const out = await runRoute();
    expect(out.embeddingShadow?.error).toContain(DRIVER_TEXT);
    expect(out.embeddingShadow?.error).not.toContain("see error_logs");
  });

  it("writes one error_logs row: error level, the words 'shadow sweep', the driver text, context.fn", async () => {
    shadowMocks.sweep.mockRejectedValue(new Error(DRIVER_TEXT));
    await runRoute();
    const rows = h.errorRows.filter((r) => r.data.context.fn === "sweepEmbeddingShadow");
    expect(rows).toHaveLength(1);
    const { level, message, stack, context } = rows[0].data;
    expect(level).toBe("error");
    expect(message).toBe(`[cron.data-cleanup] embedding shadow sweep threw: ${DRIVER_TEXT}`);
    expect(stack).toContain("Error");
    expect(context.source).toBe("cron.data-cleanup");
  });

  it("a failed error_logs write is reported, not lost", async () => {
    shadowMocks.sweep.mockRejectedValue(new Error(DRIVER_TEXT));
    h.errorLogWriteFails = true;
    const out = await runRoute();
    expect(out.ok).toBe(false);
    expect(out.reason).toContain(DRIVER_TEXT);
    expect(out.reason).toContain("error_logs write also failed");
  });

  it("control: a sweep that works files no failure and writes no error row", async () => {
    const out = await runRoute();
    expect(out.ok).toBeUndefined();
    expect(h.errorRows.filter((r) => r.data.context.fn === "sweepEmbeddingShadow")).toHaveLength(0);
  });
});
