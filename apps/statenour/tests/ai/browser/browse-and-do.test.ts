/**
 * browseAndDo — locks the three pure safety-critical pieces:
 *   · classifyConsequential — the structural guard against firing irreversible
 *     web actions under draft permission
 *   · parsePlannerDecision — the planner-JSON contract (malformed → null, never throw)
 *   · gateStep — the read/draft/execute permission matrix
 */
import { describe, it, expect } from "vitest";
import {
  classifyConsequential,
  parsePlannerDecision,
  gateStep,
} from "@/lib/ai/browser/browse-and-do";

describe("classifyConsequential", () => {
  it("fires on irreversible / outward instructions", () => {
    for (const t of [
      "click the Submit button",
      "press Send",
      "purchase the item in the cart",
      "click Buy Now",
      "place the order",
      "confirm the booking",
      "delete the saved address",
      "publish the post",
      "click Sign up",
      "complete the payment",
      "click checkout",
      // 2026-08-11 · update/save/upload were slipping the guard
      "click Save",
      "upload the file resume.pdf",
      "update the shipping address",
    ]) {
      expect(classifyConsequential(t), t).toBe(true);
    }
  });

  it("stays quiet on recon / navigation / benign interaction", () => {
    for (const t of [
      "click the About link",
      "type '20 units' into the quantity field",
      "scroll to the pricing table",
      "open the product details page",
      "click the search icon and type 'brake pads'",
      "select 'Ohio' from the state dropdown",
      // \bsave\b must not match "saved" (recon over saved state is benign)
      "scroll to the saved addresses section",
    ]) {
      expect(classifyConsequential(t), t).toBe(false);
    }
  });
});

describe("parsePlannerDecision", () => {
  it("parses a valid next-step decision", () => {
    const d = parsePlannerDecision('{"done": false, "next": {"kind": "navigate", "url": "https://example.com"}}');
    expect(d?.next?.kind).toBe("navigate");
  });

  it("parses a done decision with summary", () => {
    const d = parsePlannerDecision('{"done": true, "summary": "The link points to iana.org."}');
    expect(d?.done).toBe(true);
    expect(d?.summary).toContain("iana.org");
  });

  it("tolerates JSON wrapped in prose/fences", () => {
    const d = parsePlannerDecision('Here you go:\n```json\n{"done": false, "next": {"kind": "extract", "instruction": "get the heading"}}\n```');
    expect(d?.next?.kind).toBe("extract");
  });

  it("rejects malformed / incomplete decisions with null (never throws)", () => {
    expect(parsePlannerDecision("total garbage")).toBeNull();
    expect(parsePlannerDecision('{"done": false, "next": null}')).toBeNull(); // not done but no step
    expect(parsePlannerDecision('{"done": false, "next": {"kind": "navigate"}}')).toBeNull(); // navigate w/o url
    expect(parsePlannerDecision('{"done": false, "next": {"kind": "act"}}')).toBeNull(); // act w/o instruction
    expect(parsePlannerDecision('{"done": false, "next": {"kind": "teleport", "instruction": "x"}}')).toBeNull(); // bad kind
  });
});

describe("gateStep permission matrix", () => {
  it("read: navigate/extract/observe pass, ANY act is blocked", () => {
    expect(gateStep("read", "navigate", undefined).allowed).toBe(true);
    expect(gateStep("read", "extract", "read the heading").allowed).toBe(true);
    expect(gateStep("read", "observe", undefined).allowed).toBe(true);
    const v = gateStep("read", "act", "click the About link");
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.status).toBe("blocked");
  });

  it("draft: benign act passes, consequential act stops as draft_ready", () => {
    expect(gateStep("draft", "act", "type 'brake pads' into the search box").allowed).toBe(true);
    const v = gateStep("draft", "act", "click Submit to place the order");
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.status).toBe("draft_ready");
      expect(v.reason).toMatch(/execute/);
    }
  });

  it("execute: everything passes", () => {
    expect(gateStep("execute", "act", "click Submit to place the order").allowed).toBe(true);
    expect(gateStep("execute", "act", "confirm the purchase").allowed).toBe(true);
  });
});
