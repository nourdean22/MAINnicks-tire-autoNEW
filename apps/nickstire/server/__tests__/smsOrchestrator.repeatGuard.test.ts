/**
 * Repeated-message guard — self-match regression (2026-08-05).
 *
 * The inbound webhook persists the customer's text to sms_messages BEFORE
 * orchestrateSms runs, so last5Messages arrives with the current message as
 * its newest row. The old guard compared the raw tail against event.body and
 * therefore flagged EVERY AI-drafted reply as repeated_customer_message —
 * measured in prod: 24 of 24 nickgpt-path inbounds over the 21 days before
 * 2026-08-05 were held for review, including first-contact texts.
 *
 * These tests are DB-free on purpose (voiceAgent.test.ts's skipIf(!HAS_DB)
 * precedent means DB-bound tests never run in CI).
 */
import { describe, it, expect } from "vitest";
import { isRepeatedInbound, priorMessagesForInbound } from "../services/smsOrchestrator";

const at = (s: number) => new Date(2026, 7, 5, 12, 0, s);
const inbound = (body: string, s: number) => ({ direction: "inbound" as const, body, createdAt: at(s) });
const outbound = (body: string, s: number) => ({ direction: "outbound" as const, body, createdAt: at(s) });

describe("isRepeatedInbound", () => {
  it("a first-contact message whose only occurrence is its own persisted row is NOT repeated", () => {
    // This is the exact prod shape that was 100% false-positive.
    const history = [inbound("Hello! I need my left headlight repaired on Sunday", 10)];
    expect(isRepeatedInbound(history, "Hello! I need my left headlight repaired on Sunday")).toBe(false);
  });

  it("a message with prior unrelated history plus its own row is NOT repeated", () => {
    const history = [
      outbound("Sorry if you couldn't get through just now", 1),
      inbound("Brakes", 5),
      outbound("We start with a free check on the brakes", 6),
      inbound("How much for tire", 10),
    ];
    expect(isRepeatedInbound(history, "How much for tire")).toBe(false);
  });

  it("a genuine repeat — same inbound body twice in a row — IS repeated", () => {
    const history = [inbound("Tires", 5), inbound("Tires", 10)];
    expect(isRepeatedInbound(history, "Tires")).toBe(true);
  });

  it("same body from the SHOP (outbound) immediately before does not count as a customer repeat", () => {
    const history = [outbound("Tires", 5), inbound("Tires", 10)];
    expect(isRepeatedInbound(history, "Tires")).toBe(false);
  });

  it("empty / undefined history is never repeated", () => {
    expect(isRepeatedInbound([], "Brakes")).toBe(false);
    expect(isRepeatedInbound(undefined, "Brakes")).toBe(false);
  });
});

describe("priorMessagesForInbound", () => {
  it("drops exactly one trailing self-occurrence and nothing else", () => {
    const history = [inbound("Tires", 1), outbound("reply", 2), inbound("Tires", 3)];
    const prior = priorMessagesForInbound(history, "Tires");
    expect(prior).toHaveLength(2);
    expect(prior[0].body).toBe("Tires"); // the EARLIER genuine occurrence survives
    expect(prior[1].direction).toBe("outbound");
  });

  it("leaves history untouched when the newest row is not the current message (persist failed)", () => {
    const history = [inbound("Brakes", 1), outbound("reply", 2)];
    expect(priorMessagesForInbound(history, "Tires")).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const history = [inbound("Tires", 1)];
    priorMessagesForInbound(history, "Tires");
    expect(history).toHaveLength(1);
  });
});
