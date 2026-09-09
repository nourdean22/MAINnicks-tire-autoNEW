import { describe, it, expect } from "vitest";
import {
  COLUMNS, GUARDED_SET, plateTextToStore,
  HEARTBEAT_COLUMNS, HEARTBEAT_GUARDED_SET, HEARTBEAT_ACCEPT, parseHeartbeat,
} from "./cameraVisitsRoutes";

describe("camera visit ingest — plate durability", () => {
  it("stores plate text ONLY when the read is CONFIRMED", () => {
    expect(plateTextToStore("CONFIRMED", "abc 1234")).toBe("ABC1234");
  });

  it("drops the text for every unproven status but keeps the status itself", () => {
    // An unproven string persisted to a database becomes a fact in someone's
    // head, and a wrong plate attaches the wrong customer's history to a car.
    for (const status of ["CANDIDATE", "AMBIGUOUS", "UNREADABLE", "NONE"]) {
      expect(plateTextToStore(status, "ABC1234"), status).toBeNull();
    }
  });

  it("normalizes a confirmed read so lookups compare on one key", () => {
    expect(plateTextToStore("CONFIRMED", "  abc-1234 ")).toBe("ABC1234");
  });

  it("a confirmed status with no usable text is null, not an empty string", () => {
    expect(plateTextToStore("CONFIRMED", "")).toBeNull();
    expect(plateTextToStore("CONFIRMED", null)).toBeNull();
    expect(plateTextToStore("CONFIRMED", "---")).toBeNull();
  });
});

describe("camera visit ingest — the seq guard covers every column", () => {
  it("guards EVERY updatable column, so a new column cannot skip monotonicity", () => {
    // The invariant is enforced by the ON DUPLICATE KEY UPDATE clause, not by a
    // read-then-write, and it only holds if every assignment carries the guard. A
    // column added to COLUMNS without one would let a stale delivery overwrite that
    // single field while the rest of the row correctly refused it.
    const updatable = COLUMNS.filter((c) => c !== "visitId");
    for (const col of updatable) {
      expect(GUARDED_SET, `${col} is not seq-guarded`).toContain(
        `\`${col}\` = IF(VALUES(\`seq\`) >= \`seq\`, VALUES(\`${col}\`), \`${col}\`)`,
      );
    }
    expect(GUARDED_SET.split("IF(VALUES(`seq`)").length - 1).toBe(updatable.length);
  });

  it("never rewrites the key it matches on", () => {
    expect(GUARDED_SET).not.toContain("`visitId` =");
  });
});

describe("camera visit ingest — commissioning data class", () => {
  it("carries dataClass and commissioningRunId through the seq-guarded column set", () => {
    // A commissioning row that lost its class on a retried delivery would silently
    // become a production visit; the guard must cover both columns like any other.
    expect(COLUMNS).toContain("dataClass");
    expect(COLUMNS).toContain("commissioningRunId");
    expect(GUARDED_SET).toContain("`dataClass` = IF(VALUES(`seq`) >= `seq`, VALUES(`dataClass`), `dataClass`)");
  });
});

describe("camera heartbeat ingest — idempotency key (producerInstanceId, heartbeatSeq)", () => {
  it("guards EVERY column with the accept predicate, so a replayed heartbeat cannot walk the row back", () => {
    const updatable = HEARTBEAT_COLUMNS.filter((c) => c !== "camera");
    for (const col of updatable) {
      expect(HEARTBEAT_GUARDED_SET, `${col} is not accept-guarded`).toContain(
        `\`${col}\` = IF(${HEARTBEAT_ACCEPT}, VALUES(\`${col}\`), \`${col}\`)`,
      );
    }
    // + receivedAt and stateSince, the two server clocks.
    expect(HEARTBEAT_GUARDED_SET.split("IF(").length - 1).toBe(updatable.length + 2);
    expect(HEARTBEAT_GUARDED_SET).not.toContain("`camera` =");
  });

  it("a new producer instance is accepted even when its sequence restarts from zero", () => {
    // A restart legitimately resets heartbeatSeq; the OR makes the instance change
    // sufficient on its own. Without it, a restarted producer would be ignored until
    // its counter climbed past the dead instance's last value.
    expect(HEARTBEAT_ACCEPT).toBe(
      "(VALUES(`producerInstanceId`) <> `producerInstanceId` OR VALUES(`heartbeatSeq`) >= `heartbeatSeq`)",
    );
  });

  it("stateSince moves only on an ACCEPTED heartbeat whose state actually changed", () => {
    expect(HEARTBEAT_GUARDED_SET).toContain(
      "`stateSince` = IF(" + HEARTBEAT_ACCEPT + " AND VALUES(`state`) <> `state`, NOW(), `stateSince`)",
    );
    expect(HEARTBEAT_GUARDED_SET).toContain("`receivedAt` = IF(" + HEARTBEAT_ACCEPT + ", NOW(), `receivedAt`)");
  });

  it("rejects a body without the key fields and an unparseable producer timestamp", () => {
    expect(parseHeartbeat({ camera: "sign" }).success).toBe(false);
    expect(parseHeartbeat({ camera: "sign", producerInstanceId: "abc", heartbeatSeq: 1, observedAtEdge: "yesterday-ish" }).success).toBe(false);
    const ok = parseHeartbeat({ camera: "sign", producerInstanceId: "abc", heartbeatSeq: 1, observedAtEdge: 1_800_000_000 });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.mode).toBe("PRODUCTION");
      expect(ok.data.observedAtEdge?.getTime()).toBe(1_800_000_000 * 1000);
    }
  });
});
