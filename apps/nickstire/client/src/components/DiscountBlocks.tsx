/**
 * Shared shell for /discounts and /discounts/:slug. Every number and term on
 * these blocks comes from BUSINESS and DISCOUNT_PROGRAMS in shared/business.ts.
 */
import { Link } from "wouter";
import { Phone, MapPin } from "lucide-react";
import { BUSINESS, DISCOUNT_PROGRAMS, type DiscountGroup } from "@shared/business";
import { trackPhoneClick, trackEvent } from "@/components/SEO";

export function CallAndDirections({ source }: { source: string }) {
  return (
    <div className="mt-6 flex flex-col sm:flex-row gap-3">
      <a
        href={BUSINESS.phone.href}
        onClick={() => trackPhoneClick(`${source}-call`)}
        className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold hover:bg-primary/90 transition-colors"
      >
        <Phone className="w-4 h-4" aria-hidden="true" />
        Call {BUSINESS.phone.display}
      </a>
      <a
        href={BUSINESS.urls.googleMapsDirections}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("directions_click", { source })}
        className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-6 py-3 font-bold hover:border-primary hover:text-primary transition-colors"
      >
        <MapPin className="w-4 h-4" aria-hidden="true" />
        Get directions
      </a>
    </div>
  );
}

/** The terms the counter honors, for one group or (no group) the general offer. */
export function OfferBox({ group }: { group?: DiscountGroup }) {
  const { display, finePrint } = DISCOUNT_PROGRAMS.offer;
  return (
    <section aria-labelledby="offer-heading" className="border-2 border-primary bg-card/40 p-5 sm:p-8">
      <h2 id="offer-heading" className="text-sm font-semibold text-primary">
        {group ? `${group.label} discount` : "The discount"}
      </h2>
      <p className="mt-2 text-3xl sm:text-4xl font-bold text-foreground leading-tight">{display}</p>
      {group && (
        <>
          <p className="mt-4 text-foreground/80">
            <span className="font-semibold text-foreground">Who qualifies: </span>
            {group.qualifies}
          </p>
          <p className="mt-4 font-semibold text-foreground">Bring one of these:</p>
          <ul className="mt-2 space-y-1 text-foreground/80 list-disc pl-5">
            {group.proof.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </>
      )}
      <ul className="mt-5 space-y-1 text-sm text-foreground/70">
        {finePrint.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </section>
  );
}

export function VisitBox() {
  return (
    <section aria-labelledby="visit-heading" className="border border-border/50 p-5 sm:p-6">
      <h2 id="visit-heading" className="text-xl font-bold text-foreground">Come in</h2>
      <dl className="mt-3 space-y-2 text-foreground/80">
        <div>
          <dt className="sr-only">Address</dt>
          <dd>{BUSINESS.address.full}</dd>
        </div>
        <div>
          <dt className="sr-only">Hours</dt>
          <dd>{BUSINESS.hours.display}</dd>
        </div>
        <div>
          <dt className="sr-only">How it works</dt>
          <dd>{BUSINESS.model.walkIns}. {BUSINESS.model.noAppointment}.</dd>
        </div>
      </dl>
      <CallAndDirections source="discounts-visit" />
    </section>
  );
}

export function FaqList({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-2xl font-bold text-foreground">Questions</h2>
      <div className="mt-4 divide-y divide-border/40 border-y border-border/40">
        {faqs.map((f) => (
          <div key={f.q} className="py-4">
            <h3 className="font-semibold text-foreground">{f.q}</h3>
            <p className="mt-1 text-foreground/75 leading-relaxed">{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function SeeAllDiscounts() {
  return (
    <p className="text-foreground/80">
      <Link href="/discounts" className="text-primary underline hover:no-underline">See every discount</Link>
    </p>
  );
}
