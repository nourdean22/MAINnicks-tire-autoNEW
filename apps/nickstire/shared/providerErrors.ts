/**
 * Provider failure taxonomy — what went wrong decides what to do about it.
 *
 * THE DEFECT THIS REPLACES
 * The reel worker caught every error, incremented `attempts`, and sent the job
 * back to `queued` until MAX_ATTEMPTS. One policy for every cause means:
 *
 *   - a permanently safety-blocked prompt is resubmitted twice more, unchanged,
 *     burning two more paid submissions to be rejected identically
 *   - an expired API key looks like a flaky provider and quietly exhausts the
 *     retry budget instead of paging the operator
 *   - a rate limit consumes a retry that should have been a wait
 *   - a LOCAL timeout — where the remote job may still be RUNNING and may still
 *     bill — is retried, which is how you pay twice for one clip
 *
 * Pure by design (no DB, no network) so each rule is a test rather than a claim.
 */

/** What actually failed. Ordered roughly cheapest-to-recover first. */
export type ProviderErrorClass =
  /** Connection reset, DNS, socket hang-up. Retry. */
  | "TRANSIENT_NETWORK"
  /** HTTP 429 / explicit quota-per-minute. Wait, don't burn an attempt. */
  | "RATE_LIMIT"
  /** 401/403, expired or revoked key. No retry will fix this. */
  | "AUTH_INVALID"
  /** Credits or billing quota exhausted. Operator must top up. */
  | "QUOTA_OR_CREDIT"
  /** Malformed request — unsupported param, bad aspect ratio, bad duration. */
  | "PROMPT_INVALID"
  /** Content policy rejected the prompt. Resubmitting it unchanged cannot pass. */
  | "SAFETY_POLICY_PERMANENT"
  /** The remote operation ran and terminated as failed. A NEW op is allowed. */
  | "REMOTE_FAILED"
  /** We stopped polling; the op id is known, so the SAME op can be resumed. */
  | "LOCAL_TIMEOUT_REMOTE_RUNNING"
  /** We stopped polling and have NO op handle. May still be running and billing. */
  | "LOCAL_TIMEOUT_REMOTE_UNKNOWN"
  /** Download, ffmpeg, or storage — deterministic, not the generator's fault. */
  | "STORAGE_OR_ASSEMBLY"
  /** Unrecognised. Treated conservatively. */
  | "UNKNOWN";

export type RecoveryAction =
  /** Retry on a later pulse; consumes one attempt. */
  | "RETRY_BACKOFF"
  /** Retry, but do NOT consume an attempt — the work never started. */
  | "RETRY_WITHOUT_CONSUMING_ATTEMPT"
  /** Stop using this provider until a human intervenes. */
  | "PAUSE_PROVIDER"
  /** Rebuild provider-safe wording from the UNCHANGED claim, then retry. */
  | "REGENERATE_PROMPT"
  /** Resume the same remote operation; never submit a new one. */
  | "RESUME_OPERATION"
  /** Check provider history/credits for a completed op BEFORE paying again. */
  | "RECONCILE_BEFORE_RETRY"
  /** Repair inputs locally; regenerating clips would waste money. */
  | "REPAIR_WITHOUT_REGENERATING"
  /** Park it. */
  | "FAIL_TERMINAL";

export interface ProviderErrorVerdict {
  errorClass: ProviderErrorClass;
  action: RecoveryAction;
  /** False when a retry must not count against MAX_ATTEMPTS. */
  consumesAttempt: boolean;
  /** True when another identical submission could be billed again. */
  mayDoubleSpend: boolean;
  /** Operator-facing reason. */
  reason: string;
}

export interface ClassifyContext {
  /** A known remote operation handle makes a timeout resumable rather than ambiguous. */
  hasRemoteOperationId?: boolean;
  /** Set by reelPipeline's LocalTimeoutError tag. */
  isLocalTimeout?: boolean;
}

/**
 * Patterns are matched against the message text providers actually return.
 * Order matters: the most specific and most expensive-to-get-wrong go first, so
 * a safety block is never demoted to a generic retry.
 */
