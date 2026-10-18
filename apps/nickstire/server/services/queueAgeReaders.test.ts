/**
 * Queue-age readers · each returns { oldestDueAtMs, readFailed } with the age
 * computed IN SQL (TiDB DATETIME comes back shifted on ET; see
 * apps/nickstire/AGENTS.md > Time). The DB is a fake: these never touch a
 * real connection.
 *
 * The empty-vs-error pair is the point: an unavailable DB, a thrown query and
 * an unexpected result shape are readFailed; only a successful aggregate that
 * came back NULL is "no due row".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const execute = vi.fn();
let dbAvailable = true;
vi.mock("../db", () => ({ getDb: async () => (dbAvailable ? { execute } : null) }));

const suppression = vi.fn();
vi.mock("../sms", () => ({ loadSuppressionIndex: () => suppression() }));

import { QUEUE_AGE_READERS } from "./queueAgeReaders";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 18, 16, 0, 0);
const dialect = new MySqlDialect();
const sqlText = (call: number) => dialect.sqlToQuery(execute.mock.calls[call][0] as SQL).sql.replace(/\s+/g, " ");

const ENV_KEYS = [
  "FEATURE_FOLLOWUP_CADENCE",
  "FOLLOWUP_CADENCE_DRY_RUN",
  "VAPI_API_KEY",
  "REEL_GENERATION_ENABLED",
  "REEL_AUTOPOST_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  execute.mockReset();
  suppression.mockReset();
  dbAvailable = true;
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FEATURE_FOLLOWUP_CADENCE = "1";
  process.env.VAPI_API_KEY = "test-key";
  delete process.env.FOLLOWUP_CADENCE_DRY_RUN;
  process.env.REEL_GENERATION_ENABLED = "true";
  suppression.mockResolvedValue({ ok: true, phones: new Set<string>(), stale: false });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("reminder-queue reader", () => {
  const read = () => QUEUE_AGE_READERS["reminder-queue"](NOW);

  it("selects what processReminderQueue would: scheduled and nextDueDate <= now, aged in SQL", async () => {
    execute.mockResolvedValueOnce([[{ ageMinutes: 90 }]]);
    expect(await read()).toEqual({ oldestDueAtMs: NOW - 90 * MIN, readFailed: false });
    const q = sqlText(0);
    expect(q).toContain("FROM service_reminders");
    expect(q).toContain("status = 'scheduled'");
    expect(q).toContain("nextDueDate <= NOW()");
    expect(q).toContain("TIMESTAMPDIFF(MINUTE, nextDueDate, NOW())");
  });

  it("a NULL aggregate from a successful read is no due row", async () => {
    execute.mockResolvedValueOnce([[{ ageMinutes: null }]]);
    expect(await read()).toEqual({ oldestDueAtMs: null, readFailed: false });
  });

  it("a thrown query is readFailed, never empty", async () => {
    execute.mockRejectedValueOnce(new Error("Unknown column 'nextDueDate'"));
    const r = await read();
    expect(r.readFailed).toBe(true);
    expect(r.oldestDueAtMs).toBeNull();
    expect(r.error).toContain("Unknown column");
  });

  it("an unavailable database is readFailed, never empty", async () => {
    dbAvailable = false;
    expect((await read()).readFailed).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("an unexpected result shape is readFailed (an aggregate always returns one row)", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect((await read()).readFailed).toBe(true);
    execute.mockResolvedValueOnce([[{ ageMinutes: "not-a-number" }]]);
    expect((await read()).readFailed).toBe(true);
  });
});

describe("followup-cadence reader", () => {
  const read = () => QUEUE_AGE_READERS["followup-cadence"](NOW);

  it("skipped (not stuck) when FEATURE_FOLLOWUP_CADENCE is off; no query runs", async () => {
    delete process.env.FEATURE_FOLLOWUP_CADENCE;
    const r = await read();
    expect(r.readFailed).toBe(false);
    expect(r.skipped).toMatch(/FEATURE_FOLLOWUP_CADENCE/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("skipped in dry run: the job writes no voice_followups rows, so every touch would age forever", async () => {
    process.env.FOLLOWUP_CADENCE_DRY_RUN = "1";
    expect((await read()).skipped).toMatch(/DRY_RUN/);
  });

  it("due = completed booking in the 7..65 day window whose first un-fired touch is past due", async () => {
    execute.mockResolvedValueOnce([[{ phone: "(216) 555-0101", ageMinutes: 300 }]]); // pii-allow: fictional 555-01xx
    expect(await read()).toEqual({ oldestDueAtMs: NOW - 300 * MIN, readFailed: false });
    const q = sqlText(0);
    expect(q).toContain("FROM bookings b");
    expect(q).toContain("b.status = 'completed'");
    expect(q).toContain("INTERVAL 65 DAY");
    expect(q).toContain("INTERVAL 7 DAY");
    expect(q).toContain("voice_followups f7 ON f7.bookingId = b.id AND f7.touch = 'd7'");
    expect(q).toContain("WHEN f7.id IS NULL THEN 7 WHEN f30.id IS NULL THEN 30 ELSE 60");
  });

  it("skips opted-out and malformed phones exactly as the job does, then takes the oldest left", async () => {
    suppression.mockResolvedValueOnce({ ok: true, phones: new Set(["2165550101"]), stale: false });
    execute.mockResolvedValueOnce([
      [
        { phone: "+1 (216) 555-0101", ageMinutes: 9000 }, // pii-allow: fictional 555-01xx; opted out, the job skips it forever
        { phone: "555", ageMinutes: 8000 }, // not 10 digits: the job skips it
        { phone: "216-555-0199", ageMinutes: 120 }, // pii-allow: fictional 555-01xx test number
      ],
    ]);
    expect(await read()).toEqual({ oldestDueAtMs: NOW - 120 * MIN, readFailed: false });
  });

  it("an unreadable or stale suppression index is readFailed (the job itself refuses to run on it)", async () => {
    suppression.mockResolvedValueOnce({ ok: false, reason: "database unavailable" });
    expect((await read()).readFailed).toBe(true);
    suppression.mockResolvedValueOnce({ ok: true, phones: new Set(), stale: true });
    expect((await read()).readFailed).toBe(true);
  });

  it("no rows left after filtering is empty", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await read()).toEqual({ oldestDueAtMs: null, readFailed: false });
  });
});

describe("reel readers", () => {
  it("non-terminal: oldest queued/generating/assets_ready/assembling row by its last update", async () => {
    execute.mockResolvedValueOnce([[{ ageMinutes: 400 }]]);
    expect(await QUEUE_AGE_READERS["reel-pipeline"](NOW)).toEqual({ oldestDueAtMs: NOW - 400 * MIN, readFailed: false });
    const q = sqlText(0);
    expect(q).toContain("FROM reel_jobs");
    expect(q).toContain("status IN ('queued', 'generating', 'assets_ready', 'assembling')");
    expect(q).toContain("TIMESTAMPDIFF(MINUTE, updatedAt, NOW())");
  });

  it("publish: a claim stamped by publication_scheduled_at that never reached posted", async () => {
    execute.mockResolvedValueOnce([[{ ageMinutes: 200 }]]);
    expect(await QUEUE_AGE_READERS["reel-pipeline:publish"](NOW)).toEqual({ oldestDueAtMs: NOW - 200 * MIN, readFailed: false });
    const q = sqlText(0);
    expect(q).toContain("status IN ('publishing', 'publish_ambiguous')");
    expect(q).toContain("publication_scheduled_at IS NOT NULL");
    expect(q).toContain("TIMESTAMPDIFF(MINUTE, publication_scheduled_at, NOW())");
  });

  it("both reel checks are skipped when neither reel lane is on ('true' exactly)", async () => {
    process.env.REEL_GENERATION_ENABLED = "1";
    delete process.env.REEL_AUTOPOST_ENABLED;
    expect((await QUEUE_AGE_READERS["reel-pipeline"](NOW)).skipped).toMatch(/REEL_GENERATION_ENABLED/);
    expect((await QUEUE_AGE_READERS["reel-pipeline:publish"](NOW)).skipped).toMatch(/REEL_AUTOPOST_ENABLED/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("publish is still judged with generation off when the autopost lane can claim publishes", async () => {
    process.env.REEL_GENERATION_ENABLED = "false";
    process.env.REEL_AUTOPOST_ENABLED = "true";
    execute.mockResolvedValueOnce([[{ ageMinutes: 200 }]]);
    expect((await QUEUE_AGE_READERS["reel-pipeline:publish"](NOW)).oldestDueAtMs).toBe(NOW - 200 * MIN);
    expect((await QUEUE_AGE_READERS["reel-pipeline"](NOW)).skipped).toMatch(/REEL_GENERATION_ENABLED/);
  });
});
