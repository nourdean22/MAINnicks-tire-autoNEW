/**
 * receptionist.prompt_experiment v1 is a REGISTERED, BRIDGE-ONLY RealityEvent
 * (2026-10-09).
 *
 * nickstire's weekly prompt-evolution run posts one receipt per run to
 * /api/sync/evidence with STATENOUR_SYNC_KEY (the bridge door): one
 * `receptionist.prompt_experiment` event plus one H2 EvidenceClaim resting on
 * it. The ledger rejects every unregistered event type by index, so without
 * the registry entry the whole receipt would be dropped and the claim refused
 * for dangling lineage. /proof labels these rows as that cron's receipts, so
 * the type is scoped to the bridge door: the EVIDENCE_LEDGER_KEY holder
 * (Night Shift, an LLM) cannot write a row that renders exactly like it.
 *
 * Positive controls first (the producer-shaped batch lands through the real
 * recordEvidenceBatch, and through the real POST route, with Prisma mocked),
 * then the breaks that prove each guard is load-bearing.
 *
 * PII pairing: the ledger's phone tripwire flags any run of exactly 10 digits,
 * which random hex ids hit by chance. The producer splits digit runs with "_"
 * (nickstire promptEvolutionReceipt.ts ledgerSafe). The tests below pin both
 * halves against the REAL findPii: raw ids do trip it (so the split is
 * needed), and every split form passes (so the split works).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  realityEventContract,
  validateRealityEventRegistration,
} from "@/lib/events/reality-event-registry";

const { eventCreate, claimCreate } = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  claimCreate: vi.fn(),
}));

const prismaMock = {
  realityEvent: { create: eventCreate },
  evidenceClaim: { create: claimCreate },
  // evidenceHandler (the real route wrapper) may log the request.
  apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
  // The writer inserts inside one transaction; the mock hands the same client back.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

/** The producer contract, as nickstire's cron:prompt-evolution-weekly posts it. */
const sampleEvent = {
  eventType: "receptionist.prompt_experiment",
  eventVersion: 1,
  occurredAt: "2026-10-12T13:33:00.000Z",
  objects: [{ type: "experiment", id: "prompt-evolution:9f2c4e1ab07d3e55" }],
  source: { system: "nickstire", uri: "cron:prompt-evolution-weekly" },
  quality: "derived",
  payload: {
    outcome: "rejected-holdout",
    promotionStage: "none",
    baseline: { source: "live_provider", promptHash: "a1b2c3d4", parity: "identical" },
    candidate: { promptHash: "e5f6a7b8" },
    lanes: { parity: false, differences: ["model", "temperature"] },
    cohorts: { train: 14, holdout: 12, confirm: 6, success: 10 },
    gates: {
      holdout: { reason: "not-significant", pValue: 0.344, comparable: 11, improved: 3, worsened: 1 },
      success: null,
      confirmation: null,
    },
    previousProposal: { status: "not_applied" },
    usage: { durationMs: 118618, replays: 72 },
  },
};
const sampleClaim = {
  claimText: "Receptionist prompt candidate did not beat the baseline on the holdout cohort (p=0.344, 11 comparable seeds).",
  grade: "H2",
  hypothesisId: "prompt-evolution:9f2c4e1ab07d3e55",
  disposition: "refuted",
  sourceEventIndexes: [0],
};

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  eventCreate.mockImplementation(async () => ({ id: `evt_${++nextId}` }));
  claimCreate.mockImplementation(async () => ({ id: `clm_${++nextId}` }));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
});

