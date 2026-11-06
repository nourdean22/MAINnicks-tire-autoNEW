/**
 * Harness control (job 2026-11-06-harness-control-nick-node). Nour, 2026-11-06: "another session giving
 * control and ability to use the computers ... Add Nick (agent) to the multi-computer harness as a
 * connected node". The snapshot door stays read-only; this is a SEPARATE door with its own key.
 *
 * Pull, never push: a caller (a Claude session through scripts/agent-os/harness-run.mjs, or Nick through
 * runHarnessAction) queues a NAMED action for one PC; that PC's poller (scripts/agent-os/harness-poll.mjs,
 * a scheduled task Nour installs) claims it, runs the argv written for that name in
 * config/agent-os/harness-actions.json on its own checkout, and posts the result. bdnick never reaches a
 * PC, and no request field can carry a command: a compromised bdnick can at worst ask for an allowlisted
 * name. Benchmarked against Fleet's scripts (fleetdm.com/guides/scripts, read 2026-11-06): off by default,
 * the host agent opts in, queued work runs on the host's next check-in, output lands in an activity feed.
 *
 * Keys: HARNESS_CONTROL_KEY opens these doors and nothing else; the snapshot keys (DEVICE_AGENT_KEY,
 * STATENOUR_SYNC_KEY) never open them, and a control key equal to either is treated as unset (fail
 * closed), so one leaked snapshot key can never become remote execution.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { same } from "@/lib/security/evidence-ledger-auth";
import { HARNESS_PCS, type HarnessPcKey } from "@/lib/services/harness-status";
import { ServiceError } from "@/lib/utils/service-error";

const PC_KEYS = HARNESS_PCS.map((p) => p.key) as [HarnessPcKey, ...HarnessPcKey[]];
const ALL_PCS: readonly HarnessPcKey[] = PC_KEYS;

/**
 * Mirror of config/agent-os/harness-actions.json (the Docker build prunes the repo root, so the server
 * cannot read it). Names, PCs and needsGo only: the argv lives on the PC and nowhere else.
 * tests/services/harness-control.test.ts fails when the two drift.
 */
export const HARNESS_ACTIONS = {
  "pc-status": { pcs: ALL_PCS, needsGo: false, timeoutSec: 30, summary: "Free RAM, uptime, the heavy slot and the last harness-snapshot failure on this PC." },
  "harness-snapshot-now": { pcs: ALL_PCS, needsGo: false, timeoutSec: 120, summary: "Send this PC's read-only harness snapshot now instead of waiting for the 5-minute tick." },
  "bootstrap-check": { pcs: ALL_PCS, needsGo: false, timeoutSec: 120, summary: "Report what the machine bootstrap would change on this PC; changes nothing (--check)." },
  "health-line": { pcs: ALL_PCS, needsGo: false, timeoutSec: 60, summary: "The [health] line: code graph and its server, scheduled tasks, hooks, CLIs. Read-only." },
} as const satisfies Record<string, { pcs: readonly HarnessPcKey[]; needsGo: boolean; timeoutSec: number; summary: string }>;
export type HarnessActionName = keyof typeof HARNESS_ACTIONS;

/** A PC that is off when the action is queued: the request dies here instead of running hours later. */
export const HARNESS_ACTION_TTL_MS = 10 * 60_000;
/** A claimed action with no result this long after its own timeout reads LOST. */
const LOST_GRACE_MS = 2 * 60_000;
/** The biggest result the result door stores. The poller caps lower per PC class (8 KB on the 2-core PCs). */
export const HARNESS_OUTPUT_MAX = 16_384;
/** Request bodies are small by construction; anything bigger is refused before it is parsed. */
export const HARNESS_BODY_MAX = 32_768;

// ── The key ────────────────────────────────────────────────────────────

export type HarnessControlEnv = { HARNESS_CONTROL_KEY?: string; DEVICE_AGENT_KEY?: string; STATENOUR_SYNC_KEY?: string };