const PATTERNS: Array<{ cls: ProviderErrorClass; re: RegExp }> = [
  // Google RAI / Veo policy, Higgsfield moderation, OpenAI-style refusals.
  { cls: "SAFETY_POLICY_PERMANENT", re: /\b(safety|content[_ ]policy|policy[_ ]violation|blocked by|responsible ?ai|rai[_ ]?filter|moderation|prohibited[_ ]content|violates)\b/i },
  { cls: "AUTH_INVALID", re: /\b(401|403|unauthori[sz]ed|forbidden|invalid[_ ]api[_ ]key|api[_ ]key[_ ]not[_ ]valid|permission[_ ]denied|expired[_ ]token|authentication[_ ]failed|hf auth login)\b/i },
  // A PLAN-TIER wall belongs here, not in RATE_LIMIT, and the difference is
  // money. Observed in prod 2026-08-04, reel job #1380001:
  //   {"modal_data":{"elapsed_days":2},"type":"unlock_full_access_notice",
  //    "error_type":"grace_daily_limit_reached"}
  // None of the patterns below matched it — no "billing", no "exhausted", and
  // no "rate" for RATE_LIMIT — so it fell through to UNKNOWN, whose policy is
  // RETRY_BACKOFF. The daily reel cron therefore re-attempted every day,
  // logging "unrecognised failure — treated as transient", and NOTHING alerted:
  // the operator noticed only because reels stopped appearing on Instagram.
  //
  // It must NOT be RATE_LIMIT. That class is RETRY_WITHOUT_CONSUMING_ATTEMPT,
  // built for a request refused before work began that clears on its own. A
  // grace-tier daily cap does not clear by waiting minutes and cannot be
  // retried out of — it needs the operator to upgrade the plan. QUOTA_OR_CREDIT
  // is PAUSE_PROVIDER, which stops the spend and raises a human. That is the
  // correct direction even though credits may remain: a balance is not
  // permission to generate.
  // A PLAN-TIER wall — kept as its own entry rather than bolted onto the
  // credit regex below, for a reason worth writing down: `_` is a WORD
  // character, so a trailing `\b` never fires inside an underscore-joined
  // token. `\bgrace[_ ]daily[_ ]limit\b` does NOT match
  // "grace_daily_limit_reached", because the boundary it wants sits between
  // `limit` and `_reached` where both sides are word characters. The first
  // draft of this fix did exactly that and the test caught it.
  { cls: "QUOTA_OR_CREDIT", re: /(grace[_ -]?daily[_ -]?limit|daily[_ -]?limit[_ -]?reached|unlock[_ -]?full[_ -]?access|upgrade[_ -]?required|trial[_ -]?expired|subscription[_ -]?required|plan[_ -]?limit)/i },
  { cls: "QUOTA_OR_CREDIT", re: /\b(quota[_ ]exceeded|insufficient[_ ](credits?|funds|balance)|out of credits|billing|payment[_ ]required|402|exhausted)\b/i },
  { cls: "RATE_LIMIT", re: /\b(429|rate[_ ]?limit|too many requests|resource[_ ]exhausted|retry[- ]after)\b/i },
  { cls: "PROMPT_INVALID", re: /\b(400|invalid[_ ](argument|request|parameter|value)|unsupported[_ ](model|parameter|aspect|ratio|duration)|malformed|is not found|model.*not found)\b/i },
  { cls: "STORAGE_OR_ASSEMBLY", re: /\b(ffmpeg|ENOENT|EACCES|no such file|S3_BUCKET|storage write failed|truncated download|durable storage)\b/i },
  { cls: "REMOTE_FAILED", re: /\b(operation[_ ]failed|generation[_ ]failed|job[_ ]failed|status[:=]\s*failed|internal[_ ]error|500|502|503|504)\b/i },
  { cls: "TRANSIENT_NETWORK", re: /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang ?up|network|fetch failed|aborted)\b/i },
];

