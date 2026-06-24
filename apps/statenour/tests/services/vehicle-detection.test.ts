import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleVehicleEvent } from "@/lib/services/vehicle-detection";
import * as telegram from "@/lib/services/telegram";
import * as featureFlags from "@/lib/feature-flags";

// Mock Telegram service
vi.mock("@/lib/services/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof telegram>();
  return {
    ...actual,
    sendTelegramWithButtons: vi.fn().mockResolvedValue({ ok: true, messageId: 999123 }),
    editTelegramMessage: vi.fn().mockResolvedValue(true),
  };
});

// Mock feature flags
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof featureFlags>();
  return {
    ...actual,
    getFlag: vi.fn().mockReturnValue({ key: "NICK_ARRIVAL_INTELLIGENCE", isOn: true }),
  };
});

describe("Arrival Intelligence Ingest Pipeline", () => {
  const deviceId = "test-camera-outside";

  beforeEach(async () => {
    vi.clearAllMocks();

    // 1. Ensure test device exists in DB
    await prisma.smartDevice.upsert({
      where: { platformDeviceId: deviceId },
      create: {
        id: deviceId,
        name: "Test Shop Camera",
        platform: "V380",
        platformDeviceId: deviceId,
        deviceType: "CAMERA",
        location: "shop",
        status: "ONLINE",
      },
      update: {
        status: "ONLINE",
      },
    });

    // 2. Clean up previous test events
    await prisma.deviceEvent.deleteMany({
      where: { deviceId },
    });
  });

  it("should create new event and send Telegram alert on ENTERED_ZONE", async () => {
    const payload = {
      event: "vehicle_detected",
      source: "frigate",
      timestamp: new Date().toISOString(),
      data: {
        cameraId: deviceId,
        cameraName: "Test Shop Camera",
        zone: "front_lot",
        zoneName: "Front Lot",
        state: "ENTERED_ZONE",
        label: "car",
        confidence: 0.90,
        dwellSeconds: 0.0,
        trackId: "track-xyz-123",
        plate: { status: "NONE" },
      },
    };

    const eventId = await handleVehicleEvent(deviceId, payload);
    expect(eventId).toBeDefined();

    // Verify persisted in DB
    const dbEvent = await prisma.deviceEvent.findUnique({
      where: { id: eventId },
    });
    expect(dbEvent).toBeDefined();
    expect(dbEvent?.event).toBe("vehicle_detected");
    expect((dbEvent?.data as any).trackId).toBe("track-xyz-123");
    expect((dbEvent?.data as any).telegramMessageId).toBe("999123");

    // Verify Telegram triggered
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
  });

  it("should update existing event and edit Telegram message when trackId matches", async () => {
    // 1. Send initial event
    const payload1 = {
      event: "vehicle_detected",
      source: "frigate",
      timestamp: new Date().toISOString(),
      data: {
        cameraId: deviceId,
        cameraName: "Test Shop Camera",
        zone: "front_lot",
        zoneName: "Front Lot",
        state: "ENTERED_ZONE",
        label: "car",
        confidence: 0.90,
        dwellSeconds: 0.0,
        trackId: "track-xyz-123",
        plate: { status: "NONE" },
      },
    };
    const eventId1 = await handleVehicleEvent(deviceId, payload1);

    // 2. Send updated event (dwell confirm + plate resolved)
    const payload2 = {
      event: "vehicle_detected",
      source: "frigate",
      timestamp: new Date().toISOString(),
      data: {
        cameraId: deviceId,
        cameraName: "Test Shop Camera",
        zone: "front_lot",
        zoneName: "Front Lot",
        state: "CONFIRMED_ARRIVAL",
        label: "car",
        confidence: 0.94,
        dwellSeconds: 3.5,
        trackId: "track-xyz-123",
        plate: {
          status: "CANDIDATE",
          text: "ABC1234",
          normalizedText: "ABC1234",
          state: "OH",
          confidence: 0.88,
          provider: "mock",
        },
      },
    };
    
    const eventId2 = await handleVehicleEvent(deviceId, payload2);
    expect(eventId2).toBe(eventId1); // Should update the SAME record

    // Verify data updated in DB
    const dbEvent = await prisma.deviceEvent.findUnique({
      where: { id: eventId1 },
    });
    expect((dbEvent?.data as any).state).toBe("CONFIRMED_ARRIVAL");
    expect((dbEvent?.data as any).dwellSeconds).toBe(3.5);
    expect((dbEvent?.data as any).plate.text).toBe("ABC1234");

    // Verify Telegram message edit was triggered
    expect(telegram.editTelegramMessage).toHaveBeenCalledOnce();
    expect(telegram.editTelegramMessage).toHaveBeenCalledWith(
      999123,
      expect.stringContaining("ABC1234"),
      undefined,
      expect.any(Array)
    );
  });

  it("should respect cooldown and suppress Telegram alerts on rapid consecutive events", async () => {
    // 1. Send first event (will alert)
    const payload1 = {
      event: "vehicle_detected",
      source: "frigate",
      data: {
        cameraId: deviceId,
        zone: "front_lot",
        state: "CONFIRMED_ARRIVAL",
        trackId: "track-1",
      },
    };
    await handleVehicleEvent(deviceId, payload1);

    // 2. Clear calls to reset count
    vi.mocked(telegram.sendTelegramWithButtons).mockClear();

    // 3. Send second event with DIFFERENT trackId instantly (cooldown active)
    const payload2 = {
      event: "vehicle_detected",
      source: "frigate",
      data: {
        cameraId: deviceId,
        zone: "front_lot",
        state: "CONFIRMED_ARRIVAL",
        trackId: "track-2", // different vehicle
      },
    };
    const eventId2 = await handleVehicleEvent(deviceId, payload2);
    expect(eventId2).toBeDefined();

    // Verify event exists in DB
    const dbEvent2 = await prisma.deviceEvent.findUnique({
      where: { id: eventId2 },
    });
    expect(dbEvent2).toBeDefined();
    expect((dbEvent2?.data as any).telegramMessageId).toBeNull(); // No Telegram ID, throttled

    // Verify Telegram NOT called again
    expect(telegram.sendTelegramWithButtons).not.toHaveBeenCalled();
  });
});
