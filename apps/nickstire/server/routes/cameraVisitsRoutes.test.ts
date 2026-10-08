import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  COLUMNS, GUARDED_SET, HEARTBEAT_ACCEPT, HEARTBEAT_COLUMNS,
  HEARTBEAT_GUARDED_SET, activeRunField, parseHeartbeat, plateTextToStore,
} from "./cameraVisitsRoutes";
import { cameraProducerAuthority } from "./cameraProducerAuthority";

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
  /** The assignment for ONE column, sliced out of the combined SET clause.
   *
   *  Splitting on the backtick-quoted column name is what lets these tests assert what a
   *  column's guard DOES without pinning the exact text around it -- the failure mode that
   *  turned a strengthened guard into two red tests. */
  const clauseFor = (set: string, col: string): string => {
    // Split on the ONLY thing that separates two assignments: a ", " followed by a
    // backtick-quoted identifier and " = ". Values contain ", `col`" too -- inside
    // COALESCE -- but those are followed by ")", never by " = ", so the lookahead does not
    // match them. Slicing to the first "), `" instead cut the clause in half, which is how
    // the first attempt at this helper turned one red test into a different red test.
    const parts = set.split(/, (?=`\w+` = )/);
    return parts.find((part) => part.startsWith(`\`${col}\` = `)) ?? "";
  };

  it("guards EVERY updatable column, so a new column cannot skip monotonicity", () => {
    // The invariant is enforced by the ON DUPLICATE KEY UPDATE clause, not by a
    // read-then-write, and it only holds if every assignment carries the guard. A
    // column added to COLUMNS without one would let a stale delivery overwrite that
    // single field while the rest of the row correctly refused it.
    const immutable = ["dataClass", "commissioningRunId"];
    const updatable = COLUMNS.filter((c) => c !== "visitId" && !immutable.includes(c));
    for (const col of updatable) {
      // The seq comparison must gate every column. It is asserted as PRESENT IN THE
      // COLUMN'S CLAUSE rather than as its literal opening, because a column may carry an
      // ADDITIONAL outer guard: `plateText` and `plateStatus` are wrapped in a
      // `plateStatus = 'SCRUBBED'` check so a retention scrub cannot be undone by a
      // redelivery. That wrapping does not skip monotonicity -- it adds a condition in
      // front of it -- and the earlier prefix assertion could not tell the two apart, so
      // it failed a change that strengthened the very thing it protects.
      const clause = clauseFor(GUARDED_SET, col);
      expect(clause, `${col} has no assignment at all`).toBeTruthy();
      expect(clause, `${col} is not seq-guarded`).toContain("IF(VALUES(`seq`) >= `seq`, ");
    }
    expect(GUARDED_SET.split("IF(VALUES(`seq`)").length - 1).toBe(updatable.length);
  });

  it("NEVER UN-LEARNS a timestamp: a null from a restarted producer cannot erase one", () => {
    // The mirror accumulates per-visit state IN MEMORY, and that does not survive a
    // producer restart. Afterwards its first emission renders a full row with NULL
    // arrival and bay times at a HIGHER seq -- which the guard would accept, overwriting
    // a complete row with nulls. A routine restart would silently erase a visit's timing
    // (Codex P1 on #2255). A car does not un-arrive, so COALESCE is always right here.
    for (const col of ["arrivedAt", "waitStartedAt", "bayEnteredAt", "bayExitedAt", "departedAt", "bay", "entryEvidence", "evidenceRef"]) {
      expect(clauseFor(GUARDED_SET, col), `${col} can be nulled by a restart`).toContain(
        `COALESCE(VALUES(\`${col}\`), \`${col}\`)`,
      );
    }
    // But a value that legitimately CHANGES is still replaced outright -- COALESCE
    // everywhere would freeze the state machine at its first non-null reading.
    expect(clauseFor(GUARDED_SET, "state")).toContain("VALUES(`state`)");
    expect(clauseFor(GUARDED_SET, "state")).not.toContain("COALESCE");
    // `plateStatus` replaces outright too -- it is a reading, not a thing learned once --
    // but it additionally cannot be moved OFF 'SCRUBBED'. Asserted as two facts about the
    // clause rather than as one literal string, because the literal could no longer tell
    // "still replaced outright" from "no longer guarded at all".
    expect(clauseFor(GUARDED_SET, "plateStatus")).toContain("VALUES(`plateStatus`)");
    expect(clauseFor(GUARDED_SET, "plateStatus")).not.toContain("COALESCE");
    expect(clauseFor(GUARDED_SET, "plateStatus")).toContain("`plateStatus` = 'SCRUBBED'");
  });

  it("the DATA CLASS is fixed at insert: a restart cannot reclassify a visit", () => {
    // A producer restarted across a commissioning boundary would otherwise turn a real
    // customer into COMMISSIONING (vanishing from the shop's KPIs) or a test drive into
    // PRODUCTION (counted as one). A visit belongs to the run it STARTED in.
    expect(GUARDED_SET).not.toContain("`dataClass` =");
    expect(GUARDED_SET).not.toContain("`commissioningRunId` =");
    // ... while still being written on the INSERT itself.
    expect(COLUMNS).toContain("dataClass");
    expect(COLUMNS).toContain("commissioningRunId");
  });

  it("never rewrites the key it matches on", () => {
    expect(GUARDED_SET).not.toContain("`visitId` =");
  });
});

