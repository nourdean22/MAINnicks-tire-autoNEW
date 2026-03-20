/**
 * Premium Lead Capture Popup
 * Smart triggers: exit-intent (desktop), scroll depth (80%), time delay (25s).
 * Refined glass morphism design.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Phone, AlertTriangle, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { trackLeadSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import { BUSINESS } from "@shared/business";

const STORAGE_KEY = "nicks_lead_popup_dismissed";
const DELAY_MS = 25000;
const SCROLL_THRESHOLD = 0.8;

export default function LeadPopup() {
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    vehicle: "",
    problem: "",
  });

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  }, []);

  const show = useCallback(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
    } catch {}
    setVisible(true);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
    } catch {}

    const timer = setTimeout(show, DELAY_MS);

    const onScroll = () => {
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (scrolled >= SCROLL_THRESHOLD) {
        show();
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 5) {
        show();
        document.removeEventListener("mouseleave", onMouseLeave);
      }
    };
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [show]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    // Meta Pixel + CAPI: Track lead popup submission
    const eventId = trackLeadSubmission({ source: "popup", problem: form.problem.trim() });
    const userData = getUserDataForCAPI();
    const utmData = getUtmData();
    submitLead.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      vehicle: form.vehicle.trim() || undefined,
      problem: form.problem.trim() || undefined,
      source: "popup",
      pixelEventId: eventId,
      pixelUserData: userData,
      ...utmData,
    });
  };

  const inputCls =
    "w-full bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />

          {/* Popup */}
          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative bg-[oklch(0.08_0.004_260/0.97)] backdrop-blur-2xl border border-[oklch(0.17_0.004_260)] rounded-2xl w-full max-w-md z-10 overflow-hidden shadow-2xl shadow-black/40"
          >
            {/* ─── HEADER ─── */}
            <div className="bg-primary/[0.06] border-b border-primary/10 px-6 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground text-[14px] tracking-[-0.01em]">
                  Car Problem?
                </span>
              </div>
              <button onClick={dismiss} className="text-foreground/25 hover:text-foreground/50 transition-colors p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6">
              {!submitted ? (
                <>
                  <h3 className="font-bold text-[22px] text-foreground tracking-[-0.02em]">
                    Tell us what's going on.
                  </h3>
                  <p className="text-foreground/40 text-[13px] mt-2 leading-relaxed">
                    Describe your vehicle problem and we'll call you with an honest assessment. No obligation.
                  </p>

                  <form onSubmit={handleSubmit} className="mt-5 space-y-3">
                    <input
                      type="text"
                      placeholder="Your name *"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      required
                      className={inputCls}
                    />
                    <input
                      type="tel"
                      placeholder="Phone number *"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      required
                      className={inputCls}
                    />
                    <input
                      type="text"
                      placeholder="Vehicle (year, make, model)"
                      value={form.vehicle}
                      onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))}
                      className={inputCls}
                    />
                    <textarea
                      placeholder="What's going on with your car?"
                      value={form.problem}
                      onChange={e => setForm(f => ({ ...f, problem: e.target.value }))}
                      rows={3}
                      className={`${inputCls} resize-none`}
                    />
                    <button
                      type="submit"
                      disabled={submitLead.isPending}
                      className="w-full bg-primary text-primary-foreground py-3.5 rounded-lg font-semibold text-[14px] tracking-[-0.01em] hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {submitLead.isPending ? "Submitting..." : "Get a Free Assessment"}
                    </button>
                  </form>

                  <div className="mt-4 flex items-center justify-center gap-2 text-foreground/25 text-[12px]">
                    <Phone className="w-3 h-3" />
                    <span>Or call: <a href={BUSINESS.phone.href} className="text-foreground/40 hover:text-foreground/60 transition-colors">{BUSINESS.phone.display}</a></span>
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-nick-teal/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-7 h-7 text-nick-teal" />
                  </div>
                  <h3 className="font-bold text-[22px] text-foreground tracking-[-0.02em]">
                    We got your info.
                  </h3>
                  <p className="text-foreground/40 text-[13px] mt-2 leading-relaxed max-w-[280px] mx-auto">
                    One of our team members will call you shortly with an honest assessment. No pressure.
                  </p>
                  <button
                    onClick={dismiss}
                    className="mt-6 bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity"
                  >
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
