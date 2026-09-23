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
 *
 * AUDIT FIXES (2026-09-23, three independent reviews of #2557/#2561):
 *  - The text goes FIRST. It is the one lane measured working; the email path
 *    can spend ~70 s in retries while Resend is failing.
 *  - A CONFIDENTIAL lead's text carries no name, phone or "employed
 *    elsewhere": it is sent from the store phone, whose sent box and the
 *    /admin SMS log staff can read. The email goes to CEO_EMAIL alone with no
 *    push (the push logs its title and posts to NOTIFICATION_WEBHOOK_URL).
 *  - Subjects carry no applicant name — notifyOwner logs the title.
 *  - Emails send real HTML (escaped, line breaks kept); plain text sent as
 *    HTML collapsed into one paragraph.
 *  - The acknowledgement greets by a sanitized first name only, so the form
 *    cannot put arbitrary text (a URL) into mail from nickstire.org.
 *  - Brakes from the table, not memory: the owner text skips a same-phone
 *    repeat within 24 h, owner alerts stop at OWNER_ALERTS_PER_DAY and
 *    acknowledgements at APPLICANT_EMAILS_PER_DAY (plus one per address per
 *    day). Internal texts skip sendSms's daily caps but still count toward
 *    the shop-wide one, so an unbraked flood could freeze customer SMS.
 *  - ownerAlertedAt is stamped when EITHER owner lane lands (it was
 *    email-only, and email has not delivered since the cut-over).
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
import { ENV } from "../_core/env";
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
  /**
   * Rows saved in the last 24 hours, excluding this one and honeypot rows
   * (db.getCandidateSendBudget). null = could not count: the owner alerts
   * still go (missing an applicant is the worse failure), the applicant
   * email does not.
   */
  recent: { last24h: number; sameEmail24h: number; samePhone24h: number } | null;
}

/** Real volume is a handful a day; these only bind on a flood. */
const OWNER_ALERTS_PER_DAY = 20;
const APPLICANT_EMAILS_PER_DAY = 30;

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

/**
 * Plain-GSM-7 text. One em dash (or a curly quote from an iPhone-typed name)
 * switches the whole SMS to UCS-2, cutting a segment from 160 to 70 chars:
 * measured 2026-09-23, the first live owner text arrived as 4 segments.
 */
function toGsm7(text: string): string {
  return text
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...");
}

/**
 * Pure: the owner text — short and GSM-7, so it lands in as few segments as
 * possible. A CONFIDENTIAL lead's text names nobody: it leaves from the store
 * phone, whose sent box (and the /admin SMS log) staff can read.
 */
function buildOwnerSms(c: IntakeCandidate): string {
  const repeat = c.priorIds && c.priorIds.length > 0 ? " (REPEAT)" : "";
  if (c.intent === "confidential") {
    return toGsm7(
      [
        `NEW PRIVATE CAREERS INQUIRY${repeat} #${c.id}: ${c.positionTitle ?? "any role"}.`,
        `Name and number are in Admin > Leads > Candidates #${c.id} - contact discreetly.`,
      ].join("\n"),
    );
  }
  const wants = c.intent === "apply" ? "applied" : CANDIDATE_INTENT_LABELS[c.intent].toLowerCase();
  const lines = [
    `NEW CAREERS LEAD${repeat}: ${displayName(c.name)} - ${c.positionTitle ?? "any role"}, ${wants}.`,
    `Call/text: ${c.phone}`,
    c.refCode ? `Ref: ${c.refCode}` : "",
    `Admin > Leads > Candidates #${c.id}`,
  ];
  return toGsm7(lines.filter(Boolean).join("\n"));
}

/**
 * The applicant's name as the OWNER sees it (text, email body). The name field
 * is free text from a public form; a link typed there would arrive tappable on
 * the operator's phone, sent from the shop's own line. Link-shaped tokens are
 * replaced and the length is capped; the saved row keeps what was typed.
 */
function displayName(name: string): string {
  const cleaned = name
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]")
    .replace(/\b\S+\.(?:com|net|org|io|co|info|biz|xyz|ru|cn|link|app|site|online)\b\S*/gi, "[link removed]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned || "(no name)";
}

