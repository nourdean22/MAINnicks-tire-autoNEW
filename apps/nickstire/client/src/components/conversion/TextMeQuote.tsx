/**
 * TextMeQuote — phone-only SMS-back capture, low-friction conversion
 * surface for users who don't want to fill the full booking form.
 *
 * Submits to trpc.lead.submit with source="sms_capture" so the lead
 * routes through the same scoring + Telegram + email-notify pipe as
 * other lead sources, but stays visible as its own bucket in admin.
 *
 * The optional `serviceLabel` prop lets parent pages pass context
 * (e.g. "Brake Repair") that gets prepended to the lead's `problem`
 * field — saves the master tech a discovery call.
 *
 * Variants:
 *   - "block"   — full-width card, used in service pages + homepage
 *   - "inline"  — single-row compact form, used in narrow contexts
 *
 * No fake counters. No invented urgency. Real submission, real follow-up.
 */

import { useState, useCallback } from "react";
import { MessageSquare, Loader2, CheckCircle, Phone as PhoneIcon, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { trackLeadSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import { trackFormSubmission } from "@/lib/ga4";
import { BUSINESS } from "@shared/business";

interface TextMeQuoteProps {
  /** Service slug or label — e.g. "brakes" or "Brake Repair". */
  serviceLabel?: string;
  /** Variant. "block" = full card, "inline" = compact strip. */
  variant?: "block" | "inline";
  /** Optional override for the headline. */
  headline?: string;
  /** Optional override for the sub. */
  sub?: string;
  /** Track-source override for analytics — defaults to "sms_capture". */
  source?: "sms_capture" | "popup";
}

export default function TextMeQuote({
  serviceLabel,
  variant = "block",
  headline,
  sub,
  source = "sms_capture",
}: TextMeQuoteProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setError(null);
    },
    onError: () => {
      setError(`Couldn't send. Try calling ${BUSINESS.phone.display}.`);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      const cleanedPhone = phone.replace(/\D/g, "");
      if (!trimmedName || cleanedPhone.length < 10) {
        setError("Name + 10-digit phone, please.");
        return;
      }
      const problem = serviceLabel
        ? `Text-me-quote request for: ${serviceLabel}.`
        : `Text-me-quote request from website.`;
      // Meta Pixel Lead (returns eventID for server CAPI dedup) + GA4 +
      // UTM attribution — same wiring as LeadPopup.tsx handleSubmit.
      const eventId = trackLeadSubmission({ source, problem });
      const userData = getUserDataForCAPI();
      const utmData = getUtmData();
      trackFormSubmission("lead", { service: serviceLabel, source, eventId });
      mutation.mutate({
        name: trimmedName,
        phone: cleanedPhone,
        problem,
        source,
        pixelEventId: eventId,
        pixelUserData: userData,
        ...utmData,
      });
    },
    [name, phone, serviceLabel, source, mutation]
  );

  // ─── INLINE VARIANT ────────────────────────────────────────────
  if (variant === "inline") {
    if (submitted) {
      return (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          Got it — we'll text you in the next few minutes.
        </div>
      );
    }
    return (
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 items-stretch">
        <input
          type="text"
          placeholder="First name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-card/50 border border-border/40 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none"
          required
        />
        <input
          type="tel"
          placeholder={BUSINESS.phone.placeholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="flex-1 bg-card/50 border border-border/40 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="bg-primary text-primary-foreground px-5 py-2 rounded-md font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
          Text Me
        </button>
        {error && <span className="text-rose-400 text-xs sm:hidden">{error}</span>}
      </form>
    );
  }

  // ─── BLOCK VARIANT (default) ───────────────────────────────────
  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 lg:p-7">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-lg">We'll text you in the next few minutes.</h3>
            <p className="text-foreground/65 text-sm mt-1 leading-relaxed">
              A master tech will text {phone} with a quote and the next-available drop-off times. Reply STOP to opt out at any time.
            </p>
            <p className="text-foreground/45 text-xs mt-3">
              Need it now? Call <a href={BUSINESS.phone.href} className="text-primary font-semibold hover:underline">{BUSINESS.phone.display}</a> — we answer 7 days.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-primary/[0.02] to-transparent p-6 lg:p-7">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold mb-1">
            60 seconds · no commitment
          </div>
          <h3 className="font-heading font-bold text-foreground text-xl tracking-tight uppercase leading-tight">
            {headline || "Text me a quote."}
          </h3>
          <p className="text-foreground/65 text-sm leading-relaxed mt-1">
            {sub ||
              (serviceLabel
                ? `Drop your name + number. A master tech texts you a real quote for ${serviceLabel.toLowerCase()} within a few minutes.`
                : "Drop your name + number. A master tech texts you a real quote within a few minutes.")}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="First name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-card/40 border border-border/40 rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none transition-colors"
            required
          />
          <input
            type="tel"
            placeholder={BUSINESS.phone.placeholder}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="bg-card/40 border border-border/40 rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none transition-colors"
            required
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary text-primary-foreground py-3 rounded-md font-bold text-sm uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Pulling the numbers...
            </>
          ) : (
            <>
              <MessageSquare className="w-4 h-4" />
              Text Me a Quote
            </>
          )}
        </button>
        <div className="flex items-center justify-between text-[11px] text-foreground/40 pt-1">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" />
            We don't sell or rent contact info. Reply STOP to opt out.
          </span>
          <a href={BUSINESS.phone.href} className="hidden sm:inline-flex items-center gap-1 text-foreground/55 hover:text-primary transition-colors">
            <PhoneIcon className="w-3 h-3" />
            Or call
          </a>
        </div>
        {error && (
          <p className="text-rose-400 text-xs leading-relaxed">{error}</p>
        )}
      </form>
    </div>
  );
}
