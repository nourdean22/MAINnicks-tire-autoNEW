/**
 * SiteMobileCTA — Enhanced sticky mobile CTA bar.
 * Shows phone, directions, and booking on mobile devices.
 */
import { Phone, Navigation, Calendar } from "lucide-react";
import { trackPhoneClick } from "@/components/SEO";
import { BUSINESS } from "@shared/business";

export default function SiteMobileCTA() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden safe-area-bottom">
      <div className="bg-nick-dark/95 backdrop-blur-md border-t border-border/30">
        <div className="grid grid-cols-3 divide-x divide-border/20">
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("mobile-cta")}
            className="flex flex-col items-center justify-center py-3 gap-1 text-nick-yellow active:bg-nick-yellow/10 transition-colors"
            aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
          >
            <Phone className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Call</span>
          </a>
          <a
            href={BUSINESS.urls.googleMapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center py-3 gap-1 text-foreground/70 active:bg-foreground/5 transition-colors"
            aria-label="Get directions to Nick's Tire and Auto"
          >
            <Navigation className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Directions</span>
          </a>
          <a
            href="/contact"
            className="flex flex-col items-center justify-center py-3 gap-1 text-foreground/70 active:bg-foreground/5 transition-colors"
            aria-label="Book an appointment at Nick's Tire and Auto"
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Book</span>
          </a>
        </div>
      </div>
    </div>
  );
}
