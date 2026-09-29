/**
 * audit-2026-09-29-F3 · a spoken do-not-call must survive an SMS opt-in.
 *
 * The defect (#2694): a customer says "stop calling, just text me" on an AI
 * call, and markPhoneVoiceOptedOut records a VOICE-only row. Confirmation
 * texts still reach them. They reply YES, or STOP then START, and the inbound
 * orchestrator:
 *   (a) treated YES as an opt-in because `index.phones` includes voice-only
 *       numbers;
 *   (b) called markPhoneOptedIn, which dropped the number from both caches and
 *       wrote opted_out=0, erasing the do-not-call;
 *   (c) wrote a ledger grant with scope "all", which also lifts the
 *       voice_ai_* revocation (design rule 4 grants a keyword its own scope).
 * The next recovery or follow-up run could then call them.
 *
 * Driven through the REAL orchestrator entry, the REAL sms.ts writers and
 * index, and the REAL complianceLog + consentLedger. Only the database is a
 * stub: it records every write and serves sms_preferences rows. It does NOT
 * evaluate SQL, so the upsert's own semantics are pinned against a real
 * MySQL 8 in smsConsent.voiceDnc.mysql.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

vi.unmock("../sms");
vi.unmock("../services/complianceLog");
vi.unmock("../services/consentLedger");

vi.mock("twilio", () => ({ default: () => ({ messages: { create: vi.fn().mockResolvedValue({ sid: "SM_x" }) } }) }));
vi.mock("../services/nickgpt-client", () => ({
  draftSmsReply: vi.fn().mockResolvedValue({ ok: false, error: "disabled in test" }),
}));
vi.mock("../services/classifiers", () => ({
  classifyIntent: vi.fn().mockResolvedValue({ ok: false }),
}));
vi.mock("../services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(false) }));

const PHONE = "2165550188";

type PrefRow = { phone: string; keyword: string | null; optedOut: boolean };
let prefRows: PrefRow[] = [];
let writes: Array<{ kind: "insert" | "update" | "execute"; table: string; text: string; params: unknown[]; values?: unknown }> = [];

const dialect = new MySqlDialect();
function render(q: unknown): { text: string; params: unknown[] } {
  try {
    const out = dialect.sqlToQuery(q as never);
    return { text: out.sql, params: out.params };
  } catch {
    return { text: JSON.stringify(q), params: [] };
  }
}

function tableOf(t: unknown): string {
  try {
    return getTableName(t as never);
  } catch {
    return "?";
  }
}

// A chainable query builder: every method returns the chain, awaiting it
// yields rows for sms_preferences and [] for every other table.
function chain(table: string, onAwait: () => unknown) {
  const c: Record<string, unknown> = {};
  const self = new Proxy(c, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          try {
            resolve(onAwait());
          } catch (e) {
            reject(e);
          }
        };
      }
      if (prop === "$returningId") return () => [{ id: 1 }];
      return () => self;
    },
  });
  return self;
}

const fakeDb = {
  select: () => ({
    from: (t: unknown) => {
      const table = tableOf(t);
      return chain(table, () => (table === "sms_preferences" ? prefRows : []));
    },
  }),
  selectDistinct: () => ({ from: () => chain("?", () => []) }),
  insert: (t: unknown) => {
    const table = tableOf(t);
    return {
      values: (values: unknown) => {
        writes.push({ kind: "insert", table, text: "", params: [], values });
        return chain(table, () => [{ insertId: 1 }]);
      },
    };
  },
  update: (t: unknown) => {
    const table = tableOf(t);
    return {
      set: (values: unknown) => {
        writes.push({ kind: "update", table, text: "", params: [], values });
        return chain(table, () => [{ affectedRows: 1 }]);
      },
    };
  },
  delete: () => chain("?", () => [{ affectedRows: 0 }]),
  execute: async (q: unknown) => {
    const { text, params } = render(q);
    const table = /(?:INTO|UPDATE)\s+`?(\w+)/i.exec(text)?.[1] ?? "?";
    writes.push({ kind: "execute", table, text, params });
    return [[], []];
  },
};

vi.mock("../db", () => ({
  getDb: async () => fakeDb,
  getDbTyped: async () => fakeDb,
}));

const ENV_KEYS = ["CONSENT_LEDGER_MODE", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SMS_KILL_SWITCH"] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();
  prefRows = [];
  writes = [];
  // Ledger writes happen only when the rollout is on; shadow records them.
  process.env.CONSENT_LEDGER_MODE = "shadow";
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  process.env.SMS_KILL_SWITCH = "1";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function inbound(body: string, n: number) {
  const { orchestrateSms } = await import("../services/smsOrchestrator");
  try {
    await orchestrateSms({ type: "inbound_sms", phone: PHONE, body, conversationId: 900, idempotencyKey: `t-${n}` } as never);
  } catch {
    // Everything after the consent block is out of scope here; the consent
    // block itself never throws (it catches and logs).
  }
}

function prefWrites() {
  return writes.filter((w) => w.table === "sms_preferences");
}
function customerOptInWrites() {
  return writes.filter((w) => w.kind === "update" && w.table === "customers" && (w.values as { smsOptOut?: number })?.smsOptOut === 0);
}
function ledgerGrantScopes(): string[] {
  return writes
    .filter((w) => w.kind === "execute" && w.table === "contact_consent_events" && w.params.includes("grant"))
    .map((w) => String(w.params[3]));
}

describe("(a) YES to a voice-only number is not an opt-in", () => {
  it("writes nothing and keeps the number suppressed for voice", async () => {
    prefRows = [{ phone: PHONE, keyword: "VOICE", optedOut: true }];
    const { loadSuppressionIndex } = await import("../sms");
    const before = await loadSuppressionIndex();
    if (!before.ok) throw new Error(before.reason);
    expect(before.voiceOnly.has(PHONE)).toBe(true);

    await inbound("YES", 1);

    expect(prefWrites()).toEqual([]);
    expect(customerOptInWrites()).toEqual([]);
    expect(ledgerGrantScopes()).toEqual([]);
    const after = await loadSuppressionIndex();
    if (!after.ok) throw new Error(after.reason);
    expect(after.phones.has(PHONE)).toBe(true);
    expect(after.voiceOnly.has(PHONE)).toBe(true);
  });

  it("POSITIVE CONTROL: YES to a fully SMS-opted-out number still opts in", async () => {
    prefRows = [{ phone: PHONE, keyword: null, optedOut: true }];
    await inbound("YES", 2);
    expect(prefWrites().length).toBeGreaterThan(0);
    expect(customerOptInWrites()).toHaveLength(1);
  });
});

describe("(b) START restores texting but never clears a spoken do-not-call", () => {
  it("the persisted upsert keeps opted_out and the VOICE marker for a do-not-call row", async () => {
    prefRows = [{ phone: PHONE, keyword: "VOICE", optedOut: true }];
    await inbound("START", 3);
    const upsert = prefWrites().find((w) => /INSERT INTO sms_preferences/i.test(w.text));
    expect(upsert, JSON.stringify(prefWrites())).toBeDefined();
    expect(upsert!.text).toMatch(/opted_out = IF\(opt_out_keyword IN \(\?, \?\), 1, 0\)/);
    expect(upsert!.params).toEqual(expect.arrayContaining(["VOICE", "SMS+VOICE"]));
    // Never an unconditional opted_out=false write.
    expect(prefWrites().some((w) => w.kind === "insert" && (w.values as { optedOut?: boolean })?.optedOut === false)).toBe(false);
  });

  it("this process keeps the number suppressed for every voice lane", async () => {
    // The stub serves the row the upsert leaves behind (opted_out=1, VOICE);
    // the real-MySQL test proves the upsert leaves exactly that.
    prefRows = [{ phone: PHONE, keyword: "VOICE", optedOut: true }];
    const { loadSuppressionIndex } = await import("../sms");
    await loadSuppressionIndex();
    await inbound("START", 4);
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);
    expect(idx.phones.has(PHONE)).toBe(true);
    expect(idx.voiceOnly.has(PHONE)).toBe(true);
  });

  it("POSITIVE CONTROL: START on a plain text STOP clears the suppression", async () => {
    prefRows = [{ phone: PHONE, keyword: null, optedOut: true }];
    const { loadSuppressionIndex } = await import("../sms");
    await loadSuppressionIndex();
    prefRows = [{ phone: PHONE, keyword: null, optedOut: false }];
    await inbound("START", 5);
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);
    expect(idx.phones.has(PHONE)).toBe(false);
  });
});

describe("(c) a START-family keyword grants SMS scopes only in the ledger", () => {
  it.each(["START", "UNSTOP"])("%s writes sms_* grants and no voice or all grant", async (kw) => {
    prefRows = [{ phone: PHONE, keyword: null, optedOut: true }];
    await inbound(kw, 6);
    const scopes = ledgerGrantScopes().sort();
    expect(scopes).toEqual(["sms_conversational", "sms_informational", "sms_marketing"]);
  });
});
