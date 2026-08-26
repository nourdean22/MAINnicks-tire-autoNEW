/**
 * Red-team probes for the internal-line refusal inside sendSms().
 *
 * WHY THIS GUARD EXISTS, measured 2026-08-25. The operator's own mobile
 * received 18 automated customer-facing messages across at least eight lanes -
 * lead response, 2-week follow-up, thank-you, check-in, nine missed-call
 * follow-ups, a tire quote, a maintenance-due reminder and a Google review
 * request - all `delivered`, zero inbound. It was also one cron run from an
 * automated "you still owe $846.72" text about a bill he owes himself.
 *
 * WHY IT IS IN sendSms AND NOT IN EACH LANE. sendSms is the single choke point
 * every lane passes through; seven cron jobs alone call it. A per-lane filter
 * fixes one door and cannot cover a lane written next month.
 *
 * THESE PROBE THE REAL FUNCTION. The guard sits before the footer, the daily
 * cap, the opt-out gate, the gateway routing and the offline queue, so a
 * refusal returns from pure in-memory logic and the real sendSms can be called
 * here without a database or a gateway. Asserting on the returned result is
 * the equivalent of asserting on an exit code rather than on a regex I talked
 * myself into.
 *
 * The probe classes below are the ones that produced real bypasses in the
 * #1355 policy red-team, translated to this domain: format/quoting variants,
 * escape-hatch abuse, ordering (a guard after the send is not a guard), and
 * mention-vs-execution false positives against real customers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("./sms");

import { sendSms } from "./sms";
import { INTERNAL_LINES, internalLineFor } from "./services/nonCustomerFilter";

const OPERATOR = INTERNAL_LINES[0].last10;
const SHOP = INTERNAL_LINES[1].last10;
/** A number deliberately NOT in the registry. */
const CUSTOMER = "2167804062";

const REFUSAL = /internal shop\/operator line/i;

describe("red-team - format variants cannot evade the guard", () => {
  // A guard that matched only one spelling would be bypassed by the next
  // caller that formatted the number differently. Every lane builds its
  // destination string its own way.
  const variants = (d: string) => [
    d,
    `+1${d}`,
    `1${d}`,
    `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
    `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`,
    `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
    ` ${d} `,
  ];

  for (const v of variants(OPERATOR)) {
    it(`BREAKS: refuses the operator line written as ${JSON.stringify(v)}`, async () => {
      const r = await sendSms(v, "automated marketing body");
      expect(r.success, `${v} must be refused`).toBe(false);
      expect(r.error).toMatch(REFUSAL);
    });
  }

  it("BREAKS: refuses the shop's own published line too", async () => {
    const r = await sendSms(SHOP, "automated marketing body");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });
});

