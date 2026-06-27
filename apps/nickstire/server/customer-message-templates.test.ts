import { describe, it, expect, vi, beforeEach } from "vitest";
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

const mockDb: any = {
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

describe("customer message templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder = null;
    mockExistingSms = [];
    mockExistingEmail = [];
    sentSmsParams = null;
    sentEmailParams = null;
    loggedActionParams = [];
    currentTableName = "";
    delete process.env.ENABLE_CUSTOMER_CONFIRMATIONS;
  });

  it("renders all five templates with order facts", () => {
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
