import BookingWizard from "@/components/BookingWizard";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import { BUSINESS } from "@shared/business";
import { Link } from "wouter";

export default function BookingPage() {
  return (
    <PageLayout activeHref="/booking">
      <SEOHead
        title="Book Auto Repair Online | Cleveland OH | Walk-Ins Welcome"
        description="Schedule auto repair or tire service online at Nick's Tire & Auto Cleveland. Walk-ins welcome 7 days. Same-day service available. (216) 862-0005"
        canonicalPath="/booking"
      />
      <LocalBusinessSchema />
      <main className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Schedule Your Drop-Off
          </h1>
          <p className="text-foreground/60 text-lg max-w-xl mx-auto">
            Schedule your service online. Walk-ins are also welcome 7 days a week.
          </p>
          <p className="text-foreground/40 text-sm mt-2">
            Or call us directly:{" "}
            <a href={`tel:${BUSINESS.phone.raw}`} className="text-primary hover:underline font-medium">
              {BUSINESS.phone.display}
            </a>
          </p>
        </div>
        <BookingWizard />
        <div className="mt-12 text-center text-sm text-foreground/50 space-y-2">
          <p>Need help choosing a service? Check our <Link href="/services" className="text-primary hover:underline">services overview</Link> or use our <Link href="/diagnose" className="text-primary hover:underline">diagnostic tool</Link>.</p>
          <p>Payment plans available — <Link href="/financing" className="text-primary hover:underline">see financing options</Link>.</p>
        </div>
      </main>
      <InternalLinks title="Explore Our Services" maxLinks={6} />
    </PageLayout>
  );
}
