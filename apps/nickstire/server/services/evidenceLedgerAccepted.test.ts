/**
 * Delivery means RECORDED (2026-10-09, review on #2944).
 *
 * StateNour's /api/sync/evidence answers HTTP 200 for a partial batch: the
 * apiHandler envelope is { ok, data: { ok, rejected: [...], duplicate? } }.
 * postToEvidenceLedger used to return true on res.ok alone, so the
 * prompt-evolution cron told Telegram "recorded" for a receipt the ledger had
 * refused. requireAccepted reads the body; the default keeps the old contract
 * for the existing callers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { postToEvidenceLedger } from "./evidenceLedger";

const ENV = { STATENOUR_SYNC_URL: process.env.STATENOUR_SYNC_URL, STATENOUR_SYNC_KEY: process.env.STATENOUR_SYNC_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function answer(body: unknown, status = 200) {
  process.env.STATENOUR_SYNC_URL = "https://ledger.example.test";
  process.env.STATENOUR_SYNC_KEY = "test-key";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status, headers: { "content-type": "application/json" } })));
}

const recorded = { ok: true, data: { ok: true, eventsWritten: 1, claimsWritten: 1, rejected: [] }, meta: {} };
const partial = { ok: true, data: { ok: false, eventsWritten: 0, claimsWritten: 1, rejected: [{ kind: "event", index: 0, error: "PII-shaped value" }] }, meta: {} };
const duplicate = { ok: true, data: { ok: true, eventsWritten: 0, claimsWritten: 0, rejected: [], duplicate: true }, meta: {} };
const required = (b = {}) => postToEvidenceLedger(b, { requireAccepted: true });

describe("postToEvidenceLedger requireAccepted", () => {
  it("true for a fully recorded batch and for a keyed duplicate replay", async () => {
    answer(recorded);
    expect(await required()).toBe(true);
    answer(duplicate);
    expect(await required()).toBe(true);
  });
  it("false for HTTP 200 that rejected rows, an envelope error, an unreadable body, or no positive ok", async () => {
    answer(partial);
    expect(await required()).toBe(false);
    answer({ ok: false, error: "nope" });
    expect(await required()).toBe(false);
    answer("not json at all");
    expect(await required()).toBe(false);
    answer({ ok: true, data: {} });
    expect(await required()).toBe(false);
  });
  it("CONTROL: without requireAccepted the old status-only contract is unchanged; a non-2xx is false either way", async () => {
    answer(partial);
    expect(await postToEvidenceLedger({})).toBe(true);
    answer(recorded, 500);
    expect(await required()).toBe(false);
  });
});
