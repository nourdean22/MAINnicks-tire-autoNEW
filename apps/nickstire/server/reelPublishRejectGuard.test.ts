/**
 * audit-2026-09-29-F1 — three defects on the Instagram Reel publish path.
 *
 *   1. P0 · a reel REJECTED in the Queue was still auto-approved and published
 *      by the cron, and the confirmed-live mirror then overwrote "rejected"
 *      with "published" (erasing the operator's no).
 *   2. P1 · the Queue / Trial door never claimed reel_jobs, so the cron posted
 *      the same reel again; and it would publish a job already in flight.
 *   3. P1 · the Queue / Trial door sent no is_ai_generated for generated reels.
 *
 * Every layer is pinned on its own (positive-control-first: "a single
 * end-to-end assertion cannot tell you which layer holds").
 *
 * THE DATABASE IS REAL DRIZZLE over an in-memory MySQL subset: the code under
 * test builds its queries with the real mysql2 dialect, and the fake client
 * EVALUATES the generated WHERE clauses. A guard that is missing from the SQL
 * therefore changes the outcome here exactly as it would on TiDB — which a
 * hand-rolled `update().set().where()` stub (that ignores its where) cannot do.
 * Only true external boundaries are mocked: the Meta publish call, the
 * attempt ledger, the rendered-QA verdict, the originality corpus and the
 * autonomy policy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { mediaAssets, reelJobs, reelPublishApprovals, socialContentInventory } from "../drizzle/schema";

// ─── in-memory MySQL subset ────────────────────────────────────────────────
type Row = Record<string, unknown>;

const mem = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Array<Record<string, unknown>>>,
    nextId: 1000,
    /** Test hook, run BEFORE each statement executes (used to simulate a racing writer). */
    before: null as null | ((sql: string, params: unknown[]) => void),
    unsupported: [] as string[],
  };
  return state;
});

