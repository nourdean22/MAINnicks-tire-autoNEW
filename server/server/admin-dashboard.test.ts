import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAdminContext(): TrpcContext {
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
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createNonAdminContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "regular-user",
      email: "user@test.com",
      name: "Regular User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("adminDashboard.stats", () => {
  it("returns dashboard stats for admin users", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const stats = await caller.adminDashboard.stats();

    // Verify the structure of the returned stats
    expect(stats).toHaveProperty("bookings");
    expect(stats).toHaveProperty("leads");
    expect(stats).toHaveProperty("content");
    expect(stats).toHaveProperty("chat");
    expect(stats).toHaveProperty("users");
    expect(stats).toHaveProperty("recentActivity");

    // Verify booking stats structure
    expect(stats.bookings).toHaveProperty("total");
    expect(stats.bookings).toHaveProperty("new");
    expect(stats.bookings).toHaveProperty("confirmed");
    expect(stats.bookings).toHaveProperty("completed");
    expect(stats.bookings).toHaveProperty("cancelled");
    expect(stats.bookings).toHaveProperty("thisWeek");
    expect(stats.bookings).toHaveProperty("byService");
    expect(typeof stats.bookings.total).toBe("number");
    expect(Array.isArray(stats.bookings.byService)).toBe(true);

    // Verify lead stats structure
    expect(stats.leads).toHaveProperty("total");
    expect(stats.leads).toHaveProperty("new");
    expect(stats.leads).toHaveProperty("contacted");
    expect(stats.leads).toHaveProperty("booked");
    expect(stats.leads).toHaveProperty("closed");
    expect(stats.leads).toHaveProperty("lost");
    expect(stats.leads).toHaveProperty("urgent");
    expect(stats.leads).toHaveProperty("thisWeek");
    expect(stats.leads).toHaveProperty("bySource");
    expect(stats.leads).toHaveProperty("avgUrgency");
    expect(typeof stats.leads.avgUrgency).toBe("number");

    // Verify content stats structure
    expect(stats.content).toHaveProperty("totalArticles");
    expect(stats.content).toHaveProperty("published");
    expect(stats.content).toHaveProperty("drafts");
    expect(stats.content).toHaveProperty("activeNotifications");
    expect(stats.content).toHaveProperty("generationLogs");

    // Verify chat stats structure
    expect(stats.chat).toHaveProperty("totalSessions");
    expect(stats.chat).toHaveProperty("converted");
    expect(stats.chat).toHaveProperty("thisWeek");

    // Verify user stats structure
    expect(stats.users).toHaveProperty("total");
    expect(stats.users).toHaveProperty("admins");

    // Verify recent activity is an array
    expect(Array.isArray(stats.recentActivity)).toBe(true);

    // Verify numeric values are non-negative
    expect(stats.bookings.total).toBeGreaterThanOrEqual(0);
    expect(stats.leads.total).toBeGreaterThanOrEqual(0);
    expect(stats.content.totalArticles).toBeGreaterThanOrEqual(0);
    expect(stats.chat.totalSessions).toBeGreaterThanOrEqual(0);
    expect(stats.users.total).toBeGreaterThanOrEqual(0);
  });

  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(createNonAdminContext());
    await expect(caller.adminDashboard.stats()).rejects.toThrow();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.adminDashboard.stats()).rejects.toThrow();
  });
});

describe("adminDashboard.siteHealth", () => {
  it("returns site health info for admin users", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const health = await caller.adminDashboard.siteHealth();

    expect(health).toHaveProperty("domains");
    expect(health).toHaveProperty("sitemapPageCount");
    expect(health).toHaveProperty("totalBlogPosts");
    expect(health).toHaveProperty("hardcodedBlogPosts");
    expect(health).toHaveProperty("dynamicBlogPosts");
    expect(health).toHaveProperty("sheetsConfigured");

    expect(Array.isArray(health.domains)).toBe(true);
    expect(health.domains.length).toBeGreaterThan(0);
    expect(typeof health.sitemapPageCount).toBe("number");
    expect(health.sitemapPageCount).toBeGreaterThan(0);
    expect(health.totalBlogPosts).toBeGreaterThanOrEqual(health.hardcodedBlogPosts);
    expect(health.hardcodedBlogPosts).toBe(6);
  });

  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(createNonAdminContext());
    await expect(caller.adminDashboard.siteHealth()).rejects.toThrow();
  });
});

describe("adminDashboard stats consistency", () => {
  it("booking status counts sum to total", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const stats = await caller.adminDashboard.stats();

    const statusSum = stats.bookings.new + stats.bookings.confirmed +
      stats.bookings.completed + stats.bookings.cancelled;
    expect(statusSum).toBe(stats.bookings.total);
  });

  it("lead status counts sum to total", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const stats = await caller.adminDashboard.stats();

    const statusSum = stats.leads.new + stats.leads.contacted +
      stats.leads.booked + stats.leads.closed + stats.leads.lost;
    expect(statusSum).toBe(stats.leads.total);
  });

  it("recent activity items have valid types", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const stats = await caller.adminDashboard.stats();

    const validTypes = ["booking", "lead", "article", "chat"];
    for (const item of stats.recentActivity) {
      expect(validTypes).toContain(item.type);
      expect(typeof item.title).toBe("string");
      expect(typeof item.subtitle).toBe("string");
      expect(item.timestamp).toBeInstanceOf(Date);
    }
  });

  it("recent activity is sorted by timestamp descending", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const stats = await caller.adminDashboard.stats();

    for (let i = 1; i < stats.recentActivity.length; i++) {
      expect(stats.recentActivity[i - 1]!.timestamp.getTime())
        .toBeGreaterThanOrEqual(stats.recentActivity[i]!.timestamp.getTime());
    }
  });
});
