/**
 * Q-53 · adStudio.potholeAudiences through the REAL appRouter: the Ad Studio's
 * pothole tab reaches the 311 reader, a failed read surfaces as an error (never
 * an empty map), and only the owner can call it. Network is stubbed with the
 * recorded ArcGIS fixtures.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "__tests__/fixtures/cleveland311", name), "utf8");

function context(role: "admin" | "user") {
  return {
    user: {
      id: 1,
      openId: `${role}-user`,
      email: `${role}@nickstire.com`,
      name: `${role} user`,
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

const urls: string[] = [];
let arcgisDown = false;

async function call(role: "admin" | "user" = "admin") {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller(context(role)).adStudio.potholeAudiences({ days: 30 });
}

describe("adStudio.potholeAudiences", () => {
  beforeEach(() => {
    vi.resetModules();
    urls.length = 0;
    arcgisDown = false;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (arcgisDown) return new Response("bad gateway", { status: 502 });
      // The newer window starts 30 days before "now"; the prior window ends there.
      const where = new URL(url).searchParams.get("where") ?? "";
      const [, fromTs] = where.match(/>= TIMESTAMP '([^']+)'/) ?? [];
      const isCurrent = Date.now() - new Date(`${fromTs}Z`).getTime() < 31 * 86_400_000;
      return new Response(
        fixture(isCurrent ? "pothole-groups-2026-08-31_2026-09-30.json" : "pothole-groups-2026-08-01_2026-08-31.json"),
        { status: 200 },
      );
    });
    // vi.resetModules() above gives each test a fresh 311 module, so its
    // in-process cache starts empty.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ranked ward drafts from Cleveland 311 for the owner", async () => {
    const r = await call();
    expect(r.status).toBe("draft");
    expect(r.totalRequests).toBe(132);
    expect(r.priorTotalRequests).toBe(123);
    expect(r.wards[0].inServiceArea).toBe(true);
    expect(r.source.license).toBe("ODbL-1.0");
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith("https://services3.arcgis.com/"))).toBe(true);
  });

  it("turns a failed 311 read into SERVICE_UNAVAILABLE, not an empty report", async () => {
    arcgisDown = true;
    await expect(call()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("refuses a non-admin caller before touching the network", async () => {
    await expect(call("user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(urls).toHaveLength(0);
  });
});
