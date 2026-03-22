/**
 * ExitIntentOffer — Service pages only.
 * Detects mouse leaving viewport (desktop) and shows a quick lead capture modal.
 * Name + Phone only. One-time per session (React state).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, CheckCircle, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { trackLeadSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE, ACIMA_SOCIAL_PROOF } from "@/lib/acima";

// Session-level flag to prevent re-fire
let exitIntentFiredThisSession = false;

export default function ExitIntentOffer({ serviceName }: { serviceName: string }) {
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const mountTimeRef = useRef(Date.now());

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;

    const eventId = trackLeadSubmission({ source: "exit-intent", problem: serviceName });
    const userData = getUserDataForCAPI();
    const utmData = getUtmData();

    submitLead.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      problem: `Exit intent — interested in ${serviceName}`,
      source: "popup",
      pixelEventId: eventId,
      pixelUserData: userData,
      ...utmData,
    });
  };

  const inputCls =
    "w-full bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-4 py-3 text-[14px] placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all";

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
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6">
              {!submitted ? (
                <>
                  <h3 className="font-bold text-[20px] text-foreground tracking-[-0.02em]">
                    Before you go — get a free estimate.
                  </h3>
                  <p className="text-foreground/40 text-[13px] mt-2 leading-relaxed">
                    No obligation. We'll text you a price in 15 minutes.
                  </p>
                  <p className="text-[11px] text-emerald-400/60 mt-1">
                    Lease-to-own available — $10 down with Acima
                    <span className="block text-[9px] text-emerald-400/40 mt-0.5">{ACIMA_SOCIAL_PROOF}</span>
                    <span className="block text-[9px] text-foreground/25 mt-0.5">{ACIMA_COMPACT_DISCLOSURE}</span>
                  </p>

                  <form onSubmit={handleSubmit} className="mt-5 space-y-3">
                    <input
                      type="text"
                      placeholder="Your name"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      required
                      className={inputCls}
                    />
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      required
                      className={inputCls}
                    />
                    <button
                      type="submit"
                      disabled={submitLead.isPending}
                      className="w-full bg-primary text-primary-foreground py-3.5 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {submitLead.isPending ? "Submitting..." : "Get My Free Estimate"}
                    </button>
                  </form>

                  <button
                    onClick={dismiss}
                    className="block mx-auto mt-3 text-foreground/25 text-[12px] hover:text-foreground/40 transition-colors"
                  >
                    No thanks, maybe later
                  </button>
                </>
              ) : (
                <div className="py-6 text-center">
                  <CheckCircle className="w-10 h-10 text-primary mx-auto mb-3" />
                  <h3 className="font-bold text-[18px] text-foreground">We'll text you shortly.</h3>
                  <p className="text-foreground/40 text-[13px] mt-2">
                    Expect a text from {BUSINESS.phone.display}.
                  </p>
                  <button onClick={dismiss} className="mt-4 text-foreground/30 text-[12px] hover:text-foreground/50 transition-colors">
                    Close
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
