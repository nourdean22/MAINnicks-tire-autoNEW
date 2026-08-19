/**
 * tests/ai/chat/redelivery.test.ts · deterministic retry re-delivery.
 *
 * The classifier gates a fast path that BYPASSES the model and
 * re-serves stored content — a false positive hijacks a real request,
 * a false negative just falls through to the model (safe). So the
 * negative cases here are the load-bearing ones.
 */

import { describe, expect, it } from "vitest";
import { isRedeliveryRequest } from "@/lib/ai/chat/redelivery";
import { classifyIntercept } from "@/lib/ai/chat/interceptors";

describe("isRedeliveryRequest · fires on real re-send asks", () => {
  it("matches the harvested production trace verbatim", () => {
    // The turn the golden-set scenario was promoted from.
    expect(isRedeliveryRequest("The whole app was bugging and I lost that. Retry")).toBe(true);
  });

  it("matches explicit re-send verbs on their own", () => {
    expect(isRedeliveryRequest("resend")).toBe(true);
    expect(isRedeliveryRequest("send it again")).toBe(true);
    expect(isRedeliveryRequest("say that again")).toBe(true);
    expect(isRedeliveryRequest("repeat that")).toBe(true);
    expect(isRedeliveryRequest("can you resend that? the app crashed")).toBe(true);
  });

  it("matches retry-family verbs WITH loss context", () => {
    expect(isRedeliveryRequest("app glitched, retry")).toBe(true);
    expect(isRedeliveryRequest("that didn't come through. try it again")).toBe(true);
    expect(isRedeliveryRequest("it froze on my end — retry")).toBe(true);
  });
});

describe("isRedeliveryRequest · refuses the dangerous near-misses", () => {
  it("bare 'retry' without loss context goes to the model", () => {
    // Production "retry" can mean re-attempt an ACTION (a send, a
    // search, a payment) — re-serving old text there would be wrong.
    expect(isRedeliveryRequest("retry")).toBe(false);
    expect(isRedeliveryRequest("Retry")).toBe(false);
    expect(isRedeliveryRequest("try that again")).toBe(false);
  });

  it("any modifier means a CHANGED deliverable — model, not re-serve", () => {
    expect(isRedeliveryRequest("resend but shorter")).toBe(false);
    expect(isRedeliveryRequest("app bugged, retry with the prices added")).toBe(false);
    expect(isRedeliveryRequest("send it again without the last section")).toBe(false);
    expect(isRedeliveryRequest("retry it, but change the tone")).toBe(false);
  });

  it("long messages never fire — a real re-send ask is short", () => {
    const long =
      "the app was bugging earlier so retry — and while you're at it I've been thinking " +
      "about the whole Saturday process, we should really talk through how the close " +
      "works when two techs are out";
    expect(isRedeliveryRequest(long)).toBe(false);
  });

  it("empty / unrelated input never fires", () => {
    expect(isRedeliveryRequest("")).toBe(false);
    expect(isRedeliveryRequest("what were Friday's numbers?")).toBe(false);
    expect(isRedeliveryRequest("the app keeps crashing lately")).toBe(false); // loss talk, no verb
  });
});

describe("classifyIntercept · redelivery wiring", () => {
  it("routes a re-send ask to the redelivery fast path", () => {
    const k = classifyIntercept("The whole app was bugging and I lost that. Retry");
    expect(k.redelivery).toBe(true);
    expect(k.any).toBe(true);
  });

  it("suppresses redelivery when the prior turn was an image", () => {
    // "send it again" after an image belongs to the image follow-up
    // path (regenerate), not text re-serving.
    const k = classifyIntercept("send it again", true);
    expect(k.redelivery).toBe(false);
  });

  it("leaves ordinary conversation untouched", () => {
    const k = classifyIntercept("what should I price the alignment special at?");
    expect(k.redelivery).toBe(false);
  });
});
