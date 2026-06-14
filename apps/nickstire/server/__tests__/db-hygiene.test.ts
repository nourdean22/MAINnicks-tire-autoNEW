import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({
  leads: [] as any[],
  bookings: [] as any[],
  callbacks: [] as any[],
  deletes: [] as Array<{ table: string; id: number }>,
  updates: [] as Array<{ table: string; id: number; values: any }>,
  adminActions: [] as any[],
}));

const getTableName = (table: any) => {
  if (!table) return "";
  if (typeof table.tableName === "string") return table.tableName;
  const symbols = Object.getOwnPropertySymbols(table);
  const nameSymbol = symbols.find(s => s.toString().includes("drizzle:Name"));
  if (nameSymbol) return table[nameSymbol];
  const anyNameSymbol = symbols.find(s => s.toString().includes("Name"));
  if (anyNameSymbol) return table[anyNameSymbol];
  return "";
};

const getConditionId = (cond: any): number => {
  if (!cond) return 0;
  if (Array.isArray(cond.queryChunks)) {
    const param = cond.queryChunks.find((chunk: any) => 
      chunk && 
      typeof chunk.value !== "undefined" && 
      !Array.isArray(chunk.value)
    );
    if (param) return Number(param.value);
  }
  if (cond.right && typeof cond.right.value !== "undefined") {
    return Number(cond.right.value);
  }
  return 0;
};

vi.mock("../lib/db-helper", () => {
  return {
    db: vi.fn(async () => {
      return {
        select: vi.fn().mockImplementation(() => {
          return {
            from: vi.fn().mockImplementation((table) => {
              return {
                where: vi.fn().mockImplementation(() => {
                  const tableName = getTableName(table);
                  if (tableName === "leads") return h.leads;
                  if (tableName === "bookings") return h.bookings;
                  if (tableName === "callback_requests") return h.callbacks;
                  return [];
                })
              };
            })
          };
        }),
        delete: vi.fn().mockImplementation((table) => {
          return {
            where: vi.fn().mockImplementation((cond: any) => {
              const id = getConditionId(cond);
              h.deletes.push({ table: getTableName(table), id });
              return Promise.resolve();
            })
          };
        }),
        update: vi.fn().mockImplementation((table) => {
          return {
            set: vi.fn().mockImplementation((values) => {
              return {
                where: vi.fn().mockImplementation((cond: any) => {
                  const id = getConditionId(cond);
                  h.updates.push({ table: getTableName(table), id, values });
                  return Promise.resolve();
                })
              };
            })
          };
        })
      };
    })
  };
});

