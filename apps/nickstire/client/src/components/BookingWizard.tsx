/**
 * BookingWizard — REPURPOSED to a Drop-Off CTA card.
 *
 * 2026-05-19 · Elon move #2 (kill the booking lie). The shop is FCFS.
 * The 4-step Booking Wizard was a lie · customers filled it out
 * expecting an appointment slot, showed up, found the line, left
 * angry. The bookings DB table stays intact for historical data and
 * admin manual entry, but no new public submissions flow in.
 *
 * This component keeps its export name + flexible props so the 40+
 * call sites embedded on TireFinder, AlignmentPage, Home, etc. don't
 * need updates. It now renders a Cleveland-honest card:
 *   "Pull up · we work first come first served · drop off if you
 *    can't wait · we'll text you when ready."
 * Then ONE prominent CALL button + a TEXT fallback + DIRECTIONS link.
 *
 * Original 4-step form (Service · Vehicle · Schedule · Contact) lives
 * in git history at the wave-181.95 commit. Restore-able if FCFS
 * positioning ever changes back.
 */
import { Phone, MessageSquare, MapPin, Clock } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackPhoneClick, trackEvent } from "@/components/SEO";

// Props kept flexible · all existing call sites pass varying combos.
// We ignore the form-related props (service / vehicle / urgency) since
// there's no form. Just signal which page fired the CTA so we can
// trace conversion attribution per silo.
interface BookingWizardProps {
  defaultService?: string;
  service?: string;
  source?: string;
  className?: string;
  // Catch-all so we don't break any caller passing custom props.
  [key: string]: unknown;
}

export default function BookingWizard(props: BookingWizardProps = {}) {
  const service = props.service || props.defaultService;
  const source = typeof props.source === "string" ? props.source : "booking-wizard";

  // Pre-fill SMS body with the service context if we have one.
  // Operator gets a richer first message · less "what does this person
  // need?" guesswork at the bay.
  const smsBody = service
    ? `Hey Nick · I need ${service} for my [year/make/model] · `
    : "Hey Nick · I need ";
  const smsHref = `sms:${BUSINESS.phone.raw}?&body=${encodeURIComponent(smsBody)}`;

  const className = typeof props.className === "string" ? props.className : "";

  return (
    <div className={`relative ${className}`}>
      <div
        className="relative overflow-hidden rounded-xl border bg-card p-6 sm:p-8"
        style={{
          borderColor: "rgba(253,185,19,0.35)",
          boxShadow: "0 10px 40px -10px rgba(253,185,19,0.18)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-12 -right-12 h-48 w-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(253,185,19,0.18) 0%, transparent 70%)",
          }}
        />

        <div className="relative">
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            Pull Up · We Work First Come First Served
          </h3>
          <p className="mt-2 text-[15px] text-foreground/70 leading-relaxed">
            {service ? (
              <>Need <span className="text-primary font-semibold">{service}</span>? </>
            ) : null}
            No appointments to chase. Drop your car off if you can&apos;t wait — we&apos;ll text you the second it&apos;s ready.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-4 text-[13px] text-foreground/60">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary" />
              {/* Hours from the source of truth — the old hardcoded
                  "Mon–Sat 8a–6p" dropped Sunday on 40+ pages while the
                  site sells Sunday service. */}
              {BUSINESS.hours.display}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              {BUSINESS.address.street}, {BUSINESS.address.city} {BUSINESS.address.state}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick(source)}
              aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}
              className="flex items-center justify-center gap-2 px-6 py-4 font-bold rounded-lg cta-depth transition-transform active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(180deg, #FFC835 0%, #FDB913 50%, #E8A810 100%)",
                color: "#0A0A0A",
                fontSize: 17,
                boxShadow:
                  "0 8px 24px -6px rgba(253,185,19,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
              }}
            >
              <Phone className="w-5 h-5" />
              Call {BUSINESS.phone.display}
            </a>

            <a
              href={smsHref}
              onClick={() => trackEvent("sms_click", { source })}
              aria-label="Text the shop"
              className="flex items-center justify-center gap-2 px-6 py-4 font-bold rounded-lg cta-depth transition-transform active:scale-[0.98]"
              style={{
                background: "rgba(26,26,26,0.55)",
                color: "#FDB913",
                border: "1px solid rgba(253,185,19,0.6)",
                fontSize: 17,
              }}
            >
              <MessageSquare className="w-5 h-5" />
              Text the Shop
            </a>
          </div>

          <a
            href={BUSINESS.urls.googleMapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("directions_click", { source })}
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary/80 hover:text-primary tracking-wide transition-colors"
          >
            <MapPin className="w-3.5 h-3.5" />
            Get directions →
          </a>

          <p className="mt-6 text-[12px] text-foreground/40 leading-relaxed">
            $10 down on tires · 4 financing partners · we text when your car is
            ready. No appointment needed — never has been.
          </p>
        </div>
      </div>
    </div>
  );
}
