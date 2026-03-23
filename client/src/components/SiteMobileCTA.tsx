/**
 * Sticky Mobile CTA Bar (Phase 1.6)
 * Fixed bottom bar with Call Now + Book Online buttons.
 * Appears after scrolling past the hero section. Hidden on desktop.
 */
import { useState, useEffect } from "react";
import { Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackPhoneClick } from "@/components/SEO";
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
          <div
            className="flex items-center justify-center gap-[4%] px-4"
            style={{
              height: 64,
              background: "#0A0A0A",
              borderTop: "1px solid #2A2A2A",
            }}
          >
            {/* Call Now */}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("mobile-cta")}
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
              className="flex items-center justify-center gap-2 font-bold"
              style={{
                width: "48%",
                height: 48,
                background: "#FDB913",
                color: "#0A0A0A",
                fontSize: 16,
                borderRadius: 8,
              }}
            >
              <Phone className="w-5 h-5" />
              Call Now
            </a>

            {/* Book Online */}
            <a
              href="/#booking"
              aria-label="Book an appointment online"
              className="flex items-center justify-center font-bold"
              style={{
                width: "48%",
                height: 48,
                background: "#1A1A1A",
                color: "#FDB913",
                border: "1px solid #FDB913",
                fontSize: 16,
                borderRadius: 8,
              }}
            >
              Book Online
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
