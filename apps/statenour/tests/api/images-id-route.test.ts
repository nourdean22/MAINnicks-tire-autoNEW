/**
 * tests/api/images-id-route.test.ts · 2026-09-07 (program D13)
 *
 * The route, not just the predicate: flag off serves raw ids exactly as
 * before (positive control), refuses a tampered signature; flag on refuses
 * raw ids, serves a signed link, and never caches past the link's expiry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ auditEvent: { findUnique: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { GET } from "@/app/api/images/[id]/route";
import { signImagePath } from "@/lib/images/signed-url";

const PNG_B64 = Buffer.from("not-really-a-png").toString("base64");
const get = (path: string) => GET(new NextRequest(`https://x.test${path}`), { params: Promise.resolve({ id: "img_1" }) });

describe("GET /api/images/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "route-test-secret-not-a-credential");
    vi.stubEnv("IMAGE_URL_SECRET", "");
    db.auditEvent.findUnique.mockResolvedValue({ eventType: "generated_image", payload: { base64: PNG_B64 } });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("flag off (default)", () => {
    beforeEach(() => vi.stubEnv("IMAGES_REQUIRE_SIGNATURE", ""));

    it("positive control: a raw id serves the bytes with the 24h public cache header", async () => {
      const res = await get("/api/images/img_1");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("not-really-a-png");
    });

    it("a valid signed link serves too, and is not cached past its expiry", async () => {
      const path = signImagePath("img_1", { ttlSeconds: 600 });
      const res = await get(path);
      expect(res.status).toBe(200);
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1]);
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(600);
    });

    it("canary: a tampered signature is refused even though raw access is open", async () => {
      const path = signImagePath("img_1", { ttlSeconds: 600 }).replace(/sig=./, "sig=z");
      const res = await get(path);
      expect(res.status).toBe(403);
      expect(db.auditEvent.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("flag on", () => {
    beforeEach(() => vi.stubEnv("IMAGES_REQUIRE_SIGNATURE", "1"));

    it("a raw id is refused before any DB read", async () => {
      const res = await get("/api/images/img_1");
      expect(res.status).toBe(401);
      expect(db.auditEvent.findUnique).not.toHaveBeenCalled();
    });

    it("a signed link serves", async () => {
      const res = await get(signImagePath("img_1", { ttlSeconds: 600 }));
      expect(res.status).toBe(200);
    });

    it("an expired link is 403", async () => {
      const path = signImagePath("img_1", { ttlSeconds: 60, now: Date.now() - 120_000 });
      expect((await get(path)).status).toBe(403);
    });

    it("unknown id under a valid signature is still 404 (signature is not existence)", async () => {
      db.auditEvent.findUnique.mockResolvedValue(null);
      expect((await get(signImagePath("img_1", { ttlSeconds: 600 }))).status).toBe(404);
    });
  });
});
