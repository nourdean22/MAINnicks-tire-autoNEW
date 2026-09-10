/**
 * ExitIntentModal — last-chance rescue when the user is about to leave.
 *
 * Triggers:
 *   - Desktop: mouseleave from top edge of viewport (clientY <= 0)
 *   - Mobile/touch: gated by 8s arm timer; modal opens on next mouseleave
 *
 * Once shown, suppressed for 24h via localStorage. Doesn't fire on
 * /admin, /booking, or /contact (the user is already converting).
 *
 * Brand-voice copy (post wave-28 FCFS audit + wave-46 voice operators):
 *   - Headline: "Don't break down before you fix it." (catastrophic-scenario)
 *   - Sub: explicit 15-min text-back promise + FCFS clarity
 *   - Primary CTA: "TEXT ME AN ESTIMATE" (action verb, what user gets)
 *   - Dismiss microcopy: "I'll risk it" (anti-pattern naming, on-brand)
 *
 * No countdowns, no fake scarcity counts. The 15-minute estimate-back
 * promise is verifiable + matches the booking-page promise (single
 * source of truth for the brand commitment).
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, Phone, Check, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useReviewStats } from "@/hooks/useReviewStats";
import { BUSINESS } from "@shared/business";

const STORAGE_KEY = "exit-intent-shown-until";
const TTL_MS = 24 * 60 * 60 * 1000;
const SUPPRESS_PATHS = ["/admin", "/booking", "/contact"];

export default function ExitIntentModal() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { rating: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();

  const submit = trpc.callback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => setOpen(false), 2500);
    },
    onError: () => toast.error("Could not save. Call (216) 862-0005."),
  });

  const onSuppressed = SUPPRESS_PATHS.some((p) => location.startsWith(p));

  useEffect(() => {
    if (typeof window === "undefined" || onSuppressed) return;
    try {
      const until = Number(localStorage.getItem(STORAGE_KEY) || 0);
      if (until > Date.now()) return;
    } catch {
      // proceed
    }

    let armed = false;
    // Arm only after 8 seconds on the page (avoid firing on quick bounces)
    const armTimer = setTimeout(() => { armed = true; }, 8000);

    const onMouseLeave = (e: MouseEvent) => {
      if (!armed) return;
      if (e.clientY <= 0) {
        setOpen(true);
        try { localStorage.setItem(STORAGE_KEY, String(Date.now() + TTL_MS)); } catch {}
        document.removeEventListener("mouseleave", onMouseLeave);
      }
    };
    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      clearTimeout(armTimer);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [onSuppressed]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a 10-digit phone."); return; }
    submit.mutate({
      name: "Exit-intent visitor",
      phone: phone.trim(),
      sourcePage: window.location.pathname + "?capture=exit-intent",
    });
  }

  function dismiss() {
    setOpen(false);
  }

  // a11y: trap focus inside the dialog + Escape closes + restore focus on close.
  // autoFocus:false — the phone input already has autoFocus; don't fight it.
  useFocusTrap(dialogRef, open, { onEscape: dismiss, autoFocus: false });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={dismiss}
        >
          <motion.div
            ref={dialogRef}
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 20 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-intent-title"
            className="relative max-w-md w-full rounded-lg border border-red-500/40 bg-card p-6 shadow-2xl ring-1 ring-red-500/20"
          >
            <button
              onClick={dismiss}
              aria-label="Close"
              className="absolute top-3 right-3 text-foreground/40 hover:text-foreground/70 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-[10px] font-bold tracking-wider text-red-400 uppercase">Wait</span>
            </div>

            <h2 id="exit-intent-title" className="font-bold text-2xl text-foreground tracking-tight mb-2">
              Don't break down before you fix it.
            </h2>

            <p className="text-sm text-foreground/70 mb-5 leading-relaxed">
              Drop your number — we'll text you a written estimate within
              15 minutes during open hours. First-come, first-served.
              No appointment, no reservation needed.
            </p>

            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-2">
                <input
                  type="tel"
                  autoFocus
                  placeholder="(216) 555-1234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded border border-foreground/20 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                  disabled={submit.isPending}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submit.isPending}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded bg-primary text-primary-foreground py-2.5 text-sm font-bold tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                    TEXT ME AN ESTIMATE
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="text-[11px] text-foreground/40 hover:text-foreground/60 transition-colors px-2"
                  >
                    I'll risk it
                  </button>
                </div>
                <p className="text-[10px] text-foreground/40 text-center pt-1">
                  Or call <a href={BUSINESS.phone.href} className="text-primary hover:underline">{BUSINESS.phone.display}</a> directly · ★{reviewRating.toFixed(1)} from {reviewCountDisplay} reviews
                </p>
              </form>
            ) : (
              <div className="flex items-center gap-2 rounded bg-emerald-500/10 border border-emerald-500/30 px-3 py-3 text-sm font-semibold text-emerald-400">
                <Check className="w-4 h-4" /> On it. We'll text within 15 min during open hours.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
