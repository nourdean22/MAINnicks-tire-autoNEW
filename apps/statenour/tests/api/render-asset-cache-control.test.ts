/**
 * tests/api/render-asset-cache-control.test.ts (R3-14 item 6)
 *
 * R3-10 made GET /api/content/render-asset owner-only, but it still sent
 * `Cache-Control: public`, which lets a shared cache (CDN, proxy) store the
 * owner-only PNG and serve it to anyone. The response must be private.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    socialPublishQueue: {
      findUnique: vi.fn().mockResolvedValue({ id: "q1", content: "Great service", sourceMetadata: { author: "Sam", rating: 5 } }),
    },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));
vi.mock("@nour/social-assets", () => ({
  renderToPng: vi.fn(async () => ({ png: Buffer.from([137, 80, 78, 71]) })),
  ReviewCard: () => null,
  ServiceWarning: () => null,
  GooglePost: () => null,
}));

import { GET } from "@/app/api/content/render-asset/route";

const ctx = { params: Promise.resolve({}) };
const get = () => GET(new Request("http://localhost/api/content/render-asset?id=q1"), ctx);

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ id: "operator-1", email: "nick@example.com", role: "operator" } as never);
});

describe("render-asset caching", () => {
  it("an owner-only PNG is cacheable by the browser only, never by a shared cache", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toMatch(/\bprivate\b/);
    expect(cc).not.toMatch(/\bpublic\b/);
  });

  it("CONTROL - the route is owner-gated: no session is 401", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const res = await get();
    expect(res.status).toBe(401);
  });
});
