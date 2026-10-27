/**
 * featureFlags.list v2 (2026-10-25): each row says whether it is an OFF-SWITCH (`inverted`) and who flipped it
 * last (`lastChange`, from the audit rows toggle writes).
 *
 * Why: Settings counted "55 of 75 enabled, 20 OFF" while 13 of the 20 are pause/mute switches whose OFF state means
 * "sending normally", and three of them raised a permanent "Feature flag OFF" warning. A paused lane is a state with
 * a who and a when, never a warning; the client needs both facts from the server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real drizzle and schema: another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("drizzle-orm");
vi.unmock("drizzle-orm/mysql-core");
vi.unmock("../../drizzle/schema");
vi.unmock("../services/featureFlags");

import { MySqlDialect } from "drizzle-orm/mysql-core";

const h = vi.hoisted(() => ({
  flags: [] as Array<{ key: string; value: boolean; description: string | null }>,
  audit: [] as Array<{ entityId: string; actor: string; changes: unknown; createdAt: unknown }>,
  executed: [] as unknown[],
  auditFails: false,
  dead: false,
}));

const fakeDb = {
  select: () => ({ from: async () => h.flags }),
  execute: async (q: unknown) => {
    h.executed.push(q);
    if (h.auditFails) throw new Error("audit_log unreadable");
    return [h.audit, []];
  },
};

// Full mocks, no importOriginal (Codex finding on PR 3293).
vi.mock("../db", () => ({
  getDb: async () => (h.dead ? null : fakeDb),
  getDbTyped: async () => (h.dead ? null : fakeDb),
}));
vi.mock("../lib/db-helper", () => ({
  db: async () => fakeDb,
  dbTyped: async () => fakeDb,
  requireDb: async () => fakeDb,
}));

import { featureFlagsRouter } from "./featureFlags";
import { FLAG_DEFINITIONS, INVERTED_FLAG_KEYS } from "../services/featureFlags";

const ctx = (role: "admin" | "user" = "admin") =>
  ({
    user: { id: 1, openId: `${role}-u`, email: "o@example.com", name: "O", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  }) as never;
const list = () => featureFlagsRouter.createCaller(ctx()).list();

beforeEach(() => {
  h.flags = [
    { key: "sms_global_pause", value: false, description: "OFF-SWITCH (inverted). Set TRUE to PAUSE ..." },
    { key: "send_pause_declined_recovery", value: true, description: "OFF-SWITCH (inverted). ..." },
    { key: "sms_review_requests", value: true, description: "Auto-send the review request SMS" },
    { key: "contact_holdout_drip", value: false, description: "retired" },
  ];
  h.audit = [];
  h.executed.length = 0;
  h.auditFails = false;
  h.dead = false;
});

describe("which definitions are off-switches", () => {
  it("INVERTED_FLAG_KEYS is exactly the definitions whose description starts 'OFF-SWITCH (inverted)'", () => {
    const byText = FLAG_DEFINITIONS.filter((f) => f.description.startsWith("OFF-SWITCH (inverted)")).map((f) => f.key).sort();
    expect([...INVERTED_FLAG_KEYS].sort()).toEqual(byText);
    // Positive control: the scan located its subject. The three the owner saw as false warnings are in it.
    expect(byText.length).toBeGreaterThan(10);
    for (const k of ["sms_global_pause", "send_pause_declined_recovery", "send_pause_missed_call_recovery"]) {
      expect(INVERTED_FLAG_KEYS.has(k)).toBe(true);
    }
    expect(INVERTED_FLAG_KEYS.has("sms_review_requests")).toBe(false);
  });
});

describe("featureFlags.list v2", () => {
  it("marks off-switches inverted and attaches who flipped one last, and when", async () => {
    h.audit = [
      { entityId: "sms_global_pause", actor: "nour@example.com", changes: { value: { old: null, new: "false" } }, createdAt: "2026-10-25 20:00:00" },
    ];
    const rows = await list();
    const pause = rows.find((r) => r.key === "sms_global_pause");
    expect(pause).toMatchObject({
      value: false,
      inverted: true,
      lastChange: { by: "nour@example.com", at: "2026-10-25T20:00:00.000Z", value: false },
      lastChangeKnown: true,
    });
  });

  it("an enable-style flag is not inverted, and one never toggled has lastChange null with the history known", async () => {
    const rows = await list();
    expect(rows.find((r) => r.key === "sms_review_requests")).toMatchObject({ inverted: false, lastChange: null, lastChangeKnown: true });
    expect(rows.find((r) => r.key === "send_pause_declined_recovery")).toMatchObject({ inverted: true, lastChange: null });
  });

  it("keeps the old fields and still drops retired keys", async () => {
    const rows = await list();
    expect(rows.map((r) => r.key)).toEqual(["sms_global_pause", "send_pause_declined_recovery", "sms_review_requests"]);
    expect(rows[0]).toMatchObject({ key: "sms_global_pause", value: false, description: expect.stringContaining("OFF-SWITCH") });
  });

  it("reads the history with ONE grouped query for all flags, not one per flag", async () => {
    await list();
    // The admin guard may run its own role read through the same handle; count only the audit history reads.
    const texts = h.executed.map((q) => new MySqlDialect().sqlToQuery(q as never).sql).filter((t) => /audit_log/i.test(t));
    expect(texts).toHaveLength(1);
    const text = texts[0];
    expect(text).toMatch(/group by entity_id/i);
    expect(text).toMatch(/flag\.toggled/);
    expect(text).toMatch(/feature_flag/);
  });

  it("an audit row stored as a JSON string and a Date timestamp are both read", async () => {
    h.audit = [
      { entityId: "sms_review_requests", actor: "a@example.com", changes: JSON.stringify({ value: { old: null, new: "true" } }), createdAt: new Date("2026-10-20T15:30:00.000Z") },
    ];
    const rows = await list();
    expect(rows.find((r) => r.key === "sms_review_requests")?.lastChange).toEqual({ by: "a@example.com", at: "2026-10-20T15:30:00.000Z", value: true });
  });

  it("an audit row whose value cannot be read says nothing about the switch", async () => {
    h.audit = [{ entityId: "sms_global_pause", actor: "x", changes: { detail: { old: null, new: "something else" } }, createdAt: "2026-10-25 20:00:00" }];
    const rows = await list();
    expect(rows.find((r) => r.key === "sms_global_pause")).toMatchObject({ lastChange: null, lastChangeKnown: true });
  });

  // Bug hunt 2026-10-27: the newest audit row says what the LAST AUDITED flip set. A flip with no audit row
  // (the API-key route /api/admin/flags/toggle) leaves an older row behind, and "since Oct 12 by x" then names the
  // person who UNPAUSED it as the one who paused it.
  it("an audit row whose value is not the switch's current value is UNKNOWN history, not who paused it", async () => {
    // send_pause_declined_recovery is TRUE (paused) in the fixture; the newest audit row says it was set FALSE.
    h.audit = [
      { entityId: "send_pause_declined_recovery", actor: "x@example.com", changes: { value: { old: null, new: "false" } }, createdAt: "2026-10-12 09:00:00" },
    ];
    const rows = await list();
    expect(rows.find((r) => r.key === "send_pause_declined_recovery")).toMatchObject({ value: true, lastChange: null, lastChangeKnown: false });
  });

  it("positive control: an audit row that agrees with the current value is still shown", async () => {
    h.audit = [
      { entityId: "send_pause_declined_recovery", actor: "x@example.com", changes: { value: { old: null, new: "true" } }, createdAt: "2026-10-12 09:00:00" },
    ];
    const rows = await list();
    expect(rows.find((r) => r.key === "send_pause_declined_recovery")).toMatchObject({
      lastChange: { by: "x@example.com", at: "2026-10-12T09:00:00.000Z", value: true },
      lastChangeKnown: true,
    });
  });

  it("an unreadable audit table is UNKNOWN (lastChangeKnown false), and the list itself still loads", async () => {
    h.auditFails = true;
    const rows = await list();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ lastChange: null, lastChangeKnown: false });
  });

  it("is admin only, and a dead database handle is SERVICE_UNAVAILABLE rather than an empty list", async () => {
    await expect(featureFlagsRouter.createCaller(ctx("user")).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.dead = true;
    await expect(list()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