/** Pure, so the real decision is what the tests run. A short or reused control key opens nothing. */
export function harnessControlAccepts(presented: string, env: HarnessControlEnv): boolean {
  const key = env.HARNESS_CONTROL_KEY?.trim();
  if (!key || key.length < 32) return false;
  for (const other of [env.DEVICE_AGENT_KEY, env.STATENOUR_SYNC_KEY]) {
    const o = other?.trim();
    if (o && same(key, o)) return false;
  }
  return same(presented.trim(), key);
}

/** Its own header, never x-sync-key: a snapshot sender that sends its usual header presents nothing here. */
export function requireHarnessControl(req: Request): void {
  const env = {
    HARNESS_CONTROL_KEY: process.env.HARNESS_CONTROL_KEY,
    DEVICE_AGENT_KEY: process.env.DEVICE_AGENT_KEY,
    STATENOUR_SYNC_KEY: process.env.STATENOUR_SYNC_KEY,
  };
  if (!harnessControlAccepts(req.headers.get("x-harness-control-key") ?? "", env)) {
    throw new ServiceError("Unauthorized", 401);
  }
}

/** Reads a body with a hard size cap: Next does not cap route-handler bodies. */
export async function readCappedJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new ServiceError("Content-Type must be application/json.", 415);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > HARNESS_BODY_MAX) throw new ServiceError("Body too large", 413);
  const raw = await req.text();
  if (raw.length > HARNESS_BODY_MAX) throw new ServiceError("Body too large", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ServiceError("Invalid JSON body.", 400);
  }
}

// ── Shapes ─────────────────────────────────────────────────────────────

const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const pc = z.enum(PC_KEYS);
// Free text for the audit trail only. It is stored, shown fenced, and never parsed for a name.
const reason = z.string().max(200).optional();

// `from` is the caller's own PC, for the audit trail; the key, not this field, is what authorizes.
export const enqueueSchema = z.object({ pc, action: z.string().max(40), requestKey, reason, from: pc.optional() }).strict();
export const claimSchema = z.object({ pc }).strict();
export const resultSchema = z
  .object({
    id: z.string().min(1).max(40),
    pc,
    exitCode: z.number().int().min(-1).max(1_000_000).nullable(),
    output: z.string().max(HARNESS_OUTPUT_MAX),
    error: z.string().max(400).nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
  })
  .strict();

export type HarnessActionRow = {
  id: string;
  requestKey: string;
  pc: string;
  action: string;
  status: string;
  requestedBy: string;
  reason: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  exitCode: number | null;
  output: string | null;
  error: string | null;
  createdAt: Date;
};

