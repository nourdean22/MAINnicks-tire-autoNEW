/**
 * A send_pause_voice_outbound set WHILE a voice cron is running stops the next
 * dial (C5.5 round 2). Round 1 read the pause once at the cron's start gate, so
 * a pause set mid-run reached only placeVapiOutboundCall, which returned it as
 * a "config" dial failure: voice recovery threw (run FAILED), follow-up cadence
 * burned the touch (voice_followups row left "failed", UNIQUE blocks a retry),
 * confirmation calls marked the booking failed and kept looping.
 *
 * What this pins, per cron, with the pause flipped after the first dial:
 *   - dial 1 placed, dial 2+ never attempted, the run RESOLVES (no throw)
 *   - details read `Skipped · send_pause:voice_outbound` with the count not attempted
 *   - nothing is claimed, inserted or marked failed for the held items
 * and the race arm: the cron's own check said "go" but placeVapiOutboundCall
 * returned the hold anyway -> the claim/row for that item is undone, not failed.
 * CONTROL: never paused -> every candidate is dialed.
 *
 * SYNTHETIC INPUTS ONLY: 555 numbers, a scripted provider, a stub db.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  paused: false,
  flipAfterFirstDial: false,
  vapiHoldOnFirstDial: false,
  checks: 0,
  dialed: [] as string[],
}));

vi.mock("../../services/sendPause", () => ({
  sendPauseHoldReason: async (lane: string) => {
    h.checks++;
    return h.paused ? `send_pause:${lane}` : null;
  },
}));

type Write = { table: string; values?: Record<string, unknown> };

function fakeDb(selectResults: unknown[][]) {
  const updates: Write[] = [];
  const inserts: Write[] = [];
  const deletes: Write[] = [];
  let nextId = 500;
  const rowsOf = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      orderBy: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
      limit: async () => rows,
    });
  const db = {
    select: () => {
      const rows = selectResults.shift() ?? [];
      return { from: () => ({ where: () => rowsOf(rows) }) };
    },
    update: (t: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table: getTableName(t), values });
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
    insert: (t: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: getTableName(t), values });
        return Object.assign(Promise.resolve(undefined), { $returningId: async () => [{ id: nextId++ }] });
      },
    }),
    delete: (t: Parameters<typeof getTableName>[0]) => ({
      where: async () => {
        deletes.push({ table: getTableName(t) });
        return [{ affectedRows: 1 }];
      },
    }),
  };
  return { db, updates, inserts, deletes };
}

/** 16:00 Cleveland: inside recovery (10-17), confirmation (15-18) and cadence (9-18). */
const NOW_UTC = new Date("2026-10-14T20:00:00Z");
const PHONES = ["216-555-0141", "216-555-0142", "216-555-0143"];

const LANES = {
  recovery: {
    flag: "FEATURE_VOICE_RECOVERY",
    run: async () => (await import("./voiceRecovery")).runVoiceRecovery(),
    selects: () => [PHONES.map((p, i) => ({ id: 9100 + i, customerName: "Synthetic Lead", customerPhone: p, serviceDescription: "brake pads", estimatedAmount: 40_000 }))],
  },
  cadence: {
    flag: "FEATURE_FOLLOWUP_CADENCE",
    run: async () => (await import("./followupCadence")).runFollowupCadence(),
    selects: () => [
      PHONES.map((p, i) => ({ id: 9200 + i, name: "Synthetic Booking", phone: p, service: "tires mounted", createdAt: new Date(NOW_UTC.getTime() - 10 * 86_400_000) })),
      [], // no touches fired yet
    ],
  },
  confirmation: {
    flag: "FEATURE_CONFIRMATION_CALLS",
    run: async () => (await import("./confirmationCalls")).runConfirmationCalls(),
    selects: () => [
      PHONES.map((p, i) => ({ id: 9300 + i, name: "Synthetic Visit", phone: p, service: "oil change", vehicleYear: null, vehicleMake: null, vehicleModel: null, preferredDate: "2026-10-15" })),
      [], // no previous calls
    ],
  },
} as const;
type LaneName = keyof typeof LANES;

let rig: ReturnType<typeof fakeDb>;

