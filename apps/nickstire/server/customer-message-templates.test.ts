import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TEMPLATE_BUILDERS,
  sendCustomerMessage,
  type OrderMessageInput,
} from "./services/customerMessageTemplates";

// --- Mocks ---
let mockOrder: any = null;
let mockExistingSms: any[] = [];
let mockExistingEmail: any[] = [];
let currentTableName = "";
// C5.5 send_pause_customer_confirmations row, read by the real sendPause reader via execute.
let pauseMode: "off" | "paused" | "throw" = "off";

const mockDb: any = {
  execute: vi.fn().mockImplementation(async (q: unknown) => {
    if (pauseMode === "throw") throw new Error("connection refused");
    const isPauseRead = JSON.stringify(q).includes("send_pause_customer_confirmations");
    return [isPauseRead && pauseMode === "paused" ? [{ v: 1 }] : []];
  }),
  select: vi.fn().mockImplementation(() => {
    const builder = {
      from: vi.fn().mockImplementation((table) => {
        if (table) {
          currentTableName = table.name || table._meta?.name || table[Symbol.for('drizzle:Name')] || "";
        }
        return builder;
      }),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((limitVal) => {
        let result: any[] = [];
        if (currentTableName === "tire_orders") {
          result = mockOrder ? [mockOrder] : [];
        } else if (currentTableName === "sms_messages") {
          result = mockExistingSms;
        } else if (currentTableName === "audit_log") {
          result = mockExistingEmail;
        }
        currentTableName = "";
        return Promise.resolve(result);
      }),
    };
    return builder;
  }),
};

vi.mock("./db", () => ({
  getDbTyped: () => Promise.resolve(mockDb),
  getDb: () => Promise.resolve(mockDb),
}));

let sentSmsParams: any = null;
vi.mock("./sms", () => ({
  sendSms: vi.fn().mockImplementation((phone, body, opts) => {
    sentSmsParams = { phone, body, opts };
    return Promise.resolve({ success: true, sid: "sms_123" });
  }),
}));

let sentEmailParams: any = null;
vi.mock("./email-notify", () => ({
  sendNotification: vi.fn().mockImplementation((input) => {
    sentEmailParams = input;
    return Promise.resolve({ emailSent: true, pushSent: false, recipients: input.overrideTo, throttled: false });
  }),
}));

let loggedActionParams: any[] = [];
vi.mock("./services/auditTrail", () => ({
  logAdminAction: vi.fn().mockImplementation((data) => {
    loggedActionParams.push(data);
    return Promise.resolve();
  }),
}));

const ORDER: OrderMessageInput = {
  customerName: "Jane Doe",
  orderNumber: "TO-20260610-123",
  quantity: 4,
  tireBrand: "NEXEN",
  tireModel: "N'Priz AH5",
  tireSize: "215/60R16",
  totalAmount: 544.0,
};

const ORIG_ENABLE_CUSTOMER_CONFIRMATIONS = process.env.ENABLE_CUSTOMER_CONFIRMATIONS;

