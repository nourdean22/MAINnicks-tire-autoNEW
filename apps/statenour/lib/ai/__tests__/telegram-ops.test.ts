import { sendTelegramOpsAlert } from "../telegram-ops";
import { withTimeout } from "@nour/utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the dependencies
vi.mock("@nour/utils", () => ({
  withTimeout: vi.fn((promise: Promise<any>) => promise),
}));

global.fetch = vi.fn() as unknown as typeof fetch;

describe("Telegram Ops", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_OWNER_ID: "12345" };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should send clean prose successfully", async () => {
    const success = await sendTelegramOpsAlert("This is a clean alert.");
    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.text).toBe("This is a clean alert.");
  });

  it("should strip <think> blocks completely", async () => {
    const textWithThink = "<think>Wait, I should check the db first...\nAh yes, recall found.</think>Alert: NHTSA Recall matched!";
    const success = await sendTelegramOpsAlert(textWithThink);
    expect(success).toBe(true);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.text).toBe("Alert: NHTSA Recall matched!");
  });

  it("should strip multiline <think> blocks completely", async () => {
    const textWithThink = `
<think>
Line 1
Line 2
</think>
Actual content
`;
    const success = await sendTelegramOpsAlert(textWithThink);
    expect(success).toBe(true);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.text).toBe("Actual content");
  });

  it("should handle the 3-second hard timeout gracefully via withTimeout", async () => {
    await sendTelegramOpsAlert("Test timeout");
    expect(withTimeout).toHaveBeenCalledTimes(1);
    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 3000);
  });
});
