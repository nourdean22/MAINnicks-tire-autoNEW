/**
 * SiteMobileCTA — unified mobile sticky bar · 3 actions, no booking lie.
 *
 * 2026-05-19 · Elon move #1 + #3 fused. Previously TWO competing mobile
 * surfaces (this bar + QuickAccessDock floating pills) which split the
 * operator's CTA real estate. Replaced both with ONE bar at the thumb-
 * height a Cleveland customer's hand is already resting on.
 *
 * 3 actions, ranked by conversion likelihood for the FCFS tire shop:
 *   1. CALL   — operator's #1 conversion path · gold · primary
 *   2. TEXT   — F25e SMS gateway · pre-fills with shop signature
 *   3. DIRECTIONS — Google Maps · for the "I'm pulling up now" intent
 *
 * No "Drop-Off"/booking button: shop is FCFS, the public booking page
 * is being killed (Elon move #2). Customer who taps DIRECTIONS IS the
 * drop-off; no form needed.
 *
 * iOS Safari + modern Chrome: full backdrop-filter blur.
 * Older browsers: degrades to translucent dark bar (still legible).
 * Safe-area-inset-bottom respected on devices with home indicator.
 */
import { useState, useEffect } from "react";
import { Phone, MessageSquare, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackPhoneClick, trackEvent } from "@/components/SEO";
import { BUSINESS } from "@shared/business";

export default function SiteMobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show after the hero is in the rearview — keeps the first paint
    // clean while ensuring the bar is there once the operator scrolls.
    const handleScroll = () => {
      setVisible(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // F25e SMS gateway is the primary path · pre-filled body lowers
  // friction. The operator gets context in the message: "Hey Nick · I
  // need a [SERVICE] for my [VEHICLE]" template prompts the customer
  // to fill in the blank, not stare at a blank message box.
  const smsHref = `sms:${BUSINESS.phone.raw}?&body=${encodeURIComponent(
    "Hey Nick · "
  )}`;

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
          {/* Brand-yellow hairline · telegraphs "this bar is part of the shop" */}
          <div
            className="absolute -top-px left-0 right-0 h-px pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(253,185,19,0.65) 35%, rgba(253,185,19,0.85) 50%, rgba(253,185,19,0.65) 65%, transparent 100%)",
            }}
          />
          <div
            className="flex items-stretch justify-between gap-2 px-3"
            style={{
              height: 68,
              background: "rgba(10, 10, 10, 0.78)",
              backdropFilter: "blur(12px) saturate(135%)",
              WebkitBackdropFilter: "blur(12px) saturate(135%)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              boxShadow:
                "0 -8px 24px -8px rgba(0,0,0,0.5), 0 -1px 0 rgba(255,255,255,0.03) inset",
            }}
          >
            {/* CALL · primary action · brand-gold · 50% of width */}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("mobile-cta")}
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 cta-depth"
              style={{
                background:
                  "linear-gradient(180deg, #FFC835 0%, #FDB913 50%, #E8A810 100%)",
                color: "#0A0A0A",
                borderRadius: 10,
                boxShadow:
                  "0 4px 14px -2px rgba(253,185,19,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
              }}
            >
              <Phone className="w-5 h-5" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
                CALL
              </span>
            </a>

            {/* TEXT · secondary · outline · F25e SMS gateway */}
            <a
              href={smsHref}
              onClick={() => trackEvent("sms_click", { source: "mobile-cta" })}
              aria-label="Text Nick's Tire and Auto"
              className="flex flex-col items-center justify-center gap-0.5 flex-1 cta-depth"
              style={{
                background: "rgba(26,26,26,0.55)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: "#FDB913",
                border: "1px solid rgba(253,185,19,0.55)",
                borderRadius: 10,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <MessageSquare className="w-5 h-5" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
                TEXT
              </span>
            </a>

            {/* DIRECTIONS · tertiary · outline · opens Google Maps */}
            <a
              href={BUSINESS.urls.googleMapsDirections}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("directions_click", { source: "mobile-cta" })}
              aria-label="Get directions to Nick's Tire and Auto"
              className="flex flex-col items-center justify-center gap-0.5 flex-1 cta-depth"
              style={{
                background: "rgba(26,26,26,0.55)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: "#FDB913",
                border: "1px solid rgba(253,185,19,0.55)",
                borderRadius: 10,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <MapPin className="w-5 h-5" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
                DIRECTIONS
              </span>
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
