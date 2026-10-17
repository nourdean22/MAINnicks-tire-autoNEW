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
  /** Parked-repair lane (2026-10-12): per-job rendered-QA script, keyed by job id. Empty = every job allowed. */
  qa: {} as Record<number, { persisted: Record<string, unknown> | null; fresh: Record<string, unknown>; freshRuns: number }>,
  /** Parked-repair lane: the active autonomy policy; null = the default (spend needs approval). */
  policy: null as null | Record<string, unknown>,
  /** Parked-repair lane: every paid beat repair the cron asked for. */
  repairCalls: [] as Array<Record<string, unknown>>,
  /** Parked-repair lane: the refusal the paid-repair boundary throws, or null = accept. */
  repairRefusal: null as null | string | Error,
  /** Parked-repair lane: makes the policy read throw, as an unreachable policy store does. */
  policyUnreadable: false,
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
  getActivePolicy: async () => {
    if (h.policyUnreadable) throw new Error("policy store unreachable");
    return h.policy ?? { version: 7, formatPermissions: { reel: "auto" } };
  },
}));

// The paid-repair writer. The real requestBeatRepair has its own suite; here the
// boundary is recorded and the queue entry is written the way the writer writes it,
// so the one-repair-per-day guard reads what production would have written. The
// verdict is flagged stale, as the writer flags it.
vi.mock("./services/selectiveRepair", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/selectiveRepair")>()),
  requestBeatRepair: async (input: { jobId: number; beatNumber: number; actor?: Record<string, unknown> }) => {
    h.repairCalls.push(input as Record<string, unknown>);
    if (h.repairRefusal) throw typeof h.repairRefusal === "string" ? new Error(h.repairRefusal) : h.repairRefusal; // the boundary refuses before any queue write
    const row = rowsOf(reelJobs).find((r) => r.id === input.jobId)!;
    const payload = JSON.parse(String(view(reelJobs, row)!.payload ?? "{}")) as { repairQueue?: unknown[] };
    const logicalRepairId = `rep_parked_${h.repairCalls.length}`;
    const entry = {
      logicalRepairId, beatNumber: input.beatNumber, state: "queued",
      requestedAt: new Date().toISOString(), attempts: [], previousClipUrl: null,
    };
    Object.assign(row, toDb(reelJobs, {
      status: "repair_queued",
      mp4Url: null,
      payload: JSON.stringify({ ...payload, repairQueue: [...(payload.repairQueue ?? []), entry] }),
    }));
    if (h.qa[input.jobId]) h.qa[input.jobId].persisted = { allowed: false, gate: "stale", findings: [], repairAttempts: 1, reason: "stale", source: "persisted" };
    return { jobId: input.jobId, beatNumber: input.beatNumber, logicalRepairId, state: "queued" };
  },
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
  // A job with no script passes, as before. A scripted job reads like production:
  // the read-only pre-filter sees the persisted verdict; a publish-door read runs
  // rendered QA, and that run persists its verdict.
  evaluateReelPublishGate: async (jobId: number, opts?: { runIfMissing?: boolean }) => {
    const script = h.qa[jobId];
    if (!script) return { allowed: true, gate: "approve", findings: [] };
    if (opts?.runIfMissing === false) {
      return script.persisted ?? { allowed: false, gate: "unavailable", findings: [], repairAttempts: 0 };
    }
    script.freshRuns++;
    script.persisted = script.fresh;
    return script.fresh;
  },
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

// ─── 2026-10-17 batch schedule: auto-approval reaches the drain's next picks ──
// The drain posts approved assembled jobs id ASC; auto-approval read only the
// NEWEST 25, so a 30-reel batch left the 5 oldest (the next to post) unapproved.
describe("auto-approval reaches the reels the drain posts first", () => {
  it("30 assembled unapproved reels: the oldest five are approved, and the newest still are", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => JOB + 100 + i);
    ids.forEach((id, i) => seedReel({ jobId: id, briefId: `inv-batch-${i}`, invStatus: "review_ready" }));
    // createdAt rises with id, as it does in production.
    for (const r of mem.tables[getTableConfig(reelJobs).name]) {
      const k = ids.indexOf(Number(r[reelJobs.id.name]));
      if (k >= 0) r[reelJobs.createdAt.name] = ts(-60 * 24 * 10 + k);
    }
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");

    const out = await autoApproveAssembledReels();

    expect(out.approved).toEqual(expect.arrayContaining(ids.slice(0, 5)));
    expect(out.approved).toEqual(expect.arrayContaining(ids.slice(-5)));
    expect(new Set(out.approved).size).toBe(out.approved.length); // each job approved once
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

// ─── PARKED REPAIR LANE (2026-10-12) · a parked reel never holds the day ────
// Job 2070009 parked on one BLOCK on 2026-10-12, so the lane posted nothing. The
// contract under test. A needs_paid_repair reel:
//   (a) gets exactly one beat repair when policy authorizes spend and one repair can
//       clear the BLOCK; the re-QA then runs on the re-render;
//   (b) still BLOCK after that repair: parks, and the next approved reel posts in the
//       same pulse;
//   (c) parks at once with no spend when the BLOCK is multi-beat, non-repairable, or
//       policy does not authorize spend;
//   (d) gets at most one repair per ET day, and never loops.
// The cron runs over real drizzle SQL. Only the rendered-QA verdict, the policy, the
// repair writer and Meta are seams.
describe("a needs_paid_repair reel parks and the day still posts (2026-10-12)", () => {
  const envKeys = ["REEL_AUTOPOST_ENABLED", "IG_SHADOW_JUDGE"] as const;
  const saved: Record<string, string | undefined> = {};
  const X = 9_870_101; // approved, assembled backlog reel that draws the BLOCK
  const Y = 9_870_102; // approved, assembled, clean: the next reel
  const X_URL = `https://cdn.example/reels/${X}.mp4`;
  const Y_URL = `https://cdn.example/reels/${Y}.mp4`;
  const AUTO = {
    version: 7,
    formatPermissions: { reel: "auto" },
    autonomousRepair: { paidBeatRegeneration: "auto" },
    limits: { maxRepairAttemptsPerAsset: 2 },
  };
  const REPAIRABLE = {
    storyboardBeats: [
      { beatNumber: 1, visual: "Extreme macro of a worn tire tread with a copper penny in the groove" },
      { beatNumber: 2, visual: "Extreme macro of a deep fresh groove, the copper coin settling between tall rubber walls" },
    ],
    promptPack: [{ beatNumber: 1, prompt: "p1" }, { beatNumber: 2, prompt: "p2" }],
  };
  const block = (beatNumber: number | null) => ({
    code: "MALFORMED_GEOMETRY", severity: "block", beatNumber, description: "x", preserve: [], change: [],
  });
  const verdict = (findings: unknown[], repairAttempts = 0) => ({
    allowed: false, gate: "needs_paid_repair", findings, repairAttempts, reason: "rendered BLOCK", source: "fresh",
  });
  const CLEAN = { allowed: true, gate: "proceed", findings: [], repairAttempts: 0, reason: "ok", source: "fresh" };
  const repairedOn = (requestedAt: string, beatNumber = 2) => ({
    logicalRepairId: "rep_earlier", beatNumber, state: "failed", requestedAt, attempts: [], previousClipUrl: null,
  });

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.REEL_AUTOPOST_ENABLED = "true";
    process.env.IG_SHADOW_JUDGE = "false";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T07:30:00Z")); // 03:30 ET: no enqueue, no slot wait
    h.qa = {};
    h.policy = null;
    h.repairCalls.length = 0;
    h.repairRefusal = null;
    h.policyUnreadable = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    h.repairRefusal = null;
    h.policyUnreadable = false;
    // h is shared by every describe in this file: leave no scripted QA, policy or repair state for the next one.
    h.qa = {};
    h.policy = null;
    h.repairCalls.length = 0;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** X (the BLOCK) and Y (clean) are both approved, assembled backlog reels. */
  function arrange(fresh: Record<string, unknown>, opts: { payload?: Record<string, unknown>; repairQueue?: unknown[] } = {}) {
    const xPayload = { ...(opts.payload ?? REPAIRABLE), ...(opts.repairQueue ? { repairQueue: opts.repairQueue } : {}) };
    seedReel({ jobId: X, briefId: "autopost-2026-09-20", invStatus: "review_ready", payload: xPayload });
    seedReel({ jobId: Y, briefId: "autopost-2026-09-21", invStatus: "review_ready", payload: { storyboardBeats: [{ onScreenText: "Why brakes squeal" }] } });
    for (const id of [X, Y]) Object.assign(jobRow(id)!, toDb(reelJobs, { createdAt: ts(-5) })); // fresh, so the stale-unavailable rule does not park them
    seedApproval(X);
    seedApproval(Y);
    h.qa[X] = { persisted: null, fresh, freshRuns: 0 }; // no verdict yet: the first read runs rendered QA
  }
  /** The pipeline re-renders and re-assembles the reel. The same mp4 comes back, so the approval still binds. */
  function reRender(id: number, url: string) {
    Object.assign(jobRow(id)!, toDb(reelJobs, { status: "assembled", mp4Url: url }));
  }

  it("(a) one single-beat pixel BLOCK queues exactly one beat repair, then re-QA runs on the re-render", async () => {
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1);
    expect(h.repairCalls[0]).toMatchObject({ jobId: X, beatNumber: 2, actor: { type: "cron" } });
    expect(h.publishCalls).toHaveLength(0);
    expect(job(X)!.status).toBe("repair_queued");

    h.qa[X].fresh = CLEAN; // the re-render passes re-QA
    reRender(X, X_URL);
    await runDailyReelPost();

    expect(h.qa[X].freshRuns).toBe(2); // re-QA ran on the re-render
    expect(h.repairCalls).toHaveLength(1); // and nothing spent a second time
    expect(h.publishCalls[0].videoUrl).toBe(X_URL);
  });

  it("(b) still BLOCK after that repair: the reel parks and the next approved reel posts in the same pulse", async () => {
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");
    await runDailyReelPost(); // pulse 1: the one repair
    reRender(X, X_URL); // pulse 2 re-QA still BLOCKs (fresh verdict unchanged)

    await runDailyReelPost();

    expect(h.qa[X].freshRuns).toBe(2);
    expect(h.repairCalls).toHaveLength(1); // no second spend
    expect(h.publishCalls).toHaveLength(1); // the lane still made its post attempt
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
    expect(job(X)!.status).toBe("assembled"); // parked: not published, not failed
    expect(job(Y)!.status).toBe("posted");
  });

  it("(c) a multi-beat BLOCK parks at once with no repair spend, and the next approved reel posts", async () => {
    arrange(verdict([block(1), block(2)]));
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0);
    expect(job(X)!.status).toBe("assembled");
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(c) a single BLOCK on a beat the executor refuses (declared real) parks with no spend", async () => {
    arrange(verdict([block(1)]), {
      payload: { ...REPAIRABLE, storyboardBeats: [{ beatNumber: 1, visual: "Extreme macro of a worn tread", source: "real" }, REPAIRABLE.storyboardBeats[1]] },
    });
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0);
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(c) under the default policy (spend needs approval) one BLOCK parks with no spend, and the next approved reel posts", async () => {
    arrange(verdict([block(2)]));
    // h.policy stays null: no autonomousRepair, so policy does not authorize paid repair.
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0);
    expect(job(X)!.status).toBe("assembled");
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(c) the paid-repair boundary refuses on the daily budget: the reel holds, nothing is queued, and nothing posts while the budget is spent", async () => {
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    h.repairRefusal = "BUDGET_DAILY_EXCEEDED: daily generation budget is spent";
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1); // asked once, refused by the boundary
    expect(JSON.parse(String(job(X)!.payload)).repairQueue ?? []).toHaveLength(0); // nothing queued, nothing spent
    expect(job(X)!.status).toBe("assembled"); // held, not repair_queued
    expect(h.publishCalls).toHaveLength(0); // a hold returns from the pass: a budget refusal holds, it does not park (F1 revised)
  });

  /** An approved, assembled reel with a verdict of its own and its own brief (one inventory row per brief). */
  function seedBacklogReel(id: number, fresh: Record<string, unknown>, briefId: string) {
    seedReel({ jobId: id, briefId, invStatus: "review_ready", payload: REPAIRABLE });
    Object.assign(jobRow(id)!, toDb(reelJobs, { createdAt: ts(-5) }));
    seedApproval(id);
    h.qa[id] = { persisted: null, fresh, freshRuns: 0 };
  }

  it("(i) a budget refusal holds the reel: it is not parked, nothing posts while the budget is spent, and once the budget allows the next pulse queues the repair", async () => {
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    h.repairRefusal = "BUDGET_DAILY_EXCEEDED: reserving $1.20 would put today at $9.00 > $10.00";
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1); // asked once, refused by the budget
    expect(h.publishCalls).toHaveLength(0); // a hold returns from the pass, so nothing posts
    expect(job(X)!.status).toBe("assembled"); // held, not repair_queued
    expect(approvals(X).every((a) => a.revokedAt === null)).toBe(true); // not retired: still approved

    h.repairRefusal = null; // the budget allows again
    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(2); // the same reel is re-evaluated and the repair is asked again
    expect(job(X)!.status).toBe("repair_queued");
  });

  it("(ii) the repair cap reached parks the reel with no spend, and the next approved reel posts", async () => {
    arrange(verdict([block(2)], 2)); // two repairs already count against the cap of 2
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0);
    expect(job(X)!.status).toBe("assembled"); // parked, not repair_queued
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(ii) the boundary's REPAIR_CAP denial parks the reel, and the next approved reel posts", async () => {
    const { AutonomyDenial } = await import("./services/autonomyControl");
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    h.repairRefusal = new AutonomyDenial(["REPAIR_CAP"], 7, "cron" as never);
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1); // asked, and refused by the cap
    expect(job(X)!.status).toBe("assembled"); // parked, not repair_queued
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(iii) a repair refused as already in flight parks the reel: the next approved reel posts, and the next pulse asks again", async () => {
    // A queued or rendering entry that never clears (a worker crash) refuses every pulse.
    // Holding on it would stop the lane every day, so this parks, it does not hold.
    arrange(verdict([block(2)]));
    h.policy = AUTO;
    h.repairRefusal = `job ${X} already has a repair in flight — one at a time`;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1);
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL); // the pass moved on to the clean reel
    expect(job(X)!.status).toBe("assembled"); // parked, not repair_queued
    expect(approvals(X).every((a) => a.revokedAt === null)).toBe(true);

    // The 06:00 slot is spent by Y, so the next pulse is the 18:00 ET slot.
    h.repairRefusal = null;
    vi.setSystemTime(new Date("2026-09-29T22:30:00Z")); // 18:30 ET
    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(2);
    expect(job(X)!.status).toBe("repair_queued");
  });

  it("(iv) an unreadable autonomy policy holds the reel: spend is not decided, nothing parks, and a readable policy on the next pulse queues the repair", async () => {
    arrange(verdict([block(2)]));
    h.policyUnreadable = true;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0);
    expect(h.publishCalls).toHaveLength(0); // held
    expect(job(X)!.status).toBe("assembled");

    h.policyUnreadable = false;
    h.policy = AUTO;
    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1);
    expect(job(X)!.status).toBe("repair_queued");
  });

  it("six needs_paid_repair reels ahead of one clean approved reel: the clean reel posts in the same pulse", async () => {
    arrange(verdict([block(2)])); // X is a seventh parked reel, Y the clean one
    h.policy = null; // default policy: a park needs no spend
    const parked = [9870051, 9870052, 9870053, 9870054, 9870055, 9870056];
    parked.forEach((id, i) => seedBacklogReel(id, verdict([block(2)]), `autopost-2026-09-0${i + 1}`));
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.publishCalls).toHaveLength(1);
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
    for (const id of parked) expect(job(id)!.status).toBe("assembled"); // parked, not published
  });

  it("a queued repair entry with no requestedAt still blocks today's repair", async () => {
    arrange(verdict([block(2)], 1), { repairQueue: [{ logicalRepairId: "rep_undated", beatNumber: 2, state: "failed", attempts: [], previousClipUrl: null }] });
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(0); // the undated entry counts as today's repair
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);
  });

  it("(d) a job already repaired today parks instead of buying a second repair, and never loops", async () => {
    arrange(verdict([block(2)], 1), { repairQueue: [repairedOn(new Date().toISOString())] });
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();
    expect(h.repairCalls).toHaveLength(0);
    expect(h.publishCalls[0].videoUrl).toBe(Y_URL);

    await runDailyReelPost(); // a later pulse does not spend either
    expect(h.repairCalls).toHaveLength(0);
  });

  it("(d) control: a repair requested on an earlier ET day does not block today's one repair", async () => {
    arrange(verdict([block(2)], 1), { repairQueue: [repairedOn("2026-09-28T12:00:00.000Z")] });
    h.policy = AUTO;
    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");

    await runDailyReelPost();

    expect(h.repairCalls).toHaveLength(1);
    expect(h.publishCalls).toHaveLength(0);
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
