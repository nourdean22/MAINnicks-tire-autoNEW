/**
 * MessageCustomerLink — wave-181.x
 *
 * Standard "Text" button that navigates to the in-admin SMS chat
 * (Outreach Hub → Messages) instead of opening the operator's PHONE
 * SMS app via the native `sms:` URI scheme.
 *
 * Why this exists · the prior pattern across the admin was:
 *   <a href={`sms:${phone}?body=...`}>Text</a>
 * That trigger the OS-level Messages/iMessage app on the operator's
 * device · routing the message through the operator's personal cell
 * line · which:
 *   1 · doesn't go through the F25e shop gateway · customer sees a
 *       different phone number than 216-862-0005 · trust break
 *   2 · doesn't get logged in sms_conversations · operator can't see
 *       the thread later in /admin
 *   3 · bypasses all of the at-most-once / TCPA / rate-limit / brand-
 *       voice safety rails the shop gateway enforces
 *   4 · operator has to copy/paste numbers · slow + error-prone
 *
 * The replacement: navigate to /admin?tab=outreach&outreachTab=sms
 * with smsPhone + optional smsBody query params. SmsSection reads
 * those params on mount, finds-or-prefills the conversation, and
 * focuses the composer with the prefilled body. Result: one click ·
 * land in chat · all sends route through F25e.
 *
 * Usage:
 *   <MessageCustomerLink phone="2168620005" body="Hi Marcus, ...">
 *     Text
 *   </MessageCustomerLink>
 */
import { MessageSquare } from "lucide-react";
import { navigateToAdminUrl } from "@/pages/admin/shared/navigation";

interface MessageCustomerLinkProps {
  /** Raw phone string · any format · will be normalized to last-10 digits */
  phone: string;
  /** Optional message body to prefill the composer */
  body?: string;
  /** Click handler · fires AFTER navigation kicks off · for analytics */
  onClick?: () => void;
  /** Optional custom className for the link wrapper */
  className?: string;
  /** Optional title attribute (tooltip) */
  title?: string;
  /** Optional aria-label override (defaults to "Text {phone}") */
  ariaLabel?: string;
  /** Render content · falls back to MessageSquare + "Text" */
  children?: React.ReactNode;
}

/**
 * Build the admin SMS deep-link URL · centralized so the URL shape
 * stays in lockstep with SmsSection's deep-link parser.
 */
export function buildMessageCustomerHref(phone: string, body?: string): string {
  const phone10 = (phone || "").replace(/\D/g, "").slice(-10);
  const params = new URLSearchParams({
    // 2026-07-11 · was tab=outreach — which is NOT a registry id OR
    // alias, so even a fresh page load landed on Overview. The Outreach
    // Hub's section id is `campaigns`.
    tab: "campaigns",
    outreachTab: "sms",
  });
  if (phone10) params.set("smsPhone", phone10);
  if (body && body.trim()) params.set("smsBody", body.trim());
  return `/admin?${params.toString()}`;
}

export default function MessageCustomerLink({
  phone,
  body,
  onClick,
  className,
  title,
  ariaLabel,
  children,
}: MessageCustomerLinkProps) {
  const href = buildMessageCustomerHref(phone, body);
  const label = ariaLabel ?? `Text ${phone}`;
  const defaultClass =
    "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium text-foreground/70 hover:text-primary hover:bg-primary/[0.06] transition-colors";

  // 2026-07-11 · was a wouter <Link>. Admin.tsx is a single-page
  // component — a Link to /admin?tab=… doesn't remount Admin or
  // re-resolve section state (documented in shared/navigation.ts), so
  // the flagship "Text" button was a NO-OP from inside the admin on all
  // ~13 call sites. Real <a> + the event bridge: left-click navigates
  // in-place; middle/ctrl-click still opens a working deep-link tab.
  return (
    <a
      href={href}
      onClick={(e) => {
        if (navigateToAdminUrl(e, href, "campaigns")) e.preventDefault();
        onClick?.();
      }}
      title={title ?? "Open in-admin SMS chat"}
      aria-label={label}
      className={className ?? defaultClass}
    >
      {children ?? (
        <>
          <MessageSquare className="w-3.5 h-3.5" />
          Text
        </>
      )}
    </a>
  );
}
