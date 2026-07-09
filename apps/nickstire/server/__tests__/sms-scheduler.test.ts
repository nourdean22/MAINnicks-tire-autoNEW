import { describe, it, expect, vi, beforeEach } from "vitest";
import { processScheduledSms } from "../services/sms-scheduler";
import { getDb } from "../services/db";

// Mock dependencies
vi.mock("../services/db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../services/smsOrchestrator", () => ({
  orchestrateSms: vi.fn().mockResolvedValue({ status: "sent" }),
}));

vi.mock("../services/featureFlags", () => ({
  isEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/smsGateway", () => ({
  isShopGatewayReachable: vi.fn().mockResolvedValue(true),
}));

describe("SMS Scheduler CAS Lock Regression", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should prevent double-send races by using Check-And-Set (CAS) atomic updates", async () => {
    const mockUpdateCAS = vi.fn().mockResolvedValue([{ affectedRows: 0 }]); // Simulate lost race
    
    const mockDb = {
      update: vi.fn().mockImplementation(() => {
        return {
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockImplementation(() => mockUpdateCAS())
        };
      }),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        // dueReminders mock
        { id: 1, bookingId: 100, type: "24h-before", status: "processing" }
      ]),
    };

    (getDb as any).mockResolvedValue(mockDb);

    // Provide a booking mock
    mockDb.limit.mockResolvedValueOnce([
      { id: 1, bookingId: 100, type: "24h-before", status: "processing" }
    ]).mockResolvedValueOnce([
      // Booking mock
      { id: 100, phone: "2165551234", status: "confirmed", vehicleYear: "2020" }
    ]);

    const result = await processScheduledSms();
    
    // Because affectedRows was 0 (lost race), it should NOT orchestrate SMS
    const { orchestrateSms } = await import("../services/smsOrchestrator");
    expect(orchestrateSms).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
