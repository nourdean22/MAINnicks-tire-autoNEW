import { describe, it, expect } from "vitest";
import { parseInsights } from "./services/metaSocial";

describe("parseInsights", () => {
  it("maps a full reel insights response", () => {
    const data = {
      data: [
        { name: "reach", values: [{ value: 1500 }] },
        { name: "saved", values: [{ value: 42 }] },
        { name: "views", values: [{ value: 3200 }] },
        { name: "shares", values: [{ value: 7 }] },
      ],
    };
    expect(parseInsights(data)).toEqual({ reach: 1500, saved: 42, views: 3200, shares: 7 });
  });

  it("leaves metrics the media type omits undefined (e.g. an image has no views)", () => {
    const data = {
      data: [
        { name: "reach", values: [{ value: 800 }] },
        { name: "saved", values: [{ value: 10 }] },
        { name: "shares", values: [{ value: 3 }] },
      ],
    };
    const r = parseInsights(data);
    expect(r.reach).toBe(800);
    expect(r.views).toBeUndefined();
  });

  it("never throws on malformed / empty responses", () => {
    expect(parseInsights(null).reach).toBeUndefined();
    expect(parseInsights({}).reach).toBeUndefined();
    expect(parseInsights({ data: "nope" }).reach).toBeUndefined();
    expect(parseInsights({ data: [{ name: "reach", values: [] }] }).reach).toBeUndefined();
    expect(parseInsights({ data: [{ name: "reach", values: [{ value: "x" }] }] }).reach).toBeUndefined();
  });
});
