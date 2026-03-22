/**
 * Premium Mobile CTA — Sticky bottom bar for mobile.
 * Glass morphism, responsive button layout, primary call highlight.
 */
import { Phone, Navigation, Calendar, MessageCircle, MessageSquare } from "lucide-react";
import { trackPhoneClick } from "@/components/SEO";
import { BUSINESS } from "@shared/business";
import { Link } from "wouter";

export default function SiteMobileCTA() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden safe-area-bottom">
      <div className="bg-[oklch(0.06_0.004_260/0.95)] backdrop-blur-2xl border-t border-[oklch(0.17_0.004_260/0.6)] shadow-[0_-2px_24px_oklch(0_0_0/0.4)]">
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-0">
          {/* Call — Primary, always visible */}
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("mobile-cta")}
            className="flex flex-col items-center justify-center py-3 gap-1 text-primary active:opacity-70 transition-opacity min-h-[56px]"
            aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
          >
            <Phone className="w-[18px] h-[18px]" />
            <span className="text-[10px] font-semibold tracking-wide">Call</span>
          </a>

          {/* Text Us */}
          <a
            href={`sms:${BUSINESS.phone.raw}`}
            className="flex flex-col items-center justify-center py-3 gap-1 text-foreground/40 active:text-foreground/60 transition-colors min-h-[56px]"
            aria-label={`Text Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
          >
            <MessageSquare className="w-[18px] h-[18px]" />
            <span className="text-[10px] font-semibold tracking-wide">Text</span>
          </a>

          {/* Book */}
          <a
            href="/#booking"
            className="flex flex-col items-center justify-center py-3 gap-1 text-foreground/40 active:text-foreground/60 transition-colors min-h-[56px]"
            aria-label="Book an appointment at Nick's Tire and Auto"
          >
            <Calendar className="w-[18px] h-[18px]" />
            <span className="text-[10px] font-semibold tracking-wide">Book Today</span>
          </a>

          {/* Diagnose — hidden on very small screens */}
          <a
            href="/diagnose"
            className="flex flex-col items-center justify-center py-3 gap-1 text-foreground/40 active:text-foreground/60 transition-colors min-h-[56px]"
            aria-label="Free car diagnostic tool"
          >
            <MessageCircle className="w-[18px] h-[18px]" />
            <span className="text-[10px] font-semibold tracking-wide">Diagnose</span>
          </a>

          {/* Directions — only on sm and up */}
          <a
            href={BUSINESS.urls.googleMapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex flex-col items-center justify-center py-3 gap-1 text-foreground/40 active:text-foreground/60 transition-colors min-h-[56px]"
            aria-label="Get directions to Nick's Tire and Auto"
          >
            <Navigation className="w-[18px] h-[18px]" />
            <span className="text-[10px] font-semibold tracking-wide">Directions</span>
          </a>
        </div>
        <Link href="/financing?utm_source=site_mobile_cta" className="block text-center text-emerald-400/70 text-[10px] mt-1 pb-1">
          Payment options available →
        </Link>
      </div>
    </div>
  );
}
