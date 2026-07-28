import { describe, it, expect } from "vitest";
import { outcomeContentHash } from "@/lib/services/outcome-ledger";

describe("outcomeContentHash — dedup identity for recommendations", () => {
  it("is stable across whitespace and case variants (a re-shown rec is the SAME rec)", () => {
    const a = outcomeContentHash("Call  Mike about the   $900 brake quote");
    const b = outcomeContentHash("call mike about the $900 brake quote");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it("differs when the substance differs", () => {
    expect(outcomeContentHash("Call Mike about brakes")).not.toBe(
      outcomeContentHash("Call Mike about tires"),
    );
  });
});
