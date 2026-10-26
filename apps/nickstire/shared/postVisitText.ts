import { STORE_NAME } from "./const";

/**
 * The post-visit text: the first message after a visit (Draft D, approved by Nour 2026-10-24).
 * It leads with the thank-you and "text us here", and asks for the review second.
 *
 * One builder for every post-visit send path (review-requests cron, post-invoice-followup cron; the
 * RUN FOLLOW-UPS booking lane was deleted in PR 3294), so the copy cannot drift again. "text us here" is only
 * true because both send with `via: "shop"`: a reply reaches the shop line and lands in the admin Messages inbox
 * (routes/webhooks/smsGateway.ts). A caller that sends from anywhere else must not use this text.
 * It lives in shared/ so the admin custom-template box can show the real default (its placeholder
 * is this function called with the placeholder tokens), not a copy that drifts.
 *
 * Keep the text ASCII (straight apostrophes, no dashes): one curly quote flips the whole
 * message to UCS-2 and cuts a segment from 153 characters to 67. sendSms appends the STOP
 * footer itself (withOptOut), so none belongs here.
 */
export function postVisitText(firstName: string, reviewUrl: string): string {
  return `Hi ${firstName}, it's ${STORE_NAME} on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: ${reviewUrl}`;
}
