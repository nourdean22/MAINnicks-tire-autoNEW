/**
 * BookingPage — REPURPOSED to a Drop-Off info page.
 *
 * 2026-05-19 · Elon move #2 (the booking page was lying to customers).
 * Old multi-step BookingWizard at `/booking` and `/appointment` told
 * customers they were holding a slot. Shop is FCFS · they weren't.
 * Page now confirms operating reality: pull up + drop off · we text
 * when ready. Routes /booking + /appointment kept so external links
 * (Google · GMB · social) don't 404 — they just land on the truth.
 *
 * Restore the form: `git show <wave-181.95>:client/src/pages/BookingPage.tsx`
 */
import BookingWizard from "@/components/BookingWizard";
import NonstopNickJoin from "@/components/NonstopNickJoin";
import { SEOHead } from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import { BUSINESS } from "@shared/business";
import { Clock, MapPin, Phone } from "lucide-react";

export default function BookingPage() {
  return (
    <PageLayout activeHref="/booking">
      <SEOHead
        title="Drop-Off Cleveland · No Appointment, No Reservation | Nick's Tire & Auto"
        description="Drop your car off at Nick's on Euclid Ave any day we're open. First-come-first-served. A master tech calls back within 15 min with a written estimate. (216) 862-0005"
        canonicalPath="/booking"
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-20">
          <div className="text-center mb-10">
            <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase mb-3">
              How drop-off works
            </p>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-foreground">
              No Appointments · Just Pull Up
            </h1>
            <p className="mt-4 text-[16px] sm:text-[17px] text-foreground/70 leading-relaxed max-w-2xl mx-auto">
              We&apos;ve always been first come first served. If you can wait,
              we&apos;ll get to your car in line. If you can&apos;t, drop it off — we
              text you the second it&apos;s ready.
            </p>
            <p className="mt-4 text-[15px] text-foreground/80 leading-relaxed max-w-2xl mx-auto">
              Repair work? Free check. Written quote. <span className="text-primary font-semibold">You don&apos;t pay until you say yes.</span>
            </p>
          </div>

          <BookingWizard source="booking-page" />

          {/* Membership cross-sell at the drop-off decision point. Reuses
              the live NonstopNickJoin card (phone → Stripe hosted Checkout)
              rather than a second bespoke signup UI. Copy stays inside the
              FCFS pit-stop doctrine: we work cars in order — the membership
              sells $0 small-tire-stuff coverage, not line-skipping. */}
          <div className="mt-12 rounded-2xl border border-white/[0.08] bg-[#0f172a]/80 backdrop-blur-[12px] p-5 sm:p-7">
            <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase mb-2">
              While you&apos;re here
            </p>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Nonstop Nick &middot; the small tire stuff, covered
            </h2>
            <p className="mt-2 text-[14px] text-foreground/70 leading-relaxed">
              $7.99/mo on one registered vehicle: flat repairs, valve stems,
              rotation, rim cleans, and air-ups &mdash; $0 at the counter,
              every visit. Nick+ at $9.99/mo adds 15% off any repair, parts
              and labor.
            </p>
            <div className="mt-4">
              <NonstopNickJoin source="booking_page" />
            </div>
          </div>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="text-center">
              <Clock className="mx-auto w-6 h-6 text-primary mb-2" />
              <p className="text-[11px] font-bold tracking-wider uppercase text-foreground/60 mb-1">Shop Hours</p>
              <p className="text-[15px] text-foreground">Mon–Sat 8a–6p</p>
            </div>
            <div className="text-center">
              <MapPin className="mx-auto w-6 h-6 text-primary mb-2" />
              <p className="text-[11px] font-bold tracking-wider uppercase text-foreground/60 mb-1">Where We Are</p>
              <p className="text-[15px] text-foreground">{BUSINESS.address.street}</p>
              <p className="text-[13px] text-foreground/60">{BUSINESS.address.city}, {BUSINESS.address.state} {BUSINESS.address.zip}</p>
            </div>
            <div className="text-center">
              <Phone className="mx-auto w-6 h-6 text-primary mb-2" />
              <p className="text-[11px] font-bold tracking-wider uppercase text-foreground/60 mb-1">Front Desk</p>
              <a href={BUSINESS.phone.href} className="text-[15px] text-foreground hover:text-primary transition-colors">
                {BUSINESS.phone.dashed}
              </a>
            </div>
          </div>

          <div className="mt-16 space-y-6 max-w-2xl mx-auto">
            <div>
              <h2 className="text-[15px] font-bold text-foreground mb-2">
                &ldquo;Can I come right now?&rdquo;
              </h2>
              <p className="text-[14px] text-foreground/65 leading-relaxed">
                Yes. We don&apos;t schedule — the bays are open during shop hours
                and we work the cars in the order they pull up. Earlier in the
                day means less wait.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-bold text-foreground mb-2">
                &ldquo;How long is the wait?&rdquo;
              </h2>
              <p className="text-[14px] text-foreground/65 leading-relaxed">
                Depends on the day · usually 30 min to a couple hours for
                routine work. Call us and we&apos;ll tell you what the line looks
                like before you drive over.
              </p>
            </div>

            <div>
              <h2 className="text-[15px] font-bold text-foreground mb-2">
                &ldquo;What if I can&apos;t wait?&rdquo;
              </h2>
              <p className="text-[14px] text-foreground/65 leading-relaxed">
                Drop the keys with the front desk · take an Uber · we text
                when the car is ready for pickup. Most cars done same-day.
              </p>
            </div>
          </div>
        </div>
    </PageLayout>
  );
}
