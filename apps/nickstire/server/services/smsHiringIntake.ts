/**
 * Text-to-apply: an inbound text that opens with the careers pages' exact
 * token (shared/jobOpenings.ts HIRING_SMS_TOKEN) is a job application, not a
 * customer question.
 *
 * WHY (job 2026-10-30-tech-hiring-page): techs who will not fill a form will
 * send one text. Before this, that text reached the customer reply bot, whose
 * intents are all customer intents (brakes, tire sizes, hours).
 *
 * Rules:
 *  - Routing is on the token alone. A customer text that mentions a job, a
 *    tech or hiring is never caught here.
 *  - A token text that is ALSO an opt-out is recorded as an opt-out here and
 *    answered with nothing. The orchestrator cannot do it: it records only
 *    what parseSmsResponse finds, and that parser is prefix-anchored, so
 *    "JOB-APPLY ... STOP" never reads as one there.
 *  - No reply to the applicant. A recruiting text to an applicant needs a
 *    consent step and a registered campaign (candidateIntake.ts header); the
 *    owner calls or texts back himself. The existing owner alert fires.
 *  - One row per inbound text: the caller passes a key per response job, and a
 *    re-run of the same job (crash, deploy, lease reclaim) finds the saved row
 *    instead of saving and alerting twice. The job claim itself is already a
 *    guarded UPDATE, so two runners never hold one job at the same time.
 *  - The inbound itself is already saved in the conversation thread by the
 *    webhook before this runs, so the admin SMS inbox still shows it.
 */
import { JOB_OPENINGS, startsWithHiringToken } from "@shared/jobOpenings";
import { normalizePhone } from "../lib/phone";
import { logSafeErrorMessage } from "../lib/dbErrors";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { createLogger } from "../lib/logger";
import { trackDetached } from "../_core/gracefulShutdown";
import { parseSmsResponse } from "./smsResponseParser";

const log = createLogger("sms-hiring-intake");

const E164 = /^\+[1-9]\d{7,14}$/;
// Opt-out inside a token text. Bare "stop" and "quit" are NOT here: an
// applicant writes "I can stop by Monday" or "I will quit my current shop".
// Kept: the explicit words, "stop" as the last word, and "stop texting" forms.
const OPT_OUT_IN_HIRING_TEXT =
  /\b(stopall|unsubscribe|revoke|opt[\s-]?out)\b|\bstop\W*$|\bstop\s+(all|texting|messaging|sending)\b/i;

export type HiringSmsKind = "hiring" | "opt_out";

/** null = not a text-to-apply message; route it the normal way. */
export function classifyHiringSms(body: string): HiringSmsKind | null {
  if (!startsWithHiringToken(body)) return null;
  if (OPT_OUT_IN_HIRING_TEXT.test(body)) return "opt_out";
  const parsed = parseSmsResponse(body);
  if (parsed.intent === "unsubscribe" || parsed.autoAction === "unsubscribe-customer") return "opt_out";
  return "hiring";
}

/** The open role named after the token, longest title first, or null. */
function roleFromHiringSms(body: string): string | null {
  const lower = body.toLowerCase();
  const titles = JOB_OPENINGS.filter((j) => j.status === "open")
    .map((j) => j.title)
    .sort((a, b) => b.length - a.length);
  return titles.find((t) => lower.includes(t.toLowerCase())) ?? null;
}

/** Text typed after "my name is", cleaned; a fallback when left blank. */
function nameFromHiringSms(body: string): string {
  const m = body.match(/my name is[:\s]*([^\n.,!?]{1,80})/i);
  const name = sanitizeText(m?.[1] ?? "").trim();
  return name || "Text applicant";
}

/**
 * Record an opt-out that arrived inside a token text, the same three writes the
 * live inbound path makes (smsOrchestrator.ts, the Q-43 block): in-process +
 * durable suppression, customers.smsOptOut, and the compliance ledger row.
 */