vi.mock("../services/auditTrail", () => {
  return {
    logAdminAction: vi.fn(async (payload) => {
      h.adminActions.push(payload);
      return { id: 1 };
    }),
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
  h.leads = [];
  h.bookings = [];
  h.callbacks = [];
  h.deletes = [];
  h.updates = [];
  h.adminActions = [];
  vi.clearAllMocks();
});

describe("Database Hygiene Router Tests", () => {
  describe("adminDashboard.dbCleanupScan", () => {
    it("should refuse access for non-admin users", async () => {
      const caller = appRouter.createCaller(userContext());
      await expect(caller.adminDashboard.dbCleanupScan()).rejects.toThrow();
    });

    it("should identify fake/test records and exclude voice agents", async () => {
      const caller = appRouter.createCaller(adminContext());

      // Setup mock records containing fake patterns
      h.leads = [
        { id: 101, name: "Test Lead", phone: "216-555-0199", problem: "Testing", status: "new", createdAt: new Date() },
        { id: 102, name: "John Doe", phone: "2165551212", problem: "This is a test message", status: "new", createdAt: new Date() },
        { id: 103, name: "Vapi Log", phone: "2165550000", problem: "[Voice-Agent] Real call inquiry", status: "new", createdAt: new Date() }, // should be excluded from fake
        { id: 104, name: "Real Cust", phone: "216-333-1122", problem: "Need tire patch", status: "new", createdAt: new Date() }, // should not be fake
      ];

      h.bookings = [
        { id: 201, name: "Jane Smith", phone: "111-111-1111", message: "Asdf", service: "Oil Change", status: "new", createdAt: new Date() }, // fake phone pattern
      ];

      h.callbacks = [
        { id: 301, name: "caller", phone: "123", context: "test", status: "new", createdAt: new Date() }, // fake name and short phone
      ];

      const result = await caller.adminDashboard.dbCleanupScan();

      // Verify fake leads identified
      const fakeLeads = result.fake.filter(f => f.table === "leads");
      expect(fakeLeads).toHaveLength(2);
      expect(fakeLeads.map(f => f.id)).toContain(101);
      expect(fakeLeads.map(f => f.id)).toContain(102);

      // Verify Vapi/Real leads NOT marked as fake
      expect(fakeLeads.map(f => f.id)).not.toContain(103);
      expect(fakeLeads.map(f => f.id)).not.toContain(104);

      // Verify name masking was applied
      const lead101 = fakeLeads.find(f => f.id === 101);
      expect(lead101.name).toBe("T. L."); // Test Lead -> T. L.
      expect(lead101.phone).toBe("***-***-0199");

      // Verify fake bookings identified
      const fakeBookings = result.fake.filter(f => f.table === "bookings");
      expect(fakeBookings).toHaveLength(1);
      expect(fakeBookings[0].id).toBe(201);

      // Verify fake callbacks identified
      const fakeCallbacks = result.fake.filter(f => f.table === "callbacks");
      expect(fakeCallbacks).toHaveLength(1);
      expect(fakeCallbacks[0].id).toBe(301);
    });

    it("should identify duplicate records within 24 hours", async () => {
      const caller = appRouter.createCaller(adminContext());
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      h.leads = [
        { id: 1, name: "Alice Smith", phone: "216-333-7788", problem: "Tire leak", status: "new", createdAt: now },
        { id: 2, name: "Alice Smith", phone: "216-333-7788", problem: "Tire leak again", status: "new", createdAt: twoHoursLater }, // Duplicate
        { id: 3, name: "Alice Smith", phone: "216-333-7788", problem: "Same person much later", status: "new", createdAt: twoDaysLater }, // NOT duplicate (>24h)
      ];

      const result = await caller.adminDashboard.dbCleanupScan();

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].id).toBe(2);
      expect(result.duplicates[0].details).toContain("Duplicate of Lead #1");
    });

    it("should identify stale records older than 90 days with status new", async () => {
      const caller = appRouter.createCaller(adminContext());
      const hundredDaysAgo = new Date();
      hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);

      h.leads = [
        { id: 10, name: "Arthur Pendragon", phone: "216-333-9000", problem: "Flat tire", status: "new", createdAt: hundredDaysAgo }, // Stale
        { id: 11, name: "Lancelot du Lac", phone: "216-333-9001", problem: "Oil leak", status: "contacted", createdAt: hundredDaysAgo }, // NOT stale (status !== new)
      ];

      const result = await caller.adminDashboard.dbCleanupScan();

      const staleLeads = result.stale.filter(s => s.table === "leads");
      expect(staleLeads).toHaveLength(1);
      expect(staleLeads[0].id).toBe(10);
    });
  });

  describe("adminDashboard.dbCleanupPrune", () => {
    it("should refuse access for non-admin users", async () => {
      const caller = appRouter.createCaller(userContext());
      await expect(
        caller.adminDashboard.dbCleanupPrune({
          fakeIds: [],
          duplicateIds: [],
          staleIds: []
        })
      ).rejects.toThrow();
    });

    it("should throw BAD_REQUEST if pruned item is not a valid candidate", async () => {
      const caller = appRouter.createCaller(adminContext());

      // Return empty candidate lists
      h.leads = [];
      h.bookings = [];
      h.callbacks = [];

      await expect(
        caller.adminDashboard.dbCleanupPrune({
          fakeIds: [{ id: 99, table: "leads" }],
          duplicateIds: [],
          staleIds: []
        })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Record ID 99 in table leads is not a valid candidate for fake cleanup."
        })
      );
    });

    it("should delete fake and duplicate entries, and archive stale ones", async () => {
      const caller = appRouter.createCaller(adminContext());
      const hundredDaysAgo = new Date();
      hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);

      // Setup scan candidates
      h.leads = [
        { id: 1, name: "Test Lead", phone: "555-0101", problem: "Test", status: "new", createdAt: new Date() }, // Fake
        { id: 2, name: "Alice Smith", phone: "216-333-1234", problem: "Brakes", status: "new", createdAt: new Date() },
        { id: 3, name: "Arthur Pendragon", phone: "216-333-9876", problem: "Clutch", status: "new", createdAt: hundredDaysAgo }, // Stale
      ];

      // Insert duplicate partner to trigger duplicate scan logic
      h.leads.push({
        id: 4, name: "Alice Smith", phone: "216-333-1234", problem: "Brakes", status: "new", createdAt: new Date(h.leads[1].createdAt.getTime() + 1000)
      });

      const prunePayload = {
        fakeIds: [{ id: 1, table: "leads" as const }],
        duplicateIds: [{ id: 4, table: "leads" as const }],
        staleIds: [{ id: 3, table: "leads" as const }]
      };

      const result = await caller.adminDashboard.dbCleanupPrune(prunePayload);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2); // Fake (1) + Duplicate (1)
      expect(result.archived).toBe(1); // Stale (1)

      // Verify database deletes executed
      expect(h.deletes).toHaveLength(2);
      expect(h.deletes.map(d => d.id)).toContain(1);
      expect(h.deletes.map(d => d.id)).toContain(4);
      expect(h.deletes.every(d => d.table === "leads")).toBe(true);

      // Verify database updates executed (archive)
      expect(h.updates).toHaveLength(1);
      expect(h.updates[0].id).toBe(3);
      expect(h.updates[0].table).toBe("leads");
      expect(h.updates[0].values.status).toBe("closed");

      // Verify audit log call occurred
      expect(h.adminActions).toHaveLength(1);
      expect(h.adminActions[0].action).toBe("database.hygiene_prune");
      expect(h.adminActions[0].details).toContain("deleted 2 records, archived/closed 1 stale records");
      expect(h.adminActions[0].actor).toBe("admin@nickstire.com");
    });
  });
});
