/**
 * FomoTicker — Live Social Proof Notification (Phase 1.5).
 * Slides in a small toast from the bottom-left (desktop) or bottom-center (mobile)
 * showing recent bookings and reviews. Rotates every 30-45s, visible for 5s each.
 * Dismissable permanently via localStorage.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Star, Clock, Wrench } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Data ─────────────────────────────────────────────────────────────

interface BookingEntry {
  type: "booking";
  name: string;
  neighborhood: string;
  service: string;
  minutesAgo: number;
}

interface ReviewEntry {
  type: "review";
  name: string;
  excerpt: string;
  timeAgo: string;
}

type FomoEntry = BookingEntry | ReviewEntry;

const ENTRIES: FomoEntry[] = [
  // Bookings
  { type: "booking", name: "Marcus", neighborhood: "Euclid", service: "Brake Inspection", minutesAgo: 8 },
  { type: "booking", name: "Denise", neighborhood: "Lakewood", service: "Oil Change", minutesAgo: 12 },
  { type: "booking", name: "James", neighborhood: "Parma", service: "Tire Rotation", minutesAgo: 4 },
  { type: "booking", name: "Angela", neighborhood: "Cleveland Heights", service: "Engine Diagnostic", minutesAgo: 18 },
  { type: "booking", name: "Terrance", neighborhood: "Shaker Heights", service: "Alignment", minutesAgo: 6 },
  { type: "booking", name: "Nicole", neighborhood: "East Cleveland", service: "Transmission Service", minutesAgo: 22 },
  { type: "booking", name: "David", neighborhood: "South Euclid", service: "Brake Pad Replacement", minutesAgo: 15 },
  { type: "booking", name: "Crystal", neighborhood: "Garfield Heights", service: "AC Repair", minutesAgo: 9 },
  { type: "booking", name: "Robert", neighborhood: "Lakewood", service: "Tire Installation", minutesAgo: 3 },
  { type: "booking", name: "Tamika", neighborhood: "Parma", service: "Check Engine Light", minutesAgo: 27 },
  { type: "booking", name: "Kevin", neighborhood: "Euclid", service: "Suspension Repair", minutesAgo: 11 },
  { type: "booking", name: "Lisa", neighborhood: "Cleveland Heights", service: "Battery Replacement", minutesAgo: 7 },
  // Reviews
  { type: "review", name: "Anthony", excerpt: "Best tire shop in Cleveland. Fair prices, honest work.", timeAgo: "2 hours ago" },
  { type: "review", name: "Sharon", excerpt: "Got me in same day for brakes. Lifesaver!", timeAgo: "1 hour ago" },
  { type: "review", name: "Michael", excerpt: "Nick and his team are the real deal. Highly recommend.", timeAgo: "3 hours ago" },
  { type: "review", name: "Patricia", excerpt: "Fixed my AC fast and didn't try to upsell me.", timeAgo: "45 min ago" },
  { type: "review", name: "Dwayne", excerpt: "Been coming here 10 years. Wouldn't go anywhere else.", timeAgo: "5 hours ago" },
  { type: "review", name: "Maria", excerpt: "Honest mechanics are hard to find. These guys are it.", timeAgo: "30 min ago" },
  { type: "review", name: "Tyrone", excerpt: "Quick oil change, fair price. In and out in 20 min.", timeAgo: "4 hours ago" },
  { type: "review", name: "Jennifer", excerpt: "They explained everything before doing the work. Respect.", timeAgo: "2 hours ago" },
  { type: "review", name: "Carlos", excerpt: "New tires at a great price. Rides like a dream now.", timeAgo: "6 hours ago" },
  { type: "review", name: "Brenda", excerpt: "My whole family brings their cars here. Trust them completely.", timeAgo: "1 hour ago" },
];

const STORAGE_KEY = "fomo-dismissed";
const SHOW_DURATION = 5000;
const MIN_INTERVAL = 30000;
const MAX_INTERVAL = 45000;

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

function randomInterval(): number {
  return MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
}

// ── Component ────────────────────────────────────────────────────────

export default function FomoTicker() {
  const [currentEntry, setCurrentEntry] = useState<FomoEntry | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const indexRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cycleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Check localStorage on mount
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") {
        setDismissed(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Track scroll position on mobile to avoid obscuring sticky CTA
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;

    const onScroll = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      setIsNearBottom(docHeight - scrollBottom < 120);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Shuffle entries once on mount
  const shuffledRef = useRef<FomoEntry[]>([]);
  useEffect(() => {
    const shuffled = [...ENTRIES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffledRef.current = shuffled;
  }, []);

  const showNext = useCallback(() => {
    if (shuffledRef.current.length === 0) return;
    const entry = shuffledRef.current[indexRef.current % shuffledRef.current.length];
    indexRef.current += 1;

    setCurrentEntry(entry);
    setVisible(true);

    // Hide after SHOW_DURATION
    showTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, SHOW_DURATION);
  }, []);

  // Main cycle
  useEffect(() => {
    if (dismissed) return;

    // Initial delay before first notification (8-15s)
    const initialDelay = 8000 + Math.random() * 7000;
    cycleTimerRef.current = setTimeout(() => {
      showNext();

      // Recurring cycle
      const startCycle = () => {
        cycleTimerRef.current = setTimeout(() => {
          showNext();
          startCycle();
        }, randomInterval());
      };
      startCycle();
    }, initialDelay);

    return () => {
      clearTimeout(cycleTimerRef.current);
      clearTimeout(showTimerRef.current);
    };
  }, [dismissed, showNext]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
    clearTimeout(cycleTimerRef.current);
    clearTimeout(showTimerRef.current);
  }, []);

  if (dismissed) return null;

  const shouldHide = isNearBottom && window.innerWidth < 768;

  return (
    <AnimatePresence>
      {visible && currentEntry && !shouldHide && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{
            position: "fixed",
            bottom: 20,
            left: window.innerWidth >= 768 ? 20 : "50%",
            transform: window.innerWidth < 768 ? "translateX(-50%)" : undefined,
            width: window.innerWidth >= 768 ? 320 : 280,
            zIndex: 40,
            background: "#1A1A1A",
            border: "1px solid #2A2A2A",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            padding: "14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            fontFamily: "'DM Sans', sans-serif",
          }}
          role="status"
          aria-live="polite"
        >
          {/* Avatar circle */}
          <div
            style={{
              width: 38,
              height: 38,
              minWidth: 38,
              borderRadius: "50%",
              background: "#FDB913",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: "#1A1A1A",
              lineHeight: 1,
            }}
          >
            {getInitials(currentEntry.name)}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {currentEntry.type === "booking" ? (
              <>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    color: "#F5F5F5",
                    lineHeight: 1.4,
                  }}
                >
                  <strong>{currentEntry.name}</strong> from{" "}
                  <strong>{currentEntry.neighborhood}</strong> just booked{" "}
                  <span style={{ color: "#FDB913" }}>{currentEntry.service}</span>
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "#A0A0A0",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Clock size={11} />
                  {currentEntry.minutesAgo} min ago
                </p>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      size={12}
                      fill="#FDB913"
                      color="#FDB913"
                    />
                  ))}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "#F5F5F5",
                    lineHeight: 1.4,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{currentEntry.excerpt}&rdquo;
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "#A0A0A0",
                  }}
                >
                  — {currentEntry.name}, {currentEntry.timeAgo}
                </p>
              </>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            aria-label="Dismiss notifications permanently"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "#666",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
