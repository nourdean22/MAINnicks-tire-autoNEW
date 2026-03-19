import { describe, it, expect } from "vitest";

describe("Twilio Credentials Validation", () => {
  it("should have TWILIO_ACCOUNT_SID set and starting with AC", () => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    expect(sid).toBeDefined();
    expect(sid).toBeTruthy();
    expect(sid!.startsWith("AC")).toBe(true);
  });

  it("should have TWILIO_AUTH_TOKEN set", () => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    expect(token).toBeDefined();
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("should have TWILIO_PHONE_NUMBER set in E.164 format", () => {
    const phone = process.env.TWILIO_PHONE_NUMBER;
    expect(phone).toBeDefined();
    expect(phone).toBeTruthy();
    // E.164: starts with + followed by digits
    expect(phone).toMatch(/^\+\d{10,15}$/);
  });

  it("should be able to authenticate with Twilio API", async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;

    // Call the Twilio API to verify credentials — just fetch account info
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      {
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        },
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sid).toBe(sid);
    expect(data.status).toBe("active");
  });
});
