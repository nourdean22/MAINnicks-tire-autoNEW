/**
 * Calendar r2 W1 (2026-10-31): Nour's calendar-of-record slot refuses the shop's Google account.
 *
 * The SELECT that day found `google_oauth_personal` holding the SAME account as the shop's primary
 * slot: the June grant picked the wrong account in Google's picker and nothing noticed, so his
 * calendar was never connected. The exchange now refuses that grant before it overwrites the slot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { name: string; config: Record<string, unknown> };
const { db } = vi.hoisted(() => ({ db: { rows: new Map<string, Row>(), upserts: [] as string[] } }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: {
      findUnique: async ({ where }: { where: { name: string } }) => db.rows.get(where.name) ?? null,
      upsert: async ({ where, create }: { where: { name: string }; create: Row }) => {
        db.upserts.push(where.name);
        db.rows.set(where.name, { name: where.name, config: create.config });
        return create;
      },
    },
  },
}));

import { exchangeCodeForToken } from "@/lib/services/google-oauth";

const idToken = (email: string) =>
  `h.${Buffer.from(JSON.stringify({ email })).toString("base64")}.s`;

function stubGoogleToken(email: string) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: idToken(email) }), { status: 200 }),
  ));
}

beforeEach(() => {
  vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "secret");
  db.rows.clear();
  db.upserts.length = 0;
  db.rows.set("google_oauth", { name: "google_oauth", config: { refreshToken: "shop-rt", email: "shop@example.com" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("exchangeCodeForToken · calendar-of-record slot guard", () => {
  it("refuses the shop's account in his slot and leaves the slot untouched", async () => {
    stubGoogleToken("Shop@Example.com");
    await expect(exchangeCodeForToken("code", "personal")).rejects.toThrow(/shop's Google account/);
    expect(db.upserts).toEqual([]);
  });

  it("stores his own account in his slot", async () => {
    stubGoogleToken("owner@example.com");
    const r = await exchangeCodeForToken("code", "personal");
    expect(r.integrationName).toBe("google_oauth_personal");
    expect(db.upserts).toEqual(["google_oauth_personal"]);
  });

  it("still lets the shop's primary slot be re-granted with the shop's account", async () => {
    stubGoogleToken("shop@example.com");
    await exchangeCodeForToken("code", "primary");
    expect(db.upserts).toEqual(["google_oauth"]);
  });
});
