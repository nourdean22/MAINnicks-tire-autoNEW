/**
 * Canaries for the test-row filter and the one-shot reminder trigger.
 *
 * MEASURED 2026-08-25, with denominators, because a ratio inside a filter is
 * not a fact about the table:
 *
 *   invoices        4 of 2,959 look like tests = 0.14%
 *                   $1,270.03 of $1,432,056.23 = 0.09% of dollars
 *   alg_estimates   0 of 452 - CLEAN
 *   unpaid 7-90d    3 of 5 = 60%
 *   paid invoices   1 of 2,951 = 0.03%
 *
 * So table-wide revenue, margin and conversion figures are NOT materially
 * contaminated. The 60% is real but largely DEFINITIONAL: a test row is never
 * paid, so it cannot drain out of the unpaid bucket the way a real invoice
 * does, and it pools there permanently. The narrow, true statement is that
 * figures derived from the UNPAID slice are contaminated; figures over the
 * whole table are not.
 *
 * The filter is deliberately CONSERVATIVE. Suppressing a real customer's
 * payment reminder is a bill that never gets paid - the same failure in the
 * opposite direction - so anything ambiguous stays IN.
 *
 * SYNTHETIC INPUTS ONLY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { testRowReason, isLikelyTestRow, partitionTestRows } from "./services/testRowFilter";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the three real test rows are caught", () => {
  it("BREAKS: the two 216-555-9999 rows are excluded", () => {
    expect(testRowReason({ customerName: "John Test Doe", customerPhone: "2165559999" })).toBe("name-says-test");
    expect(testRowReason({ customerName: "Nour Test", customerPhone: "216-555-9999" })).toBe("name-says-test");
    // and on the phone signal alone, without the name
    expect(testRowReason({ customerName: "Jane Smith", customerPhone: "(216) 555-9999" })).toBe("phone-555-exchange");
  });

  it("BREAKS: the 11-digit 77777777777 row is excluded", () => {
    expect(testRowReason({ customerName: "test test", customerPhone: "77777777777" })).toBe("name-says-test");
    expect(testRowReason({ customerName: "Real Person", customerPhone: "77777777777" })).toBe("phone-repeated-digit");
  });
});

describe("canary - it does NOT exclude people who might be real", () => {
  it("BREAKS: the real customer in the same set is kept", () => {
    // Jhordan Oneal, $207.36, 73 days. Excluding this row means the shop
    // never asks for money it is owed.
    expect(testRowReason({ customerName: "Jhordan Oneal", customerPhone: "2167804062" })).toBeNull();
  });

  it("BREAKS: the ambiguous internal-looking number is KEPT", () => {
    // 216-848-8888 has 18 outbound messages, all delivered, zero inbound.
    // Deliverable, possibly internal - but nothing PROVES it is not a
    // customer, so the filter must leave it alone and let a human decide.
    expect(testRowReason({ customerName: "Nick Rabah", customerPhone: "2168488888" })).toBeNull();
  });

  it("the word test matches WHOLE-WORD only, never as a substring", () => {
    // Substring matching would suppress real people. These are the names that
    // make a naive /test/i filter a money-losing bug.
    for (const name of ["Testa Rossa", "Maria Contesta", "Protestant Church Fleet", "Testerman"]) {
      expect(testRowReason({ customerName: name, customerPhone: "2167804062" }), name).not.toBe("name-says-test");
    }
    // ...while the real form is still caught, in any casing or position.
    for (const name of ["test test", "TEST User", "Nour Test", "a test b"]) {
      expect(testRowReason({ customerName: name, customerPhone: "2167804062" }), name).toBe("name-says-test");
    }
  });

  it("a legitimate repeated-digit-ENDING number is kept", () => {
    // 216-848-8888 ends in four 8s and is real. Only TEN OR MORE identical
    // digits - the whole number - is undialable.
    expect(isLikelyTestRow({ customerName: "X", customerPhone: "2168488888" })).toBe(false);
    expect(isLikelyTestRow({ customerName: "X", customerPhone: "8888888888" })).toBe(true);
  });

  it("a missing phone is NOT a test row - that is a different problem", () => {
    expect(testRowReason({ customerName: "No Phone", customerPhone: null })).toBeNull();
    expect(testRowReason({ customerName: "No Phone", customerPhone: "" })).toBeNull();
  });

  it("11-digit US numbers starting with 1 are valid, not malformed", () => {
    expect(testRowReason({ customerName: "X", customerPhone: "12167804062" })).toBeNull();
    expect(testRowReason({ customerName: "X", customerPhone: "216780406" })).toBe("phone-wrong-length");
  });

  it("POSITIVE CONTROL: the filter can return every reason AND null", () => {
    // Without this, a testRowReason that always returned null would satisfy
    // every "is kept" assertion above.
    const seen = new Set([
      testRowReason({ customerName: "Test Guy", customerPhone: "2167804062" }),
      testRowReason({ customerName: "A", customerPhone: "2165559999" }),
      testRowReason({ customerName: "A", customerPhone: "9999999999" }),
      testRowReason({ customerName: "A", customerPhone: "12345" }),
      testRowReason({ customerName: "A", customerPhone: "2167804062" }),
    ]);
    expect(seen.size).toBe(5);
  });
});

describe("canary - exclusions are reported, never silent", () => {
  it("BREAKS: partition returns the reason for every excluded row", () => {
    const { real, excluded } = partitionTestRows([
      { customerName: "Jhordan Oneal", customerPhone: "2167804062" },
      { customerName: "Nour Test", customerPhone: "2165559999" },
      { customerName: "test test", customerPhone: "77777777777" },
    ]);
    expect(real).toHaveLength(1);
    expect(excluded).toHaveLength(2);
    expect(excluded.every((e) => typeof e.reason === "string" && e.reason.length > 0)).toBe(true);
  });
});

describe("canary - the filter is WIRED where the money is quoted", () => {
  const cron = stripComments(
    readFileSync(join(process.cwd(), "server/cron/jobs/unpaidInvoiceRecovery.ts"), "utf-8"),
  );
  const router = stripComments(
    readFileSync(join(process.cwd(), "server/routers/advanced/invoices.ts"), "utf-8"),
  );

  it("BREAKS: the cron filters before sending", () => {
    expect(cron).toContain('"../../services/testRowFilter"');
    expect(cron).toContain("partitionTestRows<(typeof candidates)[number]>(candidates)");
    expect(cron).toMatch(/const eligible = opts\?\.invoiceIds\?\.length/);
  });

  it("BREAKS: the dashboard figure is built from the FILTERED set", () => {
    // This is the $2,221.35 the banner published, $1,167.27 of which was
    // fiction. If `decorated` is ever rebuilt from the raw rows the banner
    // silently starts lying again.
    expect(router).toContain('"../../services/testRowFilter"');
    expect(router).toMatch(/split\.real\.map\(/);
    expect(router).not.toMatch(/const decorated = items\.map\(/);
  });

  it("the operator can see WHY the figure shrank", () => {
    expect(router).toMatch(/excludedTestRows: split\.excluded\.length/);
    expect(router).toMatch(/excludedReasons:/);
  });
});

describe("canary - the one-shot trigger is scoped and fails closed", () => {
  const router = stripComments(
    readFileSync(join(process.cwd(), "server/routers/advanced/invoices.ts"), "utf-8"),
  );
  const fn = router.slice(router.indexOf("runUnpaidRecoveryNow:"));

  it("BREAKS: invoiceIds is REQUIRED and bounded - it cannot fire at everything", () => {
    expect(fn).toContain("invoiceIds: z.array(z.number().int().positive()).min(1).max(25)");
    expect(fn).toMatch(/invoiceIds: input\.invoiceIds/);
    expect(fn).toMatch(/maxSends: input\.invoiceIds\.length/);
  });

  it("BREAKS: it gates on sms_global_pause, NOT the misleading SMS_KILL_SWITCH", () => {
    // SMS_KILL_SWITCH gates only the dead Twilio fallback; the live F25e path
    // bypasses it. Gating on it refuses when sending works and permits when
    // the real switch is thrown.
    const body = fn.slice(0, fn.indexOf("}),"));
    // Assert the INVOCATION, not the identifier. `getSmsPauseState` also
    // appears on the import line, so a bare toContain() stayed green when a
    // mutation probe replaced the call with a hardcoded { paused: false }.
    expect(body).toContain("await getSmsPauseState()");
    expect(body).toMatch(/const pause = await getSmsPauseState\(\)/);
    expect(body).not.toContain("SMS_KILL_SWITCH");
  });

  it("BREAKS: an UNREADABLE pause flag refuses the send", () => {
    // An emergency stop that cannot be read is not permission to send.
    expect(fn).toMatch(/if \(!pause\.readable\)/);
    const guard = fn.slice(fn.indexOf("if (!pause.readable)"), fn.indexOf("if (pause.paused)"));
    expect(guard).toMatch(/blocked: true/);
    expect(guard).not.toMatch(/runUnpaidInvoiceRecovery/);
  });

  it("a paused shop refuses before any send", () => {
    const guard = fn.slice(fn.indexOf("if (pause.paused)"), fn.indexOf("const { runUnpaidInvoiceRecovery }"));
    expect(guard).toMatch(/blocked: true/);
  });
});
