/**
 * SmartCTA — Context-aware floating CTA widget.
 * Changes message based on:
 * - Business hours (open vs closed)
 * - Time of day (morning urgency vs evening planning)
 * - Return visitors (localStorage check)
 * Positioned as a subtle bottom-left widget on desktop.
 */
import { useState, useEffect } from "react";
import { Phone, Calendar, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { useBusinessHours } from "@/hooks/useBusinessHours";
import { useIsMobile } from "@/hooks/useMediaQuery";

export default function SmartCTA() {
  const { isOpen } = useBusinessHours();
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Show after 8 seconds of browsing, only once per session
  useEffect(() => {
    try { if (sessionStorage.getItem("smartcta-shown")) return; } catch { return; }

    const timer = setTimeout(() => {
      setVisible(true);
      try { sessionStorage.setItem("smartcta-shown", "1"); } catch {}
    }, 8000);

    return () => clearTimeout(timer);
  }, []);

  // Track return visitors
  const isReturning = (() => {
    try {
      const visits = Number(localStorage.getItem("visit-count") || "0") + 1;
      localStorage.setItem("visit-count", String(visits));
      return visits > 1;
    } catch {
      return false;
    }
  })();

  if (dismissed || !visible || isMobile) return null;

  // Determine CTA content based on context
  const getContent = () => {
    if (!isOpen) {
      return {
        icon: Calendar,
        title: "We're closed right now",
        subtitle: "Book online and we'll confirm first thing",
        action: { label: "Book Appointment", href: "/contact" },
      };
    }

    if (isReturning) {
      return {
        icon: Phone,
        title: "Welcome back!",
        subtitle: "Ready to schedule that repair?",
        action: { label: `Call ${BUSINESS.phone.display}`, href: BUSINESS.phone.href },
      };
    }

    return {
      icon: Clock,
      title: "Same-day service available",
      subtitle: "Walk-ins welcome — no appointment needed",
      action: { label: `Call Now`, href: BUSINESS.phone.href },
    };
  };

  const content = getContent();
  const Icon = content.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="fixed bottom-24 left-5 z-40 max-w-[280px] bg-[#141414] border border-[#2A2A2A] rounded-lg shadow-2xl p-4"
      >
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 text-foreground/20 hover:text-foreground/50 text-xs"
          aria-label="Dismiss"
        >
          &times;
        </button>

        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-[#FDB913]/10">
            <Icon className="w-4 h-4 text-[#FDB913]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground/80">{content.title}</p>
            <p className="text-[11px] text-foreground/40 mt-0.5">{content.subtitle}</p>
            <a
              href={content.action.href}
              className="inline-block mt-2 text-[11px] font-semibold text-[#FDB913] hover:text-[#FFD54F] transition-colors"
            >
              {content.action.label} &rarr;
            </a>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
