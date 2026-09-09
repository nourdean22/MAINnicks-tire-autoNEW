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

/**
 * A minimal simulator of MySQL/TiDB `ON DUPLICATE KEY UPDATE` semantics, so the canary
 * below tests the BEHAVIOUR of the real generated clause rather than its shape.
 *
 * The one rule that matters, and the one that produced a live defect: assignments are
 * evaluated LEFT TO RIGHT, and a bare column reference reads the value as updated so far
 * WITHIN THE SAME STATEMENT, while `VALUES(col)` always reads the incoming row. A guard
 * that reads a column it also assigns therefore means something different depending on
 * where it sits in the list.
 *
 * Supports exactly the two predicate shapes this route generates. Anything else throws,
 * which is deliberate: a new predicate shape needs a human to re-reason about ordering,
 * not a simulator that quietly guesses.
 */
function applyOnDuplicateKeyUpdate(
  setClause: string,
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const row = { ...stored };
  const NOW = "__NOW__";

  const evalPredicate = (pred: string): boolean => {
    const base = /^\(VALUES\(`(\w+)`\) <> `\1` OR VALUES\(`(\w+)`\) >= `\2`\)$/;
    const withState = /^(.*) AND VALUES\(`(\w+)`\) <> `\2`$/;
    const st = withState.exec(pred);
    if (st) return evalPredicate(st[1]) && incoming[st[2]] !== row[st[2]];
    const m = base.exec(pred);
    if (!m) throw new Error(`unsupported predicate shape, re-review ordering: ${pred}`);
    const [, idCol, seqCol] = m;
    return incoming[idCol] !== row[idCol] || Number(incoming[seqCol]) >= Number(row[seqCol]);
  };

  // Split on top-level commas only (the IF(...) arguments contain commas of their own).
  const assignments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < setClause.length; i++) {
    const ch = setClause[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      assignments.push(setClause.slice(start, i).trim());
      start = i + 1;
    }
  }
  assignments.push(setClause.slice(start).trim());

  for (const a of assignments) {
    const m = /^`(\w+)` = IF\((.*), (VALUES\(`\w+`\)|NOW\(\)), `\1`\)$/.exec(a);
    if (!m) throw new Error(`unsupported assignment shape: ${a}`);
    const [, col, pred, thenExpr] = m;
    if (evalPredicate(pred)) {
      row[col] = thenExpr === "NOW()" ? NOW : incoming[col];
    }
  }
  return row;
}

describe("camera heartbeat ingest — the guard must survive a producer RESTART", () => {
  /** What the row looks like after a producer has been up for a while. */
  const stored = {
    producerInstanceId: "instance-A",
    heartbeatSeq: 120,
    state: "HEALTHY",
    calibrationVersion: "cal-1",
    captureFps: 4,
    receivedAt: "old",
    stateSince: "old",
  };

  it("a RESTARTED producer's state is written, not just its instance id", () => {
    // THE DEFECT, measured against production 2026-09-09: `producerInstanceId` was
    // assigned FIRST, so every later guard compared the new id to itself and collapsed
    // to `VALUES(heartbeatSeq) >= heartbeatSeq` — false for a producer whose sequence
    // restarted at 1. The row kept the DEAD producer's state while advertising the live
    // producer's id, and the shop's camera card stayed frozen on it for ~120 heartbeats.
    const restart = {
      producerInstanceId: "instance-B",
      heartbeatSeq: 1,
      state: "CAMERA_OFFLINE",
      calibrationVersion: null,
      captureFps: 0,
    };
    const after = applyOnDuplicateKeyUpdate(HEARTBEAT_GUARDED_SET, stored, restart);

    expect(after.producerInstanceId).toBe("instance-B");
    expect(after.heartbeatSeq).toBe(1);
    expect(after.state).toBe("CAMERA_OFFLINE");
    expect(after.calibrationVersion).toBeNull();
    expect(after.captureFps).toBe(0);
    expect(after.receivedAt).toBe("__NOW__");
    expect(after.stateSince).toBe("__NOW__");
  });

  it("a REPLAYED heartbeat from the SAME producer still changes nothing", () => {
    // The property the guard existed for in the first place; the ordering fix must not
    // buy restart-correctness by giving up replay-safety.
    const replay = {
      producerInstanceId: "instance-A",
      heartbeatSeq: 7,
      state: "CAMERA_OFFLINE",
      calibrationVersion: null,
      captureFps: 0,
    };
    expect(applyOnDuplicateKeyUpdate(HEARTBEAT_GUARDED_SET, stored, replay)).toEqual(stored);
  });

  it("a NEWER heartbeat from the same producer applies", () => {
    const next = {
      producerInstanceId: "instance-A",
      heartbeatSeq: 121,
      state: "CLOUD_BACKLOG",
      calibrationVersion: "cal-1",
      captureFps: 3,
    };
    const after = applyOnDuplicateKeyUpdate(HEARTBEAT_GUARDED_SET, stored, next);
    expect(after.heartbeatSeq).toBe(121);
    expect(after.state).toBe("CLOUD_BACKLOG");
    expect(after.stateSince).toBe("__NOW__");
  });

  it("stateSince moves ONLY when the state actually changed", () => {
    const same = {
      producerInstanceId: "instance-A",
      heartbeatSeq: 121,
      state: "HEALTHY",
      calibrationVersion: "cal-1",
      captureFps: 4,
    };
    const after = applyOnDuplicateKeyUpdate(HEARTBEAT_GUARDED_SET, stored, same);
    expect(after.receivedAt).toBe("__NOW__", );
    expect(after.stateSince).toBe("old");
  });

  it("the two discriminators are assigned LAST, which is what makes all of the above true", () => {
    // A structural assertion ON TOP of the behavioural ones, pinning the DERIVED order
    // itself: a refactor that reorders these reintroduces one of two measured defects,
    // and this fails naming the ordering rather than a downstream symptom.
    const order = [...HEARTBEAT_GUARDED_SET.matchAll(/`(\w+)` = IF\(/g)].map((m) => m[1]);
    // The exact derived order, not merely "last": heartbeatSeq must precede
    // producerInstanceId, and stateSince must precede state.
    expect(order.slice(-2)).toEqual(["heartbeatSeq", "producerInstanceId"]);
    expect(order.indexOf("stateSince")).toBeLessThan(order.indexOf("state"));
    for (const d of ["producerInstanceId", "heartbeatSeq", "state", "stateSince"]) {
      expect(order.filter((c) => c === d), `${d} assigned more than once`).toHaveLength(1);
    }
    // Every updatable column is still covered exactly once.
    const updatable = HEARTBEAT_COLUMNS.filter((c) => c !== "camera");
    expect(new Set(order)).toEqual(new Set([...updatable, "receivedAt", "stateSince"]));
    expect(HEARTBEAT_ACCEPT).toContain("producerInstanceId");
  });
});
