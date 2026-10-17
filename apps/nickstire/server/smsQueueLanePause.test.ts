/**
 * A text queued BEFORE a send pause is held by it (C5.5 round 2).
 *
 * The defect: processDelayedQueue checked only sms_global_pause. A confirmation
 * queued while the gateway was offline ("Queued for the 8 AM window"), or a
 * declined-recovery text the CLI queued at 9 PM, went out on the next drain even
 * after send_pause_<lane> was set. The drain now maps each row to its lane
 * (messageClass customer_confirmation or a confirm:* variantKey ->
 * customer_confirmations; a declined_<n>d_<P> variantKey -> declined_recovery)
 * and leaves a paused lane's rows queued. shouldHold decides, so an unreadable
 * switch follows the lane's fail class: confirmations send, declined holds.
 *
 * Drives the REAL queue: rows come back through rehydrateQueuedFromDb, the real
 * 60 s timer fires, the real sendPause reads a fake feature_flags row. No
 * transport is configured, so a drained row is attempted and leaves the queue;
 * a held row stays (delayedQueueSize) and is never stamped sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

vi.unmock("./sms");

const h = vi.hoisted(() => ({
  pendingRows: [] as Array<{ id: number; body: string; phone: string; variantKey: string | null; createdAt?: Date }>,
  statusWrites: [] as Array<{ status: unknown; failureReason?: unknown }>,
  sendAttempts: 0,
  flipOnFirstSend: null as string | null,
  queuedRows: [] as Array<{ id: number; variantKey: string | null }>,
  queuedGroups: [] as Array<{ variantKey: string | null; n: number }>,
  pausedKeys: new Set<string>(),
  unreadable: false,
  sentMarks: 0,
  stuckGroups: [] as Array<{ variantKey: string | null; n: number; oldestMin: number }>,
  telegrams: [] as string[],
  globalPaused: false,
}));

function chain(result: unknown): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return () => chain(result);
    },
    apply: () => chain(result),
  });
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) =>
        getTableName(table) === "sms_messages"
          ? {
              innerJoin: () => ({ where: () => ({ limit: async () => h.pendingRows }) }),
              // countQueuedByLane's old row read honoured its LIMIT; the fix aggregates in SQL instead
              where: () => new Proxy(chain([]) as object, {
                get: (t, p) => (p === "limit" ? async (n: number) => h.queuedRows.slice(0, n) : (t as Record<string | symbol, unknown>)[p]),
              }),
            }
          : chain([]),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        if (v.status === "sent") h.sentMarks++;
        if ("status" in v) h.statusWrites.push({ status: v.status, failureReason: v.failureReason });
        return chain([{ affectedRows: 1 }, []]);
      },
    }),
    insert: () => chain([{ id: 1 }]),
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      const key = /send_pause_[a-z_]+/.exec(text)?.[0];
      if (key) {
        if (h.unreadable) throw new Error("connection refused");
        return [h.pausedKeys.has(key) ? [{ v: 1 }] : []];
      }
      // checkStuckQueueAlert: queued rows older than the threshold, one row per variantKey
      if (text.includes("TIMESTAMPDIFF")) return [h.stuckGroups, []];
      // countQueuedByLane: every queued row, grouped by variantKey, no cap
      if (text.includes("GROUP BY variantKey")) return [h.queuedGroups, []];
      // recordSendFailure: one per attempted send (no transport is configured, so every send fails)
      if (text.includes("send_attempts")) {
        h.sendAttempts++;
        if (h.flipOnFirstSend) { h.pausedKeys.add(h.flipOnFirstSend); h.flipOnFirstSend = null; }
      }
      return [[], []];
    },
  }),
}));

vi.mock("./services/smsControl", () => ({
  getSmsPauseState: async () => ({ readable: true, paused: h.globalPaused, reason: null }),
}));
vi.mock("./services/telegram", () => ({
  sendTelegram: async (m: string) => {
    h.telegrams.push(m);
    return true;
  },
}));

const TRANSPORT_ENV = [
  "SHOP_SMS_GATEWAY_USERNAME",
  "SHOP_SMS_GATEWAY_PASSWORD",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  h.pendingRows = [];
  h.pausedKeys = new Set();
  h.unreadable = false;
  h.sentMarks = 0;
  h.stuckGroups = [];
  h.telegrams = [];
  h.globalPaused = false;
  h.statusWrites = [];
  h.sendAttempts = 0;
  h.flipOnFirstSend = null;
  h.queuedRows = [];
  h.queuedGroups = [];
  for (const k of TRANSPORT_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(async () => {
  const sms = await import("./sms");
  sms.stopDelayedQueueProcessor();
  vi.useRealTimers();
  for (const k of TRANSPORT_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/**
 * Rehydrate one row, run two real 60 s drain cycles at 10:00 Cleveland, return
 * the queue size after. Each cycle is AWAITED (delayedQueueCyclesInFlight):
 * polling the size instead passed a "held" assertion before the drain had run.
 */
