/**
 * What happens right after a /careers submission is saved.
 *
 * WHY (measured 2026-09-22, docs/recruiting/RECRUITING-ENGINE-2026-09.md):
 * candidates.submit saved the row and told nobody. The careers email alert
 * that lead.submit used to send ("JOB APPLICATION: ... call within 48 hours",
 * email-notify.ts notifyNewLead) was lost when the form moved to
 * candidates.submit on 2026-09-09, and the 48-hour alarm lives only inside
 * the admin panel. Employed technicians assume no interest after a day or two
 * of silence, so the first reply time is the part of the funnel that matters.
 *
 * Three sends, each with its own kill switch. The operator turned all three
 * on explicitly on 2026-09-23 ("have the store phone send me a message to my
 * personal CEO line ... immediately whenever a new comes in along with
 * whatever email u set up"; "u can turn that back on" for the applicant email):
 *
 *  - OWNER EMAIL (shop/CEO inboxes via sendNotification). Restores the alert
 *    the careers path had before the cut-over. Off: CANDIDATE_OWNER_ALERT=off.
 *
 *  - OWNER TEXT to the operator's own mobile, sent from the store line
 *    (via: "shop"). NOT OWNER_PHONE_NUMBER — that was measured to not be his
 *    mobile (server/sms.ts, internal-line refusal comment). The number comes
 *    from OPERATOR_MOBILE_LAST10, the same value the internal-line guard uses;
 *    messageClass "internal" is the declared intent that guard requires.
 *    Override: CANDIDATE_ALERT_PHONE. Off: CANDIDATE_OWNER_SMS=off.
 *
 *  - APPLICANT ACKNOWLEDGEMENT, email only, to the address the applicant
 *    typed. Off: CANDIDATE_ACK_EMAIL=off. Never SMS — recruiting texts to an
 *    applicant need a consent checkbox and a registered 10DLC campaign.
 *
 * Both are fire-and-forget from the router: a failed alert must never turn a
 * saved application into an error the applicant sees.
 */
import { BUSINESS, SITE_URL } from "@shared/business";
import {
  CANDIDATE_INTENT_ACTION,
  CANDIDATE_INTENT_LABELS,
  MOVE_REASON_LABELS,
  parseMoveReasons,
  type CandidateIntent,
} from "@shared/candidateLifecycle";
import { sendNotification } from "../email-notify";
import { sendSms } from "../sms";
import { normalizePhone } from "../lib/phone";
import { OPERATOR_MOBILE_LAST10 } from "./nonCustomerFilter";
import { markCandidateOwnerAlerted } from "../db";
import { createLogger } from "../lib/logger";

const log = createLogger("candidate-intake");

export interface IntakeCandidate {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  positionTitle: string | null;
  experienceLevel: string | null;
  message: string | null;
  intent: CandidateIntent;
  moveReasons: string | null;
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** Earlier candidate ids with the same normalized phone; null = could not check. */
  priorIds: number[] | null;
}

function ownerAlertEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CANDIDATE_OWNER_ALERT ?? "").trim().toLowerCase() !== "off";
}

function applicantAckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CANDIDATE_ACK_EMAIL ?? "").trim().toLowerCase() !== "off";
}

function ownerSmsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CANDIDATE_OWNER_SMS ?? "").trim().toLowerCase() !== "off";
}

/** E.164 destination for the owner text; null if the override is unusable. */
function ownerAlertPhone(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = (env.CANDIDATE_ALERT_PHONE ?? "").trim();
  return normalizePhone(override || OPERATOR_MOBILE_LAST10);
}

