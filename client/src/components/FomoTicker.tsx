/**
 * FomoTicker — Live Social Proof Notification.
 * Pulls REAL recent activity (bookings, completed jobs, reviews) from the server.
 * Falls back to hardcoded entries when no real data is available.
 * Slides in a small toast from the bottom-left (desktop) or bottom-center (mobile)
 * showing recent activity. Rotates every 30-45s, visible for 5s each.
 * Dismissable permanently via localStorage.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Star, Clock, Wrench, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

// ── Data ─────────────────────────────────────────────────────────────

interface FomoEntry {
  type: "booking" | "completed" | "review";
  message: string;
  minutesAgo: number;
}

// Hardcoded fallback entries used when real data is not available
const FALLBACK_ENTRIES: FomoEntry[] = [
  { type: "completed", message: "A 2020 Honda CR-V just got used tires — in and out in 18 minutes", minutesAgo: 5 },
  { type: "booking", message: "Someone in Euclid just booked a drop-off for brake repair", minutesAgo: 8 },
  { type: "completed", message: "A 2018 Chevy Equinox owner never left the car — tire swap done", minutesAgo: 11 },
  { type: "booking", message: "Someone in Parma just scheduled a drop-off for diagnostics", minutesAgo: 4 },
  { type: "review", message: "\u2605\u2605\u2605\u2605\u2605 \"Didn't even get out of my car. They came out, fixed it, brought the receipt. Amazing.\"", minutesAgo: 25 },
  { type: "completed", message: "A 2021 Toyota Camry just got brakes done — dropped off this morning", minutesAgo: 15 },
  { type: "review", message: "\u2605\u2605\u2605\u2605\u2605 \"Best tire shop in Cleveland. Used tire for $60, in and out in 15 min.\"", minutesAgo: 40 },
  { type: "booking", message: "Someone in Cleveland Heights just booked online — skipped the line", minutesAgo: 18 },
  { type: "review", message: "\u2605\u2605\u2605\u2605\u2605 \"Nick and his team are the real deal. Fair prices, honest work.\"", minutesAgo: 55 },
  { type: "completed", message: "A 2022 Ford Escape just got an oil change — same day drop-off", minutesAgo: 22 },
];

const STORAGE_KEY = "fomo-dismissed";
const SHOW_DURATION = 5000;
const MIN_INTERVAL = 30000;
const MAX_INTERVAL = 45000;

function randomInterval(): number {
  return MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
}

function getIcon(type: FomoEntry["type"]) {
  switch (type) {
    case "booking":
      return <Clock size={11} />;
    case "completed":
      return <CheckCircle size={11} />;
    case "review":
      return <Star size={11} fill="#FDB913" color="#FDB913" />;
    default:
      return <Wrench size={11} />;
  }
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

  // Fetch real activity data from server
  const { data: realActivity } = trpc.activity.recent.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // Use real data when available, fallback to hardcoded
  const entriesRef = useRef<FomoEntry[]>(FALLBACK_ENTRIES);
  useEffect(() => {
    if (realActivity && realActivity.length > 0) {
      entriesRef.current = realActivity;
    } else {
      entriesRef.current = FALLBACK_ENTRIES;
    }
  }, [realActivity]);

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
  const shuffledOnce = useRef(false);
  useEffect(() => {
    if (shuffledOnce.current) return;
    shuffledOnce.current = true;
    const shuffled = [...entriesRef.current];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    entriesRef.current = shuffled;
  }, []);

  const showNext = useCallback(() => {
    const entries = entriesRef.current;
    if (entries.length === 0) return;
    const entry = entries[indexRef.current % entries.length];
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

  const shouldHide = isNearBottom && typeof window !== "undefined" && window.innerWidth < 768;

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
            left: typeof window !== "undefined" && window.innerWidth >= 768 ? 20 : "50%",
            transform: typeof window !== "undefined" && window.innerWidth < 768 ? "translateX(-50%)" : undefined,
            width: typeof window !== "undefined" && window.innerWidth >= 768 ? 340 : 290,
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
          {/* Icon circle */}
          <div
            style={{
              width: 38,
              height: 38,
              minWidth: 38,
              borderRadius: "50%",
              background: currentEntry.type === "review" ? "#FDB913" : currentEntry.type === "completed" ? "#22c55e" : "#3b82f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: "#1A1A1A",
              lineHeight: 1,
            }}
          >
            {currentEntry.type === "booking" && <Clock size={18} color="#fff" />}
            {currentEntry.type === "completed" && <CheckCircle size={18} color="#fff" />}
            {currentEntry.type === "review" && <Star size={18} color="#1A1A1A" />}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#F5F5F5",
                lineHeight: 1.4,
              }}
            >
              {currentEntry.message}
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
              {getIcon(currentEntry.type)}
              {currentEntry.minutesAgo < 60
                ? `${currentEntry.minutesAgo} min ago`
                : `${Math.round(currentEntry.minutesAgo / 60)}h ago`}
            </p>
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
