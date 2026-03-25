/**
 * ExitIntentOffer — Acima lease-to-own CTA popup.
 * Detects mouse leaving viewport (desktop) and shows Acima apply prompt.
 * One-time per session (module-level flag).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";
import {
  ACIMA_COMPACT_DISCLOSURE,
  ACIMA_STATES_EXCLUDED,
  buildAcimaUrl,
  trackAcimaClick,
} from "@/lib/acima";

// Session-level flag to prevent re-fire
let exitIntentFiredThisSession = false;

export default function ExitIntentOffer({ serviceName }: { serviceName: string }) {
  const [visible, setVisible] = useState(false);
  const mountTimeRef = useRef(Date.now());

  const show = useCallback(() => {
    if (exitIntentFiredThisSession) return;
    exitIntentFiredThisSession = true;
    setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    // Desktop only — mobile exit intent is unreliable
    const mobile = window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
    if (mobile) return;

    const onMouseLeave = (e: MouseEvent) => {
      // Only trigger when mouse moves to top of viewport
      if (e.clientY > 10) return;
      // Wait at least 5 seconds before triggering
      if (Date.now() - mountTimeRef.current < 5000) return;
      show();
    };

    document.addEventListener("mouseleave", onMouseLeave);
    return () => document.removeEventListener("mouseleave", onMouseLeave);
  }, [show]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />

          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative bg-[oklch(0.08_0.004_260/0.97)] backdrop-blur-2xl border border-[oklch(0.17_0.004_260)] rounded-2xl w-full max-w-sm z-10 overflow-hidden shadow-2xl shadow-black/40"
          >
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 text-foreground/25 hover:text-foreground/50 transition-colors p-1 z-10"
              aria-label="Close popup"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6">
              <h3 className="font-bold text-[20px] text-foreground tracking-[-0.02em]">
                Before you go —
              </h3>
              <p className="text-foreground/50 text-[13px] mt-2 leading-relaxed">
                Get approved for lease-to-own in 60 seconds. $10 initial payment, no credit history needed.
              </p>

              <a
                href={buildAcimaUrl("exit_intent")}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackAcimaClick("exit_intent_cta")}
                className="mt-5 w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3.5 rounded-lg font-semibold text-[14px] hover:bg-emerald-500 transition-colors"
              >
                Check If I Qualify →
              </a>

              <a
                href={BUSINESS.phone.href}
                className="flex items-center justify-center gap-2 mt-3 text-foreground/40 text-[13px] hover:text-foreground/60 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                Or call us: {BUSINESS.phone.display}
              </a>

              <p className="text-[9px] text-foreground/25 mt-4 leading-relaxed">
                {ACIMA_COMPACT_DISCLOSURE} Not available in {ACIMA_STATES_EXCLUDED}.
              </p>

              <button
                onClick={dismiss}
                className="block mx-auto mt-3 text-foreground/25 text-[12px] hover:text-foreground/40 transition-colors"
              >
                No thanks, maybe later
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
