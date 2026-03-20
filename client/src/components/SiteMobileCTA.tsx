/**
 * SiteMobileCTA — Enhanced sticky mobile CTA bar.
 * Shows phone, directions, and booking on mobile devices.
 * The "Call" button is highlighted as the primary action.
 */
import { Phone, Navigation, Calendar, MessageCircle } from "lucide-react";
import { trackPhoneClick } from "@/components/SEO";
import { BUSINESS } from "@shared/business";

export default function SiteMobileCTA() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden safe-area-bottom">
      <div className="bg-nick-dark/98 backdrop-blur-md border-t border-nick-yellow/30 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
        <div className="grid grid-cols-4 divide-x divide-border/20">
          {/* Call — Primary action, highlighted */}
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("mobile-cta")}
            className="flex flex-col items-center justify-center py-2.5 gap-0.5 bg-nick-yellow/10 text-nick-yellow active:bg-nick-yellow/20 transition-colors"
            aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
          >
            <Phone className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Call</span>
          </a>

          {/* Book — Links to booking section */}
          <a
            href="/#booking"
            className="flex flex-col items-center justify-center py-2.5 gap-0.5 text-foreground/70 active:bg-foreground/5 transition-colors"
            aria-label="Book an appointment at Nick's Tire and Auto"
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Book</span>
          </a>

          {/* Diagnose — Links to free diagnostic tool */}
          <a
            href="/diagnose"
            className="flex flex-col items-center justify-center py-2.5 gap-0.5 text-foreground/70 active:bg-foreground/5 transition-colors"
            aria-label="Free car diagnostic tool"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Diagnose</span>
          </a>

          {/* Directions */}
          <a
            href={BUSINESS.urls.googleMapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center py-2.5 gap-0.5 text-foreground/70 active:bg-foreground/5 transition-colors"
            aria-label="Get directions to Nick's Tire and Auto"
          >
            <Navigation className="w-5 h-5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Directions</span>
          </a>
        </div>
      </div>
    </div>
  );
}
