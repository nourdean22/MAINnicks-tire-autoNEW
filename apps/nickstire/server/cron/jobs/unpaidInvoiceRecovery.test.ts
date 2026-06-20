import { describe, it, expect } from "vitest";
import { buildMessage, firstName } from "./unpaidInvoiceRecovery";

describe("unpaidInvoiceRecovery · firstName", () => {
  it("handles plain 'First Last'", () => {
    expect(firstName("John Smith")).toBe("John");
  });
  it("handles ALG 'LASTNAME, FIRSTNAME'", () => {
    expect(firstName("Smith, John")).toBe("John");
  });
  it("falls back to 'there' on null / undefined / empty", () => {
    expect(firstName(null)).toBe("there");
    expect(firstName(undefined)).toBe("there");
    expect(firstName("")).toBe("there");
    expect(firstName("   ")).toBe("there");
  });
});

describe("unpaidInvoiceRecovery · buildMessage (claim-safe copy)", () => {
  it("7d: greets by name, gives shop number, has NO dollar amount, no pressure", () => {
    const m = buildMessage("7d", "John");
    expect(m).toContain("John");
    expect(m).toContain("(216) 862-0005");
    // Debt-collection safety: never put a balance figure in the text.
    expect(m).not.toMatch(/\$\s?\d/);
    expect(m.toLowerCase()).toContain("no pressure");
  });
  it("30d: greets by name, shop number + hours, NO dollar amount", () => {
    const m = buildMessage("30d", "John");
    expect(m).toContain("John");
    expect(m).toContain("(216) 862-0005");
    expect(m).not.toMatch(/\$\s?\d/);
    expect(m).toContain("Mon-Sat");
  });
  it("neither touch ever embeds a dollar figure", () => {
    expect(buildMessage("7d", "x")).not.toMatch(/\$\s?\d/);
    expect(buildMessage("30d", "x")).not.toMatch(/\$\s?\d/);
  });
});