export type HarnessActionView = {
  id: string;
  pc: string;
  action: string;
  /** QUEUED, CLAIMED, DONE, FAILED, or computed: EXPIRED (never claimed in time), LOST (claimed, no result). */
  state: "QUEUED" | "CLAIMED" | "DONE" | "FAILED" | "EXPIRED" | "LOST";
  requestedBy: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  output: string | null;
  error: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Pure: the stored status plus the clock gives the state a reader sees. */
export function harnessActionView(row: HarnessActionRow, now: Date = new Date()): HarnessActionView {
  const timeoutMs = ((HARNESS_ACTIONS as Record<string, { timeoutSec: number }>)[row.action]?.timeoutSec ?? 120) * 1000;
  let state = row.status as HarnessActionView["state"];
  if (row.status === "QUEUED" && row.expiresAt.getTime() <= now.getTime()) state = "EXPIRED";
  if (row.status === "CLAIMED" && row.claimedAt && now.getTime() - row.claimedAt.getTime() > timeoutMs + LOST_GRACE_MS) state = "LOST";
  return {
    id: row.id,
    pc: row.pc,
    action: row.action,
    state,
    requestedBy: row.requestedBy,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    claimedAt: iso(row.claimedAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    exitCode: row.exitCode,
    output: row.output,
    error: row.error,
  };
}

// ── The database seam ──────────────────────────────────────────────────

type Where = Record<string, unknown>;
/** The few calls this file makes, so the tests drive the real logic against a fake. */
export type HarnessDb = {
  harnessAction: {
    create(args: { data: Record<string, unknown> }): Promise<HarnessActionRow>;
    findUnique(args: { where: { id?: string; requestKey?: string } }): Promise<HarnessActionRow | null>;
    findFirst(args: { where: Where; orderBy: Record<string, "asc" | "desc"> }): Promise<HarnessActionRow | null>;
    findMany(args: { where?: Where; orderBy: Record<string, "asc" | "desc">; take: number }): Promise<HarnessActionRow[]>;
    updateMany(args: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  auditEvent: { create(args: { data: { actor: string; eventType: string; detail: string; payload?: object } }): Promise<unknown> };
};

async function defaultDb(): Promise<HarnessDb> {
  const { prisma } = await import("@/lib/prisma");
  return prisma as unknown as HarnessDb;
}

const prismaCode = (err: unknown) => (err as { code?: string } | null)?.code;

/** Prisma P2021: the table is not there yet. The doors answer 503 with the reason, never an empty list. */
export function isHarnessTableMissing(err: unknown): boolean {
  return prismaCode(err) === "P2021" || prismaCode(err) === "P2022";
}
const notMigrated = () => new ServiceError("Harness control is not migrated yet (20261106180000_harness_actions)", 503);

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isHarnessTableMissing(err)) throw notMigrated();
    throw err;
  }
}

/** The audit row is part of the action: if it cannot be written, the caller hears the failure. */
async function audit(db: HarnessDb, actor: string, eventType: string, detail: string, payload: object) {
  await db.auditEvent.create({ data: { actor: actor.slice(0, 60), eventType, detail: detail.slice(0, 300), payload } });
}

// ── The "anything queued?" hint ────────────────────────────────────────
// A PC polls every 60-120 s. Without this, each poll is a database read and Neon never sleeps (the
// worker keeps every waker at 15 min on purpose, #1696). shortcut: per-process memory, so a request
// queued on another replica waits for the next forced read; upgrade to a shared signal if bdnick ever
// runs more than one replica.
const HINT_RECHECK_MS = 5 * 60_000;
const queuedHint = new Map<string, boolean>();
const lastRead = new Map<string, number>();
export function resetHarnessHints() {
  queuedHint.clear();
  lastRead.clear();
}

// ── The writes ─────────────────────────────────────────────────────────

export type EnqueueInput = z.infer<typeof enqueueSchema> & { requestedBy: string };

/** The allowlist decision on identifying fields only: the name, the PC, the go flag. */
export function checkHarnessRequest(action: string, pcKey: string): { ok: true; name: HarnessActionName } | { ok: false; status: number; reason: string } {
  if (!Object.prototype.hasOwnProperty.call(HARNESS_ACTIONS, action)) {
    return { ok: false, status: 400, reason: `Unknown action "${action.slice(0, 40)}": only names in the allowlist run` };
  }
  const name = action as HarnessActionName;
  const entry = HARNESS_ACTIONS[name];
  if (!(entry.pcs as readonly string[]).includes(pcKey)) return { ok: false, status: 400, reason: `${name} is not allowed on ${pcKey}` };
  if (entry.needsGo) return { ok: false, status: 403, reason: `${name} needs Nour's go, and v1 has no approval path` };
  return { ok: true, name };
}

export async function enqueueHarnessAction(input: EnqueueInput, db?: HarnessDb, now: Date = new Date()) {
  const d = db ?? (await defaultDb());
  const check = checkHarnessRequest(input.action, input.pc);
  if (!check.ok) {
    await guarded(() => audit(d, input.requestedBy, "harness.action.refused", check.reason, { pc: input.pc, action: input.action.slice(0, 40) }));
    throw new ServiceError(check.reason, check.status);
  }
  return guarded(async () => {
    try {
      const row = await d.harnessAction.create({
        data: {
          requestKey: input.requestKey,
          pc: input.pc,
          action: check.name,
          status: "QUEUED",
          requestedBy: input.requestedBy.slice(0, 40),
          reason: input.reason ?? null,
          expiresAt: new Date(now.getTime() + HARNESS_ACTION_TTL_MS),
        },
      });
      await audit(d, input.requestedBy, "harness.action.queued", `${check.name} on ${input.pc}`, { id: row.id, pc: input.pc, action: check.name });
      queuedHint.set(input.pc, true);
      return { replayed: false, action: harnessActionView(row, now) };
    } catch (err) {
      if (prismaCode(err) !== "P2002") throw err;
      // A replayed request key: hand back the first row, never queue a second run.
      const first = await d.harnessAction.findUnique({ where: { requestKey: input.requestKey } });
      if (!first || first.pc !== input.pc || first.action !== check.name) {
        throw new ServiceError("That request key was already used for a different action", 409);
      }
      return { replayed: true, action: harnessActionView(first, now) };
    }
  });
}

/**
 * The PC takes its oldest live action. Compare-and-swap on the row it read (claim-before-act): two pollers
 * racing for one row both run the update, and only the one that still sees QUEUED gets count 1.
 */
export async function claimHarnessAction(pcKey: HarnessPcKey, db?: HarnessDb, now: Date = new Date()) {
  const last = lastRead.get(pcKey) ?? 0;
  if (!queuedHint.get(pcKey) && now.getTime() - last < HINT_RECHECK_MS) return null;
  const d = db ?? (await defaultDb());
  return guarded(async () => {
    lastRead.set(pcKey, now.getTime());
    const row = await d.harnessAction.findFirst({
      where: { pc: pcKey, status: "QUEUED", expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
    });
    if (!row) {
      queuedHint.set(pcKey, false);
      return null;
    }
    const won = await d.harnessAction.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: { status: "CLAIMED", claimedAt: now },
    });
    if (won.count !== 1) return null; // Another poller took it; the hint stays set, so the next poll looks again.
    await audit(d, `pc:${pcKey}`, "harness.action.claimed", `${row.action} on ${pcKey}`, { id: row.id });
    return { id: row.id, action: row.action, timeoutSec: (HARNESS_ACTIONS as Record<string, { timeoutSec: number }>)[row.action]?.timeoutSec ?? 120 };
  });
}

