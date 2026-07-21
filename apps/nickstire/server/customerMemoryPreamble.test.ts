/**
 * The customer-memory preamble is what turns a cold chatbot reply into an
 * employee who remembers the customer. It must forward known facts, omit prices
 * (an open-estimate amount must never be quoted by the model), and stay empty
 * when nothing is known so it never fabricates a relationship.
 */
import { describe, it, expect } from "vitest";
import { buildCustomerMemoryPreamble } from "./services/nickgpt-client";

describe("buildCustomerMemoryPreamble", () => {
  it("is empty when no customer facts are known (no fabricated memory)", () => {
    expect(buildCustomerMemoryPreamble({})).toBe("");
    expect(buildCustomerMemoryPreamble({ customer: {}, activeEstimate: undefined, lastVapiSummary: null })).toBe("");
  });

  it("includes the name and vehicle when known", () => {
    const p = buildCustomerMemoryPreamble({ customer: { firstName: "Dave", vehicle: "2018 Honda Accord" } });
    expect(p).toContain("the customer's name is Dave");
    expect(p).toContain("their vehicle on file is a 2018 Honda Accord");
  });

  it("includes an open estimate's service but NOT any dollar amount", () => {
    const p = buildCustomerMemoryPreamble({ activeEstimate: { serviceDescription: "front brakes + rotors" } });
    expect(p).toContain('open written estimate for "front brakes + rotors"');
    expect(p).not.toMatch(/\$\d/); // no price leaked into the prompt
  });

  it("includes the last call gist", () => {
    const p = buildCustomerMemoryPreamble({ lastVapiSummary: "asked about two used tires for an Accord" });
    expect(p).toContain("their most recent call was about: asked about two used tires for an Accord");
  });

  it("instructs the model not to recite or invent", () => {
    const p = buildCustomerMemoryPreamble({ customer: { firstName: "Dave" } });
    expect(p).toMatch(/do NOT recite/i);
    expect(p).toMatch(/never invent/i);
  });
});
