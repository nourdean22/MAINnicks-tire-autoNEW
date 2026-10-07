import { afterEach, describe, expect, it } from "vitest";
import { HEARTBEAT_ACCEPT, HEARTBEAT_COLUMNS, HEARTBEAT_GUARDED_SET } from "./cameraVisitsRoutes";
import {
  CAMERA_RUNTIME_COLUMNS_SINCE_0124,
  heartbeatGuardedSetFor,
  resetStorableHeartbeatColumns,
  storableHeartbeatColumns,
} from "../lib/heartbeatStorableColumns";

/**
 * Migrations are hand-applied, so the code ALWAYS deploys ahead of the DDL for a while. The
 * heartbeat upsert names every column, which used to turn that window into "every camera
 * heartbeat rejected until someone applies 0143 and notices the lattice went STALE". These
 * pin the behaviour that closes the window: name only the post-0124 columns the catalog has.
 */

const NEW_0143 = [
  "detectionsLast10m", "portalCrossingsLast60m",
  "conversationListeningCoverage60m", "conversationCaptureSecondsLast60m",
  "conversationCapturesLast60m", "conversationCaptureFailuresLast60m",
  "conversationWakeTriggersLast60m", "conversationTranscribeBacklog",
];
const READ_BY_GUARDS = ["state", "heartbeatSeq", "producerInstanceId"];
const SINCE = CAMERA_RUNTIME_COLUMNS_SINCE_0124;

function catalog(names: readonly string[]) {
  const state = { calls: 0 };
  return {
    state,
    async execute() {
      state.calls += 1;
      return [names.map((n) => ({ columnName: n }))];
    },
  };
}

const storable = (db: { execute: () => Promise<unknown> }, now: number, log: (m: string) => void = () => undefined) =>
  storableHeartbeatColumns(db, HEARTBEAT_COLUMNS, SINCE, now, log);

afterEach(() => resetStorableHeartbeatColumns());

describe("camera heartbeat ingest - storable columns follow the catalog", () => {
  it("drops ONLY the post-0124 columns production lacks, and says so once", async () => {
    const logs: string[] = [];
    const db = catalog(HEARTBEAT_COLUMNS.filter((c) => !NEW_0143.includes(c)));
    const columns = await storable(db, 1_000_000, (m) => logs.push(m));
    for (const c of NEW_0143) expect(columns).not.toContain(c);
    expect(columns.length).toBe(HEARTBEAT_COLUMNS.length - NEW_0143.length);
    expect(logs).toHaveLength(1);
    for (const c of NEW_0143) expect(logs[0]).toContain(c);
    expect(logs[0]).toContain("DROPPED");

    // Cached: the second heartbeat neither re-reads the catalog nor logs again.
    const again = await storable(db, 1_000_000 + 60_000, (m) => logs.push(m));
    expect(again).toEqual(columns);
    expect(db.state.calls).toBe(1);
    expect(logs).toHaveLength(1);
  });

  it("keeps the full list when production has every column", async () => {
    const logs: string[] = [];
    const columns = await storable(catalog(HEARTBEAT_COLUMNS), 1, (m) => logs.push(m));
    expect(columns).toEqual(HEARTBEAT_COLUMNS);
    expect(logs).toEqual([]);
  });

  it("never drops a pre-0124 column: those ARE the row, whatever the catalog says", async () => {
    const db = catalog(HEARTBEAT_COLUMNS.filter((c) => c !== "mode" && c !== "captureFps"));
    const columns = await storable(db, 1);
    expect(columns).toContain("mode");
    expect(columns).toContain("captureFps");
    expect(SINCE.has("mode")).toBe(false);
  });

  it("falls back to the full list when the catalog cannot be read or is empty", async () => {
    const broken = { async execute() { throw new Error("INFORMATION_SCHEMA unavailable"); } };
    expect(await storable(broken, 1)).toEqual(HEARTBEAT_COLUMNS);
    resetStorableHeartbeatColumns();
    const empty = { async execute() { return [[]]; } };
    expect(await storable(empty, 1)).toEqual(HEARTBEAT_COLUMNS);
  });

  it("re-reads the catalog after the TTL and after an explicit reset, so an applied migration takes effect without a redeploy", async () => {
    const db = catalog(HEARTBEAT_COLUMNS.filter((c) => !NEW_0143.includes(c)));
    await storable(db, 1_000_000);
    await storable(db, 1_000_000 + 9 * 60_000);
    expect(db.state.calls).toBe(1);
    await storable(db, 1_000_000 + 11 * 60_000);
    expect(db.state.calls).toBe(2);
    resetStorableHeartbeatColumns();
    await storable(db, 1_000_000 + 11 * 60_000);
    expect(db.state.calls).toBe(3);
  });

  it("every post-0124 column is a real heartbeat column, and every 0143 column is listed", () => {
    for (const c of SINCE) expect(HEARTBEAT_COLUMNS).toContain(c);
    for (const c of NEW_0143) expect(SINCE.has(c)).toBe(true);
  });
});

describe("camera heartbeat ingest - the guarded SET follows the column set it writes", () => {
  it("is the same clause the full column list has always produced", () => {
    expect(heartbeatGuardedSetFor(HEARTBEAT_COLUMNS, HEARTBEAT_ACCEPT, READ_BY_GUARDS)).toBe(HEARTBEAT_GUARDED_SET);
  });

  it("guards every column of a REDUCED set and names none of the dropped ones", () => {
    const reduced = HEARTBEAT_COLUMNS.filter((c) => !NEW_0143.includes(c));
    const set = heartbeatGuardedSetFor(reduced, HEARTBEAT_ACCEPT, READ_BY_GUARDS);
    for (const col of reduced.filter((c) => c !== "camera")) {
      expect(set, `${col} is not accept-guarded`).toContain(
        `\`${col}\` = IF(${HEARTBEAT_ACCEPT}, VALUES(\`${col}\`), \`${col}\`)`,
      );
    }
    for (const c of NEW_0143) expect(set).not.toContain(`\`${c}\``);
    // + receivedAt and stateSince, the two server clocks.
    expect(set.split("IF(").length - 1).toBe(reduced.length - 1 + 2);
    expect(set.endsWith("`receivedAt`)")).toBe(true);
  });
});
