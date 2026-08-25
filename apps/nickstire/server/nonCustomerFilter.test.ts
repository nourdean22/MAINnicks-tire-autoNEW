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

import {
  exclusionReason, isNonCustomer, partitionNonCustomers, exclusionNote,
  INTERNAL_LINES, type InternalLine,
} from "./services/nonCustomerFilter";

/** SYNTHETIC registry — the mechanism is exercised without asserting on the
 *  operator's real number, so this suite keeps its meaning if that changes. */
const FAKE_INTERNAL: readonly InternalLine[] = [{ last10: "5551230000", note: "synthetic" }];

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the three real test rows are caught", () => {
  it("BREAKS: the two 216-555-9999 rows are excluded", () => {
    expect(exclusionReason({ customerName: "John Test Doe", customerPhone: "2165559999" })).toBe("name-says-test");
    expect(exclusionReason({ customerName: "Nour Test", customerPhone: "216-555-9999" })).toBe("name-says-test");
    // and on the phone signal alone, without the name
    expect(exclusionReason({ customerName: "Jane Smith", customerPhone: "(216) 555-9999" })).toBe("phone-555-exchange");
  });

  it("BREAKS: the 11-digit 77777777777 row is excluded", () => {
    expect(exclusionReason({ customerName: "test test", customerPhone: "77777777777" })).toBe("name-says-test");
    expect(exclusionReason({ customerName: "Real Person", customerPhone: "77777777777" })).toBe("phone-repeated-digit");
  });
});

describe("canary - it does NOT exclude people who might be real", () => {
  it("BREAKS: the real customer in the same set is kept", () => {
    // Jhordan Oneal, $207.36, 73 days. Excluding this row means the shop
    // never asks for money it is owed.
    expect(exclusionReason({ customerName: "Jhordan Oneal", customerPhone: "2167804062" })).toBeNull();
  });

  it("BREAKS: a well-formed number NOT in the registry is kept", () => {
    // Nothing about a normal 10-digit number should exclude it. Driven with
    // the synthetic registry so this asserts the RULE, not the roster.
    expect(exclusionReason({ customerName: "Nick Rabah", customerPhone: "2168488888" }, FAKE_INTERNAL)).toBeNull();
  });

  it("the word test matches WHOLE-WORD only, never as a substring", () => {
    // Substring matching would suppress real people. These are the names that
    // make a naive /test/i filter a money-losing bug.
    for (const name of ["Testa Rossa", "Maria Contesta", "Protestant Church Fleet", "Testerman"]) {
      expect(exclusionReason({ customerName: name, customerPhone: "2167804062" }), name).not.toBe("name-says-test");
    }
    // ...while the real form is still caught, in any casing or position.
    for (const name of ["test test", "TEST User", "Nour Test", "a test b"]) {
      expect(exclusionReason({ customerName: name, customerPhone: "2167804062" }), name).toBe("name-says-test");
    }
  });

  it("a legitimate repeated-digit-ENDING number is kept", () => {
    // 216-848-8888 ends in four 8s and is real. Only TEN OR MORE identical
    // digits - the whole number - is undialable.
    // Synthetic registry: this asserts the SHAPE rule. 216-848-8888 is in the
    // real roster for a different reason entirely (it is the operator's line),
    // and conflating the two is exactly what this suite must not do.
    expect(isNonCustomer({ customerName: "X", customerPhone: "2168488888" }, FAKE_INTERNAL)).toBe(false);
    expect(isNonCustomer({ customerName: "X", customerPhone: "8888888888" }, FAKE_INTERNAL)).toBe(true);
  });

  it("a missing phone is NOT a test row - that is a different problem", () => {
    expect(exclusionReason({ customerName: "No Phone", customerPhone: null })).toBeNull();
    expect(exclusionReason({ customerName: "No Phone", customerPhone: "" })).toBeNull();
  });

  it("11-digit US numbers starting with 1 are valid, not malformed", () => {
    expect(exclusionReason({ customerName: "X", customerPhone: "12167804062" })).toBeNull();
    expect(exclusionReason({ customerName: "X", customerPhone: "216780406" })).toBe("phone-wrong-length");
  });

  it("POSITIVE CONTROL: the filter can return every reason AND null", () => {
    // Without this, an exclusionReason that always returned null would satisfy
    // every "is kept" assertion above.
    const seen = new Set([
      exclusionReason({ customerName: "Test Guy", customerPhone: "2167804062" }),
      exclusionReason({ customerName: "A", customerPhone: "2165559999" }),
      exclusionReason({ customerName: "A", customerPhone: "9999999999" }),
      exclusionReason({ customerName: "A", customerPhone: "12345" }),
      exclusionReason({ customerName: "A", customerPhone: "2167804062" }),
    ]);
    expect(seen.size).toBe(5);
  });
});

