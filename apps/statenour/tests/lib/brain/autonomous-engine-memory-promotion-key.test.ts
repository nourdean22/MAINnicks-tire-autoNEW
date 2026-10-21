/**
 * memory_promotion promotes a row by UPDATING its category to wisdom and keeping
 * its key. BrainMemory is unique on (category, key), so when a wisdom row with
 * that key already exists (soft-deleted ones included) the update threw P2002.
 * The top-seenCount candidate never changed, so the rule failed once a day from
 * 2026-10-11 ("Unique constraint failed on the fields: (`category`,`key`)").
 *
 * The collision is predictable, so the action looks for it first and skips with
 * the same confidence drop the other two skip paths use. A P2002 from the update
 * itself (a row appearing between the check and the write) is the same skip.
 * Anything else still throws, so a real failure stays a failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { findFirst, update, sendTelegram } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findFirst, update } } }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { __ruleActionForTest } from "@/lib/brain/autonomous-engine";

const action = () => {
  const a = __ruleActionForTest("memory_promotion");
  if (!a) throw new Error("no rule named memory_promotion");
  return a;
};

const memory = {
  id: "mem-1",
  key: "tire_pressure_cold",
  category: "pattern",
  confidence: 0.8,
  seenCount: 9,
  // Passes the real wisdom quality gate (conditional + imperative markers).
  content: "Always check tire pressure when the temperature drops below 40 degrees to avoid under-inflation.",
};

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`category`,`key`)", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["category", "key"] },
  });

/** findFirst is called twice: the content dupe guard (where.content) and the key lookup (where.key). */
function wisdomRows(opts: { contentDupe?: { id: string } | null; keyRow?: { id: string } | null }) {
  findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
    "content" in args.where ? (opts.contentDupe ?? null) : (opts.keyRow ?? null),
  );
}

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
  update.mockResolvedValue({});
  sendTelegram.mockReset();
});

describe("memory_promotion · wisdom key collision", () => {
  it("positive control: no collision promotes to wisdom", async () => {
    wisdomRows({});
    const out = await action()(memory);
    expect(out.result).toBe("success");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.category).toBe("wisdom");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("a wisdom row with the same key (soft-deleted or not) is a skip that lowers confidence", async () => {
    wisdomRows({ keyRow: { id: "wis-9" } });
    const out = await action()(memory);

    expect(out).toEqual({ result: "skipped", payload: { reason: "wisdom_key_exists", existing: "wis-9" } });
    // The lookup must not filter deletedAt, and must exclude this very row.
    const keyLookup = findFirst.mock.calls.map((c) => c[0].where).find((w) => "key" in w);
    expect(keyLookup).toMatchObject({ category: "wisdom", key: "tire_pressure_cold", id: { not: "mem-1" } });
    expect(keyLookup).not.toHaveProperty("deletedAt");
    // Same drop as the other skip paths, and no category change.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({ where: { id: "mem-1" }, data: { confidence: 0.5 } });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("race: P2002 from the promote update is the same skip, with confidence lowered", async () => {
    wisdomRows({});
    update.mockRejectedValueOnce(p2002()).mockResolvedValue({});
    const out = await action()(memory);

    expect(out).toMatchObject({ result: "skipped", payload: { reason: "wisdom_key_exists" } });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0]).toEqual({ where: { id: "mem-1" }, data: { confidence: 0.5 } });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("any other update error still throws", async () => {
    wisdomRows({});
    update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "test" }),
    );
    await expect(action()(memory)).rejects.toThrow("Record not found");
  });

  it("a failed key lookup throws, it is not read as 'no existing row'", async () => {
    findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ("content" in args.where) return null;
      throw new Error("connection reset");
    });
    await expect(action()(memory)).rejects.toThrow("connection reset");
    expect(update).not.toHaveBeenCalled();
  });
});