function arm(lane: LaneName) {
  vi.stubEnv("VAPI_API_KEY", "canary-key");
  vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
  vi.stubEnv(LANES[lane].flag, "1");
  vi.doMock("../../lib/timezoneAssert", () => ({ getBusinessHour: () => 16, getBusinessDateKey: () => "2026-10-15" }));
  vi.doMock("../../services/vapi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/vapi")>()),
    resolveVapiPhoneNumberId: async () => "pn_canary",
    placeVapiOutboundCall: async (params: { customerNumber: string }) => {
      h.dialed.push(params.customerNumber);
      if (h.vapiHoldOnFirstDial && h.dialed.length === 1) {
        return { success: false, error: "send_pause:voice_outbound", errorKind: "config" as const };
      }
      if (h.flipAfterFirstDial) h.paused = true;
      return { success: true, callId: `call_${h.dialed.length}` };
    },
  }));
  vi.doMock("../../sms", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../sms")>()),
    loadSuppressionIndex: async () => ({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false }),
  }));
  rig = fakeDb(LANES[lane].selects() as unknown[][]);
  vi.doMock("../../db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../db")>()),
    getDb: async () => rig.db,
  }));
}

const failedWrites = () => rig.updates.filter((u) => u.values?.status === "failed" || u.values?.voiceRecoveryOutcome === "failed");
const recoveryClaims = () => rig.updates.filter((u) => u.values?.voiceRecoveryOutcome === "pending");
const recoveryReleases = () => rig.updates.filter((u) => u.values?.voiceRecoveryAttemptedAt === null);

beforeEach(() => {
  vi.resetModules();
  h.paused = false;
  h.flipAfterFirstDial = false;
  h.vapiHoldOnFirstDial = false;
  h.checks = 0;
  h.dialed = [];
  // Only Date is faked: the loops throttle with a real setTimeout.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_UTC);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  // doMocks are NOT file-scoped under singleFork serial mode.
  vi.doUnmock("../../lib/timezoneAssert");
  vi.doUnmock("../../services/vapi");
  vi.doUnmock("../../sms");
  vi.doUnmock("../../db");
});

describe.each(Object.keys(LANES) as LaneName[])("%s · pause set mid-run", (lane) => {
  it("CONTROL: never paused -> every candidate is dialed", async () => {
    arm(lane);
    const r = await LANES[lane].run();
    expect(h.dialed).toHaveLength(3);
    expect(r.recordsProcessed).toBe(3);
    expect(r.details).not.toMatch(/send_pause/);
  }, 20_000);

  it("pause flips after dial 1 -> dial 2+ never attempted, no throw, Skipped with the count", async () => {
    arm(lane);
    h.flipAfterFirstDial = true;
    const r = await LANES[lane].run();
    expect(h.dialed).toHaveLength(1);
    expect(r.recordsProcessed).toBe(1);
    expect(r.details).toMatch(/^Skipped · send_pause:voice_outbound/);
    expect(r.details).toContain("not_attempted=2");
    expect(failedWrites(), "a held item must not be marked failed").toEqual([]);
    if (lane === "recovery") {
      expect(recoveryClaims(), "only the dialed lead is claimed").toHaveLength(1);
      expect(recoveryReleases()).toEqual([]);
    } else {
      expect(rig.inserts, "only the dialed item gets a claim row").toHaveLength(1);
    }
  }, 20_000);

  it("race: the cron check said go but placeVapiOutboundCall returned the hold -> undone, not failed, run stops", async () => {
    arm(lane);
    h.vapiHoldOnFirstDial = true;
    const r = await LANES[lane].run();
    expect(h.dialed).toHaveLength(1);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/^Skipped · send_pause:voice_outbound/);
    expect(r.details).toContain("not_attempted=3");
    expect(failedWrites(), "a held dial is not a failed dial").toEqual([]);
    if (lane === "recovery") {
      expect(recoveryClaims()).toHaveLength(1);
      expect(recoveryReleases(), "the claim is released so the lead stays eligible").toHaveLength(1);
    } else {
      expect(rig.deletes, "the claim row is removed so the touch/booking stays eligible").toHaveLength(1);
    }
  }, 20_000);
});
