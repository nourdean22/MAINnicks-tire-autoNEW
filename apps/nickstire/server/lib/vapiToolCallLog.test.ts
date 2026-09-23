import { describe, expect, it } from "vitest";
import { toolCallLogFields } from "./vapiToolCallLog";

describe("toolCallLogFields", () => {
  it("keeps the tool name, sorted argument keys, phone last 4 and call id", () => {
    expect(
      toolCallLogFields("bookSlot", { phone: "+1 (216) 555-0142", name: "Pat Example", service: "brakes", callId: "call-9" }),
    ).toEqual({ name: "bookSlot", argKeys: ["callId", "name", "phone", "service"], phoneLast4: "0142", callId: "call-9" });
  });

  it("never carries an argument value other than the call id", () => {
    const out = JSON.stringify(
      toolCallLogFields("escalate", { name: "Pat Example", customerPhone: "2165550142", reason: "wants a quote on rims" }),
    );
    expect(out).toContain('"phoneLast4":"0142"');
    expect(out).not.toContain("5550142");
    expect(out).not.toContain("Pat");
    expect(out).not.toContain("rims");
  });

  it("marks a phone too short to trim, and omits phone fields when there is none", () => {
    expect(toolCallLogFields("t", { phone: "12" }).phoneLast4).toBe("????");
    expect(toolCallLogFields("shopInfo", {})).toEqual({ name: "shopInfo", argKeys: [] });
  });
});
