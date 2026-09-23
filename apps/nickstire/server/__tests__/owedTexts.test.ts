/**
 * Owed texts (2026-09-23). The census found 55 of 104 inbound text episodes
 * ending unanswered, and nothing on Today showed them. These pin the rule that
 * decides who is waiting: newest message wins, a failed reply is no reply,
 * and a STOP, an opt-in or a bare "ok thanks" is owed nothing.
 */
import { describe, expect, it } from "vitest";
import { pickOwedTexts, type OwedTextRow } from "../lib/owedTextsRule";

let nextId = 1;
const msg = (
  conversationId: number,
  direction: "inbound" | "outbound",
  ageMinutes: number,
  body = "Do you have 225/65R17 in stock?",
  status = direction === "inbound" ? "received" : "sent",
  phone = "+12165550101",
): OwedTextRow => ({
  messageId: nextId++,
  conversationId,
  phone,
  customerName: `Customer ${conversationId}`,
  direction,
  status,
  body,
  createdAt: new Date(0),
  ageMinutes,
});

describe("pickOwedTexts", () => {
  it("POSITIVE CONTROL: a customer's unanswered question is owed", () => {
    const owed = pickOwedTexts([msg(1, "outbound", 300, "Thanks for texting Nick's"), msg(1, "inbound", 90)]);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ conversationId: 1, waitingMinutes: 90 });
    expect(owed[0].preview).toContain("225/65R17");
  });

  it("a shop reply after the question clears it", () => {
    expect(pickOwedTexts([msg(2, "inbound", 90), msg(2, "outbound", 60)])).toEqual([]);
  });

  it("a FAILED reply is no reply: the customer is still waiting", () => {
    const owed = pickOwedTexts([msg(3, "inbound", 90), msg(3, "outbound", 60, "We have it", "failed")]);
    expect(owed.map((o) => o.conversationId)).toEqual([3]);
  });

  it("a text younger than the wait gives the automated reply its chance first", () => {
    expect(pickOwedTexts([msg(4, "inbound", 5)])).toEqual([]);
    expect(pickOwedTexts([msg(4, "inbound", 15)])).toHaveLength(1);
  });

  it("a STOP, an opt-in or a bare acknowledgement is owed nothing", () => {
    for (const body of ["STOP", "Stop.", "opt-out", "START", "ok thanks", "Thank you!", "👍"]) {
      expect(pickOwedTexts([msg(5, "inbound", 90, body)]), body).toEqual([]);
    }
  });

  it("a short-code sender (carrier notice) is not a customer", () => {
    expect(pickOwedTexts([msg(6, "inbound", 90, "Your code is 1234", "received", "73981")])).toEqual([]);
  });

  it("orders the longest wait first", () => {
    const owed = pickOwedTexts([msg(7, "inbound", 30), msg(8, "inbound", 600), msg(9, "inbound", 120)]);
    expect(owed.map((o) => o.conversationId)).toEqual([8, 9, 7]);
  });
});

describe("a sentence that merely starts with a keyword is still owed", () => {
  it("\"Stop by around 3?\" and \"ok but how much\" need an answer; a bare \"Stop\" does not", () => {
    expect(pickOwedTexts([msg(10, "inbound", 90, "Stop by around 3?")])).toHaveLength(1);
    expect(pickOwedTexts([msg(11, "inbound", 90, "ok but how much for two tires")])).toHaveLength(1);
    expect(pickOwedTexts([msg(12, "inbound", 90, "Stop")])).toEqual([]);
  });
});