describe("canary - exclusions are reported, never silent", () => {
  it("BREAKS: partition returns the reason for every excluded row", () => {
    const { real, excluded } = partitionNonCustomers([
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
    expect(cron).toContain('"../../services/nonCustomerFilter"');
    expect(cron).toContain("partitionNonCustomers<(typeof candidates)[number]>(candidates)");
    expect(cron).toMatch(/const eligible = opts\?\.invoiceIds\?\.length/);
  });

  it("BREAKS: the dashboard figure is built from the FILTERED set", () => {
    // This is the $2,221.35 the banner published, $1,167.27 of which was
    // fiction. If `decorated` is ever rebuilt from the raw rows the banner
    // silently starts lying again.
    expect(router).toContain('"../../services/nonCustomerFilter"');
    expect(router).toMatch(/split\.real\.map\(/);
    expect(router).not.toMatch(/const decorated = items\.map\(/);
  });

  it("the operator can see WHY the figure shrank", () => {
    expect(router).toMatch(/excludedNonCustomers: split\.excluded\.length/);
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

describe("canary - internal lines are withheld as their OWN category", () => {
  it("BREAKS: a registry number is excluded, and NOT as test data", () => {
    // The category matters. A future reader must not see this suppressed and
    // conclude the row was junk — it is a real, deliverable, working line.
    const r = exclusionReason({ customerName: "Anyone", customerPhone: "555-123-0000" }, FAKE_INTERNAL);
    expect(r).toBe("internal-operator-line");
    expect(r).not.toBe("name-says-test");
    expect(exclusionNote("internal-operator-line")).toMatch(/internal line/i);
    expect(exclusionNote("internal-operator-line")).not.toMatch(/test/i);
  });

  it("matches on the last 10 digits, so +1 / formatting cannot evade it", () => {
    for (const p of ["+1 (555) 123-0000", "15551230000", "5551230000"]) {
      expect(exclusionReason({ customerPhone: p }, FAKE_INTERNAL), p).toBe("internal-operator-line");
    }
  });

  it("the internal check runs BEFORE the shape checks", () => {
    // Internal lines are well-formed real numbers, so no other rule would
    // catch them. If the order flipped, the reason would be wrong or absent.
    expect(exclusionReason({ customerName: "test test", customerPhone: "5551230000" }, FAKE_INTERNAL))
      .toBe("internal-operator-line");
  });

  it("BREAKS: the operator's line and the shop line are both in the REAL registry, with reasons", () => {
    // The roster is asserted separately from the rule, and every entry must
    // carry why it is there — a silent entry stops a payer being contacted.
    const nums = INTERNAL_LINES.map((l) => l.last10);
    expect(nums).toContain("2168488888"); // operator's own mobile
    expect(nums).toContain("2168620005"); // the shop's published line
    for (const l of INTERNAL_LINES) {
      expect(l.last10, "every entry is a 10-digit key").toMatch(/^[0-9]{10}$/);
      expect(l.note.length, `entry ${l.last10} must say WHY`).toBeGreaterThan(30);
    }
  });

  it("POSITIVE CONTROL: the internal rule can both fire and not fire", () => {
    const seen = new Set([
      exclusionReason({ customerPhone: "5551230000" }, FAKE_INTERNAL),
      exclusionReason({ customerPhone: "2167804062" }, FAKE_INTERNAL),
    ]);
    expect(seen.size).toBe(2);
  });
});

/**
 * The reminder ladder is one-directional.
 *
 * Reimplemented here from the cron's own expression so the RULE can be driven
 * with synthetic ages and claim states. A source canary below pins that the
 * cron still carries the guard, so the two cannot drift apart silently.
 */
function touchFor(ageDays: number, a7: boolean, a30: boolean): "7d" | "30d" | null {
  if (ageDays >= 30 && !a30) return "30d";
  if (ageDays >= 7 && !a7 && !a30) return "7d";
  return null;
}

describe("canary - an escalated invoice never drops back to the earlier touch", () => {
  it("BREAKS: after a 30d touch, the 7d touch is NOT sent the next day", () => {
    // The real case, 2026-08-25: a 73-day-old invoice took the 30d touch,
    // which left the 7d slot unclaimed. Without the guard the next run sent a
    // SECOND message about the same bill, in the softer earlier wording.
    expect(touchFor(73, false, true)).toBeNull();
    expect(touchFor(31, false, true)).toBeNull();
  });

  it("an invoice that ages normally still gets 7d then 30d, in order", () => {
    expect(touchFor(7, false, false)).toBe("7d");   // first touch
    expect(touchFor(30, true, false)).toBe("30d");  // escalates later
    expect(touchFor(45, true, true)).toBeNull();    // both spent
  });

  it("younger than 7 days gets nothing - the courtesy delay is real", () => {
    expect(touchFor(6, false, false)).toBeNull();
    expect(touchFor(0, false, false)).toBeNull();
  });

  it("POSITIVE CONTROL: the ladder can return all three outcomes", () => {
    // Without this, a touchFor that always returned null would satisfy every
    // "sends nothing" assertion above.
    expect(new Set([touchFor(7, false, false), touchFor(35, true, false), touchFor(5, false, false)]).size).toBe(3);
  });

  it("BREAKS: the cron itself still carries the !reminder30d guard", () => {
    // The rule above is a local reimplementation; this is what pins it to the
    // shipped code. Without it the canary could stay green while the cron
    // regressed.
    const cron = stripComments(
      readFileSync(join(process.cwd(), "server/cron/jobs/unpaidInvoiceRecovery.ts"), "utf-8"),
    );
    expect(cron).toContain("else if (ageDays >= 7 && !inv.reminder7d && !inv.reminder30d) touch = \"7d\";");
  });
});