export async function recordHiringOptOut(input: { phone: string; body: string; evidenceRef: string }): Promise<void> {
  const normalized = normalizePhone(input.phone) ?? input.phone;
  const phone10 = normalized.replace(/\D/g, "").slice(-10);
  const { markPhoneFullyOptedOut } = await import("../sms");
  const persisted = await markPhoneFullyOptedOut(normalized);
  if (!persisted) {
    log.error("opt-out in a job text was cached but the durable write failed", {
      phoneSuffix: phone10.slice(-4),
      errorId: "SMS_OPT_OUT_PERSIST_FAILED",
    });
  }
  if (phone10.length === 10) {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (db) {
      const { customers } = await import("../../drizzle/schema");
      const { like } = await import("drizzle-orm");
      await db.update(customers).set({ smsOptOut: 1 }).where(like(customers.phone, `%${phone10}`));
    }
  }
  const { logSmsOptOut } = await import("./complianceLog");
  await logSmsOptOut({
    phone: normalized,
    via: "keyword",
    keyword: input.body,
    evidenceRef: input.evidenceRef,
    ledgerScope: "all",
    ledgerMethod: "sms_reply",
  });
}

/**
 * Save the application once per `dedupeKey` and fire the owner alert. Throws a
 * log-safe error when the row could not be read or saved, so a durable response
 * job retries it instead of losing it.
 */
export async function recordHiringSms(input: { phone: string; body: string; dedupeKey: string }): Promise<number> {
  const { createCandidate, findCandidateIdBySessionId, findCandidatesByPhoneE164, getCandidateSendBudget } =
    await import("../db");

  // drizzle's error message carries the query params (name, phone, the text);
  // only the code may reach the log line or sms_response_jobs.lastError.
  const safe = (step: string, err: unknown) => new Error(`text application not saved (${step}): ${logSafeErrorMessage(err)}`);

  let existing: number | null;
  try {
    existing = await findCandidateIdBySessionId(input.dedupeKey);
  } catch (err) {
    throw safe("lookup", err);
  }
  if (existing !== null) {
    log.info("text application already saved for this message", { id: existing });
    return existing;
  }

  const phone = sanitizePhone(input.phone);
  const normalized = normalizePhone(phone);
  const phoneE164 = normalized && E164.test(normalized) ? normalized : null;
  const name = nameFromHiringSms(input.body);
  const positionTitle = roleFromHiringSms(input.body);
  const message = sanitizeText(input.body).slice(0, 2000) || null;

  let result: Awaited<ReturnType<typeof createCandidate>>;
  try {
    result = await createCandidate({
      name,
      phone,
      email: null,
      positionTitle,
      experienceLevel: null,
      message,
      source: "sms",
      sessionId: input.dedupeKey,
      ...(phoneE164 ? { phoneE164 } : {}),
    });
  } catch (err) {
    throw safe("insert", err);
  }
  if (!result.success) throw new Error("text application not saved (insert): candidates table unavailable");
  const id = (result as { id: number }).id;
  log.info("text application saved", { id, hasRole: positionTitle !== null });

  // After the save; an alert failure must not undo or retry a saved row.
  void trackDetached(
    "sms-hiring:owner-alert",
    (async () => {
      const prior = phoneE164
        ? await findCandidatesByPhoneE164(phoneE164, id).catch((err) => {
            log.warn("prior-applicant lookup failed", { id, error: logSafeErrorMessage(err) });
            return null;
          })
        : null;
      const budget = await getCandidateSendBudget({ excludeId: id, email: null, phoneE164 }).catch((err) => {
        log.warn("send-budget lookup failed", { id, error: logSafeErrorMessage(err) });
        return null;
      });
      const { runCandidateIntake } = await import("./candidateIntake");
      await runCandidateIntake({
        id,
        name,
        phone,
        email: null,
        positionTitle,
        experienceLevel: null,
        message,
        intent: "apply",
        moveReasons: null,
        refCode: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        priorIds: prior && prior.available ? prior.rows.map((p) => p.id) : null,
        recent:
          budget && budget.available
            ? { last24h: budget.last24h, sameEmail24h: budget.sameEmail24h, samePhone24h: budget.samePhone24h }
            : null,
      });
    })(),
  ).catch((err) => log.warn("text application intake failed", { id, error: logSafeErrorMessage(err) }));

  return id;
}
