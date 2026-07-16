import { describe, expect, it } from "vitest";
import { affectedRowCount } from "./db-affected";

describe("affectedRowCount", () => {
  it("reads the mysql2 tuple shape ([ResultSetHeader, FieldPacket[]])", () => {
    expect(affectedRowCount([{ affectedRows: 1 }, []])).toBe(1);
    expect(affectedRowCount([{ affectedRows: 0 }, []])).toBe(0);
  });

  it("reads the bare-header shape (.affectedRows on the result itself)", () => {
    expect(affectedRowCount({ affectedRows: 1 })).toBe(1);
    expect(affectedRowCount({ affectedRows: 0 })).toBe(0);
  });

  // The whole point of the helper: a claim guarding an irreversible publish must
  // not proceed on an unreadable result. Each case below previously resolved to
  // `1` ("claimed") under the `?? 1` fallback this replaces.
  it("fails CLOSED (0) when the count is unreadable", () => {
    expect(affectedRowCount(undefined)).toBe(0);
    expect(affectedRowCount(null)).toBe(0);
    expect(affectedRowCount([])).toBe(0);
    expect(affectedRowCount({})).toBe(0);
    expect(affectedRowCount([{}, []])).toBe(0);
    expect(affectedRowCount("1")).toBe(0);
    expect(affectedRowCount({ affectedRows: "1" })).toBe(0);
    expect(affectedRowCount({ affectedRows: NaN })).toBe(0);
  });
});
