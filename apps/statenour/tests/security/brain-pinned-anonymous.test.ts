/**
 * tests/security/brain-pinned-anonymous.test.ts · 2026-09-07
 *
 * `/api/brain` is a session-exempt prefix (lib/security/route-policy.ts), so
 * every handler under it runs its OWN session check. The pinned route did —
 * but OUTSIDE its try/catch, so the ServiceError `requireSession()` throws
 * escaped as an unhandled 500. Live-probed on production: an anonymous GET
 * answered 500 (and minted a Sentry issue per probe) while every sibling
 * answered 401.
 *
 * The #2175 review round added the second half of the contract: every throw
 * still DENIES, but the STATUS must be honest — the guard's own 503
 * ("Authentication is unavailable", production without auth credentials)
 * must not be relabelled as an expired login, and an unexpected failure is a
 * sanitized 500, not a 401.
 *
 * Drives the REAL exported handlers with the session check mocked, plus a
 * valid-owner positive control — so a route that stopped checking at all
 * fails the first case, and one that denied everyone fails the last.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "@/lib/utils/service-error";

const guard = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));
vi.mock("@/lib/auth-guard", () => ({ requireSession: guard.requireSession }));

const pins = vi.hoisted(() => ({
  listPins: vi.fn(),
  createPin: vi.fn(),
  updatePin: vi.fn(),
  deletePin: vi.fn(),
}));
vi.mock("@/lib/services/pins", () => ({
  listPins: pins.listPins,
  createPin: pins.createPin,
  updatePin: pins.updatePin,
  deletePin: pins.deletePin,
  PinNotFoundError: class PinNotFoundError extends Error {},
  PinContentRequiredError: class PinContentRequiredError extends Error {},
  PinContentTooLongError: class PinContentTooLongError extends Error {},
}));

const logs = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ error: logs.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}));

import { GET, POST, PATCH, DELETE } from "@/app/api/brain/pinned/route";

const URL_ = "https://example.test/api/brain/pinned";
const json = (method: string, body?: unknown) =>
  new NextRequest(URL_, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const allVerbs = () =>
  Promise.all([
    GET(new NextRequest(URL_)),
    POST(json("POST", { content: "x" })),
    PATCH(json("PATCH", { id: "pin-1", content: "y" })),
    DELETE(new NextRequest(`${URL_}?id=pin-1`, { method: "DELETE" })),
  ]);

const serviceUntouched = () => {
  expect(pins.listPins).not.toHaveBeenCalled();
  expect(pins.createPin).not.toHaveBeenCalled();
  expect(pins.updatePin).not.toHaveBeenCalled();
  expect(pins.deletePin).not.toHaveBeenCalled();
};

describe("/api/brain/pinned session guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pins.listPins.mockResolvedValue({ pins: [] });
    pins.createPin.mockResolvedValue({ id: "pin-1" });
    pins.updatePin.mockResolvedValue({ id: "pin-1" });
    pins.deletePin.mockResolvedValue({ ok: true });
  });

  it("no session → 401 on every verb, never 500, service untouched", async () => {
    guard.requireSession.mockRejectedValue(new ServiceError("Unauthorized", 401));
    const responses = await allVerbs();
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    for (const res of responses) expect(await res.json()).toEqual({ error: "unauthorized" });
    serviceUntouched();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("authentication unavailable (the guard's own 503) stays 503 — an outage is not an expired login", async () => {
    guard.requireSession.mockRejectedValue(new ServiceError("Authentication is unavailable", 503));
    const responses = await allVerbs();
    expect(responses.map((r) => r.status)).toEqual([503, 503, 503, 503]);
    for (const res of responses) expect(await res.json()).toEqual({ error: "authentication unavailable" });
    serviceUntouched();
  });

  it("an unexpected failure inside the session check is a sanitized 500 with one log line, still denied", async () => {
    guard.requireSession.mockRejectedValue(new Error("auth() exploded: connect ECONNREFUSED 10.0.0.9:5432"));
    const res = await GET(new NextRequest(URL_));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "session check failed" });
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(logs.error).toHaveBeenCalledWith("session_check_failed", expect.objectContaining({ message: expect.stringContaining("ECONNREFUSED") }));
    serviceUntouched();
  });

  it("positive control: with a session the GET reaches the service and answers 200", async () => {
    guard.requireSession.mockResolvedValue({ id: "op", email: "op@example.test", role: "operator" });
    pins.listPins.mockResolvedValue({ pins: [{ id: "pin-1" }] });
    const res = await GET(new NextRequest(`${URL_}?withStats=1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pins: [{ id: "pin-1" }] });
    expect(pins.listPins).toHaveBeenCalledWith({ withStats: true });
  });
});
