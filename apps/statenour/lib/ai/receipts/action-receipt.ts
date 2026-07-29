/**
 * Action receipts — a normalized "did it actually happen?" contract.
 *
 * Statenour already detects fabricated action claims reactively
 * (action-claim-detector + action-result-verifier + the chat_claim_warn chip).
 * This module adds the missing *positive* contract: a typed ActionReceipt that
 * a finalize summary can be checked against, so a side-effecting action whose
 * result isn't a verified success can never be summarized as "done".
 *
 * Reuses existing truth, does not duplicate it:
 *   · side-effecting-ness comes from the tool catalog (getToolMeta) for SDK
 *     tools, or MUTATION_ACTIONS for action blocks (task.create, etc.).
 *
 * Pure — no IO, no DB. LIVE: canClaimDone/toReceipt are wired into the
 * finalize seam at 4 call sites in lib/services/chat/persist-assistant-turn.ts
 * (2026-07-11 review corrected this header — it previously claimed "not yet
 * wired", which risked a future editor treating the path as dead).
 * See docs/runbooks/action-honesty-and-receipts.md.
 */

import { getToolMeta } from "@/lib/ai/tools/catalog";
import { MUTATION_ACTIONS } from "@/lib/ai/chat/action-result-verifier";

export type ReceiptStatus =
  | "success"
  | "failed"
  | "skipped"
  | "needs_approval"
  | "partial";

