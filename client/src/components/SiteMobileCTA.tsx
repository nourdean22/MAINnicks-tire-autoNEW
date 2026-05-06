/**
 * Sticky Mobile CTA Bar — glassmorphic upgrade (2026-05-06).
 *
 * Fixed bottom bar with Call Now + Book Online buttons.
 * Appears after scrolling past the hero section. Hidden on desktop.
 *
 * Glassmorphic upgrade: backdrop-blur + translucent surface + subtle
 * gradient hairline at the top. Reads as "premium-but-grounded" —
 * Antigravity weightless feel without losing the working-class voice.
 *
 * iOS Safari + modern Chrome: full backdrop-filter blur.
 * Older browsers: degrades to a slightly translucent dark bar
 * (still legible, still on-brand).
 */
import { useState, useEffect } from "react";
import { Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackPhoneClick, trackEvent } from "@/components/SEO";
import { BUSINESS } from "@shared/business";

export default function SiteMobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          exit={{ y: 100 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-[9999] lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Yellow accent hairline above the bar — telegraphs "branded" */}
          <div
            className="absolute -top-px left-0 right-0 h-px pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(253,185,19,0.65) 35%, rgba(253,185,19,0.85) 50%, rgba(253,185,19,0.65) 65%, transparent 100%)",
            }}
          />
          <div
            className="flex items-center justify-center gap-[4%] px-4"
            style={{
              height: 68,
              // Glassmorphic — translucent black with backdrop blur.
              // 12px blur lands the visual payoff on every Cleveland
              // Android since Galaxy S8 without the 20px GPU spike that
              // can stutter on older devices. The background opacity is
              // dialed up slightly to compensate for less blur.
              // Non-supporting browsers fall back to the rgba layer alone
              // (still reads as a bar, just less premium).
              background: "rgba(10, 10, 10, 0.74)",
              backdropFilter: "blur(12px) saturate(135%)",
              WebkitBackdropFilter: "blur(12px) saturate(135%)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              boxShadow:
                "0 -8px 24px -8px rgba(0,0,0,0.5), 0 -1px 0 rgba(255,255,255,0.03) inset",
            }}
          >
            {/* Call Now */}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("mobile-cta")}
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
              className="flex items-center justify-center gap-2 font-bold cta-depth"
              style={{
                width: "48%",
                height: 48,
                background:
                  "linear-gradient(180deg, #FFC835 0%, #FDB913 50%, #E8A810 100%)",
                color: "#0A0A0A",
                fontSize: 16,
                borderRadius: 10,
                boxShadow:
                  "0 4px 14px -2px rgba(253,185,19,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
              }}
            >
              <Phone className="w-5 h-5" />
              {BUSINESS.phone.display}
            </a>

            {/* Book Online — glass-style outline, complements the gold CTA */}
            <a
              href="/booking"
              aria-label="Drop off your car at Nick's Tire & Auto"
              onClick={() => trackEvent("drop_off_click", { source: "mobile-cta" })}
              className="flex items-center justify-center font-bold cta-depth"
              style={{
                width: "48%",
                height: 48,
                background: "rgba(26,26,26,0.55)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: "#FDB913",
                border: "1px solid rgba(253,185,19,0.55)",
                fontSize: 16,
                borderRadius: 10,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              {/* 2026-05-06 audit fix · "Hold a Bay" was appointment-language
                  (banned per operator voice rules). "Drop-Off" affirms the
                  FCFS model. */}
              Drop-Off
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