describe("registry: receptionist.prompt_experiment v1", () => {
  it("resolves to a bridge-only, evidence-class v1 contract with its own canonical type", () => {
    expect(realityEventContract("receptionist.prompt_experiment")?.producers).toEqual(["bridge"]);
    expect(
      validateRealityEventRegistration({ eventType: sampleEvent.eventType, eventVersion: 1, payload: sampleEvent.payload, producer: "bridge" }),
    ).toMatchObject({
      ok: true,
      eventVersion: 1,
      retentionClass: "evidence",
      canonicalType: "com.statenour.receptionist.prompt_experiment.recorded.v1",
      // passthrough: the reader's optional keys survive validation untouched
      payload: { gates: { holdout: { pValue: 0.344 } }, previousProposal: { status: "not_applied" } },
    });
  });

  it("a minimal payload (outcome only) is accepted: every other key is optional for the reader", () => {
    expect(
      validateRealityEventRegistration({ eventType: "receptionist.prompt_experiment", payload: { outcome: "no-candidate" }, producer: "bridge" }),
    ).toMatchObject({ ok: true });
  });

  it("break: the ledger door, the operator door, and a caller that names no door are each refused (fail closed)", () => {
    for (const producer of ["ledger", "operator", undefined] as const) {
      const r = validateRealityEventRegistration({ eventType: "receptionist.prompt_experiment", payload: { outcome: "accepted" }, producer });
      expect(r, String(producer)).toEqual({
        ok: false,
        error: `receptionist.prompt_experiment is accepted only through the bridge door (this request: ${producer ?? "unknown door"})`,
      });
    }
  });

  it("the scope is per family: an unscoped type (experiment.verdict) still validates from the ledger door and with no door", () => {
    expect(realityEventContract("experiment.verdict")?.producers).toBeUndefined();
    expect(validateRealityEventRegistration({ eventType: "experiment.verdict", payload: { status: "keep_running" }, producer: "ledger" })).toMatchObject({ ok: true });
    expect(validateRealityEventRegistration({ eventType: "experiment.verdict", payload: { status: "keep_running" } })).toMatchObject({ ok: true });
  });

  it("break: a near-miss event type is NOT registered (exact match, not a prefix)", () => {
    expect(validateRealityEventRegistration({ eventType: "receptionist.prompt_experiments", payload: { outcome: "x" }, producer: "bridge" })).toEqual({
      ok: false,
      error: 'unregistered RealityEvent type "receptionist.prompt_experiments"',
    });
  });

  it("break: a payload without an outcome is refused", () => {
    const { outcome: _omit, ...rest } = sampleEvent.payload;
    const r = validateRealityEventRegistration({ eventType: "receptionist.prompt_experiment", payload: rest, producer: "bridge" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/payload does not match receptionist v1: outcome/);
  });

  it("break: an explicit eventVersion 2 or a non-evidence retention class is refused", () => {
    const v2 = validateRealityEventRegistration({ eventType: "receptionist.prompt_experiment", eventVersion: 2, payload: { outcome: "x" }, producer: "bridge" });
    expect(v2).toMatchObject({ ok: false });
    if (!v2.ok) expect(v2.error).toMatch(/eventVersion 2.*registered version 1/);
    const rc = validateRealityEventRegistration({ eventType: "receptionist.prompt_experiment", retentionClass: "operational", payload: { outcome: "x" }, producer: "bridge" });
    expect(rc).toMatchObject({ ok: false });
  });
});

describe("recordEvidenceBatch: the producer-shaped receipt lands through the bridge door only", () => {
  it("positive control: event + H2 claim are written, the claim rests on the event's real id", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch({ events: [sampleEvent], claims: [sampleClaim], sender: "nickstire" }, { producer: "bridge" });
    expect(r).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      eventType: "receptionist.prompt_experiment",
      eventVersion: 1,
      retentionClass: "evidence",
      sourceSystem: "nickstire",
      sourceUri: "cron:prompt-evolution-weekly",
      occurredAt: new Date("2026-10-12T13:33:00.000Z"),
    });
    expect(claimCreate.mock.calls[0][0].data).toMatchObject({
      grade: "H2",
      disposition: "REFUTED",
      createdBy: "CRON",
      sourceEventKeys: ["evt_1"],
    });
  });

  it("break: the SAME receipt through the ledger door writes nothing; the claim is refused for dangling lineage", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch({ events: [sampleEvent], claims: [sampleClaim], sender: "nickstire" }, { producer: "ledger" });
    expect(r.eventsWritten).toBe(0);
    expect(r.claimsWritten).toBe(0);
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0"]);
    expect(r.rejected[0].error).toMatch(/accepted only through the bridge door \(this request: ledger\)/);
    expect(eventCreate).not.toHaveBeenCalled();
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it("break: the same receipt without an outcome writes nothing, and the claim is refused for dangling lineage", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const { outcome: _omit, ...rest } = sampleEvent.payload;
    const r = await recordEvidenceBatch(
      { events: [{ ...sampleEvent, payload: rest }], claims: [sampleClaim], sender: "nickstire" },
      { producer: "bridge" },
    );
    expect(r.eventsWritten).toBe(0);
    expect(r.claimsWritten).toBe(0);
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0"]);
    expect(r.rejected[0].error).toMatch(/payload does not match receptionist v1/);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/evidence: the door is derived from the key, end to end", () => {
  it("the bridge key lands the receipt; the ledger key is refused, with no row written", async () => {
    const prev = { l: process.env.EVIDENCE_LEDGER_KEY, b: process.env.STATENOUR_SYNC_KEY };
    process.env.EVIDENCE_LEDGER_KEY = "ledger-key-for-test";
    process.env.STATENOUR_SYNC_KEY = "bridge-key-for-test";
    try {
      const { POST } = await import("@/app/api/sync/evidence/route");
      const post = async (key: string) =>
        (
          await POST(
            new Request("http://x/api/sync/evidence", {
              method: "POST",
              headers: { "content-type": "application/json", "x-sync-key": key },
              body: JSON.stringify({ events: [sampleEvent], claims: [sampleClaim], sender: "nickstire" }),
            }),
            {} as never,
          )
        ).json();

      const ledger = await post("ledger-key-for-test");
      expect(ledger.data).toMatchObject({ ok: false, producer: "ledger", eventsWritten: 0, claimsWritten: 0 });
      expect(ledger.data.rejected[0].error).toMatch(/only through the bridge door/);
      expect(eventCreate).not.toHaveBeenCalled();

      const bridge = await post("bridge-key-for-test");
      expect(bridge.data).toMatchObject({ ok: true, producer: "bridge", eventsWritten: 1, claimsWritten: 1, rejected: [] });
      expect(eventCreate).toHaveBeenCalledTimes(1);
    } finally {
      if (prev.l === undefined) delete process.env.EVIDENCE_LEDGER_KEY;
      else process.env.EVIDENCE_LEDGER_KEY = prev.l;
      if (prev.b === undefined) delete process.env.STATENOUR_SYNC_KEY;
      else process.env.STATENOUR_SYNC_KEY = prev.b;
    }
  });
});

