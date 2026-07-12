/**
 * UrgencyWidget — floating bottom-right callout with REAL shop capacity data.
 *
 * Behavior:
 *   - Hidden until user scrolls past 35% of the page (signals real intent).
 *   - Slides in from bottom-right with subtle attention.
 *   - Shows: real line status (cars in shop, estimated wait) — NEVER
 *     "slots"/"reserve" language. The shop is strictly first-come-first-
 *     served with no appointment slots; implying a reservable slot is a
 *     standing-rule violation (fixed feat/home-v2 after the 2026-07-12
 *     audit caught "slots left / Next available / RESERVE" shipping live).
 *   - Optional 1-tap callback request → captures phone via callback.submit.
 *   - Auto-collapses after 8s if not interacted; re-expandable on hover.
 *   - LocalStorage flag suppresses for 24h after dismiss.
 *
 * Per the conversion-overhaul spec (`docs/CONVERSION-OVERHAUL-V1.1.md`):
 *   - All numbers are REAL (from `trpc.conversion.shopCapacity`).
 *   - Hides outside business hours rather than fake an open status.
 *   - Doesn't show on /admin or /booking (don't double-prompt the user
 *     who's already converting).
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, X, Phone, Check, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { BUSINESS } from "@shared/business";
// attribution-wave 2026-06: the widget's Call CTA was untracked (its SMS
// capture was tracked via callback.submit but phone clicks vanished —
// biasing this surface's read toward SMS). UTM spread added to the
// callback submission so widget callbacks attribute to channel/campaign.
import { trackPhoneClick } from "@/components/SEO";
import { getUtmData } from "@/lib/utm";

const STORAGE_KEY = "urgency-widget-dismissed-until";
const SCROLL_THRESHOLD = 0.35;
const AUTO_COLLAPSE_MS = 8000;
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const SUPPRESS_PATHS = ["/admin", "/booking", "/contact"];

export default function UrgencyWidget() {
  const reduced = useReducedMotion();
  const [location] = useLocation();
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.callback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setCaptureOpen(false);
        setSubmitted(false);
        setPhone("");
      }, 2500);
    },
    onError: () => toast.error("Could not save. Call (216) 862-0005."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a 10-digit phone."); return; }
    submit.mutate({
      name: "Urgency-widget visitor",
      phone: phone.trim(),
      sourcePage: window.location.pathname + "?capture=urgency-widget",
      // Server (callback.submit) already accepts + stores these as nullish
      // columns; extra keys from getUtmData (gclid etc.) are stripped by zod.
      ...getUtmData(),
    });
  }

  const { data: capacity } = trpc.conversion.shopCapacity.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  // Path-level suppression
  const onSuppressedPath = SUPPRESS_PATHS.some((p) => location.startsWith(p));

  // Local-storage dismissal check
  useEffect(() => {
    if (typeof window === "undefined" || onSuppressedPath) return;
    try {
      const dismissedUntil = Number(localStorage.getItem(STORAGE_KEY) || 0);
      if (dismissedUntil > Date.now()) return; // still suppressed
    } catch {
      // localStorage may be blocked — proceed.
    }

    const onScroll = () => {
      const scrolled = window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);
      if (scrolled > SCROLL_THRESHOLD) {
        setVisible(true);
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [onSuppressedPath]);

  // Auto-collapse after first appearance
  useEffect(() => {
    if (!visible || collapsed) return;
    const t = setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [visible, collapsed]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now() + DISMISS_TTL_MS));
    } catch {
      // ignore
    }
  }

  // Hide cases:
  //   - on suppressed path
  //   - shop closed (don't lie about availability)
  //   - no capacity data yet (cold start)
  if (onSuppressedPath || !visible || !capacity || capacity.isOpen === false) return null;

  // "slots" stays as the internal capacity heuristic (display gate below);
  // it must never surface as customer-facing reservation language.
  const slots = capacity.slotsRemainingToday;
  const waitMin = capacity.estimatedWaitMinutes ?? 0;

  // If real numbers aren't persuasive, don't show.
  if (slots == null || slots > 25) return null;

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 50, scale: 0.95 }}
            transition={reduced ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
            onMouseEnter={() => setCollapsed(false)}
            className="fixed bottom-4 right-4 z-50 max-w-sm shadow-2xl"
          >
            {collapsed ? (
              <button
                onClick={() => setCollapsed(false)}
                className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-primary-foreground shadow-xl ring-1 ring-primary/30 hover:scale-105 transition-transform"
                aria-label="Expand availability widget"
              >
                <Clock className="w-4 h-4" />
                <span className="text-xs font-bold tracking-wide">
                  {slots > 0 ? "The line is moving now" : "Today is full — call us"}
                </span>
              </button>
            ) : (
              <div className="rounded-lg border border-primary/40 bg-card/95 backdrop-blur-md p-4 ring-1 ring-primary/20">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full ${reduced ? "" : "animate-ping"} rounded-full bg-emerald-400/60`} />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    <span className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase">Live</span>
                  </div>
                  <button
                    onClick={dismiss}
                    aria-label="Dismiss"
                    className="text-foreground/40 hover:text-foreground/70 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-sm font-bold text-foreground mb-1">
                  {slots > 0 ? (
                    <>The line is <span className="text-primary">moving</span> — first come, first served</>
                  ) : (
                    <>Today is full — first-come tomorrow</>
                  )}
                </div>

                <div className="text-[11px] text-foreground/60 mb-3 space-y-0.5">
                  {waitMin > 0 && (
                    <div>Current wait: ~{Math.round(waitMin / 60 * 10) / 10}h</div>
                  )}
                  {capacity.activeJobs != null && (
                    <div>{capacity.activeJobs} car{capacity.activeJobs !== 1 ? "s" : ""} in shop right now</div>
                  )}
                </div>

                {!captureOpen ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCaptureOpen(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded bg-primary text-primary-foreground py-2 text-xs font-bold tracking-wide hover:bg-primary/90 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      TEXT ME AN ESTIMATE
                    </button>
                    <a
                      href={BUSINESS.phone.href}
                      onClick={() => trackPhoneClick("urgency-widget")}
                      className="flex items-center justify-center gap-1.5 rounded border border-foreground/30 text-foreground/80 px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary transition-colors"
                    >
                      Call
                    </a>
                  </div>
                ) : submitted ? (
                  <div className="flex items-center gap-2 rounded bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-400">
                    <Check className="w-3.5 h-3.5" /> On it. Text within 15 min during open hours.
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                      type="tel"
                      autoFocus
                      placeholder="(216) 555-1234"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="flex-1 rounded border border-foreground/20 bg-background/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                      disabled={submit.isPending}
                    />
                    <button
                      type="submit"
                      disabled={submit.isPending}
                      className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs font-bold tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-1"
                    >
                      {submit.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      TEXT ME
                    </button>
                  </form>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