async function drainTwice(row: { variantKey: string | null }) {
  h.pendingRows = [{ id: 71, body: "Your tires are ready.", phone: "2165550171", ...row }];
  vi.useFakeTimers({ now: new Date("2026-10-14T14:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
  const sms = await import("./sms");
  expect(await sms.rehydrateQueuedFromDb()).toBe(1);
  expect(sms.getSmsStats().delayedQueueSize).toBe(1);
  sms.startDelayedQueueProcessor();
  for (let i = 0; i < 2; i++) {
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(sms.delayedQueueCyclesInFlight());
  }
  return sms.getSmsStats().delayedQueueSize;
}

const CONFIRM = "confirm:tire_ready:NT-1001";
const DECLINED = "declined_7d_P0";

describe("delayed queue · send_pause lane hold", () => {
  it("CONTROL: a queued confirmation with its lane live is drained", async () => {
    expect(await drainTwice({ variantKey: CONFIRM })).toBe(0);
  });

  it("a queued confirmation with send_pause_customer_confirmations set stays queued and is not marked sent", async () => {
    h.pausedKeys.add("send_pause_customer_confirmations");
    expect(await drainTwice({ variantKey: CONFIRM })).toBe(1);
    expect(h.sentMarks).toBe(0);
  });

  it("a queued declined text with send_pause_declined_recovery set stays queued", async () => {
    h.pausedKeys.add("send_pause_declined_recovery");
    expect(await drainTwice({ variantKey: DECLINED })).toBe(1);
    expect(h.sentMarks).toBe(0);
  });

  it("an unmapped class is unaffected by any lane pause (today's behaviour)", async () => {
    h.pausedKeys.add("send_pause_customer_confirmations");
    h.pausedKeys.add("send_pause_declined_recovery");
    expect(await drainTwice({ variantKey: "retention_d7_v1" })).toBe(0);
  });

  it("round 2: a queued weather text with send_pause_weather_sms set stays queued", async () => {
    h.pausedKeys.add("send_pause_weather_sms");
    expect(await drainTwice({ variantKey: "weather_first_freeze" })).toBe(1);
    expect(h.sentMarks).toBe(0);
  });

  it("round 2: a queued missed-call recovery text with send_pause_missed_call_recovery set stays queued", async () => {
    h.pausedKeys.add("send_pause_missed_call_recovery");
    expect(await drainTwice({ variantKey: "missed_call_recovery" })).toBe(1);
  });

  it("round 2 CONTROL: the same weather text with its lane live is drained", async () => {
    expect(await drainTwice({ variantKey: "weather_first_freeze" })).toBe(0);
  });

  it("declined queued + unreadable switch -> held (fail closed)", async () => {
    h.unreadable = true;
    expect(await drainTwice({ variantKey: DECLINED })).toBe(1);
  });

  it("confirmation queued + unreadable switch -> drained (fail open)", async () => {
    h.unreadable = true;
    expect(await drainTwice({ variantKey: CONFIRM })).toBe(0);
  });
});

describe("queuedSendPauseLane (class -> lane)", () => {
  // Dynamic so the queue tests above still run (red) against code that lacks the export.
  let queuedSendPauseLane: (c: string | undefined, v: string | null | undefined) => string | null;
  beforeEach(async () => {
    ({ queuedSendPauseLane } = await import("./lib/smsQueueReplay") as unknown as { queuedSendPauseLane: typeof queuedSendPauseLane });
  });
  it("maps confirmations by messageClass or confirm:* variantKey", () => {
    expect(queuedSendPauseLane("customer_confirmation", null)).toBe("customer_confirmations");
    expect(queuedSendPauseLane(undefined, CONFIRM)).toBe("customer_confirmations");
  });
  it("maps every declined sequence key to declined_recovery", () => {
    for (const k of ["declined_3d_P0", "declined_7d_P1", "declined_14d_P2", "declined_30d_P3", "declined_45d_P0"]) {
      expect(queuedSendPauseLane("customer_marketing", k), k).toBe("declined_recovery");
    }
  });
  it("round 2: maps weather_* keys to weather_sms and the missed-call recovery key to missed_call_recovery", () => {
    for (const k of ["weather_first_freeze", "weather_heavy_rain", "weather_salt_season_end"]) {
      expect(queuedSendPauseLane("customer_marketing", k), k).toBe("weather_sms");
    }
    expect(queuedSendPauseLane("customer_followup", "missed_call_recovery")).toBe("missed_call_recovery");
    // the webhook's own forwarded-call follow-up keeps its catalog key and is NOT the cron's lane
    expect(queuedSendPauseLane("customer_followup", "vapi_forwarded_call_followup_v1")).toBeNull();
  });
  it("leaves anything else unmapped", () => {
    expect(queuedSendPauseLane(undefined, undefined)).toBeNull();
    expect(queuedSendPauseLane("customer_marketing", "retention_d7_v1")).toBeNull();
    expect(queuedSendPauseLane("internal", "declined_work")).toBeNull();
  });
});

/**
 * The silent-stall alert must not page "SMS queue STUCK" for rows held only by
 * their lane's send pause: that is an operator-chosen hold, like the global
 * pause it already excludes. Drives the real 60 s cycle with the gateway
 * configured and reachable (fetch stubbed), so checkStuckQueueAlert runs.
 */
describe("stuck-queue alert · lane-held rows", () => {
  const GATEWAY_ENV = ["SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD"];
  async function oneCycle() {
    for (const k of GATEWAY_ENV) process.env[k] = "canary";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ id: "dev1", lastSeen: new Date().toISOString() }]), { status: 200 }));
    vi.useFakeTimers({ now: new Date("2026-10-14T14:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
    const sms = await import("./sms");
    sms.startDelayedQueueProcessor();
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(sms.delayedQueueCyclesInFlight());
  }
  afterEach(() => vi.unstubAllGlobals());
  const pages = () => h.telegrams.filter((m) => m.includes("SMS queue STUCK"));

  it("a 6-minute-old due confirmation with send_pause_customer_confirmations paused does NOT page", async () => {
    h.pausedKeys.add("send_pause_customer_confirmations");
    h.stuckGroups = [{ variantKey: CONFIRM, n: 1, oldestMin: 6 }];
    await oneCycle();
    expect(pages()).toEqual([]);
  });

  it("CONTROL: the same row with its lane live DOES page", async () => {
    h.stuckGroups = [{ variantKey: CONFIRM, n: 1, oldestMin: 6 }];
    await oneCycle();
    expect(pages()).toHaveLength(1);
    expect(pages()[0]).toContain("1 due message(s)");
  });

  it("a held lane does not hide a real stall in another row: only the unheld row is counted", async () => {
    h.pausedKeys.add("send_pause_customer_confirmations");
    h.stuckGroups = [{ variantKey: CONFIRM, n: 3, oldestMin: 40 }, { variantKey: null, n: 2, oldestMin: 7 }];
    await oneCycle();
    expect(pages()).toHaveLength(1);
    expect(pages()[0]).toContain("2 due message(s)");
    expect(pages()[0]).toContain("oldest 7m");
  });

  it("CONTROL: the global pause still suppresses the page (unchanged)", async () => {
    h.globalPaused = true;
    h.stuckGroups = [{ variantKey: CONFIRM, n: 1, oldestMin: 6 }];
    await oneCycle();
    expect(pages()).toEqual([]);
  });
});

/** The per-drain "holding N" line is rate-limited: once per 10 minutes per lane, or when the count changes. */
describe("delayed queue · held-count log rate limit", () => {
  it("logs once, again on a count change, and again after 10 minutes", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      const s = String(chunk);
      if (s.includes("[sms queue] holding")) lines.push(s);
      return true;
    });
    try {
      h.pausedKeys.add("send_pause_customer_confirmations");
      h.pendingRows = [{ id: 81, body: "Your tires are ready.", phone: "2165550181", variantKey: CONFIRM }];
      vi.useFakeTimers({ now: new Date("2026-10-14T14:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
      const sms = await import("./sms");
      expect(await sms.rehydrateQueuedFromDb()).toBe(1);
      sms.startDelayedQueueProcessor();
      const cycle = async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.all(sms.delayedQueueCyclesInFlight());
      };
      for (let i = 0; i < 4; i++) await cycle(); // minutes 1-4, same count
      expect(lines, "one line for four identical drains").toHaveLength(1);

      h.pendingRows = [{ id: 82, body: "Your tires are ready.", phone: "2165550182", variantKey: "confirm:tire_ready:NT-1002" }];
      expect(await sms.rehydrateQueuedFromDb()).toBe(1);
      await cycle(); // minute 5, count 1 -> 2
      expect(lines, "a count change logs").toHaveLength(2);
      expect(lines[1]).toContain("holding 2");

      for (let i = 0; i < 9; i++) await cycle(); // minutes 6-14: 10 minutes after the last line at minute 5 is minute 15
      expect(lines).toHaveLength(2);
      await cycle(); // minute 15
      expect(lines, "10 minutes later the line repeats").toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  });
});

/** Codex P1/P2 on #3136: re-check before EACH drained send, expire obsolete held rows, count without a cap. */
describe("delayed queue · round 2b (per-send re-check, held-row expiry, uncapped count)", () => {
  const NOW = new Date("2026-10-14T14:00:00Z"); // 10:00 Cleveland
  const HOUR = 3_600_000;
  async function boot() {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    return import("./sms");
  }
  async function cycle(sms: typeof import("./sms")) {
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(sms.delayedQueueCyclesInFlight());
  }

  it("three due rows of one lane, the pause flips after send 1 -> one attempt, two rows stay pending", async () => {
    h.pendingRows = [71, 72, 73].map((id) => ({ id, body: "Your tires are ready.", phone: `21655501${id}`, variantKey: CONFIRM }));
    h.flipOnFirstSend = "send_pause_customer_confirmations";
    const sms = await boot();
    expect(await sms.rehydrateQueuedFromDb()).toBe(3);
    h.pendingRows = []; // nothing new to rehydrate after this
    sms.startDelayedQueueProcessor();
    await cycle(sms);
    expect(h.sendAttempts, "only the first row was sent").toBe(1);
    expect(sms.getSmsStats().delayedQueueSize, "rows 2-3 back in the queue").toBe(2);
    expect(h.sentMarks).toBe(0);
  });

  it("CONTROL: never paused -> all three are attempted", async () => {
    h.pendingRows = [71, 72, 73].map((id) => ({ id, body: "Your tires are ready.", phone: `21655501${id}`, variantKey: CONFIRM }));
    const sms = await boot();
    expect(await sms.rehydrateQueuedFromDb()).toBe(3);
    h.pendingRows = [];
    sms.startDelayedQueueProcessor();
    await cycle(sms);
    expect(h.sendAttempts).toBe(3);
  });

  it("a row rehydrated while its lane is paused is NOT marked sending (it stays queued)", async () => {
    h.pausedKeys.add("send_pause_weather_sms");
    h.pendingRows = [{ id: 81, body: "Hi Pat, heavy rain today.", phone: "2165550181", variantKey: "weather_heavy_rain", createdAt: new Date(NOW.getTime() - HOUR) }];
    const sms = await boot();
    await sms.rehydrateQueuedFromDb();
    expect(h.statusWrites.map((w) => w.status)).not.toContain("sending");
  });

  it("a weather row held past the 6 h bound is expired on release: marked failed send_pause_expired:weather_sms, never sent", async () => {
    h.pausedKeys.add("send_pause_weather_sms");
    h.pendingRows = [{ id: 82, body: "Hi Pat, heavy rain today.", phone: "2165550182", variantKey: "weather_heavy_rain", createdAt: new Date(NOW.getTime() - 7 * HOUR) }];
    const sms = await boot();
    await sms.rehydrateQueuedFromDb();
    h.pendingRows = [];
    sms.startDelayedQueueProcessor();
    await cycle(sms); // held
    h.pausedKeys.delete("send_pause_weather_sms"); // the operator resumes
    await cycle(sms); // released
    expect(h.sendAttempts, "an obsolete weather text is never sent").toBe(0);
    expect(h.statusWrites).toContainEqual({ status: "failed", failureReason: "send_pause_expired:weather_sms" });
    expect(sms.getSmsStats().delayedQueueSize, "and removed from memory").toBe(0);
  });

  it("CONTROL: a weather row held for under the bound is sent on release", async () => {
    h.pausedKeys.add("send_pause_weather_sms");
    h.pendingRows = [{ id: 83, body: "Hi Pat, heavy rain today.", phone: "2165550183", variantKey: "weather_heavy_rain", createdAt: new Date(NOW.getTime() - HOUR) }];
    const sms = await boot();
    await sms.rehydrateQueuedFromDb();
    h.pendingRows = [];
    sms.startDelayedQueueProcessor();
    await cycle(sms);
    h.pausedKeys.delete("send_pause_weather_sms");
    await cycle(sms);
    expect(h.sendAttempts).toBe(1);
    expect(h.statusWrites.map((w) => w.failureReason)).not.toContain("send_pause_expired:weather_sms");
  });

  it("a missed-call row held past 48 h is expired; a confirmation held 47 h is sent", async () => {
    h.pausedKeys.add("send_pause_missed_call_recovery");
    h.pausedKeys.add("send_pause_customer_confirmations");
    h.pendingRows = [
      { id: 84, body: "Hey, this is Nick's.", phone: "2165550184", variantKey: "missed_call_recovery", createdAt: new Date(NOW.getTime() - 49 * HOUR) },
      { id: 85, body: "Your tires are ready.", phone: "2165550185", variantKey: CONFIRM, createdAt: new Date(NOW.getTime() - 47 * HOUR) },
    ];
    const sms = await boot();
    await sms.rehydrateQueuedFromDb();
    h.pendingRows = [];
    sms.startDelayedQueueProcessor();
    await cycle(sms);
    h.pausedKeys.clear();
    await cycle(sms);
    expect(h.statusWrites).toContainEqual({ status: "failed", failureReason: "send_pause_expired:missed_call_recovery" });
    expect(h.sendAttempts, "only the confirmation").toBe(1);
  });

  it("a row the drain holds after it was claimed goes back to queued in the DB", async () => {
    h.pendingRows = [{ id: 86, body: "Your tires are ready.", phone: "2165550186", variantKey: CONFIRM }];
    const sms = await boot();
    await sms.rehydrateQueuedFromDb(); // lane live: claimed queued -> sending
    expect(h.statusWrites.map((w) => w.status)).toContain("sending");
    h.pendingRows = [];
    h.pausedKeys.add("send_pause_customer_confirmations");
    sms.startDelayedQueueProcessor();
    await cycle(sms);
    expect(h.statusWrites.at(-1)?.status, "held rows never sit in sending").toBe("queued");
    expect(sms.getSmsStats().delayedQueueSize).toBe(1);
  });

  it("heldQueued counts a 2001-row backlog exactly, never a capped 2000", async () => {
    h.queuedRows = Array.from({ length: 2001 }, (_, i) => ({ id: 10_000 + i, variantKey: CONFIRM }));
    h.queuedGroups = [{ variantKey: CONFIRM, n: 2001 }, { variantKey: null, n: 5 }];
    const sms = await boot();
    const counts = await sms.countQueuedByLane();
    expect(counts?.get("customer_confirmations")).toBe(2001);
  });
});