/** Pure: the owner text — short enough for one or two segments. */
function buildOwnerSms(c: IntakeCandidate): string {
  const wants = c.intent === "apply" ? "applied" : CANDIDATE_INTENT_LABELS[c.intent].toLowerCase();
  const repeat = c.priorIds && c.priorIds.length > 0 ? " (REPEAT)" : "";
  const lines = [
    `NEW CAREERS LEAD${repeat}: ${c.name} — ${c.positionTitle ?? "any role"}, ${wants}.`,
    `Call/text: ${c.phone}`,
    c.intent === "confidential" ? "Employed elsewhere: contact discreetly." : "",
    c.refCode ? `Ref: ${c.refCode}` : "",
    `Details in email + admin #${c.id}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Pure: subject + body of the owner alert. */
function buildOwnerAlert(c: IntakeCandidate): { subject: string; body: string } {
  const label = CANDIDATE_INTENT_LABELS[c.intent];
  const reasons = parseMoveReasons(c.moveReasons).map((r) => MOVE_REASON_LABELS[r]);
  const source =
    [c.utmSource, c.utmMedium, c.utmCampaign].filter(Boolean).join(" / ") || "direct / unknown";
  const dup =
    c.priorIds == null
      ? "Duplicate check: could not run"
      : c.priorIds.length > 0
        ? `REPEAT: same phone as candidate #${c.priorIds.join(", #")}`
        : "";
  const subject =
    c.intent === "apply"
      ? `JOB APPLICATION: ${c.name} — ${c.positionTitle ?? "any role"}`
      : `CAREERS (${label}): ${c.name} — ${c.positionTitle ?? "any role"}`;
  const body = [
    c.intent === "confidential" ? "CONFIDENTIAL — this person is likely employed elsewhere." : "",
    `Name: ${c.name}`,
    `Phone: ${c.phone}`,
    c.email ? `Email: ${c.email}` : "",
    `Role: ${c.positionTitle ?? "not chosen"}`,
    c.experienceLevel ? `Experience: ${c.experienceLevel}` : "",
    `Wants: ${label}`,
    reasons.length ? `Would move for: ${reasons.join(", ")}` : "",
    c.message ? `\n${c.message}\n` : "",
    `Source: ${source}`,
    c.refCode ? `Referral code: ${c.refCode}` : "",
    dup,
    ``,
    `ACTION: ${CANDIDATE_INTENT_ACTION[c.intent]} Target: first reply within 15 minutes during shop hours; the site promises 48 hours.`,
    `Admin: ${SITE_URL}/admin (Leads → Candidates, #${c.id})`,
    `Time: ${new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone })}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { subject, body };
}

/** Pure: the applicant acknowledgement. */
function buildApplicantAck(c: IntakeCandidate): { subject: string; body: string } {
  const first = c.name.split(/\s+/)[0] || c.name;
  const what =
    c.intent === "confidential"
      ? "Your message stays between you and the owner. We won't contact your current shop, and we'll reach out the way you'd prefer."
      : c.intent === "shop_tour"
        ? "We'll reach out to set up a time to walk the shop — after hours works."
        : c.intent === "talent_network"
          ? "No pressure. We'll keep your info and check in when it makes sense for you."
          : "We'll review what you sent and reach out within 48 hours.";
  return {
    subject: `${BUSINESS.name} — we got your message`,
    body: [
      `Hi ${first},`,
      ``,
      `Thanks for reaching out to ${BUSINESS.name}. ${what}`,
      ``,
      `Want to talk sooner? Call ${BUSINESS.phone.display}.`,
      ``,
      `— ${BUSINESS.name}, ${BUSINESS.address.full}`,
      ``,
      `You're getting this one email because you contacted us at nickstire.org/careers. We don't add you to any mailing list.`,
    ].join("\n"),
  };
}

/** Fire-and-forget entry point called by candidates.submit after a successful save. */
export async function runCandidateIntake(c: IntakeCandidate): Promise<void> {
  if (ownerAlertEnabled()) {
    try {
      const { subject, body } = buildOwnerAlert(c);
      // bypassThrottle: a job applicant is rare and expensive to miss — the
      // smart-batching throttle exists for noisy categories, not this one.
      // high_value routes to BOTH the shop and the CEO inbox; "lead" reached
      // the shop inbox only, and the operator asked for his own copy.
      const res = await sendNotification({
        category: "high_value",
        subject,
        body,
        bypassThrottle: true,
        templateUsed: "candidate_owner_alert",
      });
      if (res.emailSent) await markCandidateOwnerAlerted(c.id);
      else log.warn("[candidate-intake] owner alert not sent", { id: c.id });
    } catch (err) {
      log.warn("[candidate-intake] owner alert failed", { id: c.id, err: String(err) });
    }
  }

  if (ownerSmsEnabled()) {
    const to = ownerAlertPhone();
    if (!to) {
      log.warn("[candidate-intake] owner text skipped — CANDIDATE_ALERT_PHONE is not a phone number", { id: c.id });
    } else {
      try {
        const res = await sendSms(to, buildOwnerSms(c), { via: "shop", messageClass: "internal" });
        if (!res.success) log.warn("[candidate-intake] owner text not sent", { id: c.id, error: res.error });
      } catch (err) {
        log.warn("[candidate-intake] owner text failed", { id: c.id, err: String(err) });
      }
    }
  }

  if (applicantAckEnabled() && c.email) {
    try {
      const { subject, body } = buildApplicantAck(c);
      // follow_up: no default recipients and NO owner push — the applicant's
      // own copy must not fire a second alert at the operator.
      await sendNotification({
        category: "follow_up",
        subject,
        body,
        overrideTo: [c.email],
        bypassThrottle: true,
        templateUsed: "candidate_applicant_ack",
      });
    } catch (err) {
      log.warn("[candidate-intake] applicant ack failed", { id: c.id, err: String(err) });
    }
  }
}
