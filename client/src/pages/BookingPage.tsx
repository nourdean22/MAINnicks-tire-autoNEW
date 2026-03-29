import BookingWizard from "@/components/BookingWizard";
import SiteNavbar from "@/components/SiteNavbar";
import SiteFooter from "@/components/SiteFooter";
import { BUSINESS } from "@shared/business";

export default function BookingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNavbar />
      <main className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Book Your Appointment
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
      </main>
      <SiteFooter />
    </div>
  );
}
