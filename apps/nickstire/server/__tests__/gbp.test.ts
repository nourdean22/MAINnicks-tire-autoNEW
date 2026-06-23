import { describe, it, expect, vi, beforeEach } from "vitest";
import { gbpRouter } from "../routers/gbp";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  mockAccounts: [{ name: "accounts/123", accountName: "Nick's Tire", type: "PERSONAL" }],
  mockLocations: [{ name: "locations/456", title: "Nick's Tire Euclid", storeCode: "EUC" }],
  mockPostResult: { name: "accounts/123/locations/456/localPosts/789", searchUrl: "https://google.com/post/789", state: "LIVE" }
}));

vi.mock("../lib/db-helper", () => {
  function chain(result: unknown) {
    const c: {
      from: () => typeof c;
      where: () => typeof c;
      limit: () => Promise<unknown>;
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      from: () => c,
      where: () => c,
      limit: () => Promise.resolve(result),
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return c;
  }
  return {
    db: vi.fn(async () => ({
      select: () => chain(h.selectQueue.shift() ?? []),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push(values);
          return {
            onDuplicateKeyUpdate: () => Promise.resolve()
          };
        }
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            h.updates.push(values);
            return Promise.resolve();
          },
        }),
      }),
    })),
  };
});

vi.mock("@nour/gbp-publisher", () => {
  return {
    getAuthUrl: vi.fn((params) => `https://accounts.google.com/o/oauth2/v2/auth?client_id=${params.clientId}&state=${params.state}`),
    exchangeCode: vi.fn(async () => ({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiryDate: 123456789
    })),
    getAuthenticatedClient: vi.fn(() => ({
      credentials: { refresh_token: "mock-refresh-token" }
    })),
    listGbpAccounts: vi.fn(async () => h.mockAccounts),
    listGbpLocations: vi.fn(async () => h.mockLocations),
    publishGbpPost: vi.fn(async () => h.mockPostResult),
  };
});

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function userContext(): TrpcContext {
  return {
    ...adminContext(),
    user: { ...adminContext().user!, id: 2, openId: "regular", role: "user" },
  };
}

beforeEach(() => {
  h.selectQueue.length = 0;
  h.inserts.length = 0;
  h.updates.length = 0;
  vi.clearAllMocks();
});

describe("gbpRouter - Authorization and Status", () => {
  it("returns configured: false when no secrets exist", async () => {
    h.selectQueue.push([]); // Select from appSecretKv returns no rows
    const caller = gbpRouter.createCaller(adminContext());
    const status = await caller.getAuthStatus();

    expect(status).toEqual({
      configured: false,
      connected: false,
      locationConfigured: false,
      clientIdFingerprint: null,
      accountId: null,
      locationId: null,
    });
  });

  it("returns configured and connected when refresh token exists", async () => {
    h.selectQueue.push([
      { k: "gbp_client_id", v: "my-client-id" },
      { k: "gbp_client_secret", v: "secret" },
      { k: "gbp_refresh_token", v: "refresh-tok" },
      { k: "gbp_account_id", v: "accounts/123" },
      { k: "gbp_location_id", v: "locations/456" }
    ]);
    const caller = gbpRouter.createCaller(adminContext());
    const status = await caller.getAuthStatus();

    expect(status).toEqual({
      configured: true,
      connected: true,
      locationConfigured: true,
      clientIdFingerprint: "…ent-id",
      accountId: "accounts/123",
      locationId: "locations/456",
    });
  });

  it("fails to generate auth url if client ID or secret is missing", async () => {
    h.selectQueue.push([]);
    const caller = gbpRouter.createCaller(adminContext());
    await expect(caller.getAuthUrl()).rejects.toThrow(/client details are missing/);
  });

  it("generates auth url if configured", async () => {
    h.selectQueue.push([
      { k: "gbp_client_id", v: "my-client-id" },
      { k: "gbp_client_secret", v: "secret" },
      { k: "gbp_redirect_uri", v: "https://localhost/callback" }
    ]);
    const caller = gbpRouter.createCaller(adminContext());
    const res = await caller.getAuthUrl();

    expect(res.url).toContain("my-client-id");
    expect(res.url).toContain("gbp-oauth");
  });
});

