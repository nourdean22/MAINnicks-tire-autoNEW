/**
 * 2026-07-20 · Claim-result parsing for the SMS rehydration path.
 *
 * THE LIVE DEFECT THIS PINS. On boot, startDelayedQueueProcessor() rehydrates
 * `sms_messages WHERE status='queued'`, atomically claiming each row
 * queued -> sending, then pushes it into the in-memory delayedQueue. The claim
 * result was read as:
 *
 *   claim?.rowsAffected ?? claim?.affectedRows ?? 0
 *
 * But drizzle-orm/mysql2 types an UPDATE result as a TUPLE:
 *
 *   export type MySqlRawQueryResult = [ResultSetHeader, FieldPacket[]]
 *
 * Reading `.affectedRows` off the ARRAY yields undefined, so claimedRows was
 * always 0 and `continue` fired for EVERY row. The UPDATE still committed, so
 * the row moved to 'sending' — but it was never queued, never sent, and
 * `rehydrated` stayed 0 so even the "Rehydrated N pending SMS" log never
 * printed (which is how the bug stayed invisible).
 *
 * Measured impact: 136 messages to 103 people accumulated in a dead 'sending'
 * state between 2026-06-02 and 2026-07-19. Nothing could recover them, because
 * rehydration only ever SELECTs status='queued'.
 *
 * The invariant: a successful claim must be recognised from the shape the
 * driver actually returns.
 */
import { describe, expect, it } from "vitest";
import { readClaimedRows } from "./sms";

describe("readClaimedRows · drizzle/mysql2 result shapes", () => {
  // THE regression: this is what drizzle-orm/mysql2 actually returns.
  it("reads affectedRows from a [ResultSetHeader, FieldPacket[]] TUPLE", () => {
    expect(readClaimedRows([{ affectedRows: 1 }, []])).toBe(1);
  });

  it("treats a tuple reporting 0 rows as an unsuccessful claim", () => {
    expect(readClaimedRows([{ affectedRows: 0 }, []])).toBe(0);
  });

  // Some drivers/versions expose the header directly rather than in a tuple.
  it("still reads a bare header object", () => {
    expect(readClaimedRows({ affectedRows: 1 })).toBe(1);
  });

  it("accepts the rowsAffected spelling", () => {
    expect(readClaimedRows([{ rowsAffected: 1 }, []])).toBe(1);
    expect(readClaimedRows({ rowsAffected: 1 })).toBe(1);
  });

  // Fail CLOSED: an unrecognised shape must not be treated as a successful
  // claim, or we would queue a message whose row we never actually locked.
  it.each([null, undefined, {}, [], "nope", 0])("returns 0 for unusable shape %j", (input) => {
    expect(readClaimedRows(input as never)).toBe(0);
  });
});