function col(tok: string): string {
  const m = tok.match(/`([^`]+)`$/);
  if (!m) throw new Error(`memmysql: not a column: ${tok}`);
  return m[1];
}

function same(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/** Recursive-descent WHERE evaluator for the shapes drizzle's mysql dialect emits. */
function compileWhere(src: string, params: unknown[], cursor: { i: number }): (r: Row) => boolean {
  const toks = src.match(/`[^`]+`(?:\.`[^`]+`)?|\?|\(|\)|,|<>|=|\bnot in\b|\bin\b|\bis not null\b|\bis null\b|\band\b|\bor\b|\S+/gi) ?? [];
  let p = 0;
  const peek = () => (toks[p] ?? "").toLowerCase();
  const take = (want?: string) => {
    const t = toks[p++];
    if (want && (t ?? "").toLowerCase() !== want) throw new Error(`memmysql: expected ${want} got ${t} in: ${src}`);
    return t;
  };
  const list = (): unknown[] => {
    take("(");
    const vals: unknown[] = [];
    while (peek() !== ")") {
      take("?");
      vals.push(params[cursor.i++]);
      if (peek() === ",") take(",");
    }
    take(")");
    return vals;
  };
  const atom = (): ((r: Row) => boolean) => {
    if (peek() === "(") {
      take("(");
      const e = or();
      take(")");
      return e;
    }
    const c = col(take()!);
    const op = peek();
    if (op === "=" || op === "<>") {
      take();
      take("?");
      const v = params[cursor.i++];
      return op === "=" ? (r) => same(r[c], v) : (r) => r[c] !== null && r[c] !== undefined && !same(r[c], v);
    }
    if (op === "in" || op === "not in") {
      take();
      const vals = list();
      return op === "in"
        ? (r) => vals.some((v) => same(r[c], v))
        : (r) => r[c] !== null && r[c] !== undefined && !vals.some((v) => same(r[c], v));
    }
    if (op === "is null") { take(); return (r) => r[c] === null || r[c] === undefined; }
    if (op === "is not null") { take(); return (r) => r[c] !== null && r[c] !== undefined; }
    throw new Error(`memmysql: unsupported operator ${op} in: ${src}`);
  };
  const and = () => {
    let f = atom();
    while (peek() === "and") { take(); const g = atom(); const h = f; f = (r) => h(r) && g(r); }
    return f;
  };
  const or = (): ((r: Row) => boolean) => {
    let f = and();
    while (peek() === "or") { take(); const g = and(); const h = f; f = (r) => h(r) || g(r); }
    return f;
  };
  const fn = or();
  if (p !== toks.length) throw new Error(`memmysql: trailing tokens in where: ${src}`);
  return fn;
}

async function memQuery(q: unknown, params: unknown[] = []): Promise<unknown> {
  const sql = (typeof q === "string" ? q : (q as { sql: string }).sql).trim();
  if (process.env.MEMSQL_DEBUG) console.log("SQL", sql.slice(0, 300), JSON.stringify(params).slice(0, 200));
  mem.before?.(sql, params);
  if (/^(begin|commit|rollback|savepoint|release savepoint|start transaction|set transaction)/i.test(sql)) return [{}];
  const cursor = { i: 0 };

  let m = sql.match(/^select (.+?) from `(\w+)`(?: where (.+?))?(?: order by (.+?))?(?: limit \?)?$/i);
  if (m && !/ join /i.test(sql)) {
    const cols = m[1].split(/,\s*/).map(col);
    const rows = mem.tables[m[2]] ?? [];
    const pred = m[3] ? compileWhere(m[3], params, cursor) : () => true;
    let out = rows.filter(pred);
    if (m[4]) {
      const keys = m[4].split(/,\s*/).map((k) => ({ c: col(k.replace(/\s+(asc|desc)$/i, "")), desc: /desc$/i.test(k) }));
      out = [...out].sort((a, b) => {
        for (const k of keys) {
          const x = String(a[k.c] ?? ""), y = String(b[k.c] ?? "");
          const n = typeof a[k.c] === "number" && typeof b[k.c] === "number" ? (a[k.c] as number) - (b[k.c] as number) : x < y ? -1 : x > y ? 1 : 0;
          if (n) return k.desc ? -n : n;
        }
        return 0;
      });
    }
    if (/ limit \?$/i.test(sql)) out = out.slice(0, Number(params[cursor.i++]));
    return [out.map((r) => cols.map((c) => (r[c] === undefined ? null : r[c])))];
  }

  m = sql.match(/^update `(\w+)` set (.+?)(?: where (.+))?$/i);
  if (m) {
    const sets = m[2].split(/,\s*(?=`)/).map((s) => {
      const [, c, rhs] = s.match(/^`(\w+)` = (\?|null)$/i) ?? [];
      if (!c) throw new Error(`memmysql: unsupported set: ${s}`);
      return { c, v: rhs === "?" ? params[cursor.i++] : null };
    });
    const pred = m[3] ? compileWhere(m[3], params, cursor) : () => true;
    let affectedRows = 0;
    for (const r of mem.tables[m[1]] ?? []) {
      if (!pred(r)) continue;
      for (const s of sets) r[s.c] = s.v;
      affectedRows++;
    }
    return [{ affectedRows }];
  }

  m = sql.match(/^insert into `(\w+)` \((.+?)\) values \((.+?)\)(?: on duplicate key update .*)?$/i);
  if (m) {
    const cols = m[2].split(/,\s*/).map(col);
    const vals = m[3].split(/,\s*/);
    const row: Row = {};
    cols.forEach((c, i) => { row[c] = vals[i] === "?" ? params[cursor.i++] : null; }); // `default` and `null` both store NULL (no column defaults are modelled)
    if (row.id === undefined || row.id === null) row.id = mem.nextId++;
    (mem.tables[m[1]] ??= []).push(row);
    return [{ affectedRows: 1, insertId: row.id }];
  }

  mem.unsupported.push(sql);
  throw new Error(`memmysql: unsupported SQL: ${sql.slice(0, 160)}`);
}