describe("customer message templates", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    pauseMode = "off";
    const { _resetSendPauseCacheForTest } = await import("./services/sendPause");
    _resetSendPauseCacheForTest();
    mockOrder = null;
    mockExistingSms = [];
    mockExistingEmail = [];
    sentSmsParams = null;
    sentEmailParams = null;
    loggedActionParams = [];
    currentTableName = "";
    delete process.env.ENABLE_CUSTOMER_CONFIRMATIONS;
  });

  // Tests mutate this flag; restore it after every test so it never leaks
  // into other files in singleFork serial mode.
  afterEach(() => {
    if (ORIG_ENABLE_CUSTOMER_CONFIRMATIONS === undefined) {
      delete process.env.ENABLE_CUSTOMER_CONFIRMATIONS;
    } else {
      process.env.ENABLE_CUSTOMER_CONFIRMATIONS = ORIG_ENABLE_CUSTOMER_CONFIRMATIONS;
    }
  });

  it("renders every template with order facts", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      const msg = build(ORDER);
      expect(msg.sms.length, `${key} sms`).toBeGreaterThan(20);
      expect(msg.email.subject).toContain("TO-20260610-123");
      expect(msg.email.body).toContain("Jane Doe");
      expect(msg.sms).toContain("(216) 862-0005");
    }
  });

  it("keeps SMS bodies in a sane length band", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      expect(build(ORDER).sms.length, `${key} sms length`).toBeLessThanOrEqual(320);
    }
  });

  it("never claims reservation or guaranteed stock (claim safety)", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      const msg = build(ORDER);
      const all = `${msg.sms} ${msg.email.subject} ${msg.email.body}`.toLowerCase();
      expect(all, `${key} must not say reserved`).not.toMatch(/\breserved\b/);
      expect(all, `${key} must not say guarantee(d)`).not.toMatch(/\bguaranteed?\b(?! until staff)/);
    }
  });

  it("payment template states payment does not reserve supplier stock", () => {
    const msg = TEMPLATE_BUILDERS.paymentReceived(ORDER);
    expect(msg.email.body).toContain("does not reserve supplier stock");
  });

  it("manual-lookup template promises no charge and no order yet", () => {
    const msg = TEMPLATE_BUILDERS.manualLookupReceived(ORDER);
    expect(msg.email.body).toContain("nothing is ordered or charged yet");
  });

  // 2026-10-18 · "Text me this quote" on the /tires top-pick cards (quoteTexted).
  describe("quoteTexted (the /tires quote-by-text)", () => {
    it("carries the tire, qty, installed set total, size, vehicle, a /tires link that reopens the result, Payment Programs and the shop phone", () => {
      const sms = TEMPLATE_BUILDERS.quoteTexted({ ...ORDER, vehicleInfo: "2019 Honda Civic LX" }).sms;
      expect(sms).toContain("Nick's Tire & Auto");
      expect(sms).toContain("4x NEXEN N'Priz AH5");
      expect(sms).toContain("215/60R16");
      expect(sms).toContain("2019 Honda Civic LX");
      expect(sms).toContain("$544.00 installed");
      expect(sms).toContain("https://nickstire.org/tires?size=215/60R16");
      expect(sms).toContain("Payment Programs");
      expect(sms).toContain("(216) 862-0005");
      expect(sms).not.toMatch(/financ/i);
      expect(sms).not.toContain("—");
      expect(sms.length).toBeLessThanOrEqual(320);
    });

    it("without a vehicle the text names the size only", () => {
      const sms = TEMPLATE_BUILDERS.quoteTexted({ ...ORDER, vehicleInfo: null }).sms;
      expect(sms).not.toMatch(/for your/);
      expect(sms).toContain("215/60R16");
    });

    it("the return link carries the size with spaces stripped, or no size when it is not size-shaped", () => {
      expect(TEMPLATE_BUILDERS.quoteTexted({ ...ORDER, tireSize: "215/60 r16 " }).sms).toContain("https://nickstire.org/tires?size=215/60R16 ");
      const odd = TEMPLATE_BUILDERS.quoteTexted({ ...ORDER, tireSize: "custom size, call" }).sms;
      expect(odd).toContain("https://nickstire.org/tires ");
      expect(odd).not.toContain("?size=");
    });
  });

  describe("sendCustomerMessage execution", () => {
    it("runs dry-run and does not send if ENABLE_CUSTOMER_CONFIRMATIONS is false", async () => {
      mockOrder = {
        customerName: "Jane Doe",
        orderNumber: "TO-123",
        quantity: 4,
        tireBrand: "NEXEN",
        tireModel: "N'Priz",
        tireSize: "215/60R16",
        totalAmount: 54400,
        customerPhone: "2168620005",
        customerEmail: "jane@example.com",
      };

      process.env.ENABLE_CUSTOMER_CONFIRMATIONS = "false";

      const res = await sendCustomerMessage("TO-123", "requestReceived");
      expect(res.dryRun).toBe(true);
      expect(res.smsSent).toBe(false);
      expect(res.emailSent).toBe(false);
      expect(sentSmsParams).toBeNull();
      expect(sentEmailParams).toBeNull();
    });

    it("sends SMS and Email when ENABLE_CUSTOMER_CONFIRMATIONS is true and not already sent", async () => {
      mockOrder = {
        customerName: "Jane Doe",
        orderNumber: "TO-123",
        quantity: 4,
        tireBrand: "NEXEN",
        tireModel: "N'Priz",
        tireSize: "215/60R16",
        totalAmount: 54400,
        customerPhone: "2168620005",
        customerEmail: "jane@example.com",
      };

      process.env.ENABLE_CUSTOMER_CONFIRMATIONS = "true";

      const res = await sendCustomerMessage("TO-123", "requestReceived");
      expect(res.dryRun).toBe(false);
      expect(res.smsSent).toBe(true);
      expect(res.emailSent).toBe(true);
      
      expect(sentSmsParams).not.toBeNull();
      expect(sentSmsParams.phone).toBe("2168620005");
      expect(sentSmsParams.opts.variantKey).toBe("confirm:requestReceived:TO-123");

      expect(sentEmailParams).not.toBeNull();
      expect(sentEmailParams.overrideTo).toEqual(["jane@example.com"]);
      expect(sentEmailParams.templateUsed).toBe("requestReceived");

      expect(loggedActionParams.length).toBe(2);
      expect(loggedActionParams[0].action).toBe("customer.sms_sent");
      expect(loggedActionParams[1].action).toBe("customer.email_sent");
    });

    const armedOrder = () => {
      mockOrder = {
        customerName: "Jane Doe", orderNumber: "TO-123", quantity: 4, tireBrand: "NEXEN", tireModel: "N'Priz",
        tireSize: "215/60R16", totalAmount: 54400, customerPhone: "2168620005", customerEmail: "jane@example.com",
      };
      process.env.ENABLE_CUSTOMER_CONFIRMATIONS = "true";
    };

    it("C5.5: armed but send_pause_customer_confirmations is ON -> the dry-run outcome, nothing sent", async () => {
      armedOrder();
      pauseMode = "paused";
      const res = await sendCustomerMessage("TO-123", "requestReceived");
      expect(res).toMatchObject({ smsSent: false, emailSent: false, dryRun: true });
      expect(res.smsOutcome).toBeUndefined();
      expect(sentSmsParams).toBeNull();
      expect(sentEmailParams).toBeNull();
      expect(loggedActionParams.length).toBe(0);
    });

    it("C5.5: an unreadable pause switch fails OPEN for this 1:1 lane -> sends as today", async () => {
      armedOrder();
      pauseMode = "throw";
      const res = await sendCustomerMessage("TO-123", "requestReceived");
      expect(res).toMatchObject({ smsSent: true, emailSent: true, dryRun: false, smsOutcome: "sent" });
    });

    it("reports the SMS outcome and hands the order's vehicle to the template", async () => {
      armedOrder();
      mockOrder.vehicleInfo = "2019 Honda Civic LX";
      mockOrder.customerEmail = null;
      const res = await sendCustomerMessage("TO-123", "quoteTexted");
      expect(res).toMatchObject({ smsSent: true, emailSent: false, dryRun: false, smsOutcome: "sent" });
      expect(sentSmsParams.body).toContain("2019 Honda Civic LX");
      expect(sentSmsParams.opts.messageClass).toBe("customer_confirmation");
      expect(sentSmsParams.opts.variantKey).toBe("confirm:quoteTexted:TO-123");
    });

    it("a refused send (opted out) is a failed outcome, reported once, never retried", async () => {
      armedOrder();
      const { sendSms } = await import("./sms");
      (sendSms as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ success: false, error: "Customer opted out of SMS" }));
      const res = await sendCustomerMessage("TO-123", "quoteTexted");
      expect(res).toMatchObject({ smsSent: false, smsOutcome: "failed" });
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(loggedActionParams.filter((a) => a.action === "customer.sms_sent")).toHaveLength(0);
    });

    it("a queued send (quiet hours) is reported as queued, not sent", async () => {
      armedOrder();
      const { sendSms } = await import("./sms");
      (sendSms as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ success: true, queued: true }));
      const res = await sendCustomerMessage("TO-123", "quoteTexted");
      expect(res).toMatchObject({ smsSent: false, smsOutcome: "queued" });
    });

    it("skips sending SMS/Email if already sent (idempotency)", async () => {
      mockOrder = {
        customerName: "Jane Doe",
        orderNumber: "TO-123",
        quantity: 4,
        tireBrand: "NEXEN",
        tireModel: "N'Priz",
        tireSize: "215/60R16",
        totalAmount: 54400,
        customerPhone: "2168620005",
        customerEmail: "jane@example.com",
      };

      mockExistingSms = [{ id: 999 }];
      mockExistingEmail = [{ id: "audit_123" }];
      process.env.ENABLE_CUSTOMER_CONFIRMATIONS = "true";

      const res = await sendCustomerMessage("TO-123", "requestReceived");
      expect(res.smsSent).toBe(false);
      expect(res.emailSent).toBe(false);
      expect(sentSmsParams).toBeNull();
      expect(sentEmailParams).toBeNull();
      expect(loggedActionParams.length).toBe(0);
    });
  });
});
