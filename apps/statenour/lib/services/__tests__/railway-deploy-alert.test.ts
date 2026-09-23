/**
 * POST /api/webhooks/railway/<token> — drives the REAL route + the REAL
 * ActionAttempt claim logic (lib/services/action-attempts.ts) over an in-memory
 * `actionAttempt` table that enforces the unique operation key (P2002) the way
 * Postgres does. Only Telegram, Prisma's client and the logger are faked.
 *
 * Fixture shape: docs.railway.com/observability/webhooks (read 2026-09-23).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = { id: string; operationKey: string; state: string; attemptNo: number; holdUntil: Date | null; [k: string]: unknown };

const h = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  let seq = 0;
  let down = false;
  const pick = (r: Row | undefined) => (r ? { ...r } : null);
  const actionAttempt = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (down) throw new Error("connect ECONNREFUSED");
      if ([...rows.values()].some((r) => r.operationKey === data.operationKey)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = { ...data, id: `att_${++seq}` } as Row;
      rows.set(row.id, row);
      return { id: row.id, attemptNo: row.attemptNo };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; operationKey?: string } }) =>
      pick(where.id ? rows.get(where.id) : [...rows.values()].find((r) => r.operationKey === where.operationKey)),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
      const r = rows.get(where.id as string);
      const same = r && r.attemptNo === where.attemptNo && r.state === where.state && (r.holdUntil?.getTime() ?? null) === ((where.holdUntil as Date | null)?.getTime() ?? null);
      if (!same) return { count: 0 };
      Object.assign(r!, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const r = rows.get(where.id)!;
      Object.assign(r, data);
      return { ...r };
    }),
  };
  const log: Record<string, unknown> = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  log.withSurface = () => log;
  log.withContext = () => log;
  return {
    rows,
    actionAttempt,
    log: log as { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> },
    sendTelegram: vi.fn(async (_text: string) => true),
    setDown: (v: boolean) => { down = v; },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { actionAttempt: h.actionAttempt } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: h.sendTelegram }));

import { POST } from "@/app/api/webhooks/railway/[token]/route";
import { classifyRailwayEvent, __resetRailwayAlertMemory } from "@/lib/services/railway-deploy-alert";

const TOKEN = "rw_test_token_0123456789abcdef0123";

const deployEvent = (status: string, overrides: Record<string, unknown> = {}) => ({
  type: `Deployment.${status}`,
  details: { id: "dep-1111", source: "GitHub", status: status.toUpperCase(), branch: "main", commitHash: "abcdef1234567", commitMessage: "fix · statenour · <b>thing</b>\nbody", commitAuthor: "x" },
  resource: {
    workspace: { id: "ws", name: "ws" },
    project: { id: "11111111-2222-3333-4444-555555555555", name: "natural-appreciation" },
    environment: { id: "66666666-7777-8888-9999-000000000000", name: "production", isEphemeral: false },
    service: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "nickstire" },
    deployment: { id: "8107edff-4b8e-44fc-b43a-04566e847a2a" },
  },
  severity: "WARNING",
  timestamp: "2026-09-23T12:00:00.000Z",
  ...overrides,
});

const call = (token: string, body: unknown) =>
  POST(
    new Request(`https://bdnick.info/api/webhooks/railway/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );

describe("POST /api/webhooks/railway/[token]", () => {
  const ORIGINAL = process.env.RAILWAY_WEBHOOK_TOKEN;
  beforeEach(() => {
    vi.clearAllMocks();
    h.rows.clear();
    h.setDown(false);
    h.sendTelegram.mockResolvedValue(true);
    __resetRailwayAlertMemory();
    process.env.RAILWAY_WEBHOOK_TOKEN = TOKEN;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RAILWAY_WEBHOOK_TOKEN;
    else process.env.RAILWAY_WEBHOOK_TOKEN = ORIGINAL;
  });

  it("env unset → 404 and nothing is sent (dormant receiver does not exist)", async () => {
    delete process.env.RAILWAY_WEBHOOK_TOKEN;
    const res = await call(TOKEN, deployEvent("failed"));
    expect(res.status).toBe(404);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("wrong token → 404, same body as unset; nothing is sent or claimed", async () => {
    const res = await call("rw_test_token_0123456789abcdef0124", deployEvent("failed"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.actionAttempt.create).not.toHaveBeenCalled();
  });

  it("a configured token shorter than 24 chars is treated as unset → 404 even when the path matches", async () => {
    process.env.RAILWAY_WEBHOOK_TOKEN = "short-token";
    const res = await call("short-token", deployEvent("failed"));
    expect(res.status).toBe(404);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("correct token + Deployment.failed → exactly one Telegram page, HTML-escaped, naming the service", async () => {
    const res = await call(TOKEN, deployEvent("failed"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "sent" });
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    const text = h.sendTelegram.mock.calls[0][0];
    expect(text).toContain("Railway deploy FAILED");
    expect(text).toContain("nickstire");
    expect(text).toContain("natural-appreciation (production)");
    expect(text).toContain("&lt;b&gt;thing&lt;/b&gt;"); // commit text cannot inject Telegram HTML
    expect(text).not.toContain("\nbody"); // first line of the commit message only
    expect([...h.rows.values()][0]).toMatchObject({ operationKey: "railway:deploy:8107edff-4b8e-44fc-b43a-04566e847a2a:FAILED", state: "SUCCEEDED_UNVERIFIED" });
  });

  it("duplicate delivery (Railway retry) → 200 duplicate, no second page", async () => {
    await call(TOKEN, deployEvent("failed"));
    const res = await call(TOKEN, deployEvent("failed"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "duplicate" });
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("the same deployment later CRASHING is a new (deployment, status) → pages again", async () => {
    await call(TOKEN, deployEvent("failed"));
    await call(TOKEN, deployEvent("crashed"));
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    expect(h.sendTelegram.mock.calls[1][0]).toContain("Railway deploy CRASHED");
  });

  it("Deployment.oom_killed (out of memory) pages like a crash", async () => {
    const res = await call(TOKEN, deployEvent("oom_killed"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "sent" });
    expect(h.sendTelegram.mock.calls[0][0]).toContain("Railway deploy OOM_KILLED");
    expect([...h.rows.values()][0].operationKey).toBe("railway:deploy:8107edff-4b8e-44fc-b43a-04566e847a2a:OOM_KILLED");
  });

  it.each(["success", "building", "deploying", "removed", "sleeping"])("non-failure Deployment.%s → ignored, no page, no claim", async (status) => {
    const res = await call(TOKEN, deployEvent(status));
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe("ignored");
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.actionAttempt.create).not.toHaveBeenCalled();
  });

  it("a failed deploy in an ephemeral (PR) environment → ignored", async () => {
    const e = deployEvent("failed");
    e.resource.environment.isEphemeral = true;
    const res = await call(TOKEN, e);
    expect((await res.json()).reason).toBe("ephemeral_environment");
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("Telegram undelivered → 502 so Railway retries, and the retry is allowed to page", async () => {
    h.sendTelegram.mockResolvedValueOnce(false);
    const first = await call(TOKEN, deployEvent("failed"));
    expect(first.status).toBe(502);
    expect([...h.rows.values()][0].state).toBe("FAILED");
    const retry = await call(TOKEN, deployEvent("failed"));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, action: "sent" });
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    expect([...h.rows.values()][0]).toMatchObject({ state: "SUCCEEDED_UNVERIFIED", attemptNo: 2 });
  });

  it("claim store down → still pages (fail-open), deduped in-process", async () => {
    h.setDown(true);
    const a = await call(TOKEN, deployEvent("failed"));
    const b = await call(TOKEN, deployEvent("failed"));
    expect(a.status).toBe(200);
    expect((await b.json()).action).toBe("duplicate");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith("railway_claim_store_unavailable", expect.anything());
  });

  it("legacy payload shape (type DEPLOY + status) still pages", async () => {
    const res = await call(TOKEN, { type: "DEPLOY", status: "CRASHED", project: { id: "p", name: "natural-appreciation" }, environment: { id: "e", name: "production" }, service: { id: "s", name: "statenour" }, deployment: { id: "dep-legacy" }, timestamp: "2026-09-23T12:00:00Z" });
    expect(res.status).toBe(200);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect([...h.rows.values()][0].operationKey).toBe("railway:deploy:dep-legacy:CRASHED");
  });

  it("a volume / monitor alert pages once per identical delivery", async () => {
    const alert = { type: "VolumeAlert.triggered", resource: deployEvent("failed").resource, severity: "CRITICAL", timestamp: "2026-09-23T12:05:00Z" };
    await call(TOKEN, alert);
    await call(TOKEN, alert);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram.mock.calls[0][0]).toContain("VolumeAlert.triggered");
  });

  it("invalid JSON after a valid token → 400, nothing sent", async () => {
    const res = await call(TOKEN, "{not json");
    expect(res.status).toBe(400);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("the token never appears in any log line or page", async () => {
    await call(TOKEN, deployEvent("failed"));
    await call("rw_wrong_token_0123456789abcdef0000", deployEvent("failed"));
    process.env.RAILWAY_WEBHOOK_TOKEN = "short";
    await call("short", deployEvent("failed"));
    const everything = JSON.stringify([h.log.warn.mock.calls, h.log.error.mock.calls, h.log.info.mock.calls, h.sendTelegram.mock.calls]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("rw_wrong_token");
  });
});

describe("classifyRailwayEvent (pure)", () => {
  it("never throws on hostile bodies", () => {
    for (const body of [null, 42, "x", [], { type: 7 }, { type: "Deployment.failed", resource: "nope" }]) {
      expect(() => classifyRailwayEvent(body, JSON.stringify(body))).not.toThrow();
    }
  });
  it("an unknown event type is ignored with its reason", () => {
    expect(classifyRailwayEvent({ type: "Something.else" }, "{}")).toMatchObject({ action: "ignore", reason: "unhandled_event_type" });
  });
});