describe("red-team - the escape hatch is INTENT, never the destination", () => {
  it("BREAKS: humanInitiated ALLOWS it - operator self-tests still work", async () => {
    // Must not be refused. If this ever fails closed, the operator loses the
    // ability to text himself from the admin, and the guard gets deleted.
    const r = await sendSms(OPERATOR, "manual admin reply", { humanInitiated: true });
    expect(r.error ?? "").not.toMatch(REFUSAL);
  });

  it('BREAKS: messageClass "internal" ALLOWS it - staff alerts still work', async () => {
    const r = await sendSms(OPERATOR, "staff alert", { messageClass: "internal" });
    expect(r.error ?? "").not.toMatch(REFUSAL);
  });

  it("BREAKS: isInternal:true ALLOWS it", async () => {
    const r = await sendSms(OPERATOR, "staff alert", { isInternal: true });
    expect(r.error ?? "").not.toMatch(REFUSAL);
  });

  it("BREAKS: skipOptOutCheck does NOT bypass the refusal", async () => {
    // A neighbouring escape hatch must not double as this one. This is the
    // flag-family bypass class: a caller reaching for any override should not
    // silently acquire permission it never asked for.
    const r = await sendSms(OPERATOR, "automated", { skipOptOutCheck: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });

  it("BREAKS: skipOptOutFooter does NOT bypass the refusal", async () => {
    const r = await sendSms(OPERATOR, "automated", { skipOptOutFooter: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });

  it("BREAKS: _forceImmediate does NOT bypass the refusal", async () => {
    const r = await sendSms(OPERATOR, "automated", { _forceImmediate: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });

  it('BREAKS: via:"shop" does NOT bypass - that is the live path', async () => {
    const r = await sendSms(OPERATOR, "automated", { via: "shop" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });

  it("the customer_marketing default is refused without any opts at all", async () => {
    const r = await sendSms(OPERATOR, "automated");
    expect(r.success).toBe(false);
  });
});

describe("red-team - OWNER_PHONE_NUMBER cannot authorize a customer-facing send", () => {
  const prior = process.env.OWNER_PHONE_NUMBER;
  beforeEach(() => { process.env.OWNER_PHONE_NUMBER = OPERATOR; });
  afterEach(() => {
    // Restore-or-delete: `env.X = undefined` stores the string "undefined".
    if (prior === undefined) delete process.env.OWNER_PHONE_NUMBER;
    else process.env.OWNER_PHONE_NUMBER = prior;
  });

  it("BREAKS: isStaffNumber is a property of the NUMBER and must not grant permission", async () => {
    // isStaffNumber feeds `isInternal`, which exists only to skip the STOP
    // footer. If the guard keyed off that, automated marketing to a staff line
    // would sail through on a flag that was never about consent - and this is
    // exactly how the 18 messages got out.
    const r = await sendSms(OPERATOR, "automated marketing body");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
  });
});

describe("red-team - no false positives against real customers", () => {
  // A guard that blocks legitimate sends gets disabled by a frustrated human,
  // and then it guards nothing.
  it("a real customer number is NOT refused by this guard", async () => {
    const r = await sendSms(CUSTOMER, "legitimate customer message");
    expect(r.error ?? "").not.toMatch(REFUSAL);
  });

  it("a number sharing only a prefix or suffix is NOT refused", async () => {
    for (const near of ["2168488887", "2168488889", "3168488888", "8488888216"]) {
      const r = await sendSms(near, "legitimate customer message");
      expect(r.error ?? "", near).not.toMatch(REFUSAL);
    }
  });

  it("an invalid number fails for its OWN reason, not this one", async () => {
    // Ordering probe: normalizePhone runs first, so a malformed number must
    // still report the invalid-number error rather than being mis-attributed.
    const r = await sendSms("77777777777", "body");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid phone number/i);
    expect(r.error).not.toMatch(REFUSAL);
  });
});

describe("red-team - the lookup itself", () => {
  it("BREAKS: internalLineFor resolves every format to the same entry", () => {
    for (const v of [OPERATOR, `+1${OPERATOR}`, `1${OPERATOR}`, `(216) 848-8888`]) {
      expect(internalLineFor(v)?.last10, v).toBe(OPERATOR);
    }
  });

  it("short or empty input is not a match", () => {
    for (const v of ["", null, undefined, "8488888", "216848888"]) {
      expect(internalLineFor(v as string | null | undefined)).toBeNull();
    }
  });

  it("POSITIVE CONTROL: the lookup both matches and misses", () => {
    // Without this, an internalLineFor that always returned null would satisfy
    // every negative assertion above while the guard never fired.
    expect(internalLineFor(OPERATOR)).not.toBeNull();
    expect(internalLineFor(CUSTOMER)).toBeNull();
  });

  it("every registry entry carries a reason", () => {
    expect(INTERNAL_LINES.length).toBeGreaterThanOrEqual(2);
    for (const l of INTERNAL_LINES) {
      expect(l.last10).toMatch(/^[0-9]{10}$/);
      expect(l.note.length, `entry ${l.last10} must say WHY`).toBeGreaterThan(30);
    }
  });
});

describe("red-team - the guard runs BEFORE anything with a side effect", () => {
  const src = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    return readFileSync(join(process.cwd(), "server/sms.ts"), "utf-8");
  })();

  it("BREAKS: the refusal precedes the daily cap, the opt-out gate and the queue", () => {
    // A guard placed after persistence or routing would still let a row be
    // written or a message be queued for later delivery.
    //
    // Scoped to the sendSms BODY on purpose. A first attempt searched the whole
    // file and failed on checkDailyLimit's own DEFINITION, which naturally sits
    // above sendSms — the probe was wrong, not the guard. A red probe indicts
    // the probe or the subject exactly as a green one does; determine which.
    const bodyStart = src.indexOf("export async function sendSms(");
    expect(bodyStart, "sendSms must exist").toBeGreaterThan(-1);
    const body = src.slice(bodyStart);
    const guardAt = body.indexOf("const internalDestination = internalLineFor(");
    expect(guardAt, "guard must be inside sendSms").toBeGreaterThan(-1);
    let checked = 0;
    for (const later of ["checkDailyLimit(", "ensureOptOutCache(", "queueForLater(", "persistOutboundShopSms("]) {
      const at = body.indexOf(later);
      if (at === -1) continue;
      checked++;
      expect(at, `${later} must be CALLED after the guard`).toBeGreaterThan(guardAt);
    }
    // POSITIVE CONTROL: if none of those names were found, the loop above would
    // assert nothing and the test would pass while proving nothing.
    expect(checked, "at least two side-effect call sites must be located").toBeGreaterThanOrEqual(2);
  });

  it("BREAKS: the guard does not key off isStaffNumber", () => {
    const block = src.slice(src.indexOf("const explicitlyInternalIntent"), src.indexOf("Only internal or explicit overrides"));
    expect(block).toContain("messageClass === \"internal\"");
    expect(block).toContain("opts?.humanInitiated");
    expect(block).not.toContain("isStaffNumber");
  });
});

describe("red-team - staff-alert lanes declare intent, so the guard cannot mute them", () => {
  // The guard's escape hatch is the CALLER's declared intent. Any lane that
  // deliberately texts a staff line must say so, or it stops working the day
  // that number lands in the registry. Found by self-audit: the daily owner
  // report did not declare it, and was safe only because OWNER_PHONE_NUMBER
  // happened not to be the operator's mobile.
  const read = (rel: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    return readFileSync(join(process.cwd(), rel), "utf-8");
  };

  it("BREAKS: the daily owner report declares messageClass internal", () => {
    const src = read("server/cron/jobs/dailyReport.ts");
    expect(src).toMatch(/sendSms\(ownerPhone, message, \{[^}]*messageClass: "internal"/);
  });

  it("BREAKS: the eventBus manager alert declares it too", () => {
    const src = read("server/services/eventBus.ts");
    expect(src).toMatch(/sendSms\(managerPhone,[^)]*messageClass: "internal"/);
  });
});

