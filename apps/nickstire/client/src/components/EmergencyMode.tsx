/**
 * EmergencyMode — Emergency request UI shown when shop is closed
 * Global component displayed when business hours check shows closed
 * Features emergency request form and floating action button
 */

import { useState, useRef } from "react";
import { AlertTriangle, Phone, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useBusinessHours } from "@/hooks/useBusinessHours";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { BUSINESS } from "@shared/business";

interface EmergencyFormData {
  name: string;
  phone: string;
  vehicle: string;
  issue: string;
  urgency: "emergency" | "next-day";
}

export function EmergencyMode() {
  const { isOpen, nextOpenTime } = useBusinessHours();
  const [location] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<EmergencyFormData>({
    name: "",
    phone: "",
    vehicle: "",
    issue: "",
    urgency: "emergency",
  });
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Close resets the success state so the next open starts fresh. The
  // confirmation stays on screen until the customer dismisses it — the
  // old 3s auto-close could remove it before a stressed customer at the
  // roadside finished reading.
  const closeForm = () => {
    setShowForm(false);
    if (submitted) {
      setSubmitted(false);
      setFormData({ name: "", phone: "", vehicle: "", issue: "", urgency: "emergency" });
    }
  };

  // a11y: trap focus inside the emergency modal, autofocus first field,
  // Escape closes, restore focus to opener on close.
  useFocusTrap(dialogRef, showForm, {
    onEscape: () => {
      closeForm();
    },
  });

  const submitEmergency = trpc.emergency.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
    // 2026-05-23 · was silent on failure — worst possible class on the
    // emergency form (after-hours stuck customer · most stakes). Now
    // routes the customer to the phone line if the submit fails.
    onError: () => {
      toast.error("Couldn't submit emergency request — call (216) 862-0005 right now.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.issue) {
      // toast not alert() — alert() is suppressed in iOS PWA standalone
      // mode (where users-on-phones often run customer-facing PWAs) so
      // a missing-field submit produced no visible feedback. Same
      // native-primitive bug class fixed in wave-139/168 admin work.
      toast.error("Please fill in all required fields");
      return;
    }
    // 2026-05-23 · 10-digit phone validation. Truthy-only check let a
    // single-character "5" pass; SMS confirmation then went nowhere
    // and the emergency was lost. Matches CallbackModal/Financing pattern.
    const digits = formData.phone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast.error("Please enter a 10-digit phone so we can reach you.");
      return;
    }
    submitEmergency.mutate({
      name: formData.name,
      phone: formData.phone,
      vehicle: formData.vehicle || undefined,
      problem: formData.issue,
      urgency: formData.urgency,
    });
  };

  // Never show on admin pages; only show on customer-facing pages when closed
  if (isOpen || location.startsWith("/admin")) {
    return null;
  }

  return (
    <>
      {/* Closed-banner — slim, single-line, non-intrusive.
          Was a 90px tall block taking the entire top of the page above
          the hero (ate brand real estate). Now: compact 36-40px strip
          with truncated copy and a small CTA pill so the hero can
          breathe. On mobile, only the headline + button render. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-0 left-0 right-0 z-[60] bg-red-950/95 border-b border-red-500/40 backdrop-blur-md"
      >
        <div className="container flex items-center justify-between gap-3 py-1.5 px-4">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden />
            <p className="text-[12px] sm:text-[13px] text-red-100 truncate">
              <span className="font-bold tracking-wide">Closed</span>
              <span className="hidden sm:inline text-red-300/80"> · re-opens {nextOpenTime} · file an emergency request to be first in line</span>
              <span className="sm:hidden text-red-300/80"> · re-opens {nextOpenTime}</span>
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="shrink-0 rounded bg-red-500 hover:bg-red-400 text-white text-[11px] font-bold tracking-wider px-2.5 py-1 transition-colors"
          >
            EMERGENCY
          </button>
        </div>
      </motion.div>

      {/* Emergency Modal Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10001] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeForm}
          >
            <motion.div
              ref={dialogRef}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-background border border-border/50 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto p-6 lg:p-8"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="emergency-request-title"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <h2 id="emergency-request-title" className="font-bold text-foreground text-lg tracking-wide">EMERGENCY REQUEST</h2>
                </div>
                <button
                  onClick={closeForm}
                  className="flex h-11 w-11 items-center justify-center text-foreground/70 hover:text-foreground transition-colors sm:h-8 sm:w-8"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {submitted ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-green-400 text-2xl">✓</span>
                  </div>
                  <h3 className="font-bold text-foreground mb-2">REQUEST RECEIVED!</h3>
                  {/* No "appointment" — the shop is first-come, first-served.
                      Promising an appointment here misstates the service
                      contract the rest of the site is built around. */}
                  <p className="text-foreground/60 text-sm">
                    We'll contact you when the shop opens at {nextOpenTime} to confirm next steps — no appointment needed, we're first-come, first-served.
                  </p>
                  <p className="text-foreground/60 text-sm mt-3">
                    Need help right now?{" "}
                    <a href={BUSINESS.phone.href} className="text-primary font-semibold hover:underline">
                      Call {BUSINESS.phone.display}
                    </a>
                  </p>
                  <button
                    type="button"
                    onClick={closeForm}
                    className="mt-6 w-full border border-border/60 text-foreground/80 hover:text-foreground hover:border-border py-3 font-bold text-sm tracking-wide transition-colors"
                  >
                    CLOSE
                  </button>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      aria-label="Your name"
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="Your name"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      Phone <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                      aria-label="Phone number"
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">Vehicle (optional)</label>
                    <input
                      type="text"
                      value={formData.vehicle}
                      onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                      aria-label="Vehicle year make model"
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="e.g. 2018 Honda Civic"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      What's happening? <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={formData.issue}
                      onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                      required
                      aria-label="Describe your issue"
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm resize-none"
                      placeholder="Describe your issue..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-foreground/60 text-sm font-semibold">Urgency</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 cursor-pointer p-3 border border-border/50 rounded hover:bg-card/50 transition-colors">
                        <input
                          type="radio"
                          name="urgency"
                          value="emergency"
                          checked={formData.urgency === "emergency"}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value as "emergency" | "next-day" })}
                          className="w-4 h-4"
                        />
                        <span className="flex-1">
                          <span className="font-semibold text-foreground text-sm">🔴 Emergency — need help ASAP</span>
                          <p className="text-foreground/70 text-xs">Critical issue, vehicle not drivable</p>
                        </span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer p-3 border border-border/50 rounded hover:bg-card/50 transition-colors">
                        <input
                          type="radio"
                          name="urgency"
                          value="next-day"
                          checked={formData.urgency === "next-day"}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value as "emergency" | "next-day" })}
                          className="w-4 h-4"
                        />
                        <span className="flex-1">
                          <span className="font-semibold text-foreground text-sm">🟡 Can wait until tomorrow</span>
                          <p className="text-foreground/70 text-xs">Non-critical, can schedule for next business day</p>
                        </span>
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitEmergency.isPending}
                    className="w-full bg-red-500 hover:bg-red-600 text-white py-3 font-bold text-sm tracking-wide transition-colors disabled:opacity-50 mt-6"
                  >
                    {submitEmergency.isPending ? "SUBMITTING..." : "SUBMIT EMERGENCY REQUEST"}
                  </button>

                  <p className="text-foreground/70 text-xs text-center">
                    We'll contact you as soon as possible to confirm your request.
                  </p>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Emergency Button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setShowForm(true)}
        aria-label="Open emergency request form"
        className="fixed bottom-52 right-4 z-[95] bg-red-500 hover:bg-red-600 text-white p-4 rounded-full font-bold text-sm tracking-wide transition-colors shadow-lg flex items-center gap-2 lg:bottom-6 lg:right-24"
      >
        <motion.span
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="inline-block"
        >
          🚨
        </motion.span>
        <span className="hidden sm:inline">EMERGENCY</span>
      </motion.button>
    </>
  );
}

export default EmergencyMode;