export interface ActionReceipt {
  receiptId: string;
  /** SDK tool name or action-block type (e.g. "createTask" or "task.create"). */
  toolName: string;
  /** Coarse category for grouping (from the catalog when known). */
  category: string;
  sideEffecting: boolean;
  /**
   * Could this tool's effect be CLASSIFIED at all? False when the tool
   * is absent from both the catalog and MUTATION_ACTIONS — we then know
   * neither that it writes nor that it is a pure read, so a done-claim
   * cannot rest on it (2026-07-29 fail-closed fix).
   *
   * Optional for backward compatibility: receipts built directly as
   * literals (e.g. the audited action-receipt feed) omit it and are
   * treated as verifiable — they already declare `sideEffecting`
   * explicitly, which is a stronger statement than inference.
   */
  verifiable?: boolean;
  status: ReceiptStatus;
  entityType?: string;
  entityId?: string;
  /** Short human label (e.g. the task title). */
  label?: string;
  /** What to tell the operator. Never claims success unless status === success. */
  userVisibleSummary: string;
  /** Sanitized error text when failed (no stack/secrets). */
  errorSafeMessage?: string;
  undoAvailable: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** Raw tool/action result the chat pipeline already has, pre-normalization. */
export interface RawActionResult {
  /** SDK tool name or action-block type. */
  toolName: string;
  /** Success flag (action blocks expose `success`). */
  ok?: boolean;
  error?: string;
  skipped?: boolean;
  needsApproval?: boolean;
  partial?: boolean;
  entityType?: string;
  entityId?: string;
  label?: string;
  undoAvailable?: boolean;
  /** Explicit override; otherwise inferred from the catalog / MUTATION_ACTIONS. */
  sideEffecting?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Does a tool/action mutate state Nick could falsely claim "done"?
 *
 * Broader than the catalog's `sideEffecting` flag (which is the narrow
 * "needs approval / external write" notion). For action honesty we also count
 * any `*_write` category (createTask, completeTask, pinMemory, journalDecision,
 * …) and every action-block MUTATION. Pure reads stay false.
 */
export type ToolEffectClass = "write" | "read" | "unknown";

/**
 * Three-state classification (2026-07-29). The boolean `isSideEffecting`
 * below could not distinguish "known pure read" from "never heard of
 * it", so both answered false — and an unrecognized tool that FAILED
 * was not an offender in `canClaimDone`, letting a "done" claim survive
 * a failed action. This function keeps the distinction the boolean lost;
 * `classifyToolEffect(x) === "unknown"` is what fails closed downstream.
 *
 * NOTE the deliberate asymmetry with the boolean: we do NOT relabel
 * unknown tools as side-effecting. Claiming an unproven write would be
 * its own fabrication — the honest statement is "unclassifiable", and
 * the guard treats unclassifiable as unprovable.
 */
export function classifyToolEffect(toolName: string): ToolEffectClass {
  if (MUTATION_ACTIONS.has(toolName)) return "write";
  const meta = getToolMeta(toolName);
  if (!meta) return "unknown";
  return meta.sideEffecting === true || meta.category.endsWith("_write") ? "write" : "read";
}

export function isSideEffecting(toolName: string): boolean {
  if (MUTATION_ACTIONS.has(toolName)) return true;
  const meta = getToolMeta(toolName);
  if (!meta) return false;
  return meta.sideEffecting === true || meta.category.endsWith("_write");
}

/** Tiny deterministic id (djb2) — no crypto import, stable for tests. */
function shortId(parts: Array<string | undefined>): string {
  const s = parts.map((p) => p ?? "").join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `rcpt_${h.toString(36)}`;
}

function categoryOf(toolName: string): string {
  return getToolMeta(toolName)?.category ?? (MUTATION_ACTIONS.has(toolName) ? "action-block" : "unknown");
}

function deriveStatus(
  r: RawActionResult,
  sideEffecting: boolean,
  verifiable: boolean,
): ReceiptStatus {
  if (r.needsApproval) return "needs_approval";
  if (r.skipped) return "skipped";
  if (r.error || r.ok === false) return "failed";
  if (r.partial) return "partial";
  if (r.ok === true) return "success";
  // No explicit signal. A KNOWN read returning is success; a side-effecting
  // tool — or one we cannot classify at all — is unverified (partial) so
  // canClaimDone stays conservative: never assert "done" without proof.
  return sideEffecting || !verifiable ? "partial" : "success";
}

const SUMMARY: Record<ReceiptStatus, (label: string) => string> = {
  success: (l) => `Done: ${l}.`,
  failed: (l) => `Did NOT complete: ${l}.`,
  skipped: (l) => `Skipped: ${l}.`,
  needs_approval: (l) => `Needs approval before it runs: ${l}.`,
  partial: (l) => `Unverified — ${l} may not have completed.`,
};

/** Strip anything that looks like a stack/path/secret from an error string. */
function safeError(error?: string): string | undefined {
  if (!error) return undefined;
  return error
    .split("\n")[0]
    .replace(/[A-Za-z]:\\[^\s]+/g, "<path>")
    .replace(/\/[^\s]+/g, "<path>")
    .slice(0, 200)
    .trim();
}

/** Normalize one raw result into a receipt. Handles unknown tools safely. */
export function toReceipt(r: RawActionResult, opts: { now?: string } = {}): ActionReceipt {
  const effect = classifyToolEffect(r.toolName);
  // An explicit caller-supplied flag is a stronger statement than
  // inference — it also makes the receipt verifiable by definition.
  const verifiable = r.sideEffecting !== undefined || effect !== "unknown";
  const sideEffecting = r.sideEffecting ?? effect === "write";
  const status = deriveStatus(r, sideEffecting, verifiable);
  const createdAt = opts.now ?? new Date().toISOString();
  const label = r.label || r.entityType || r.toolName;
  return {
    receiptId: shortId([r.toolName, r.entityId, status, createdAt, r.label]),
    toolName: r.toolName,
    category: categoryOf(r.toolName),
    sideEffecting,
    verifiable,
    status,
    entityType: r.entityType,
    entityId: r.entityId,
    label: r.label,
    userVisibleSummary: SUMMARY[status](label),
    errorSafeMessage: status === "failed" ? safeError(r.error) : undefined,
    undoAvailable: r.undoAvailable ?? false,
    metadata: r.metadata,
    createdAt,
  };
}

export interface ClaimDoneVerdict {
  ok: boolean;
  /** Side-effecting receipts that are NOT a verified success. */
  offenders: ActionReceipt[];
}

/**
 * The guard: can a summary honestly claim the work is done?
 *
 * False if any receipt that COULD have mutated state is not status
 * "success". Two families qualify:
 *   · known side-effecting tools (the original rule), and
 *   · receipts explicitly marked `verifiable: false` — a tool absent
 *     from the catalog and MUTATION_ACTIONS, where we know neither that
 *     it wrote nor that it was a pure read (fail-closed, 2026-07-29).
 *
 * KNOWN pure reads still never block, so an ordinary failed read cannot
 * produce a false "not done" banner — that containment is what made
 * this safe to flip.
 */
export function canClaimDone(receipts: ReadonlyArray<ActionReceipt>): ClaimDoneVerdict {
  const offenders = receipts.filter(
    (r) => (r.sideEffecting || r.verifiable === false) && r.status !== "success",
  );
  return { ok: offenders.length === 0, offenders };
}
