/**
 * The GPT bridge's /api/bridge/sms-campaign must NEVER send (audit F-20).
 *
 * docs/eval-rubrics/autonomous-action-tiers.md Tier 0: campaigns to >50
 * recipients never auto-execute. This route accepted `limit` up to 500 behind
 * one flat key and texted every match. It now creates a DRAFT campaign for the
 * operator to send from Winback → Campaigns.
 *
 * Canary shape: with dryRun:false, sendSms is never called, no customer row is
 * touched, and a draft campaign row is inserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";
import { readFileSync } from "node:fs";

const sendSms = vi.fn();
const execute = vi.fn();
const insertValues = vi.fn();
const sendTelegram = vi.fn(async () => true);
const isEnabled = vi.fn(async () => true);

vi.mock("./sms", () => ({
  sendSms: (...a: unknown[]) => sendSms(...a),
  withOptOut: (body: string) => `${body} Reply STOP to opt out.`,
}));
vi.mock("./services/telegram", () => ({ sendTelegram: (...a: unknown[]) => sendTelegram(...a) }));
vi.mock("./services/featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    execute: (...a: unknown[]) => execute(...a),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { $returningId: async () => [{ id: 4242 }] };
      },
    }),
  }),
}));

type Handler = (req: unknown, res: unknown) => Promise<void>;

async function captureRoute(path: string): Promise<Handler> {
  const routes = new Map<string, Handler>();
  const app = {
    post: (p: string, ...fns: Handler[]) => { routes.set(p, fns[fns.length - 1]); },
    get: (p: string, ...fns: Handler[]) => { routes.set(`GET ${p}`, fns[fns.length - 1]); },
    put: () => undefined,
    delete: () => undefined,
    use: () => undefined,
  };
  const { registerBridgeRoutes } = await import("./_core/bridge-routes");
  registerBridgeRoutes(app as never);
  const h = routes.get(path);
  if (!h) throw new Error(`route ${path} not registered`);
  return h;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

describe("bridge sms-campaign · prepares, never sends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue([[
      { id: 1, firstName: "A", lastName: "One", phone: "2165550101", vehicleMake: "Honda", vehicleModel: "Civic", vehicleYear: "2018" },
      { id: 2, firstName: "B", lastName: "Two", phone: "2165550102" },
    ]]);
  });

  it("dryRun:false creates a DRAFT campaign and calls sendSms ZERO times", async () => {
    const handler = await captureRoute("/api/bridge/sms-campaign");
    const res = fakeRes();
    await handler({ body: { dryRun: false, limit: 500, daysSince: 30 } }, res);

    expect(sendSms).not.toHaveBeenCalled();
    const updates = execute.mock.calls.filter((c) => JSON.stringify(c[0]).includes("UPDATE customers"));
    expect(updates).toHaveLength(0);
    // Two inserts: the draft row, then its EXACT audience as pending send rows.
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues.mock.calls[0][0]).toMatchObject({ status: "draft", template: "winback", targetCount: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "draft_created", sent: 0, draftCampaignId: 4242, previewTargetCount: 2, recipientsPersisted: 2 });
    expect((res.body as { adminUrl: string }).adminUrl).toMatch(/tab=campaigns/);
  });

  it("persists the matched customers as pending send rows — the draft's audience is exact, not a segment (Codex P1)", async () => {
    const handler = await captureRoute("/api/bridge/sms-campaign");
    const res = fakeRes();
    await handler({ body: { dryRun: false, limit: 10, daysSince: 30 } }, res);

    const rows = insertValues.mock.calls[1][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.customerId)).toEqual([1, 2]);
    expect(rows.every((r) => r.campaignId === 4242 && r.status === "pending")).toBe(true);
    expect(rows[0]).toMatchObject({ phone: "2165550101" });
    // Per-customer copy survives (vehicle line for the customer that has one) and the opt-out footer is applied.
    expect(String(rows[0].messageBody)).toMatch(/the work on your 2018 Honda Civic\./);
    // Customer B has no vehicle on file — no vehicle line ("on your next visits" is body copy, not the line).
    expect(String(rows[1].messageBody)).toMatch(/the work\. If we earned it/);
    expect(String(rows[1].messageBody)).not.toMatch(/the work on your/);
    expect(rows.every((r) => String(r.messageBody).endsWith("Reply STOP to opt out."))).toBe(true);
    // And still: nothing was sent.
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("campaigns.send uses the persisted audience when one exists, and only re-queries the segment when none does", () => {
    // Source contract (same style as campaignEmergencyStop.test.ts): the
    // pending-row check must come BEFORE the segment rebuild inside `send`.
    const src = readFileSync(new URL("./routers/campaigns.ts", import.meta.url), "utf8");
    // sliceBlock, not indexOf: a missing marker makes indexOf return -1, and
    // src.slice(-1, -1) is an EMPTY string that passes any `not.toMatch` and
    // fails any `toMatch` with a message about the wrong thing. Exactly that
    // happened when these procedures moved to dbAdminProcedure — the failure
    // read "expected -1 to be greater than -1" rather than "marker not found".
    // sliceBlock throws with the marker in the message instead.
    // `send` is dbAdminProcedure (it reads the audience, so it is guarded);
    // `recentSends` is still plain adminProcedure. Both spellings are passed as
    // candidate end markers so this does not break again the next time one of
    // them changes — sliceBlock takes the EARLIEST match.
    const sendBody = sliceBlock(
      src,
      "  send: dbAdminProcedure",
      ["  recentSends: dbAdminProcedure", "  recentSends: adminProcedure"],
      { label: "routers/campaigns.ts" },
    );
    const preloadedAt = sendBody.indexOf('eq(smsCampaignSends.status, "pending")');
    const segmentAt = sendBody.indexOf("getSegmentCustomers(campaign.segment");
    expect(preloadedAt).toBeGreaterThan(-1);
    expect(segmentAt).toBeGreaterThan(-1);
    expect(preloadedAt).toBeLessThan(segmentAt);
    expect(sendBody).toMatch(/audience: "persisted" as const/);
    expect(sendBody).toMatch(/audience: "segment" as const/);
  });

  it("dryRun:true still previews without inserting or sending", async () => {
    const handler = await captureRoute("/api/bridge/sms-campaign");
    const res = fakeRes();
    await handler({ body: { dryRun: true, limit: 10, daysSince: 30 } }, res);
    expect(sendSms).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ dryRun: true, targetCount: 2 });
  });

  it("the sms_blast_enabled kill switch still gates the draft path", async () => {
    isEnabled.mockResolvedValueOnce(false);
    const handler = await captureRoute("/api/bridge/sms-campaign");
    const res = fakeRes();
    await handler({ body: { dryRun: false, limit: 10, daysSince: 30 } }, res);
    expect(insertValues).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ sent: 0 });
  });
});