const POLICY: Record<ProviderErrorClass, Omit<ProviderErrorVerdict, "errorClass" | "reason">> = {
  TRANSIENT_NETWORK: { action: "RETRY_BACKOFF", consumesAttempt: true, mayDoubleSpend: false },
  // The request was refused before work began, so it neither cost anything nor
  // deserves to eat the budget that exists for real failures.
  RATE_LIMIT: { action: "RETRY_WITHOUT_CONSUMING_ATTEMPT", consumesAttempt: false, mayDoubleSpend: false },
  AUTH_INVALID: { action: "PAUSE_PROVIDER", consumesAttempt: true, mayDoubleSpend: false },
  QUOTA_OR_CREDIT: { action: "PAUSE_PROVIDER", consumesAttempt: true, mayDoubleSpend: false },
  PROMPT_INVALID: { action: "REGENERATE_PROMPT", consumesAttempt: true, mayDoubleSpend: false },
  // Regenerate the WORDING, never the claim. Same prompt again = same rejection.
  SAFETY_POLICY_PERMANENT: { action: "REGENERATE_PROMPT", consumesAttempt: true, mayDoubleSpend: false },
  REMOTE_FAILED: { action: "RETRY_BACKOFF", consumesAttempt: true, mayDoubleSpend: false },
  LOCAL_TIMEOUT_REMOTE_RUNNING: { action: "RESUME_OPERATION", consumesAttempt: false, mayDoubleSpend: false },
  // The one case where a naive retry buys the same clip twice.
  LOCAL_TIMEOUT_REMOTE_UNKNOWN: { action: "RECONCILE_BEFORE_RETRY", consumesAttempt: true, mayDoubleSpend: true },
  STORAGE_OR_ASSEMBLY: { action: "REPAIR_WITHOUT_REGENERATING", consumesAttempt: true, mayDoubleSpend: false },
  UNKNOWN: { action: "RETRY_BACKOFF", consumesAttempt: true, mayDoubleSpend: false },
};

const REASONS: Record<ProviderErrorClass, string> = {
  TRANSIENT_NETWORK: "network blip — retry with backoff",
  RATE_LIMIT: "provider rate-limited the request; it never ran, so this does not spend a retry",
  AUTH_INVALID: "credentials rejected — no retry can fix this, pause the provider and alert the operator",
  QUOTA_OR_CREDIT: "provider credits or billing quota exhausted — operator must top up",
  PROMPT_INVALID: "the request itself was rejected as malformed — patch it, do not repeat it unchanged",
  SAFETY_POLICY_PERMANENT: "content policy rejected this prompt — rebuild provider-safe wording from the unchanged claim; resubmitting it verbatim can only be rejected again",
  REMOTE_FAILED: "the remote operation ran and terminated as failed — a new operation is allowed",
  LOCAL_TIMEOUT_REMOTE_RUNNING: "we stopped polling but hold the operation id — resume the SAME operation, never submit a new one",
  LOCAL_TIMEOUT_REMOTE_UNKNOWN: "we stopped polling with no operation handle; the remote job may still be running and billing — reconcile provider history before paying again",
  STORAGE_OR_ASSEMBLY: "local/deterministic failure after generation — repair inputs; regenerating clips would re-spend for media we already have",
  UNKNOWN: "unrecognised failure — treated as transient, but review the message",
};

export function classifyProviderError(
  err: unknown,
  ctx: ClassifyContext = {},
): ProviderErrorVerdict {
  const message = err instanceof Error ? err.message : String(err ?? "");

  // A local timeout is decided by what we HOLD, not by what the text says: the
  // same "poll timed out" message is resumable with an op id and a
  // double-spend risk without one.
  if (ctx.isLocalTimeout) {
    const cls: ProviderErrorClass = ctx.hasRemoteOperationId
      ? "LOCAL_TIMEOUT_REMOTE_RUNNING"
      : "LOCAL_TIMEOUT_REMOTE_UNKNOWN";
    return { errorClass: cls, ...POLICY[cls], reason: REASONS[cls] };
  }

  for (const { cls, re } of PATTERNS) {
    if (re.test(message)) {
      return { errorClass: cls, ...POLICY[cls], reason: REASONS[cls] };
    }
  }
  return { errorClass: "UNKNOWN", ...POLICY.UNKNOWN, reason: REASONS.UNKNOWN };
}