const memDb = drizzle({ query: memQuery } as never as Parameters<typeof drizzle>[0]);

// ─── module seams ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  publishCalls: [] as Array<Record<string, unknown>>,
  publishImpl: null as null | ((input: Record<string, unknown>) => Promise<unknown>),
  authorizedJobId: null as number | null,
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => memDb,
  getDbTyped: async () => memDb,
}));

vi.mock("./services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/adminSecurity")>()),
  getAdminSecurityState: async () => null,
}));

vi.mock("./services/autonomyControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/autonomyControl")>()),
  getActivePolicy: async () => ({ version: 7, formatPermissions: { reel: "auto" } }),
}));

// The Meta boundary. Nothing in this file may reach Instagram.
vi.mock("./services/socialPublish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/socialPublish")>()),
  publishToSocial: async (input: Record<string, unknown>) => {
    h.publishCalls.push(input);
    if (h.publishImpl) return h.publishImpl(input);
    return { results: [{ platform: "instagram", success: true, postId: "ig_live_1" }], igPostId: "ig_live_1" };
  },
}));

vi.mock("./services/publishAttemptLedger", () => ({
  OUTCOME: { confirmed: "confirmed", failed: "failed", ambiguous: "ambiguous" },
  recordPublishAttempt: async () => "attempt_1",
  recordPublishOutcome: async () => undefined,
}));

// The approval-integrity + rendered-QA authority is pinned by its own suite
// (reelPublishAuthority.test.ts); here it only supplies the resolved job id.
vi.mock("./services/reelPublishAuthority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/reelPublishAuthority")>()),
  authorizeReelPublish: async (_db: unknown, input: { draft: { id: string } }) => ({
    overrideBinding: null,
    approvalExpiresAt: null,
    reelJobId: h.authorizedJobId,
    gate: "allowed",
    draftId: input.draft.id,
  }),
}));

vi.mock("./services/qualityGate", () => ({
  evaluateReelPublishGate: async () => ({ allowed: true, gate: "approve", findings: [] }),
}));

vi.mock("./services/reelOriginality", () => ({ loadPublishedCorpus: async () => [] }));

vi.mock("./services/contentRun", () => ({
  RUN_STAGE: { held: "held", publishing: "publishing", done: "done" },
  OPERATIONAL_STATE: { ambiguous: "ambiguous", failed: "failed", published: "published", attempted: "attempted" },
  advanceContentRunByReelJobId: async () => undefined,
  markContentRunPublishedByInventory: async () => undefined,
}));

vi.mock("./services/metaSocial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/metaSocial")>()),
  getInstagramPermalink: async () => null,
}));

// ─── fixtures ──────────────────────────────────────────────────────────────
// Rows are stored under the REAL database column names, taken from the drizzle
// schema, so a fixture cannot silently disagree with the SQL the code emits.
type AnyTable = Parameters<typeof getTableConfig>[0];
function toDb(table: AnyTable, jsRow: Row): Row {
  const cfg = getTableConfig(table);
  const byKey = new Map<string, string>();
  for (const [key, c] of Object.entries(table as unknown as Record<string, { name?: string }>)) {
    if (c && typeof c === "object" && typeof c.name === "string" && cfg.columns.some((cc) => cc.name === c.name)) byKey.set(key, c.name);
  }
  const out: Row = {};
  for (const [k, v] of Object.entries(jsRow)) {
    const name = byKey.get(k);
    if (!name) throw new Error(`fixture: ${cfg.name} has no column for key ${k}`);
    out[name] = v;
  }
  return out;
}
function put(table: AnyTable, jsRow: Row) {
  (mem.tables[getTableConfig(table).name] ??= []).push(toDb(table, jsRow));
}
/** Read a stored row back through JS property names. */
function view(table: AnyTable, dbRow: Row | undefined): Row | undefined {
  if (!dbRow) return undefined;
  const out: Row = {};
  for (const [key, c] of Object.entries(table as unknown as Record<string, { name?: string }>)) {
    if (c && typeof c === "object" && typeof c.name === "string" && c.name in dbRow) out[key] = dbRow[c.name];
  }
  return out;
}
const JOB = 9_870_001;
const INV = "inv-f1-reel";
const GEN_CLIPS = JSON.stringify(["https://cdn.example/clips/hf_beat1.mp4"]);

