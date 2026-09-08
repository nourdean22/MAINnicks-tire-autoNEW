/**
 * tests/lib/images/signed-url.test.ts · 2026-09-07 (program D13)
 *
 * Capability URLs for /api/images/[id]. The contract under test:
 *   · flag off: raw ids still serve, signed links also serve, a PRESENT but
 *     invalid signature is refused (tampering never degrades to public);
 *   · flag on: raw ids are refused, only a valid unexpired signature serves;
 *   · no secret: signing THROWS (a minter must never quietly emit a raw
 *     path when asked to sign) and verification is 503, not 200.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_IMAGE_TTL_SECONDS,
  authorizeImageRequest,
  imagePath,
  imageSignatureRequired,
  signImagePath,
  ensureSignedImagePath,
  ensureSignedImageUrl,
} from "@/lib/images/signed-url";

const NOW = Date.parse("2026-09-07T12:00:00Z");
const OFF = { AUTH_SECRET: "test-secret-not-a-real-credential" };
const ON = { ...OFF, IMAGES_REQUIRE_SIGNATURE: "1" };

function parts(path: string) {
  const u = new URL(path, "https://x.test");
  return { id: decodeURIComponent(u.pathname.split("/").pop()!), exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
}

describe("signImagePath / imagePath", () => {
  it("signs with exp + sig, and the default ttl is a week", () => {
    const p = parts(signImagePath("img_1", { now: NOW, env: OFF }));
    expect(p.id).toBe("img_1");
    expect(Number(p.exp)).toBe(Math.floor(NOW / 1000) + DEFAULT_IMAGE_TTL_SECONDS);
    expect(p.sig).toMatch(/^[0-9a-f]{32}$/);
  });

  it("imagePath is raw when the flag is off and signed when it is on — the only minter", () => {
    expect(imagePath("img_1", { env: OFF })).toBe("/api/images/img_1");
    expect(imagePath("img_1", { env: ON, now: NOW })).toMatch(/^\/api\/images\/img_1\?exp=\d+&sig=[0-9a-f]{32}$/);
  });

  it("throws instead of emitting a raw path when asked to sign without a secret", () => {
    expect(() => signImagePath("img_1", { env: {} })).toThrow(/IMAGE_URL_SECRET nor AUTH_SECRET/);
    expect(() => imagePath("img_1", { env: { IMAGES_REQUIRE_SIGNATURE: "1" } })).toThrow();
  });

  it("flag parsing accepts 1/true only", () => {
    expect(imageSignatureRequired({ IMAGES_REQUIRE_SIGNATURE: "1" })).toBe(true);
    expect(imageSignatureRequired({ IMAGES_REQUIRE_SIGNATURE: "true" })).toBe(true);
    expect(imageSignatureRequired({ IMAGES_REQUIRE_SIGNATURE: "0" })).toBe(false);
    expect(imageSignatureRequired({})).toBe(false);
  });
});

describe("authorizeImageRequest · flag off", () => {
  it("raw id serves", () => {
    expect(authorizeImageRequest({ id: "img_1", exp: null, sig: null, env: OFF, now: NOW })).toEqual({ ok: true, signed: false, expiresAt: null });
  });

  it("a valid signed link serves", () => {
    const p = parts(signImagePath("img_1", { now: NOW, env: OFF }));
    const r = authorizeImageRequest({ ...p, env: OFF, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.signed).toBe(true);
  });

  it("canary: a present-but-wrong signature is REFUSED even though raw access is open", () => {
    const p = parts(signImagePath("img_1", { now: NOW, env: OFF }));
    const bad = { ...p, sig: p.sig!.replace(/^./, (c) => (c === "0" ? "1" : "0")) };
    expect(authorizeImageRequest({ ...bad, env: OFF, now: NOW })).toMatchObject({ ok: false, status: 403 });
  });

  it("a signature for another id does not open this one", () => {
    const p = parts(signImagePath("img_other", { now: NOW, env: OFF }));
    expect(authorizeImageRequest({ id: "img_1", exp: p.exp, sig: p.sig, env: OFF, now: NOW })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("authorizeImageRequest · flag on", () => {
  it("raw id is refused with 401", () => {
    expect(authorizeImageRequest({ id: "img_1", exp: null, sig: null, env: ON, now: NOW })).toMatchObject({ ok: false, status: 401 });
  });

  it("valid signature serves; the same link one second after exp is 403", () => {
    const p = parts(signImagePath("img_1", { now: NOW, ttlSeconds: 60, env: ON }));
    expect(authorizeImageRequest({ ...p, env: ON, now: NOW + 59_000 }).ok).toBe(true);
    expect(authorizeImageRequest({ ...p, env: ON, now: NOW + 61_000 })).toMatchObject({ ok: false, status: 403, reason: "link expired" });
  });

  it("half a signature (exp without sig, or sig without exp) is malformed, not unsigned", () => {
    const p = parts(signImagePath("img_1", { now: NOW, env: ON }));
    expect(authorizeImageRequest({ id: "img_1", exp: p.exp, sig: null, env: ON, now: NOW })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeImageRequest({ id: "img_1", exp: null, sig: p.sig, env: ON, now: NOW })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeImageRequest({ id: "img_1", exp: "not-a-number", sig: p.sig, env: ON, now: NOW })).toMatchObject({ ok: false, status: 403 });
  });

  it("no secret configured → 503, never an open door", () => {
    const p = parts(signImagePath("img_1", { now: NOW, env: ON }));
    expect(authorizeImageRequest({ ...p, env: { IMAGES_REQUIRE_SIGNATURE: "1" }, now: NOW })).toMatchObject({ ok: false, status: 503 });
  });

  it("IMAGE_URL_SECRET wins over AUTH_SECRET, so the two can rotate independently", () => {
    const envA = { IMAGE_URL_SECRET: "img-secret-fixture", AUTH_SECRET: "auth-secret-fixture", IMAGES_REQUIRE_SIGNATURE: "1" };
    const p = parts(signImagePath("img_1", { now: NOW, env: envA }));
    const onlyAuth = { AUTH_SECRET: "auth-secret-fixture", IMAGES_REQUIRE_SIGNATURE: "1" };
    expect(authorizeImageRequest({ ...p, env: envA, now: NOW }).ok).toBe(true);
    expect(authorizeImageRequest({ ...p, env: onlyAuth, now: NOW })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("ensureSignedImagePath (publish-time re-mint)", () => {
  it("flag off: passes every path through untouched", () => {
    expect(ensureSignedImagePath("/api/images/img_1", { env: OFF })).toBe("/api/images/img_1");
  });
  it("flag on: a raw stored id is re-signed; signed and absolute URLs pass through", () => {
    const out = ensureSignedImagePath("/api/images/img_1", { env: ON, now: NOW });
    expect(out).toMatch(/^\/api\/images\/img_1\?exp=\d+&sig=[0-9a-f]{32}$/);
    const signed = signImagePath("img_1", { env: ON, now: NOW });
    expect(ensureSignedImagePath(signed, { env: ON, now: NOW })).toBe(signed);
    expect(ensureSignedImagePath("https://cdn.test/x.png", { env: ON })).toBe("https://cdn.test/x.png");
  });
});

describe("ensureSignedImageUrl (every persisted shape, review on #2195)", () => {
  it("absolute same-path raw URL is re-signed with its origin kept", () => {
    const out = ensureSignedImageUrl("https://bdnick.info/api/images/img_1", { env: ON, now: NOW });
    expect(out).toMatch(/^https:\/\/bdnick\.info\/api\/images\/img_1\?exp=\d+&sig=[0-9a-f]{32}$/);
  });
  it("an expired signed URL (relative or absolute) gets a FRESH signature", () => {
    const stale = signImagePath("img_1", { env: ON, now: NOW - 30 * 86_400_000, ttlSeconds: 60 });
    const later = NOW;
    const fresh = ensureSignedImageUrl(stale, { env: ON, now: later });
    expect(fresh).not.toBe(stale);
    const p = parts(fresh);
    expect(authorizeImageRequest({ ...p, env: ON, now: later }).ok).toBe(true);
    const abs = ensureSignedImageUrl(`https://bdnick.info${stale}`, { env: ON, now: later });
    expect(abs.startsWith("https://bdnick.info/api/images/img_1?exp=")).toBe(true);
    expect(authorizeImageRequest({ ...parts(abs), env: ON, now: later }).ok).toBe(true);
  });
  it("non-image URLs and the flag-off default pass through untouched", () => {
    expect(ensureSignedImageUrl("https://cdn.test/x.png", { env: ON })).toBe("https://cdn.test/x.png");
    expect(ensureSignedImageUrl("https://bdnick.info/api/images/img_1", { env: OFF })).toBe("https://bdnick.info/api/images/img_1");
    expect(ensureSignedImageUrl("not a url", { env: ON })).toBe("not a url");
  });
});
