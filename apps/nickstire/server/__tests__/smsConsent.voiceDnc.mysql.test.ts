/**
 * audit-2026-09-29-F3 canary (d), against a REAL MySQL 8: a spoken
 * do-not-call survives YES, START, and STOP then START, and every voice lane
 * still refuses the number.
 *
 * Nothing is stubbed between the orchestrator and the database: the inbound
 * orchestrator, sms.ts's writers and suppression index, complianceLog and the
 * consent ledger all run against a throwaway MySQL (scripts/lib/dev-db.mjs,
 * full drizzle schema). That is the one thing smsConsent.voiceDnc.test.ts
 * cannot show: what the upsert SQL actually leaves in sms_preferences.
 *
 * "Every voice lane" = voiceRecovery, followupCadence and confirmationCalls,
 * which all refuse a number when `loadSuppressionIndex().phones` has it. Each
 * check below rebuilds the index from the database (fresh module graph), so an
 * in-process cache cannot answer for the row.
 *
 * OPT-IN: set NICKSTIRE_MYSQL_IT=1. mysql-memory-server downloads MySQL
 * (~150MB, cached) and needs libaio1t64 + libnuma1 on Linux, which the CI
 * image is not guaranteed to have. Receipts from a local run are in the PR.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../sms");
vi.unmock("../db");
vi.unmock("../services/complianceLog");
vi.unmock("../services/consentLedger");

vi.mock("twilio", () => ({ default: () => ({ messages: { create: vi.fn().mockResolvedValue({ sid: "SM_x" }) } }) }));
vi.mock("../services/nickgpt-client", () => ({
  draftSmsReply: vi.fn().mockResolvedValue({ ok: false, error: "disabled in test" }),
}));
vi.mock("../services/classifiers", () => ({ classifyIntent: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock("../services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(false) }));

const RUN = process.env.NICKSTIRE_MYSQL_IT === "1";

const ENV_KEYS = ["DATABASE_URL", "CONSENT_LEDGER_MODE", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SMS_KILL_SWITCH"] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let stopDb: (() => Promise<void>) | null = null;
let conn: import("mysql2/promise").Connection | null = null;
let seq = 0;

describe.skipIf(!RUN)("real MySQL: a spoken do-not-call survives an SMS opt-in", () => {
  beforeAll(async () => {
    const { startDevDb } = await import("../../scripts/lib/dev-db.mjs");
    const dev = await startDevDb({ quiet: true });
    stopDb = dev.stop;
    process.env.DATABASE_URL = dev.url;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.SMS_KILL_SWITCH = "1";
    const mysql = await import("mysql2/promise");
    conn = await mysql.createConnection({ uri: dev.url });
  }, 240_000);

  afterAll(async () => {
    await conn?.end();
    await stopDb?.();
    for (const k of ENV_KEYS) {
      const v = ORIG[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(() => {
    vi.resetModules();
  });

  async function row(phone: string) {
    const [rows] = await conn!.query("SELECT opted_out, opt_out_keyword FROM sms_preferences WHERE phone = ?", [phone]);
    const r = (rows as Array<{ opted_out: number; opt_out_keyword: string | null }>)[0];
    return r ? { optedOut: Boolean(r.opted_out), keyword: r.opt_out_keyword } : null;
  }

  /** Rebuild the index from the database in a fresh module graph. */
  async function freshIndex() {
    vi.resetModules();
    const { loadSuppressionIndex } = await import("../sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);
    return idx;
  }

  async function inbound(phone: string, body: string) {
    seq++;
    // contact_consent_events.occurred_at has one-second precision, and design
    // rule 5 lets a revoke win a same-second tie. A person cannot text STOP
    // and START within one second; this test can, so it waits.
    await new Promise((r) => setTimeout(r, 1_050));
    vi.resetModules();
    // One conversation per phone, as the webhook keeps it: the message-log
    // source releases a STOP only on a later START in the SAME conversation.
    const conversationId = Number(phone.slice(-4));
    // That source reads inbound bodies, so log the text exactly as the
    // webhook would before the orchestrator runs.
    await conn!.query("INSERT IGNORE INTO sms_conversations (id, phone) VALUES (?, ?)", [conversationId, `+1${phone}`]);
    await conn!.query(
      "INSERT INTO sms_messages (conversationId, direction, body, createdAt) VALUES (?, 'inbound', ?, NOW() + INTERVAL ? SECOND)",
      [conversationId, body, seq],
    );
    const { orchestrateSms } = await import("../services/smsOrchestrator");
    try {
      await orchestrateSms({ type: "inbound_sms", phone, body, conversationId, idempotencyKey: `it-${seq}` } as never);
    } catch {
      // Only the consent block is under test; it catches its own failures.
    }
  }

  async function voiceDnc(phone: string) {
    vi.resetModules();
    const { markPhoneVoiceOptedOut } = await import("../sms");
    expect(await markPhoneVoiceOptedOut(phone)).toBe(true);
  }

  describe.each(["off", "shadow"])("CONSENT_LEDGER_MODE=%s", (mode) => {
    beforeEach(() => {
      process.env.CONSENT_LEDGER_MODE = mode;
    });

    it("do-not-call, then YES, then START: still suppressed for every voice lane", async () => {
      const phone = mode === "off" ? "2165550301" : "2165550311";
      await voiceDnc(phone);
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "VOICE" });

      await inbound(phone, "YES");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "VOICE" });
      let idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);
      expect(idx.voiceOnly.has(phone)).toBe(true);

      await inbound(phone, "START");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "VOICE" });
      idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);
      expect(idx.voiceOnly.has(phone)).toBe(true);
    });

    it("do-not-call, then STOP, then START: the do-not-call survives the round trip", async () => {
      const phone = mode === "off" ? "2165550302" : "2165550312";
      await voiceDnc(phone);

      await inbound(phone, "STOP");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "SMS+VOICE" });
      let idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);
      // A full opt-out: not even a confirmation text.
      expect(idx.voiceOnly.has(phone)).toBe(false);

      await inbound(phone, "START");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "VOICE" });
      idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);
      expect(idx.voiceOnly.has(phone)).toBe(true);
    });

    it("text STOP, then a spoken do-not-call, then START: still suppressed for voice", async () => {
      const phone = mode === "off" ? "2165550303" : "2165550313";
      await inbound(phone, "STOP");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: null });
      await voiceDnc(phone);
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "SMS+VOICE" });

      await inbound(phone, "START");
      expect(await row(phone)).toEqual({ optedOut: true, keyword: "VOICE" });
      const idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);
    });

    it("POSITIVE CONTROL: STOP then START with no do-not-call restores contact", async () => {
      const phone = mode === "off" ? "2165550304" : "2165550314";
      await inbound(phone, "STOP");
      let idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(true);

      await inbound(phone, "START");
      expect(await row(phone)).toEqual({ optedOut: false, keyword: null });
      idx = await freshIndex();
      expect(idx.phones.has(phone)).toBe(false);
    });
  });

  it("CONSENT_LEDGER_MODE=shadow: START writes sms_* grants only, and the voice revoke stands", async () => {
    process.env.CONSENT_LEDGER_MODE = "shadow";
    const phone = "2165550321";
    await inbound(phone, "STOP");
    await inbound(phone, "START");
    const [rows] = await conn!.query(
      "SELECT scope FROM contact_consent_events WHERE subject_key = ? AND action = 'grant' ORDER BY scope",
      [phone],
    );
    expect((rows as Array<{ scope: string }>).map((r) => r.scope)).toEqual([
      "sms_conversational",
      "sms_informational",
      "sms_marketing",
    ]);
  });
});