describe("camera visit ingest — commissioning data class", () => {
  it("is written on INSERT and never on UPDATE", () => {
    // A commissioning row that lost its class on a retried delivery would silently become
    // a production visit -- so it is written once, with the row, and then frozen.
    expect(COLUMNS).toContain("dataClass");
    expect(COLUMNS).toContain("commissioningRunId");
    expect(GUARDED_SET).not.toContain("VALUES(`dataClass`)");
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

  it("encodes the priority fence and stale-owner takeover in the SQL predicate", () => {
    expect(HEARTBEAT_ACCEPT).toContain("p1-%");
    expect(HEARTBEAT_ACCEPT).toContain("p2-%");
    expect(HEARTBEAT_ACCEPT).toContain("p3-%");
    expect(HEARTBEAT_ACCEPT).toContain(`INTERVAL ${cameraProducerAuthority.staleSeconds} SECOND`);
  });

  it("stateSince moves only on an ACCEPTED heartbeat whose state actually changed", () => {
    expect(HEARTBEAT_GUARDED_SET).toContain(
      "`stateSince` = IF(" + HEARTBEAT_ACCEPT + " AND VALUES(`state`) <> `state`, NOW(), `stateSince`)",
    );
    expect(HEARTBEAT_GUARDED_SET).toContain(
      "`receivedAt` = IF((VALUES(`producerInstanceId`) = `producerInstanceId` AND VALUES(`heartbeatSeq`) >= `heartbeatSeq`), NOW(), `receivedAt`)",
    );
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

describe("camera producer authority — priority and visit fencing", () => {
  it("orders the three machines shop PC -> NicksMax -> NattyNour", () => {
    expect(cameraProducerAuthority.producerPriority("p1-shop-abc")).toBe(1);
    expect(cameraProducerAuthority.producerPriority("p2-nicksmax-abc")).toBe(2);
    expect(cameraProducerAuthority.producerPriority("p3-nattynour-abc")).toBe(3);
    expect(cameraProducerAuthority.producerPriority("legacy")).toBe(99);
  });

  it("expires local business-write authority BEFORE backend takeover becomes legal", () => {
    expect(cameraProducerAuthority.leaseSeconds).toBeGreaterThan(0);
    expect(cameraProducerAuthority.leaseSeconds).toBeLessThan(cameraProducerAuthority.staleSeconds);
  });

  it("lets the shop PC preempt a fresh standby immediately", () => {
    expect(cameraProducerAuthority.heartbeatAuthorityAccepted({
      incomingId: "p1-shop-new", incomingSeq: 1,
      storedId: "p2-nicksmax-old", storedSeq: 99, storedAgeSeconds: 1,
    })).toBe(true);
  });

  it("blocks NicksMax while a fresh shop-PC owner is alive", () => {
    expect(cameraProducerAuthority.heartbeatAuthorityAccepted({
      incomingId: "p2-nicksmax-new", incomingSeq: 1,
      storedId: "p1-shop-live", storedSeq: 99, storedAgeSeconds: 1,
    })).toBe(false);
  });

  it("allows the next standby only after the current owner is stale", () => {
    expect(cameraProducerAuthority.heartbeatAuthorityAccepted({
      incomingId: "p2-nicksmax-new", incomingSeq: 1,
      storedId: "p1-shop-dead", storedSeq: 99,
      storedAgeSeconds: cameraProducerAuthority.staleSeconds + 1,
    })).toBe(true);
  });

  it("visit writes require the elected live producer", () => {
    const current = { producerInstanceId: "p1-shop-live", ageSeconds: 10 };
    expect(cameraProducerAuthority.visitProducerAuthorized("p1-shop-live", current)).toBe(true);
    expect(cameraProducerAuthority.visitProducerAuthorized("p2-nicksmax-wait", current)).toBe(false);
    expect(cameraProducerAuthority.visitProducerAuthorized("p1-shop-live", {
      ...current, ageSeconds: cameraProducerAuthority.staleSeconds + 1,
    })).toBe(false);
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
    const withState = /^(.*) AND VALUES\(`(\w+)`\) <> `\2`$/;
    const st = withState.exec(pred);
    if (st) return evalPredicate(st[1]) && incoming[st[2]] !== row[st[2]];
    if (pred === HEARTBEAT_ACCEPT) {
      return cameraProducerAuthority.heartbeatAuthorityAccepted({
        incomingId: String(incoming.producerInstanceId),
        incomingSeq: Number(incoming.heartbeatSeq),
        storedId: String(row.producerInstanceId),
        storedSeq: Number(row.heartbeatSeq),
        storedAgeSeconds: Number(row.receivedAtAgeSeconds ?? 0),
      });
    }
    if (pred === "(VALUES(`producerInstanceId`) = `producerInstanceId` AND VALUES(`heartbeatSeq`) >= `heartbeatSeq`)") {
      return (
        incoming.producerInstanceId === row.producerInstanceId
        && Number(incoming.heartbeatSeq) >= Number(row.heartbeatSeq)
      );
    }
    throw new Error(`unsupported predicate shape, re-review ordering: ${pred}`);
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

  it("a lower-priority producer can take over a STALE owner without a half-applied row", () => {
    const stalePrimary = {
      producerInstanceId: "p1-shop-dead",
      heartbeatSeq: 120,
      state: "CAMERA_OFFLINE",
      calibrationVersion: "cal-1",
      captureFps: 0,
      receivedAt: "old",
      receivedAtAgeSeconds: cameraProducerAuthority.staleSeconds + 1,
      stateSince: "old",
    };
    const standby = {
      producerInstanceId: "p2-nicksmax-new",
      heartbeatSeq: 1,
      state: "HEALTHY",
      calibrationVersion: "cal-1",
      captureFps: 4,
    };
    const after = applyOnDuplicateKeyUpdate(HEARTBEAT_GUARDED_SET, stalePrimary, standby);
    expect(after.producerInstanceId).toBe("p2-nicksmax-new");
    expect(after.heartbeatSeq).toBe(1);
    expect(after.state).toBe("HEALTHY");
    expect(after.captureFps).toBe(4);
    expect(after.receivedAt).toBe("__NOW__");
  });

  it("the discriminators precede receivedAt, which is what keeps stale takeover atomic", () => {
    // A structural assertion ON TOP of the behavioural ones, pinning the DERIVED order
    // itself: a refactor that reorders these reintroduces one of two measured defects,
    // and this fails naming the ordering rather than a downstream symptom.
    const order = [...HEARTBEAT_GUARDED_SET.matchAll(/`(\w+)` = IF\(/g)].map((m) => m[1]);
    // The exact derived order, not merely "last": heartbeatSeq precedes
    // producerInstanceId, and receivedAt is last so stale-owner age stays immutable
    // while every authority guard is evaluated.
    expect(order.slice(-3)).toEqual(["heartbeatSeq", "producerInstanceId", "receivedAt"]);
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

describe("camera heartbeat — the commissioning run has THREE states, not two", () => {
  it("an open run is sent", () => {
    expect(activeRunField({ runId: "C-20260910-001", label: null }))
      .toEqual({ activeCommissioningRun: { runId: "C-20260910-001", label: null } });
  });

  it("LOOKED AND FOUND NONE sends an explicit null — this is what ENDS a run", () => {
    // The producer holds its mode on an absent key, so omitting this would mean a
    // commissioning run could be started and then never ended.
    expect(activeRunField(null)).toEqual({ activeCommissioningRun: null });
  });

  it("COULD NOT LOOK omits the key entirely, so a live run is not ended by a DB blip", () => {
    // One transient query failure mid-run used to send null, which took the producer out
    // of commissioning and tagged the rest of the test drive PRODUCTION — permanently,
    // because the ingest treats dataClass as immutable after insert.
    expect(activeRunField(undefined)).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(activeRunField(undefined), "activeCommissioningRun"))
      .toBe(false);
  });

  it("the two null-ish states are NOT interchangeable", () => {
    expect(activeRunField(null)).not.toEqual(activeRunField(undefined));
  });
});

describe("camera visit ingest — episode trail (migration 0127)", () => {
  // THE TRAP THIS GUARDS. A field can pass the zod schema and still be dropped at the
  // write, silently, because COLUMNS / HEARTBEAT_COLUMNS name the columns and nothing
  // else does. Schema-only additions are a writer with no reader, and the symptom is a
  // column that stays NULL forever while the producer insists it is sending the value.
  it("the visit write names the episode columns, not just the schema", () => {
    for (const col of ["episodeId", "continuesVisitId", "memberTrackIds"]) {
      expect(COLUMNS, `${col} missing from the visit write`).toContain(col);
    }
  });

  it("the heartbeat write names the stitch counters", () => {
    for (const col of ["arrivalsAfterStitch", "stitchedTotal", "stitchRefusedAmbiguous"]) {
      expect(HEARTBEAT_COLUMNS, `${col} missing from the heartbeat write`).toContain(col);
    }
  });

  it("a producer that predates the stitcher still parses — counters are nullish", () => {
    // The whole reason every column is NULLABLE: an older producer sends none of them.
    const old = parseHeartbeat({
      camera: "sign", producerInstanceId: "abc", heartbeatSeq: 1,
      observedAtEdge: "2026-09-22T20:00:00Z", mode: "PRODUCTION",
    });
    expect(old.success, JSON.stringify(old.success ? {} : old.error?.issues?.slice(0, 2))).toBe(true);
    if (old.success) {
      expect(old.data.arrivalsAfterStitch ?? null).toBeNull();
      expect(old.data.stitchRefusedAmbiguous ?? null).toBeNull();
    }
  });

  it("accepts the counters when a stitcher-aware producer sends them, INCLUDING zero", () => {
    // 0 is a real measurement here ("it ran and refused nothing"), not absence. A schema
    // that coerced 0 to null would erase the difference the counters exist to show.
    const hb = parseHeartbeat({
      camera: "sign", producerInstanceId: "abc", heartbeatSeq: 2,
      observedAtEdge: "2026-09-22T20:00:00Z", mode: "PRODUCTION",
      arrivalsAfterStitch: 41, stitchedTotal: 0, stitchRefusedAmbiguous: 7,
    });
    expect(hb.success).toBe(true);
    if (hb.success) {
      expect(hb.data.arrivalsAfterStitch).toBe(41);
      expect(hb.data.stitchedTotal).toBe(0);
      expect(hb.data.stitchRefusedAmbiguous).toBe(7);
    }
  });
});

describe("camera visit ingest — the episode trail cannot be erased", () => {
  // A later payload that OMITS these must not blank them. Two ordinary paths omit them:
  // a rollback to a pre-stitcher producer, and a terminal emission whose timing lookup
  // happens after the track mapping is gone. Losing the trail while KEEPING the corrected
  // `arrivedAt` is the worst outcome — the adjusted time survives, its explanation does not.
  // Asserted against the GENERATED SQL, not against the private set. A membership check
  // would need `LEARNED_ONCE` exported purely for the test — an unconsumed export the knip
  // orphan gate rightly rejects — and it would prove less: what protects the row is the
  // COALESCE actually reaching the statement, not a name sitting in a Set.
  it("preserves the episode trail when a later payload omits it", () => {
    const sql = String(GUARDED_SET);
    for (const col of ["episodeId", "continuesVisitId", "memberTrackIds"]) {
      expect(sql, `${col} can be NULLed by a later payload`)
        .toContain(`COALESCE(VALUES(\`${col}\`), \`${col}\`)`);
    }
  });

  it("the preservation is not vacuous — a volatile column still takes the new value", () => {
    // Positive control: if every column were COALESCEd, the test above would pass while
    // proving nothing. `state` must still be overwritten by a newer payload.
    const sql = String(GUARDED_SET);
    expect(sql).toContain("VALUES(`state`)");
    expect(sql).not.toContain("COALESCE(VALUES(`state`)");
  });
});


describe("camera heartbeat — interaction transport proofs (0134)", () => {
  const base = {
    camera: "office",
    producerInstanceId: "eufy-agent-1",
    heartbeatSeq: 1,
    observedAtEdge: "2026-09-26T23:55:00Z",
    mode: "SHADOW" as const,
  };

  it("an older producer that sends none of the new fields still parses", () => {
    const hb = parseHeartbeat(base);
    expect(hb.success).toBe(true);
    if (hb.success) {
      expect(hb.data.authPlaneOk ?? null).toBeNull();
      expect(hb.data.mediaPlaneOk ?? null).toBeNull();
      expect(hb.data.lastPtzNotifyAt ?? null).toBeNull();
    }
  });

  it("false is a measured failure and survives parsing as false", () => {
    const hb = parseHeartbeat({
      ...base,
      heartbeatSeq: 2,
      authPlaneOk: true,
      eventPlaneOk: true,
      controlPlaneOk: false,
      mediaPlaneOk: false,
      ptzHomeOk: false,
    });
    expect(hb.success).toBe(true);
    if (hb.success) {
      expect(hb.data.controlPlaneOk).toBe(false);
      expect(hb.data.mediaPlaneOk).toBe(false);
      expect(hb.data.ptzHomeOk).toBe(false);
    }
  });

  it("proof timestamps are parsed and every field reaches the guarded write", () => {
    const hb = parseHeartbeat({
      ...base,
      heartbeatSeq: 3,
      lastEventProofAt: "2026-09-26T23:54:00Z",
      lastControlProofAt: "2026-09-26T23:54:10Z",
      lastMediaProofAt: "2026-09-26T23:54:20Z",
      lastPtzNotifyAt: "2026-09-26T23:54:30Z",
    });
    expect(hb.success).toBe(true);
    if (hb.success) {
      expect(hb.data.lastEventProofAt).toBeInstanceOf(Date);
      expect(hb.data.lastPtzNotifyAt).toBeInstanceOf(Date);
    }

    for (const field of [
      "authPlaneOk",
      "eventPlaneOk",
      "controlPlaneOk",
      "mediaPlaneOk",
      "ptzHomeOk",
      "lastEventProofAt",
      "lastControlProofAt",
      "lastMediaProofAt",
      "lastPtzNotifyAt",
    ]) {
      expect(HEARTBEAT_COLUMNS, `${field} must be named by the durable heartbeat writer`).toContain(field);
      expect(HEARTBEAT_GUARDED_SET, `${field} must be protected from replay rollback`).toContain(
        `\`${field}\` = IF(${HEARTBEAT_ACCEPT}, VALUES(\`${field}\`), \`${field}\`)`,
      );
    }
  });
});

/**
 * The health timeline's RESUMPTION writer (audit N6). The ingest's transition branch compares
 * the producer's reported state with its previous one, so a producer coming back after
 * PRODUCER_OFFLINE (a state only the 5-minute pass can record) logged nothing and the outage
 * never closed in `camera_health_events`. The route now reads the last event -- only after a
 * gap past the stale threshold -- and writes the resumption at the heartbeat.
 */
describe("camera heartbeat ingest - resumption after a read-derived outage reaches the timeline", () => {
  const route = fs.readFileSync(path.join(__dirname, "cameraVisitsRoutes.ts"), "utf8");

  it("reads the previous row's gap, consults the last event only past the stale threshold, and writes through the pure rule", () => {
    expect(route).toContain("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt) AS gapSeconds");
    expect(route).toContain("gapSeconds > HEALTH_THRESHOLDS.staleAfterSeconds");
    expect(route).toContain("SELECT toState FROM camera_health_events");
    expect(route).toContain("resumptionTransition({");
    // The resumption is a fallback of the producer-transition branch, never a replacement.
    const branch = route.indexOf("if (!transition) {");
    const write = route.indexOf("INSERT INTO camera_health_events", branch);
    expect(branch).toBeGreaterThan(route.indexOf('reason: "producer restarted (new instance id)"'));
    expect(write).toBeGreaterThan(branch);
  });
});
