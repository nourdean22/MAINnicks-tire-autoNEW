/**
 * 2026-07-20 · Regression record for the SMS rehydration claim-parse (#962),
 * asserted against the SHARED helper the call site now uses.
 *
 * WHAT HAPPENED. On boot, startDelayedQueueProcessor() rehydrates
 * `sms_messages WHERE status='queued'`, atomically claims each row
 * queued -> sending, then pushes it into the in-memory delayedQueue. The claim
 * result was read as `claim?.rowsAffected ?? claim?.affectedRows ?? 0` — but
 * drizzle-orm/mysql2 types an UPDATE result as a TUPLE:
 *
 *   MySqlRawQueryResult = [ResultSetHeader, FieldPacket[]]
 *
 * Reading `.affectedRows` off the ARRAY yields undefined, so claimedRows was
 * always 0 and `continue` fired for EVERY row. The UPDATE still committed, so
 * the row moved to 'sending' — never queued, never sent — and `rehydrated`
 * stayed 0 so even the "Rehydrated N pending SMS" log never printed, which is
 * how it stayed invisible. 136 messages to 103 people accumulated in that dead
 * state between 2026-06-02 and 2026-07-19; rehydration only ever SELECTs
 * status='queued', so nothing could recover them.
 *
 * WHY THIS FILE POINTS AT lib/db-affected. The fix originally introduced a
 * second local parser. A sweep found the codebase already had FOUR correct
 * patterns plus `affectedRowCount()` — adding a fifth was the actual defect, so
 * sms.ts now uses the shared helper. These cases document the SMS incident
 * against that helper; lib/db-affected.test.ts covers the helper generally.
 */
import { describe, expect, it } from "vitest";
import { affectedRowCount } from "./lib/db-affected";

describe("SMS rehydration claim-parse (#962 regression)", () => {
  // THE regression: the shape drizzle-orm/mysql2 actually returns.
  it("reads affectedRows from a [ResultSetHeader, FieldPacket[]] TUPLE", () => {
    expect(affectedRowCount([{ affectedRows: 1 }, []])).toBe(1);
  });

  it("a tuple reporting 0 rows is NOT a successful claim", () => {
    expect(affectedRowCount([{ affectedRows: 0 }, []])).toBe(0);
  });

  it("still reads a bare header object (destructured call sites)", () => {
    expect(affectedRowCount({ affectedRows: 1 })).toBe(1);
  });

  // Fail CLOSED: an unreadable result must never count as claimed, or the
  // queue would send a message whose row was never actually locked.
  it.each([null, undefined, {}, [], "nope", 0])("returns 0 for unusable shape %j", (input) => {
    expect(affectedRowCount(input as never)).toBe(0);
  });

  // The exact predicate the rehydration loop applies.
  it("claim is only honoured when the count clears 1", () => {
    const claimed = (r: unknown) => affectedRowCount(r) >= 1;
    expect(claimed([{ affectedRows: 1 }, []])).toBe(true);
    expect(claimed([{ affectedRows: 0 }, []])).toBe(false);
    expect(claimed(undefined)).toBe(false);
  });
});
