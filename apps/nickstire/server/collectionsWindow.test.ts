/**
 * Canaries for the collections window (2026-08-25).
 *
 * MEASURED against production: 8 unpaid invoices, $3,827.97 total.
 *   5 eligible  ($2,221.35, aged 39-72 days) - found by the cron every day,
 *               and dry-run because FEATURE_UNPAID_INVOICE_RECOVERY is unset.
 *               All-time, `paymentReminder7dSentAt` is 0 across all 2,959
 *               invoices: no reminder has ever been sent.
 *   3 aged out  ($1,606.62, aged 108/128/138 days) - past the 90-day ceiling,
 *               never selected again, and previously mentioned by nothing.
 *
 * Base rate: 8 of 2,959 invoices (0.27%) are unpaid. This is a small complete
 * backlog, not a systemic leak, and the fix is sized accordingly.
 *
 * SYNTHETIC AGES ONLY - `collectionsState` is driven with numbers, never with
 * a live query, so the test keeps its meaning after the backlog is cleared.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  collectionsState,
  invoiceAgeDays,
  recoverySendingArmed,
  COLLECTIONS_MIN_AGE_DAYS,
  COLLECTIONS_MAX_AGE_DAYS,
} from "./services/collectionsWindow";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the window has two edges and both are named", () => {
  it("BREAKS: the three real aged-out invoices are classified, not silently dropped", () => {
    // 108 / 128 / 138 days. Previously these fell out of every query and were
    // mentioned by nothing at all.
    for (const age of [108, 128, 138]) {
      expect(collectionsState(age), `${age}d must read aged-out`).toBe("aged-out");
    }
  });

  it("the five real eligible invoices are eligible", () => {
    for (const age of [39, 62, 62, 62, 72]) {
      expect(collectionsState(age), `${age}d must read eligible`).toBe("eligible");
    }
  });

  it("a fresh invoice is too-new, not eligible - the courtesy delay is real", () => {
    expect(collectionsState(0)).toBe("too-new");
    expect(collectionsState(COLLECTIONS_MIN_AGE_DAYS - 1)).toBe("too-new");
  });

  it("the boundaries are inclusive on both ends", () => {
    expect(collectionsState(COLLECTIONS_MIN_AGE_DAYS)).toBe("eligible");
    expect(collectionsState(COLLECTIONS_MAX_AGE_DAYS)).toBe("eligible");
    expect(collectionsState(COLLECTIONS_MAX_AGE_DAYS + 1)).toBe("aged-out");
  });

  it("POSITIVE CONTROL: the three states are actually distinguishable", () => {
    // Without this the function could return one constant and every assertion
    // above about a single state would still pass.
    const seen = new Set([collectionsState(1), collectionsState(30), collectionsState(200)]);
    expect(seen.size).toBe(3);
  });
});

describe("canary - age is computed, not guessed", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("whole days, floored", () => {
    expect(invoiceAgeDays(new Date("2026-08-18T12:00:00Z"), now)).toBe(7);
    expect(invoiceAgeDays(new Date("2026-08-18T23:00:00Z"), now)).toBe(6);
  });

  it("a missing or unparseable date is 0, never NaN", () => {
    // NaN would flow into collectionsState and compare false against every
    // bound, silently producing "eligible".
    expect(invoiceAgeDays(null, now)).toBe(0);
    expect(invoiceAgeDays("not-a-date", now)).toBe(0);
    expect(collectionsState(invoiceAgeDays(null, now))).toBe("too-new");
  });
});

describe("canary - the flag is READ, never written", () => {
  it("recoverySendingArmed reflects the env var and nothing else", () => {
    const prior = process.env.FEATURE_UNPAID_INVOICE_RECOVERY;
    try {
      process.env.FEATURE_UNPAID_INVOICE_RECOVERY = "1";
      expect(recoverySendingArmed()).toBe(true);
      process.env.FEATURE_UNPAID_INVOICE_RECOVERY = "0";
      expect(recoverySendingArmed()).toBe(false);
      delete process.env.FEATURE_UNPAID_INVOICE_RECOVERY;
      expect(recoverySendingArmed()).toBe(false);
    } finally {
      // Restore-or-delete: `env.X = undefined` stores the string "undefined".
      if (prior === undefined) delete process.env.FEATURE_UNPAID_INVOICE_RECOVERY;
      else process.env.FEATURE_UNPAID_INVOICE_RECOVERY = prior;
    }
  });

  it("BREAKS: nothing in this module ASSIGNS the flag", () => {
    // Flipping it is the operator's call, made on Railway. A module that could
    // arm customer SMS by itself is a protected-operation violation.
    const src = stripComments(readFileSync(join(process.cwd(), "server/services/collectionsWindow.ts"), "utf-8"));
    expect(src).not.toMatch(/FEATURE_UNPAID_INVOICE_RECOVERY\s*=[^=]/);
  });
});

describe("canary - the aged-out set reaches a human, and does NOT text them", () => {
  const cron = stripComments(
    readFileSync(join(process.cwd(), "server/cron/jobs/unpaidInvoiceRecovery.ts"), "utf-8"),
  );

  it("BREAKS: the cron reports aged-out invoices", () => {
    expect(cron).toContain("reportAgedOutInvoices");
    expect(cron).toMatch(/await reportAgedOutInvoices\(d\)/);
  });

  it("it alerts an OPERATOR, never the customer", () => {
    // Texting a 138-day-old invoice is a customer-facing side effect and needs
    // the operator's explicit say-so. This hands them the list instead.
    const fn = cron.slice(cron.indexOf("async function reportAgedOutInvoices"));
    const body = fn.slice(0, fn.indexOf("export async function runUnpaidInvoiceRecovery"));
    expect(body).toContain("sendTelegram");
    expect(body).not.toMatch(/sendSms|sendSMS|twilio/i);
  });

  it("dedups through the path that demonstrably records - once per day", () => {
    const fn = cron.slice(cron.indexOf("async function reportAgedOutInvoices"));
    expect(fn).toContain("INSERT IGNORE INTO cron_alerts_fired");
    expect(fn).toContain("'unpaid_aged_out'");
    expect(fn).toMatch(/affectedRows/);
  });

  it("stays silent when nothing has aged out", () => {
    const fn = cron.slice(cron.indexOf("async function reportAgedOutInvoices"));
    expect(fn).toMatch(/if \(n === 0\) return;/);
  });

  it("cannot take the cron down", () => {
    const fn = cron.slice(cron.indexOf("async function reportAgedOutInvoices"));
    expect(fn).toContain("catch (err)");
  });
});

describe("canary - the admin surface shows the money, not a log line", () => {
  const ui = stripComments(
    readFileSync(join(process.cwd(), "client/src/pages/admin/money/UnpaidInvoicesSection.tsx"), "utf-8"),
  );
  const router = stripComments(
    readFileSync(join(process.cwd(), "server/routers/advanced/invoices.ts"), "utf-8"),
  );

  it("BREAKS: the query returns collections state, not just a total", () => {
    expect(router).toContain("collectionsState");
    expect(router).toContain("eligibleCents");
    expect(router).toContain("agedOutCents");
    expect(router).toContain("sendingArmed");
  });

  it("the dry-run backlog renders as DOLLARS and names the flag", () => {
    expect(ui).toContain("collections.eligibleCents");
    expect(ui).toContain("FEATURE_UNPAID_INVOICE_RECOVERY=1");
  });

  it("the aged-out money renders too", () => {
    expect(ui).toContain("collections.agedOutCents");
    expect(ui).toMatch(/aged out of collections/i);
  });

  it("both banners are suppressed when the read FAILED - unknown is not zero", () => {
    // The section already refuses to render "$0 owed" on an error. The new
    // banners must obey the same rule or they would assert a collections state
    // the system could not see.
    expect(ui).toMatch(/!unknown && collections && collections\.eligibleCents > 0/);
    expect(ui).toMatch(/!unknown && collections && collections\.agedOutCents > 0/);
  });

  it("the eligible banner appears only while sending is OFF", () => {
    // Once the operator arms it, telling them it is off would be the lie.
    expect(ui).toMatch(/!collections\.sendingArmed/);
  });
});