/**
 * Machine-readable prefix stamped onto `reel_jobs.error`.
 *
 * Deliberately NOT a new job status. Two reasons, both learned here:
 * `reel_jobs.status` is varchar(20) — "provider_reconciliation_required" is 32
 * chars and would throw "data too long" from INSIDE the failure handler,
 * stranding the job in `generating`. And a status no recovery path or admin
 * surface knows about is an invisible parking space; this repo has already lost
 * jobs to a state nothing displayed. `failed` is surfaced by the attention
 * badge and the reliability panel, so the class rides in the message where
 * both a human and a grep can find it.
 */
export const ERROR_CLASS_PREFIX = "[";

export function stampError(verdict: ProviderErrorVerdict, message: string): string {
  return `[${verdict.errorClass}] ${verdict.reason} :: ${message}`;
}

/**
 * The union at runtime, derived from POLICY so it cannot drift from the type.
 */
export const PROVIDER_ERROR_CLASSES = Object.keys(POLICY) as ProviderErrorClass[];

/** Recover the class from a stamped error string. */
export function parseErrorClass(stamped: string | null | undefined): ProviderErrorClass | null {
  const m = /^\[([A-Z_]+)\]/.exec(String(stamped ?? ""));
  const token = m?.[1];
  // The token is VALIDATED, not cast. `reel_jobs.error` is a mixed column: only
  // the generation stage stamps it. Assembly, the budget breach, the stuck
  // sweeper and operator closure all write raw provider text, and a message that
  // merely starts with a bracketed word — "[ERROR] ffmpeg exited with code 1" —
  // used to come back as the string "ERROR" wearing the ProviderErrorClass type.
  // Every `Record<ProviderErrorClass, …>` lookup on that reads undefined, which
  // is how a lie becomes a blank instead of an error.
  return token && (PROVIDER_ERROR_CLASSES as string[]).includes(token)
    ? (token as ProviderErrorClass)
    : null;
}

/**
 * The provider's own message, with the machine-readable stamp removed.
 *
 * Lives beside stampError because stampError owns the " :: " separator — no
 * caller should have to know the format to undo it. Returns the whole string
 * unchanged when it carries no stamp, so the unstamped writers above still
 * render their text rather than nothing.
 */
export function parseErrorMessage(stamped: string | null | undefined): string | null {
  const s = String(stamped ?? "");
  if (!s) return null;
  const i = s.indexOf(" :: ");
  return i >= 0 ? s.slice(i + 4) : s;
}

/**
 * Where a failed job goes next, using ONLY statuses the pipeline already knows.
 *
 * An unknown remote state is the one failure a retry can make worse — it may
 * buy the same clip twice — so it goes terminal immediately rather than
 * re-entering the queue, and the stamped error tells the operator to reconcile
 * provider history before authorising another paid submission.
 */
export function nextStatusFor(
  verdict: ProviderErrorVerdict,
  attempt: number,
  maxAttempts: number,
  requeueStatus: string,
): { status: string; attempts: number; terminal: boolean } {
  if (verdict.action === "RECONCILE_BEFORE_RETRY" || verdict.action === "PAUSE_PROVIDER") {
    return { status: "failed", attempts: attempt, terminal: true };
  }
  // REGENERATE_PROMPT names what SHOULD happen, and no regeneration mechanism
  // exists yet: the prompt pack is compiled once at enqueue and read from the
  // payload on every attempt, so a requeue resubmits the identical text.
  // Retrying an unchangeable prompt against a deterministic rejection is pure
  // spend, so it goes terminal now and the stamped error tells the operator the
  // brief needs repair. When a real escalation path exists, this becomes a
  // requeue and the tests below should change with it.
  if (verdict.action === "REGENERATE_PROMPT") {
    return { status: "failed", attempts: attempt, terminal: true };
  }
  if (!verdict.consumesAttempt) {
    // Give the attempt back: the work never ran, so it should not count against
    // the budget that exists for failures that did.
    return { status: requeueStatus, attempts: Math.max(0, attempt - 1), terminal: false };
  }
  const terminal = attempt >= maxAttempts;
  return { status: terminal ? "failed" : requeueStatus, attempts: attempt, terminal };
}
