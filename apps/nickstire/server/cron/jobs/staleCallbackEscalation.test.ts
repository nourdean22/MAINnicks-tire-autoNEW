/**
 * callback-escalation (crudAutomation.escalateStaleCallbacks) must never make
 * an unworked callback look worked.
 *
 * Until 2026-09-23 the job "claimed" a callback unworked for 4 hours by setting
 * status = 'no-answer' and calledAt = NOW() with nobody having called. The row
 * then left every queue that lists only `new` (the morning brief,
 * routers/intelligence.ts; the admin callbacks view), while the customer was
 * texted "still in our queue". The research doc (Part C #21) records it; the
 * receptionist now routes every promised callback through escalate, so more rows
 * reach this job.
 *
 * Asserted on the SQL the job actually issues (rendered through drizzle's MySQL
 * dialect), not on the source text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const execute = vi.fn();
const sendSms = vi.fn();
const isEnabled = vi.fn();
const sendTelegram = vi.fn();

vi.mock("../../db", () => ({ getDb: vi.fn(async () => ({ execute })) }));
vi.mock("../../sms", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("../../services/featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));
vi.mock("../../services/telegram", () => ({ sendTelegram: (...a: unknown[]) => sendTelegram(...a) }));

import { escalateStaleCallbacks } from "./crudAutomation";

const dialect = new MySqlDialect();
const issued = () => execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as never));
const STALE = { id: 7, name: "Jordan Example", phone: "2165550100", context: "brakes grinding" };

afterEach(() => {
  execute.mockReset();
  sendSms.mockReset();
  isEnabled.mockReset();
  sendTelegram.mockReset();
});

describe("callback-escalation leaves an unworked callback in the queue", () => {
  it("POSITIVE CONTROL + the fix: the row stays 'new' and calledAt is never stamped", async () => {
    execute.mockResolvedValueOnce([[STALE], []]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true });

    const res = await escalateStaleCallbacks();

    const statements = issued();
    const writes = statements.filter((q) => /^\s*UPDATE/i.test(q.sql));
    expect(writes).toHaveLength(1);
    // The pre-fix job set exactly these two — nobody had called.
    expect(writes[0]!.sql).not.toMatch(/no-answer/);
    expect(writes[0]!.sql).not.toMatch(/calledAt/i);
    // The claim is conditional: still 'new' and not yet escalated.
    expect(writes[0]!.sql).toMatch(/status = 'new'/);
    expect(writes[0]!.sql).toMatch(/LOCATE\(/);
    expect(res.recordsProcessed).toBe(1);
    expect(res.details).toMatch(/left new/);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("the SELECT skips rows escalated earlier, so a row is alerted once", async () => {
    execute.mockResolvedValueOnce([[], []]);
    isEnabled.mockResolvedValue(true);
    await escalateStaleCallbacks();
    const [select] = issued();
    expect(select!.sql).toMatch(/status = 'new'/);
    expect(select!.sql).toMatch(/LOCATE\(/);
    expect(select!.params.some((p) => typeof p === "string" && p.includes("auto-escalated"))).toBe(true);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("a row another run or a person got to first is neither texted nor alerted", async () => {
    execute.mockResolvedValueOnce([[STALE], []]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    isEnabled.mockResolvedValue(true);
    const res = await escalateStaleCallbacks();
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(res.recordsProcessed).toBe(0);
  });

  it("with the SMS flag off it still claims and alerts once, and texts nobody", async () => {
    execute.mockResolvedValueOnce([[STALE, { ...STALE, id: 8, phone: null }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    isEnabled.mockResolvedValue(false);
    const res = await escalateStaleCallbacks();
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(String(sendTelegram.mock.calls[0]![0])).toMatch(/2 callback\(s\)/);
    expect(res.recordsProcessed).toBe(2);
  });

  it("a failed read fails the run loudly instead of reporting 'completed'", async () => {
    execute.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    await expect(escalateStaleCallbacks()).rejects.toThrow(/ER_LOCK_WAIT_TIMEOUT/);
  });
});