function ts(offsetMin = 0): string {
  return new Date(Date.now() + offsetMin * 60_000).toISOString().replace("T", " ").replace("Z", "");
}

function seedReel(opts: {
  jobId?: number;
  briefId?: string;
  jobStatus?: string;
  invStatus?: string | null;
  payload?: Record<string, unknown>;
  clipUrlsJson?: string | null;
} = {}) {
  const jobId = opts.jobId ?? JOB;
  const briefId = opts.briefId ?? INV;
  put(reelJobs, {
    id: jobId,
    briefId,
    status: opts.jobStatus ?? "assembled",
    mp4Url: `https://cdn.example/reels/${jobId}.mp4`,
    caption: `Brake squeal explained ${jobId}`,
    clipUrlsJson: opts.clipUrlsJson === undefined ? GEN_CLIPS : opts.clipUrlsJson,
    payload: JSON.stringify(opts.payload ?? { storyboardBeats: [{ onScreenText: "Why brakes squeal" }] }),
    error: null,
    igPostId: null,
    createdAt: ts(-60 * 24 * 10),
  });
  if (opts.invStatus !== null) {
    put(socialContentInventory, {
      id: briefId,
      platform: "instagram",
      contentType: "reel",
      status: opts.invStatus ?? "review_ready",
      version: 2,
      hookText: "Brake squeal explained",
      briefJson: JSON.stringify({ selectedCaption: `Brake squeal explained ${jobId}`, hashtags: ["#brakes"], reelJobId: jobId }),
      assetPaths: JSON.stringify([`https://cdn.example/reels/${jobId}.mp4`]),
      errorMessage: null,
      publishedAt: null,
    });
  }
}

function seedApproval(jobId: number, over: Row = {}) {
  const j = job(jobId)!;
  put(reelPublishApprovals, {
    id: `appr-${jobId}-${approvals(jobId).length}`,
    reelJobId: jobId,
    captionSha: createHash("sha256").update(String(j.caption), "utf8").digest("hex"),
    videoUrl: j.mp4Url,
    approvedBy: "admin:1",
    approvedAt: ts(-60),
    expiresAt: ts(60 * 24),
    revokedAt: null,
    revokedBy: null,
    publishWindowStart: null,
    publishWindowEnd: null,
    assetSha256: null,
    ...over,
  });
}

const rowsOf = (t: AnyTable) => mem.tables[getTableConfig(t).name] ?? [];
/** LIVE handles: writes through them hit the stored row (used by the race hook). */
const invRow = (id = INV) => rowsOf(socialContentInventory).find((r) => r.id === id);
const jobRow = (id = JOB) => rowsOf(reelJobs).find((r) => r.id === id);
const inv = (id = INV) => view(socialContentInventory, invRow(id));
const job = (id = JOB) => view(reelJobs, jobRow(id));
const approvals = (id = JOB) => rowsOf(reelPublishApprovals).map((r) => view(reelPublishApprovals, r)!).filter((r) => String(r.reelJobId) === String(id));

