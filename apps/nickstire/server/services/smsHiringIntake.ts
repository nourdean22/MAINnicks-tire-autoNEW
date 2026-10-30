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
 *  - A token text that also carries an opt-out word goes to the orchestrator,
 *    which owns STOP handling. Falling through is the safe direction.
 *  - No reply to the applicant. A recruiting text to an applicant needs a
 *    consent step and a registered campaign (candidateIntake.ts header); the
 *    owner calls or texts back himself. The existing owner alert fires.
 *  - The inbound itself is already saved in the conversation thread by the
 *    webhook before this runs, so the admin SMS inbox still shows it.
 */
import { JOB_OPENINGS, startsWithHiringToken, HIRING_SMS_TOKEN } from "@shared/jobOpenings";
import { normalizePhone } from "../lib/phone";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { createLogger } from "../lib/logger";
import { parseSmsResponse } from "./smsResponseParser";

const log = createLogger("sms-hiring-intake");

const E164 = /^\+[1-9]\d{7,14}$/;
// Whole-word opt-out vocabulary. CANCEL and END are left out on purpose: in a
// hiring text they are ordinary words, and the live parser already decides
// those (shared/smsOptOutKeywords.ts explains the split).
const OPT_OUT_WORD = /\b(stop|stopall|unsubscribe|quit|revoke|opt[\s-]?out)\b/i;

export function isHiringSms(body: string): boolean {
  if (!startsWithHiringToken(body)) return false;
  if (OPT_OUT_WORD.test(body)) return false;
  const parsed = parseSmsResponse(body);
  return parsed.intent !== "unsubscribe" && parsed.autoAction !== "unsubscribe-customer";
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
 * Save the application and fire the owner alert. Throws when the row could not
 * be saved, so a durable response job retries it instead of losing it.
 */
export async function recordHiringSms(input: { phone: string; body: string }): Promise<number> {
  const { createCandidate, findCandidatesByPhoneE164, getCandidateSendBudget } = await import("../db");
  const { runCandidateIntake } = await import("./candidateIntake");

  const phone = sanitizePhone(input.phone);
  const normalized = normalizePhone(phone);
  const phoneE164 = normalized && E164.test(normalized) ? normalized : null;
  const name = nameFromHiringSms(input.body);
  const positionTitle = roleFromHiringSms(input.body);
  const message = sanitizeText(input.body).slice(0, 2000) || null;

  const result = await createCandidate({
    name,
    phone,
    email: null,
    positionTitle,
    experienceLevel: null,
    message,
    source: "sms",
    ...(phoneE164 ? { phoneE164 } : {}),
  });
  if (!result.success) throw new Error("candidates table unavailable: text application not saved");
  const id = (result as { id: number }).id;
  log.info("text application saved", { id, hasRole: positionTitle !== null, token: HIRING_SMS_TOKEN });

  // After the save; an alert failure must not undo or retry a saved row.
  void (async () => {
    const prior = phoneE164 ? await findCandidatesByPhoneE164(phoneE164, id).catch(() => null) : null;
    const budget = await getCandidateSendBudget({ excludeId: id, email: null, phoneE164 }).catch(() => null);
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
  })().catch((err) => log.warn("text application intake failed", { id, err: String(err) }));

  return id;
}
