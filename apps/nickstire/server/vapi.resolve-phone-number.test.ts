/**
 * wave-145 · resolveVapiPhoneNumberId — the outbound-number resolver.
 *
 * This is the fix that unblocked the whole outbound program: the crons used
 * to demand a hand-set VAPI_PHONE_NUMBER_ID that was never set, so they
 * skipped forever (voice recovery, the 7/30/60 cadence, confirmation calls).
 * Now the id is derived from the shop's VAPI line. Two contracts pinned here:
 *   - the env override wins (operator can still force a specific number),
 *   - it fails CLOSED (null → caller skips) when nothing resolves — so a
 *     missing/!ok/empty API response can NEVER produce a call from a wrong
 *     line. That fail-closed behavior is the "no spam, no errors" guarantee.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OLD_ENV = { ...process.env };

function mockFetch(payload: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => payload }));
}

beforeEach(() => {
  vi.resetModules(); // fresh module → fresh phone-number cache per test
  vi.unstubAllGlobals();
  delete process.env.VAPI_PHONE_NUMBER_ID;
  delete process.env.VAPI_API_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...OLD_ENV };
});

describe("wave-145 · resolveVapiPhoneNumberId", () => {
  it("env override wins without hitting the API", async () => {
    process.env.VAPI_PHONE_NUMBER_ID = "pn_override";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBe("pn_override");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed (null) with no API key and no override", async () => {
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBeNull();
  });

  it("looks up the shop line +12164249249 and returns its id", async () => {
    process.env.VAPI_API_KEY = "k";
    vi.stubGlobal("fetch", mockFetch([
      { id: "pn_other", number: "+19998887777" },
      { id: "pn_shop", number: "+12164249249" },
    ]));
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBe("pn_shop");
  });

  it("returns null when the shop number isn't in the account (no wrong-line call)", async () => {
    process.env.VAPI_API_KEY = "k";
    vi.stubGlobal("fetch", mockFetch([{ id: "pn_other", number: "+19998887777" }]));
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBeNull();
  });

  it("fails closed when the API returns non-ok", async () => {
    process.env.VAPI_API_KEY = "k";
    vi.stubGlobal("fetch", mockFetch("err", false));
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBeNull();
  });

  it("caches on success — a second call does not re-fetch", async () => {
    process.env.VAPI_API_KEY = "k";
    const fetchSpy = mockFetch([{ id: "pn_shop", number: "+12164249249" }]);
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveVapiPhoneNumberId } = await import("./services/vapi");
    expect(await resolveVapiPhoneNumberId()).toBe("pn_shop");
    expect(await resolveVapiPhoneNumberId()).toBe("pn_shop");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