async function adminCaller() {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller({
    user: {
      id: 101, openId: "admin-101", email: "admin-101@example.test", name: "Admin", loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never);
}

beforeEach(() => {
  mem.tables = {};
  mem.before = null;
  mem.unsupported = [];
  h.publishCalls.length = 0;
  h.publishImpl = null;
  h.authorizedJobId = JOB;
});

// ─── DEFECT 1 · layer (b): the confirmed-live mirror never erases a rejection ─
describe("markReelInventoryPublished never overwrites a rejected row", () => {
  it("POSITIVE CONTROL: a live reel whose draft was rejected leaves the row 'rejected', keeps the reason, and reports the conflict", async () => {
    seedReel({ invStatus: "rejected" });
    Object.assign(invRow()!, toDb(socialContentInventory, { errorMessage: "Manual Rejection" }));
    const { markReelInventoryPublished } = await import("./services/reelInventoryLink");

    const outcome = await markReelInventoryPublished(memDb as never, { briefId: INV, mp4Url: "https://cdn.example/x.mp4", caption: "c" });

    expect(outcome).toBe("conflict_rejected");
    expect(inv()!.status).toBe("rejected");
    expect(inv()!.errorMessage).toBe("Manual Rejection");
    expect(rowsOf(socialContentInventory)).toHaveLength(1); // no second row invented
  });

  it("control: a non-rejected row is still mirrored to published (the true case keeps working)", async () => {
    seedReel({ invStatus: "review_ready" });
    const { markReelInventoryPublished } = await import("./services/reelInventoryLink");
    expect(await markReelInventoryPublished(memDb as never, { briefId: INV })).toBe("updated");
    expect(inv()!.status).toBe("published");
  });
});

// ─── DEFECT 1 · layer (a): Reject withdraws the reel job's consent ───────────
describe("rejectDraft on a reel revokes its reel job's publish approval", () => {
  it("POSITIVE CONTROL: after Reject, the live approval is withdrawn and attributed", async () => {
    seedReel({ invStatus: "review_ready" });
    seedApproval(JOB);
    const caller = await adminCaller();

    const res = await caller.instagramAdmin.rejectDraft({ id: INV, reason: "Manual Rejection", expectedVersion: 2 });

    expect(inv()!.status).toBe("rejected");
    expect(approvals()[0].revokedAt).not.toBeNull();
    expect(String(approvals()[0].revokedBy)).toMatch(/rejected in Queue by admin:101/);
    expect(res).toMatchObject({ success: true, revokedApprovals: 1 });
  });
});

// ─── DEFECT 1 · layer (a'): auto-approval never re-approves a human "no" ─────
describe("auto-approval respects a human revocation and the inventory row", () => {
  it("POSITIVE CONTROL: a job whose approval a human REVOKED is reported approval_revoked and not re-approved", async () => {
    seedReel({ invStatus: "ready" });
    seedApproval(JOB, { revokedAt: ts(-5), revokedBy: "admin:101" });
    const { listReelPublishQueue } = await import("./services/reelApproval");
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");

    const { entries } = await listReelPublishQueue();
    expect(entries.find((e) => e.jobId === JOB)!.approvalProblem?.code).toBe("approval_revoked");

    const out = await autoApproveAssembledReels();
    expect(out.approved).not.toContain(JOB);
    expect(approvals().every((a) => a.revokedAt !== null)).toBe(true); // no fresh live row
  });

  it("POSITIVE CONTROL: a job whose Queue draft is rejected is never auto-approved, even with no approval history", async () => {
    seedReel({ invStatus: "rejected" });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");

    const out = await autoApproveAssembledReels();

    expect(out.approved).not.toContain(JOB);
    expect(out.skipped).toContainEqual({ jobId: JOB, why: "inventory_rejected" });
    expect(approvals()).toHaveLength(0);
  });

  it("control: a writer's own supersede is not a human no, and an unrejected reel is still auto-approved", async () => {
    seedReel({ invStatus: "review_ready" });
    seedApproval(JOB, { revokedAt: ts(-5), revokedBy: "superseded by admin:1" });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");

    const out = await autoApproveAssembledReels();

    expect(out.approved).toContain(JOB);
    expect(approvals().filter((a) => a.revokedAt === null)).toHaveLength(1);
  });
});

// ─── DEFECT 2 + 3: the Queue / Trial door ───────────────────────────────────
describe("publishPost (Queue / Trial) claims the reel job and owns the AI flag", () => {
  const publish = async (over: Record<string, unknown> = {}) =>
    (await adminCaller()).instagramAdmin.publishPost({
      inventoryId: INV,
      platforms: ["instagram"],
      caption: "client caption is ignored for reels",
      videoUrl: `https://cdn.example/reels/${JOB}.mp4`,
      isAiGenerated: false,
      ...over,
    } as never);

  it("POSITIVE CONTROL: a successful Queue publish moves the reel job to 'posted' with the media id", async () => {
    seedReel({ invStatus: "ready" });
    await publish();
    expect(h.publishCalls).toHaveLength(1);
    expect(job()!.status).toBe("posted");
    expect(job()!.igPostId).toBe("ig_live_1");
    expect(inv()!.status).toBe("published");
  });

  it("POSITIVE CONTROL: a job already in flight ('publishing') is refused before Meta is called", async () => {
    seedReel({ invStatus: "ready", jobStatus: "publishing" });
    await expect(publish()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/is 'publishing', not 'assembled'.*may already be LIVE/) });
    expect(h.publishCalls).toHaveLength(0);
    expect(inv()!.status).toBe("ready");
  });

  it("POSITIVE CONTROL: losing the reel-job claim to the cron hands the row back and publishes nothing", async () => {
    seedReel({ invStatus: "ready" });
    // The cron wins the race between this door's read and its claim.
    mem.before = (sql) => {
      if (/^update `social_content_inventory` set `status` = \?/.test(sql) && invRow()!.status === "ready") jobRow()!.status = "publishing";
    };
    await expect(publish()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.publishCalls).toHaveLength(0);
    expect(inv()!.status).toBe("ready");
    expect(job()!.status).toBe("publishing"); // the cron's claim is not disturbed
  });

  it("a confirmed post still lands as 'posted' when the stuck-claim sweeper parked a slow publish mid-flight", async () => {
    seedReel({ invStatus: "ready" });
    h.publishImpl = async () => {
      jobRow()!.status = "publish_ambiguous"; // reelPipeline's 12-minute sweeper fired during a slow Meta call
      return { results: [{ platform: "instagram", success: true, postId: "ig_slow_1" }], igPostId: "ig_slow_1" };
    };
    await publish();
    expect(job()!.status).toBe("posted");
    expect(job()!.igPostId).toBe("ig_slow_1");
  });

  it("a publish that THROWS parks the job publish_ambiguous, never back to assembled", async () => {
    seedReel({ invStatus: "ready" });
    h.publishImpl = async () => { throw new Error("socket hang up"); };
    await expect(publish()).rejects.toThrow(/socket hang up/);
    expect(job()!.status).toBe("publish_ambiguous");
  });

  it("POSITIVE CONTROL: Trial publish is refused when no reel job resolves", async () => {
    seedReel({ invStatus: "ready" });
    h.authorizedJobId = null;
    await expect(publish({ trialReel: { graduationStrategy: "MANUAL" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.publishCalls).toHaveLength(0);
  });

  it("POSITIVE CONTROL: AI disclosure comes from the job's clips and overrides the client's false", async () => {
    seedReel({ invStatus: "ready", clipUrlsJson: GEN_CLIPS });
    await publish({ isAiGenerated: false });
    expect(h.publishCalls[0].isAiGenerated).toBe(true);
  });

  it("control: stock-only clips publish without the AI flag even if the client claims true", async () => {
    seedReel({ invStatus: "ready", clipUrlsJson: JSON.stringify(["https://cdn.example/template-stock/a.mp4"]) });
    await publish({ isAiGenerated: true });
    expect(h.publishCalls[0].isAiGenerated).toBe(false);
  });

  it("POSITIVE CONTROL: the disclosure gate refuses generated footage whose on-screen text claims a real event", async () => {
    seedReel({ invStatus: "ready", payload: { storyboardBeats: [{ onScreenText: "This customer came in with grinding brakes" }] } });
    await expect(publish()).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Disclosure gate/) });
    expect(h.publishCalls).toHaveLength(0);
    expect(job()!.status).toBe("assembled");
  });
});

