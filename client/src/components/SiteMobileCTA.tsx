/**
 * Shared Mobile CTA — sticky bottom bar on mobile.
 * Call + Book buttons, appears after scrolling.
 */
import { useState, useEffect } from "react";
import { trackPhoneClick } from "@/components/SEO";
import { Phone } from "lucide-react";

export default function SiteMobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-nick-dark/95 backdrop-blur-xl border-t border-border p-3 flex gap-2">
      <a href="tel:2168620005" onClick={() => trackPhoneClick("mobile-sticky")} className="flex items-center justify-center gap-2 bg-foreground text-background flex-1 py-3 rounded-full font-medium text-sm" aria-label="Call now">
        <Phone className="w-4 h-4" />
        Call Now
      </a>
      <a href="/contact" className="flex items-center justify-center gap-2 border border-foreground/30 text-foreground flex-1 py-3 rounded-full font-medium text-sm" aria-label="Book online">
        Book Online
      </a>
    </div>
  );
}
