/**
 * First test for the environment verifier — it shipped 2026-05 with three real
 * read-backs and no test, and its else-branch answered `verified: true` for
 * any tool it had never looked at. That fail-open was inert only because
 * nothing consumed the true branch. The moment the receipt does
 * (persist-assistant-message.ts, 2026-09-22), "assumed true" becomes
 * "promoted to VERIFIED", so the tri-state is asserted here, both directions.
 *
 * Per AGENTS.md > "Ship the canary, not just the control": the dangerous
 * cases are the ones where the verifier must say `null` — no verifier, and a
 * verification QUERY failure — because `true` there promotes a lie and
 * `false` there stamps a fabrication banner into the operator's reply over a
 * DB hiccup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirst = vi.fn();
const mockCount = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findFirst: (a: unknown) => mockFindFirst(a),
      count: (a: unknown) => mockCount(a),
      findUnique: (a: unknown) => mockFindUnique(a),
    },
  },
}));

import { verifyEnvironmentState } from "@/lib/ai/chat/environment-verifier";

describe("verifyEnvironmentState · tri-state", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCount.mockReset();
    mockFindUnique.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("POSITIVE CONTROL: createTask whose row is read back is verified: true", async () => {
    mockFindFirst.mockResolvedValue({ id: "t1", title: "Order tires" });
    const r = await verifyEnvironmentState([{ name: "createTask", ok: true, args: { title: "Order tires" } }]);
    expect(r).toEqual([{ toolName: "createTask", verified: true }]);
    // The read-back must exclude soft-deleted rows and stale same-title rows.
    const where = (mockFindFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where.deletedAt).toBeNull();
    expect(where.createdAt).toBeDefined();
  });

  it("createTask whose row is NOT there is verified: false — a contradiction, not an absence", async () => {
    mockFindFirst.mockResolvedValue(null);
    const r = await verifyEnvironmentState([{ name: "createTask", ok: true, args: { title: "Order tires" } }]);
    expect(r[0].verified).toBe(false);
    expect(r[0].reason).toContain("not found");
  });

  // ── The two cases that MUST be null ──
  it("a tool with no verifier is verified: null, never true", async () => {
    const r = await verifyEnvironmentState([{ name: "sendTelegram", ok: true, args: {} }]);
    expect(r).toEqual([
      { toolName: "sendTelegram", verified: null, reason: "No specific environment verifier exists" },
    ]);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("a verification QUERY failure is verified: null with the error named, and warns loudly", async () => {
    mockFindFirst.mockRejectedValue(new Error("connection reset"));
    const r = await verifyEnvironmentState([{ name: "createTask", ok: true, args: { title: "x" } }]);
    expect(r[0].verified).toBeNull();
    expect(r[0].reason).toContain("Verification query failed");
    expect(r[0].reason).toContain("connection reset");
    // Not silent: a broken verifier must not read as "no verifier" forever.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[instrument.environment_verifier]");
  });

  it("a call the tool itself reported as failed is verified: false without any read-back", async () => {
    const r = await verifyEnvironmentState([{ name: "createTask", ok: false, args: { title: "x" } }]);
    expect(r[0]).toEqual({ toolName: "createTask", verified: false, reason: "Tool execution failed" });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("completeTask is true only when the row is DONE", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "t9", status: "DONE" });
    mockFindUnique.mockResolvedValueOnce({ id: "t9", status: "ACTIVE" });
    const done = await verifyEnvironmentState([{ name: "completeTask", ok: true, args: { taskId: "t9" } }]);
    const notDone = await verifyEnvironmentState([{ name: "completeTask", ok: true, args: { taskId: "t9" } }]);
    expect(done[0].verified).toBe(true);
    expect(notDone[0].verified).toBe(false);
  });

  it("addTasksToProject verifies EVERY title — a partial commit is false, not true", async () => {
    mockCount.mockResolvedValueOnce(3);
    mockCount.mockResolvedValueOnce(1);
    const calls = [{ name: "addTasksToProject", ok: true, args: { tasks: [{ title: "a" }, { title: "b" }, { title: "c" }] } }];
    expect((await verifyEnvironmentState(calls))[0].verified).toBe(true);
    const partial = (await verifyEnvironmentState(calls))[0];
    expect(partial.verified).toBe(false);
    expect(partial.reason).toContain("1/3");
  });

  it("documents existing behaviour: createTask with no title arg yields no entry (cannot be looked up)", async () => {
    const r = await verifyEnvironmentState([{ name: "createTask", ok: true, args: {} }]);
    expect(r).toEqual([]);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("never lets one bad call poison the batch", async () => {
    mockFindFirst.mockRejectedValueOnce(new Error("boom"));
    mockFindUnique.mockResolvedValueOnce({ id: "t2", status: "DONE" });
    const r = await verifyEnvironmentState([
      { name: "createTask", ok: true, args: { title: "x" } },
      { name: "completeTask", ok: true, args: { taskId: "t2" } },
    ]);
    expect(r.map((x) => x.verified)).toEqual([null, true]);
  });
});