// ─── DEFECT 1 · layer (c): the cron holds a job whose inventory forbids it ───
describe("daily reel cron honours the inventory row", () => {
  const envKeys = ["REEL_AUTOPOST_ENABLED", "IG_SHADOW_JUDGE", "REEL_PUBLISH_ENABLED"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.REEL_AUTOPOST_ENABLED = "true";
    process.env.IG_SHADOW_JUDGE = "false";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T07:30:00Z")); // 03:30 ET — not the enqueue hour
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("POSITIVE CONTROL (gate chain): today's approved job with a REJECTED draft is held, not published", async () => {
    seedReel({ briefId: "autopost-2026-09-29", invStatus: "rejected" });
    seedApproval(JOB);
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    const res = await runDailyReelPost();

    expect(h.publishCalls).toHaveLength(0);
    expect(job()!.status).toBe("assembled");
    expect(String(res.details)).toMatch(/inventory is rejected/);
  });

  it("POSITIVE CONTROL (drain pre-filter): a rejected backlog job is skipped and the next approved reel publishes", async () => {
    const A = 9_870_010, B = 9_870_020;
    seedReel({ jobId: A, briefId: "autopost-2026-09-20", invStatus: "rejected" });
    seedReel({ jobId: B, briefId: "autopost-2026-09-21", invStatus: "review_ready" });
    seedApproval(A);
    seedApproval(B);
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.publishCalls).toHaveLength(1);
    expect(h.publishCalls[0].videoUrl).toBe(`https://cdn.example/reels/${B}.mp4`);
    expect(job(A)!.status).toBe("assembled");
    expect(inv("autopost-2026-09-20")!.status).toBe("rejected");
  });
});