describe("gbpRouter - Reconnect Flow", () => {
  it("exchanges code for tokens, saves refresh token, and lists accounts", async () => {
    h.selectQueue.push([
      { k: "gbp_client_id", v: "my-client-id" },
      { k: "gbp_client_secret", v: "secret" },
      { k: "gbp_redirect_uri", v: "https://localhost/callback" }
    ]);
    const caller = gbpRouter.createCaller(adminContext());
    const res = await caller.reconnect({ code: "auth-code" });

    expect(res.success).toBe(true);
    expect(res.accounts).toEqual(h.mockAccounts);

    // Verify refresh token was inserted
    expect(h.inserts).toContainEqual({ k: "gbp_refresh_token", v: "mock-refresh-token" });
    expect(h.inserts).toContainEqual({ k: "gbp_access_token", v: "mock-access-token" });
  });
});

describe("gbpRouter - Locations", () => {
  it("lists locations for account", async () => {
    h.selectQueue.push([
      { k: "gbp_client_id", v: "my-client-id" },
      { k: "gbp_client_secret", v: "secret" },
      { k: "gbp_refresh_token", v: "refresh-tok" }
    ]);
    const caller = gbpRouter.createCaller(adminContext());
    const res = await caller.listLocations({ accountName: "accounts/123" });

    expect(res.locations).toEqual(h.mockLocations);
  });

  it("saves location selection to database", async () => {
    const caller = gbpRouter.createCaller(adminContext());
    const res = await caller.saveLocation({ accountId: "accounts/123", locationId: "locations/456" });

    expect(res.success).toBe(true);
    expect(h.inserts).toContainEqual({ k: "gbp_account_id", v: "accounts/123" });
    expect(h.inserts).toContainEqual({ k: "gbp_location_id", v: "locations/456" });
  });
});

describe("gbpRouter - Post Publication", () => {
  it("fails to publish if location is not configured", async () => {
    h.selectQueue.push([]); // No location keys stored
    const caller = gbpRouter.createCaller(adminContext());

    await expect(caller.publishPost({
      summary: "Welcome to Nick's Tire!"
    })).rejects.toThrow(/location is not configured/);
  });

  it("publishes post and updates draft status", async () => {
    // 1st select: loadGbpSecrets -> location and refresh tokens loaded
    h.selectQueue.push([
      { k: "gbp_client_id", v: "my-client-id" },
      { k: "gbp_client_secret", v: "secret" },
      { k: "gbp_refresh_token", v: "refresh-tok" },
      { k: "gbp_account_id", v: "accounts/123" },
      { k: "gbp_location_id", v: "locations/456" }
    ]);
    // 2nd select: publishPost -> lookup existing draft
    h.selectQueue.push([
      { id: "draft-777", briefJson: JSON.stringify({ status: "draft" }) }
    ]);

    const caller = gbpRouter.createCaller(adminContext());
    const res = await caller.publishPost({
      draftId: "draft-777",
      summary: "Get 10% off new tires!",
      ctaType: "LEARN_MORE",
      ctaUrl: "https://nickstire.org/specials"
    });

    expect(res.success).toBe(true);
    expect(res.postId).toBe(h.mockPostResult.name);

    // Verify draft status in database was updated
    expect(h.updates).toHaveLength(1);
    const updatedBrief = JSON.parse(h.updates[0].briefJson as string);
    expect(updatedBrief.status).toBe("posted");
    expect(updatedBrief.gbpPostId).toBe(h.mockPostResult.name);
    expect(updatedBrief.gbpSearchUrl).toBe(h.mockPostResult.searchUrl);
  });
});

describe("gbpRouter - RBAC Gates", () => {
  it("rejects non-admin users on mutations and queries", async () => {
    const caller = gbpRouter.createCaller(userContext());
    await expect(caller.getAuthStatus()).rejects.toThrow(/permission/i);
    await expect(caller.getAuthUrl()).rejects.toThrow(/permission/i);
  });
});