export type ResultInput = z.infer<typeof resultSchema>;

/** Only the PC that claimed the row, only once: a replayed or forged result changes nothing. */
export async function completeHarnessAction(input: ResultInput, db?: HarnessDb) {
  const d = db ?? (await defaultDb());
  return guarded(async () => {
    const status = input.exitCode === 0 && !input.error ? "DONE" : "FAILED";
    const res = await d.harnessAction.updateMany({
      where: { id: input.id, pc: input.pc, status: "CLAIMED" },
      data: {
        status,
        exitCode: input.exitCode,
        output: input.output.slice(0, HARNESS_OUTPUT_MAX),
        error: input.error,
        startedAt: new Date(input.startedAt),
        finishedAt: new Date(input.finishedAt),
      },
    });
    if (res.count !== 1) throw new ServiceError("No claimed action with that id for this PC", 409);
    await audit(d, `pc:${input.pc}`, "harness.action.finished", `${status} exit ${input.exitCode ?? "none"}`, { id: input.id, status, exitCode: input.exitCode });
    return { ok: true, status };
  });
}

// ── The reads ──────────────────────────────────────────────────────────

export async function readHarnessAction(id: string, db?: HarnessDb, now: Date = new Date()): Promise<HarnessActionView | null> {
  const d = db ?? (await defaultDb());
  return guarded(async () => {
    const row = await d.harnessAction.findUnique({ where: { id } });
    return row ? harnessActionView(row, now) : null;
  });
}

/** Throws on a failed read (a missing table included): the caller says "could not read", never "no actions". */
export async function listRecentHarnessActions(limit = 8, db?: HarnessDb, now: Date = new Date()): Promise<HarnessActionView[]> {
  const d = db ?? (await defaultDb());
  return guarded(async () => {
    const rows = await d.harnessAction.findMany({ orderBy: { createdAt: "desc" }, take: Math.max(1, Math.min(limit, 50)) });
    return rows.map((r) => harnessActionView(r, now));
  });
}

export const newRequestKey = () => `rk_${randomUUID().replace(/-/g, "")}`;