// ─── The Queue reads the asset digest a bound approval needs (2026-10-08) ────
// listReelPublishQueue built its permit check without the candidate's asset
// digest, so every approval bound to one listed as asset_digest_unverifiable:
// the Queue showed approved reels as unapproved, and auto-approval logged the
// same code every pass (job 2040001 at 10:53Z, twenty minutes after it was
// auto-approved). The publish door (reelApprovalProblem) always loaded it.
describe("the Queue's approval verdict matches the publish door's", () => {
  const APPROVED = "a".repeat(64);
  const REPAIRED = "b".repeat(64);
  function seedAsset(sha: string, jobId = JOB) {
    put(mediaAssets, {
      id: `ma-${jobId}-${sha.slice(0, 4)}`,
      runtimeUrl: `https://cdn.example/reels/${jobId}.mp4`,
      checksumSha256: sha,
      createdAt: ts(-30),
    });
  }
  async function verdicts() {
    const { listReelPublishQueue, reelApprovalProblem } = await import("./services/reelApproval");
    const { entries } = await listReelPublishQueue();
    const queue = entries.find((e) => e.jobId === JOB)!.approvalProblem?.code ?? null;
    const door = (await reelApprovalProblem({ jobId: JOB, caption: String(job()!.caption), videoUrl: String(job()!.mp4Url) }))?.code ?? null;
    return { queue, door };
  }

  it("POSITIVE CONTROL: an approval bound to the bytes on file lists as approved", async () => {
    seedReel({ invStatus: "review_ready" });
    seedApproval(JOB, { assetSha256: APPROVED });
    seedAsset(APPROVED);
    expect(await verdicts()).toEqual({ queue: null, door: null });
  });

  it("bytes repaired after the approval list as asset_bytes_changed_since_approval, in both places", async () => {
    seedReel({ invStatus: "review_ready" });
    seedApproval(JOB, { assetSha256: APPROVED });
    seedAsset(REPAIRED);
    expect(await verdicts()).toEqual({ queue: "asset_bytes_changed_since_approval", door: "asset_bytes_changed_since_approval" });
  });

  it("with no digest on file, both still refuse: the bytes cannot be shown to be the approved ones", async () => {
    seedReel({ invStatus: "review_ready" });
    seedApproval(JOB, { assetSha256: APPROVED });
    expect(await verdicts()).toEqual({ queue: "asset_digest_unverifiable", door: "asset_digest_unverifiable" });
  });
});
