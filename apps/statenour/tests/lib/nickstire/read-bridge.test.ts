/**
 * readBridge: a failed bridge read is UNKNOWN, never data (audit 2026-10-10, 08-F6).
 */
import { describe, expect, it } from "vitest";
import { readBridge } from "@/lib/nickstire/query";

describe("readBridge", () => {
  it("maps a transport error to unknown", () => {
    expect(readBridge({ error: "fetch failed" })).toEqual({ status: "unknown", reason: "fetch failed" });
  });
  it("maps a 400 unknown-query to unknown and says the handler is missing", () => {
    const r = readBridge({ error: 'HTTP 400: {"error":"Unknown query: quotes_pending"}', statusCode: 400 });
    expect(r.status).toBe("unknown");
    expect(r.status === "unknown" && r.reason).toMatch(/no handler/);
  });
  it("maps a 200 whose data carries an error to unknown", () => {
    expect(readBridge({ query: "q", timestamp: "t", data: { error: "No DB" } })).toEqual({ status: "unknown", reason: "No DB" });
  });
  it("maps no answer and an answer without data to unknown", () => {
    expect(readBridge(undefined).status).toBe("unknown");
    expect(readBridge({ query: "q" }).status).toBe("unknown");
  });
  it("CONTROL: a real empty read stays ok", () => {
    expect(readBridge({ data: { count: 0, pending: [] } })).toEqual({ status: "ok", data: { count: 0, pending: [] } });
    expect(readBridge({ data: [] })).toEqual({ status: "ok", data: [] });
  });
});