/** The producer's split rule (nickstire promptEvolutionReceipt.ts ledgerSafe): a "_" after every 4 digits that a digit follows. */
const splitDigitRuns = (s: string) => s.replace(/\d{4}(?=\d)/g, "$&_");

/** Seeded PRNG (mulberry32) so the sweep is the same on every run. */
function hexSource(seed: number): (len: number) => string {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (len) => Array.from({ length: len }, () => "0123456789abcdef"[Math.floor(next() * 16)]).join("");
}

describe("PII tripwire vs the producer's hex ids", () => {
  it("current tripwire, documented (flip this if the phone regex is deliberately narrowed via guard-red-team): a raw 10-digit run in a hex id is refused", async () => {
    // Measured by the review on 200,000 draws against this regex: 1.37% of
    // 16-hex ids and 2.45% of 24-hex hashes trip it; a receipt carrying an id
    // plus two hashes ~6.2%. That is why the producer splits digit runs.
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      { events: [{ ...sampleEvent, objects: [{ type: "experiment", id: "prompt-evolution:ab1234567890cdef" }] }], sender: "nickstire" },
      { producer: "bridge" },
    );
    expect(r.eventsWritten).toBe(0);
    expect(r.rejected[0].error).toMatch(/objects\[0\]\.id: value looks like phone/);
  });

  it("positive control: the producer-encoded receipt (ids and hashes split) lands, event and claim", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const id = splitDigitRuns("prompt-evolution:ab1234567890cdef");
    const baseHash = splitDigitRuns("c0ffee2718281828deadbeef");
    const candHash = splitDigitRuns("9876543210abcdefabcdef01");
    expect([id, baseHash, candHash]).toEqual(["prompt-evolution:ab1234_5678_90cdef", "c0ffee2718_2818_28deadbeef", "9876_5432_10abcdefabcdef01"]);
    const event = {
      ...sampleEvent,
      correlationId: id,
      objects: [
        { type: "experiment", id },
        { type: "assistant_prompt", id: baseHash, role: "baseline" },
        { type: "assistant_prompt", id: candHash, role: "candidate" },
      ],
      payload: { ...sampleEvent.payload, baseline: { ...sampleEvent.payload.baseline, promptHash: baseHash }, candidate: { promptHash: candHash } },
    };
    const r = await recordEvidenceBatch({ events: [event], claims: [{ ...sampleClaim, hypothesisId: id }], sender: "nickstire" }, { producer: "bridge" });
    expect(r).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
  });

  it("sweep: every seeded 16-hex id and 24-hex hash that trips the raw regex passes once split (and some do trip)", async () => {
    const { findPii } = await import("@/lib/services/reality-ledger");
    const hex = hexSource(20261009);
    let tripped = 0;
    for (let i = 0; i < 3000; i++) {
      for (const raw of [`prompt-evolution:${hex(16)}`, hex(24)]) {
        if (!findPii(raw)) continue;
        tripped += 1;
        const split = splitDigitRuns(raw);
        expect(split.replaceAll("_", "")).toBe(raw); // only separators were added
        expect(findPii(split), split).toBeNull();
      }
    }
    // Instrument fired: ~1.4% + ~2.5% of 3000 each is ~115 expected; 0 would
    // mean the tripwire (or this sweep) no longer sees hex ids at all.
    expect(tripped).toBeGreaterThan(30);
  });
});