/** Plain text -> email HTML: escaped, line breaks kept. */
function textToEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${escaped.replace(/\n/g, "<br>")}</div>`;
}

/** The greeting name: one plain word, or "there". Never free text in mail from nickstire.org. */
function greetingName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}[\p{L}'\u2019-]{0,29}$/u.test(first) ? first : "there";
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
  // No applicant name in the subject: the owner push logs its title to
  // Railway (notification.ts). The name is in the body.
  const subject =
    c.intent === "apply"
      ? `JOB APPLICATION #${c.id}: ${c.positionTitle ?? "any role"}`
      : `CAREERS #${c.id} (${label}): ${c.positionTitle ?? "any role"}`;
  const body = [
    c.intent === "confidential" ? "CONFIDENTIAL — this person is likely employed elsewhere." : "",
    `Name: ${displayName(c.name)}`,
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
  const what =
    c.intent === "confidential"
      ? "This went straight to the owner. We won't contact your current shop, and we'll reach out the way you'd prefer."
      : c.intent === "shop_tour"
        ? "We'll reach out to find a time for you to come see the shop."
        : c.intent === "talent_network"
          ? "No pressure. We'll keep your info and check in when it makes sense for you."
          : "We'll review what you sent and reach out within 48 hours.";
  return {
    subject: `${BUSINESS.name} — we got your message`,
    body: [
      `Hi ${greetingName(c.name)},`,
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
  const r = c.recent;
  const ownerOverBudget = r != null && r.last24h >= OWNER_ALERTS_PER_DAY;
  if (ownerOverBudget) log.warn("[candidate-intake] owner alerts over the daily brake — row saved, no alert", { id: c.id, last24h: r.last24h });
  let alerted = false;

  // 1 · OWNER TEXT — first: the lane measured working end to end.
  if (ownerSmsEnabled() && !ownerOverBudget) {
    const to = ownerAlertPhone();
    if (!to) {
      log.warn("[candidate-intake] owner text skipped — CANDIDATE_ALERT_PHONE is not a phone number", { id: c.id });
    } else if (r != null && r.samePhone24h > 0) {
      log.info("[candidate-intake] owner text skipped — same phone already submitted in the last 24h", { id: c.id });
    } else {
      try {
        const res = await sendSms(to, buildOwnerSms(c), { via: "shop", messageClass: "internal" });
        if (res.success && !res.queued) alerted = true;
        else if (!res.success) log.warn("[candidate-intake] owner text not sent", { id: c.id, error: res.error });
      } catch (err) {
        log.warn("[candidate-intake] owner text failed", { id: c.id, err: String(err) });
      }
    }
  }

  // 2 · OWNER EMAIL
  if (ownerAlertEnabled() && !ownerOverBudget) {
    try {
      const { subject, body } = buildOwnerAlert(c);
      // bypassThrottle: a job applicant is rare and expensive to miss — the
      // smart-batching throttle exists for noisy categories, not this one.
      // high_value routes to BOTH the shop and the CEO inbox (+ owner push).
      //
      // CONFIDENTIAL is the exception: the form says it goes straight to the
      // owner, so the email is addressed to the CEO inbox alone — never the
      // shared shop inbox (Codex on #2557) — under follow_up, which sends no
      // push. No CEO address configured -> no email; the text above still went.
      const confidential = c.intent === "confidential";
      const ceo = ENV.ceoEmail.trim();
      if (confidential && !ceo) {
        log.warn("[candidate-intake] confidential owner email skipped — CEO_EMAIL not set", { id: c.id });
      } else {
        const res = await sendNotification({
          category: confidential ? "follow_up" : "high_value",
          subject,
          body,
          html: textToEmailHtml(body),
          ...(confidential ? { overrideTo: [ceo] } : {}),
          bypassThrottle: true,
          templateUsed: "candidate_owner_alert",
        });
        if (res.emailSent) alerted = true;
        else log.warn("[candidate-intake] owner alert email not sent", { id: c.id });
      }
    } catch (err) {
      log.warn("[candidate-intake] owner alert failed", { id: c.id, err: String(err) });
    }
  }

  if (alerted) {
    try {
      await markCandidateOwnerAlerted(c.id);
    } catch (err) {
      log.warn("[candidate-intake] ownerAlertedAt stamp failed", { id: c.id, err: String(err) });
    }
  }

  // 3 · APPLICANT ACKNOWLEDGEMENT — fails CLOSED on an unreadable budget: it
  // is a courtesy, and the address is whatever a member of the public typed.
  if (applicantAckEnabled() && c.email) {
    if (r == null || r.sameEmail24h > 0 || r.last24h >= APPLICANT_EMAILS_PER_DAY) {
      log.info("[candidate-intake] applicant email skipped by the daily brake", { id: c.id, counted: r != null });
    } else {
      try {
        const { subject, body } = buildApplicantAck(c);
        const ceo = ENV.ceoEmail.trim();
        // follow_up: no default recipients and NO owner push — the applicant's
        // own copy must not fire a second alert at the operator. A confidential
        // applicant's reply goes to the owner, not the shared shop inbox.
        await sendNotification({
          category: "follow_up",
          subject,
          body,
          html: textToEmailHtml(body),
          overrideTo: [c.email],
          ...(c.intent === "confidential" && ceo ? { replyTo: ceo } : {}),
          bypassThrottle: true,
          templateUsed: "candidate_applicant_ack",
        });
      } catch (err) {
        log.warn("[candidate-intake] applicant ack failed", { id: c.id, err: String(err) });
      }
    }
  }
}
