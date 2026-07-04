import { describe, expect, it, vi } from "vitest";
import { registerMetaRoutes } from "./routes/metaRoutes";

describe("metaRoutes - GET /api/_meta/procedures", () => {
  it("registers the route on the express app", () => {
    const mockApp = {
      get: vi.fn(),
    } as any;
    registerMetaRoutes(mockApp);
    expect(mockApp.get).toHaveBeenCalledWith("/api/_meta/procedures", expect.any(Function), expect.any(Function));
  });

  it("authenticates and returns procedures listing", () => {
    const originalSyncKey = process.env.STATENOUR_SYNC_KEY;
    process.env.STATENOUR_SYNC_KEY = "test-sync-key-which-is-at-least-32-chars-long";
    
    const mockApp = {
      get: vi.fn(),
    } as any;
    
    registerMetaRoutes(mockApp);
    
    // Extract route handlers
    const [, authMiddleware, routeHandler] = mockApp.get.mock.calls[0];
    
    // 1. Unauthenticated request
    const req1 = {
      headers: {},
      ip: "127.0.0.1",
    } as any;
    const res1 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next1 = vi.fn();
    
    authMiddleware(req1, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(401);
    expect(res1.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next1).not.toHaveBeenCalled();
    
    // 2. Authenticated request with correct Statenour sync key
    const req2 = {
      headers: {
        "x-statenour-sync-key": "test-sync-key-which-is-at-least-32-chars-long",
      },
      ip: "127.0.0.1",
    } as any;
    const res2 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next2 = vi.fn();
    
    authMiddleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    
    // Trigger routeHandler
    routeHandler(req2, res2);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        count: expect.any(Number),
        procedures: expect.any(Array),
      })
    );
    
    const procedures = res2.json.mock.calls[0][0].procedures;
    expect(procedures.length).toBeGreaterThan(0);
    // Spot check
    const hasHealth = procedures.some((p: any) => p.path === "system.health");
    expect(hasHealth).toBe(true);

    // Restore environment (assigning undefined would store the string "undefined")
    if (originalSyncKey === undefined) delete process.env.STATENOUR_SYNC_KEY;
    else process.env.STATENOUR_SYNC_KEY = originalSyncKey;
  });
});
