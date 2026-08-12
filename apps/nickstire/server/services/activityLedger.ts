/**
 * Activity Ledger — attributed, diffable records for risky mutations.
 *
 * A thin opt-in layer over the existing audit_log table (via
 * services/auditTrail.ts). What it adds over the 29 manual logAdminAction call
 * sites: WHO-KIND attribution (human vs AI vs the voice receptionist vs an
 * unauthenticated visitor), sanitized before/after snapshots, and a
 * proposed-vs-executed status — the columns added by migration 0110.
 *
 * Wiring pattern (tRPC v11): attach BETWEEN .input() and .mutation() so the
 * middleware sees the parsed input —
 *
 *   publicProcedure
 *     .input(schema)
 *     .use((opts) => withActivityLedger(opts, {
 *       action: "lead.created",
 *       entityType: "lead",
 *       entityId: (_input, data) => (data as { leadId?: number }).leadId,
 *     }))
 *     .mutation(...)
 *
 * FAIL-SOFT, LOUD: a ledger write must never break the business mutation
 * (logAdminAction already guarantees this — it catches and logs). Until 0110
 * is hand-applied in production, inserts carrying the new columns fail and are
 * logged as errors while the mutation proceeds; that is the intended
 * degradation, not a silent one.
 *
 * PII: snapshots are sanitized before they land — phone-like keys keep the
 * last 4 digits, email-like keys keep the first character + domain
 * (PROTECTED-CORE rule 5: never log full customer phone numbers
 * unnecessarily).
 */
import { createLogger } from "../lib/logger";
import { logAdminAction, type AuditAction } from "./auditTrail";

const log = createLogger("activity-ledger");

export type ActorType = "human_user" | "ai_agent" | "nick_receptionist" | "public" | "system";

export interface LedgerActor {
  actor: string;
  actorType: ActorType;
}

/** Minimal slice of TrpcContext this module reads — kept structural so tests need no tRPC plumbing. */
export interface LedgerCtx {
  user?: { email?: string | null; name?: string | null } | null;
  isVoiceAgentInternal?: boolean;
}

export function deriveActor(ctx: LedgerCtx): LedgerActor {
  if (ctx.isVoiceAgentInternal === true) {
    return { actor: "nick-receptionist", actorType: "nick_receptionist" };
  }
  if (ctx.user) {
    return { actor: ctx.user.email ?? ctx.user.name ?? "admin", actorType: "human_user" };
  }
  return { actor: "public", actorType: "public" };
}

const PHONE_KEY = /phone|mobile|cell/i;
const EMAIL_KEY = /email/i; // pii-allow: key-name matcher that MASKS email values before they reach a ledger row — no PII here

export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••${digits.slice(-4)}`;
}

export function maskEmail(raw: string): string {
  const at = raw.indexOf("@");
  if (at <= 0) return "•••";
  return `${raw[0]}•••${raw.slice(at)}`;
}

/**
 * Key-based PII masking over a snapshot object (recursive, cycle-safe).
 * Values under phone-like keys keep their last 4 digits; email-like keys keep
 * first char + domain. Everything else passes through untouched.
 */
export function sanitizeSnapshot(
  snap: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!snap) return null;
  const seen = new WeakSet<object>();
  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === "string") {
      if (PHONE_KEY.test(key)) return maskPhone(value);
      if (EMAIL_KEY.test(key)) return maskEmail(value);
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return value;
  };
  return walk(snap, "") as Record<string, unknown>;
}

export interface RecordActivityInput {
  action: AuditAction;
  entityType: string;
  entityId: string | number | null | undefined;
  actor: LedgerActor;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  status?: "executed" | "proposed";
  idempotencyKey?: string | null;
  details?: string;
}

/**
 * Write one attributed ledger row. Never throws (logAdminAction catches all
 * failures internally and logs them).
 */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  const before = sanitizeSnapshot(input.before);
  const after = sanitizeSnapshot(input.after);
  await logAdminAction({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? "unknown",
    details: input.details ?? `${input.action} via activity ledger`,
    actor: input.actor.actor,
    actorType: input.actor.actorType,
    status: input.status ?? "executed",
    idempotencyKey: input.idempotencyKey ?? undefined,
    beforeJson: before,
    afterJson: after,
    // Legacy-reader compat: getAuditTrail / the admin Recent Actions UI render
    // the `changes` column, so mirror the snapshots there in the {old,new}
    // shape those readers already understand.
    ...(before || after ? { previousValue: before ? JSON.stringify(before) : undefined, newValue: after ? JSON.stringify(after) : undefined } : {}),
  });
}

export interface LedgerSpec<TInput = unknown, TData = unknown> {
  action: AuditAction;
  entityType: string;
  /** Extract the entity id from the parsed input and/or the mutation result. */
  entityId?: (input: TInput, data: TData) => string | number | null | undefined;
  /** Sanitized-later snapshot of the state the mutation produced. */
  after?: (input: TInput, data: TData) => Record<string, unknown> | null;
  /** Snapshot of the state before the mutation, when the call site knows it. */
  before?: (input: TInput) => Record<string, unknown> | null;
  idempotencyKey?: (input: TInput, data: TData) => string | null;
  /** Test seam: override the recorder. Production call sites leave it unset. */
  record?: (input: RecordActivityInput) => Promise<void>;
}

interface MiddlewareOpts<TCtx extends LedgerCtx, TRes> {
  ctx: TCtx;
  input?: unknown;
  next: () => Promise<TRes>;
}

/**
 * tRPC middleware body. Runs the mutation, then — only on success — records
 * one attributed ledger row. Failures of the mutation itself are already
 * logged by loggerMiddleware; failures of the LEDGER write are logged here and
 * never propagate. Generic over the middleware result so `.use((opts) =>
 * withActivityLedger(opts, spec))` returns exactly what the chain expects.
 */
export async function withActivityLedger<TCtx extends LedgerCtx, TRes, TInput = unknown, TData = unknown>(
  opts: MiddlewareOpts<TCtx, TRes>,
  spec: LedgerSpec<TInput, TData>,
): Promise<TRes> {
  const result = await opts.next();
  const outcome = result as { ok?: boolean; data?: unknown };
  if (outcome?.ok !== true) return result;
  try {
    const input = opts.input as TInput;
    const data = outcome.data as TData;
    const record = spec.record ?? recordActivity;
    await record({
      action: spec.action,
      entityType: spec.entityType,
      entityId: spec.entityId?.(input, data),
      actor: deriveActor(opts.ctx),
      before: spec.before?.(input) ?? null,
      after: spec.after?.(input, data) ?? null,
      status: "executed",
      idempotencyKey: spec.idempotencyKey?.(input, data) ?? null,
    });
  } catch (err) {
    // Belt over logAdminAction's own catch: a throwing extractor must not
    // break the mutation either.
    log.error("activity ledger record failed", {
      action: spec.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}
