/**
 * Lead Capture Popup
 * Smart triggers: exit-intent (desktop), scroll depth (50%), and time delay (20s).
 * Captures name, phone, vehicle, and problem description.
 * Only shows once per session (localStorage flag).
 */

import { useState, useEffect, useCallback } from "react";
import { X, Phone, AlertTriangle, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

const STORAGE_KEY = "nicks_lead_popup_dismissed";
const DELAY_MS = 20000; // 20 seconds
const SCROLL_THRESHOLD = 0.5; // 50% scroll

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

  // ─── TRIGGERS ─────────────────────────────────────────
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
    } catch {}

    // 1. Time delay trigger
    const timer = setTimeout(show, DELAY_MS);

    // 2. Scroll depth trigger
    const onScroll = () => {
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (scrolled >= SCROLL_THRESHOLD) {
        show();
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // 3. Exit-intent trigger (desktop only)
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
    submitLead.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      vehicle: form.vehicle.trim() || undefined,
      problem: form.problem.trim() || undefined,
      source: "popup",
    });
  };

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
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismiss} />

          {/* Popup */}
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="relative bg-card/95 backdrop-blur-md border border-nick-yellow/30 rounded-xl w-full max-w-md z-10 overflow-hidden shadow-2xl shadow-nick-yellow/10"
          >
            {/* Yellow top bar with gradient */}
            <div className="bg-gradient-to-r from-nick-yellow via-nick-gold to-nick-orange px-6 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-nick-dark" />
                <span className="font-heading font-bold text-nick-dark tracking-wider uppercase text-sm">
                  Car Problem?
                </span>
              </div>
              <button onClick={dismiss} className="text-nick-dark/60 hover:text-nick-dark transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {!submitted ? (
                <>
                  <h3 className="font-heading font-bold text-2xl text-foreground tracking-tight">
                    Tell us what's going on.
                  </h3>
                  <p className="text-foreground/60 text-sm mt-2 leading-relaxed">
                    Describe your vehicle problem and we'll call you with an honest assessment. No obligation.
                  </p>

                  <form onSubmit={handleSubmit} className="mt-5 space-y-3">
                    <input
                      type="text"
                      placeholder="Your name *"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      required
                      className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-sm font-mono placeholder:text-foreground/30 focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    />
                    <input
                      type="tel"
                      placeholder="Phone number *"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      required
                      className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-sm font-mono placeholder:text-foreground/30 focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Vehicle (year, make, model)"
                      value={form.vehicle}
                      onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))}
                      className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-sm font-mono placeholder:text-foreground/30 focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    />
                    <textarea
                      placeholder="What's going on with your car?"
                      value={form.problem}
                      onChange={e => setForm(f => ({ ...f, problem: e.target.value }))}
                      rows={3}
                      className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-sm font-mono placeholder:text-foreground/30 focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all resize-none"
                    />
                    <button
                      type="submit"
                      disabled={submitLead.isPending}
                      className="w-full bg-nick-yellow text-nick-dark py-3.5 rounded-md font-heading font-bold tracking-wider uppercase text-sm hover:bg-nick-gold transition-colors glow-yellow disabled:opacity-50"
                    >
                      {submitLead.isPending ? "SUBMITTING..." : "GET A FREE ASSESSMENT"}
                    </button>
                  </form>

                  <div className="mt-4 flex items-center justify-center gap-2 text-foreground/40 text-xs">
                    <Phone className="w-3 h-3 text-nick-teal" />
                    <span className="font-mono">Or call directly: <a href="tel:2168620005" className="text-nick-teal hover:text-nick-cyan transition-colors">(216) 862-0005</a></span>
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <CheckCircle className="w-12 h-12 text-nick-teal mx-auto mb-4" />
                  <h3 className="font-heading font-bold text-2xl text-foreground tracking-tight">
                    We got your info.
                  </h3>
                  <p className="text-foreground/60 text-sm mt-2 leading-relaxed">
                    One of our team members will call you shortly with an honest assessment. No pressure, no upselling.
                  </p>
                  <button
                    onClick={dismiss}
                    className="mt-6 bg-nick-yellow text-nick-dark px-8 py-3 rounded-md font-heading font-bold tracking-wider uppercase text-sm hover:bg-nick-gold transition-colors glow-yellow"
                  >
                    CLOSE
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
