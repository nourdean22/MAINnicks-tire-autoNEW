/**
 * tests/security/brain-pinned-anonymous.test.ts · 2026-09-07
 *
 * `/api/brain` is a session-exempt prefix (lib/security/route-policy.ts), so
 * every handler under it runs its OWN session check. The pinned route did —
 * but OUTSIDE its try/catch, so the ServiceError `requireSession()` throws
 * escaped as an unhandled 500. Live-probed on production: an anonymous GET
 * answered 500 (and minted a Sentry issue per probe) while every sibling
 * answered 401. Denial was never in doubt; the status and the noise were.
 *
 * Drives the REAL exported handlers with the session check mocked to throw,
 * and a positive control with it resolving — so a route that stopped
 * checking at all would fail the first case, and one that denied everyone
 * would fail the second.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

import { GET, POST, PATCH, DELETE } from "@/app/api/brain/pinned/route";

const URL_ = "https://example.test/api/brain/pinned";
const json = (method: string, body?: unknown) =>
  new NextRequest(URL_, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("GET/POST/PATCH/DELETE /api/brain/pinned without a session", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    guard.requireSession.mockRejectedValue(new Error("Unauthorized"));
    pins.listPins.mockResolvedValue({ pins: [] });
    pins.createPin.mockResolvedValue({ id: "pin-1" });
    pins.updatePin.mockResolvedValue({ id: "pin-1" });
    pins.deletePin.mockResolvedValue({ ok: true });
  });

  it("answers 401 on every verb, never 500, and never touches the pin service", async () => {
    const responses = await Promise.all([
      GET(new NextRequest(URL_)),
      POST(json("POST", { content: "x" })),
      PATCH(json("PATCH", { id: "pin-1", content: "y" })),
      DELETE(new NextRequest(`${URL_}?id=pin-1`, { method: "DELETE" })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    for (const res of responses) {
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(pins.listPins).not.toHaveBeenCalled();
    expect(pins.createPin).not.toHaveBeenCalled();
    expect(pins.updatePin).not.toHaveBeenCalled();
    expect(pins.deletePin).not.toHaveBeenCalled();
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
