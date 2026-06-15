import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Stripe webhook raw body validation", () => {
  it("enforces that constructEvent receives the rawBody (from req.rawBody Buffer) instead of the parsed req.body", () => {
    const filePath = path.resolve(import.meta.dirname, "_core", "index.ts");
    const content = fs.readFileSync(filePath, "utf8");

    // Assert we are extracting rawBody from req
    expect(content).toContain(".rawBody || req.body");

    // Assert constructEvent uses rawBody
    expect(content).toContain("stripe.webhooks.constructEvent(rawBody");
    
    // Assert we did not revert to req.body
    expect(content).not.toContain("stripe.webhooks.constructEvent(req.body");
  });
});
