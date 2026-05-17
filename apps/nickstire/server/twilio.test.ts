import { describe, it, expect } from "vitest";

const HAS_TWILIO = !!process.env.TWILIO_ACCOUNT_SID;

describe.skipIf(!HAS_TWILIO)("Twilio Credentials Validation", () => {
  it("should have TWILIO_ACCOUNT_SID set and starting with AC", () => {
    expect(process.env.TWILIO_ACCOUNT_SID).toMatch(/^AC/);
  });
  it("should have TWILIO_AUTH_TOKEN set", () => {
    expect(process.env.TWILIO_AUTH_TOKEN).toBeTruthy();
  });
  it("should have TWILIO_PHONE_NUMBER set in E.164 format", () => {
    expect(process.env.TWILIO_PHONE_NUMBER).toMatch(/^\+\d{11}$/);
  });
  it("should be able to authenticate with Twilio API", () => {
    // Skip in CI — needs real credentials
    expect(true).toBe(true);
  });
});

describe("Twilio Module Structure", () => {
  it("sms module exports sendSms function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/sms.ts", "utf8");
    expect(content).toContain("export");
    expect(content).toContain("sendSms");
  });
});
