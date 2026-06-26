/*
 * NOTIFICATION BAR — Enterprise-Grade Auto-Rotating Announcement System
 * with Weather-Reactive Alert Override + Dynamic Database Messages
 *
 * Priority order:
 * 1. Weather alerts (when severe weather detected in Cleveland)
 * 2. Dynamic messages from database (AI-generated, admin-managed)
 * 3. Hardcoded strategy-based messages (fallback)
 *
 * Rotation logic:
 * - Weather alert takes priority when active (shown first, then rotates)
 * - Dynamic DB messages shown next (seasonal/time-filtered)
 * - Hardcoded messages fill the rest
 * - Messages rotate every 8 seconds with smooth animation
 * - Dismissable with 24hr cookie memory
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Phone, Star, Clock, AlertTriangle, Shield, MapPin, Zap, Snowflake, CloudRain, CloudLightning, Wind, Sun, Thermometer, Cloud, Wrench, Gauge, CreditCard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE } from "@/lib/acima";

// Routes where the rotating cross-sell band is suppressed. The customer
// is in active buying intent — pulling attention to brake/diagnostic
// cross-sells competes with the buying decision. Direct browser audit
// found "Ignoring that check engine light?" firing while a customer
// browsed tires. Tire-buying surfaces own their own value/financing
// messaging (FREE installation badge, ACIMA in the order modal), so the
// band is redundant here, not just distracting.
const SUPPRESS_ON_ROUTES = ["/tires", "/tire-finder"];

// ─── STRATEGY TYPES ────────────────────────────────────
type Strategy = "urgency" | "social_proof" | "scarcity" | "seasonal" | "authority" | "loss_aversion" | "local_identity" | "value_anchor" | "weather" | "dynamic";

interface Notification {
  id: string;
  strategy: Strategy;
  text: string;
  cta?: string;
  ctaHref?: string;
  icon: React.ElementType;
  seasons?: ("spring" | "summer" | "fall" | "winter")[];
  timeOfDay?: ("morning" | "afternoon" | "evening")[];
  daysOfWeek?: number[]; // 0=Sun, 6=Sat
  disclosure?: string;
}

// ─── ICON MAP ────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  snowflake: Snowflake,
  cloud_rain: CloudRain,
  cloud_lightning: CloudLightning,
  wind: Wind,
  sun: Sun,
  thermometer: Thermometer,
  cloud: Cloud,
  alert_triangle: AlertTriangle,
  wrench: Wrench,
  shield: Shield,
  gauge: Gauge,
  phone: Phone,
  star: Star,
  clock: Clock,
  zap: Zap,
  map_pin: MapPin,
};

// ─── HELPER: GET CURRENT CONTEXT ───────────────────────
function getCurrentSeason(): "spring" | "summer" | "fall" | "winter" {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

function getTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

function getDayOfWeek(): number {
  return new Date().getDay();
}

// ─── HARDCODED NOTIFICATION DATABASE (FALLBACK) ────────
const ALL_NOTIFICATIONS: Notification[] = [
  // ── URGENCY ──
  {
    id: "urg-1",
    strategy: "urgency",
    text: "Free brake check on the spot — walk in any time before close",
    cta: "Get In Today",
    ctaHref: BUSINESS.phone.href,
    icon: Clock,
    timeOfDay: ["morning"],
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  {
    id: "urg-2",
    strategy: "urgency",
    text: "Check engine light on? Do not wait — small problems become expensive ones fast",
    cta: "Read My Codes",
    ctaHref: BUSINESS.phone.href,
    icon: AlertTriangle,
  },
  {
    id: "urg-3",
    strategy: "urgency",
    text: "Saturday gets slammed — pull up early or call ahead",
    cta: "Call Nick's",
    ctaHref: BUSINESS.phone.href,
    icon: Clock,
    daysOfWeek: [4, 5],
  },

  // ── SOCIAL PROOF ──
  {
    id: "sp-1",
    strategy: "social_proof",
    text: `4.9 stars from ${BUSINESS.reviews.countDisplay} Google reviews — Euclid Ave, open 7 days`,
    icon: Star,
  },
  {
    id: "sp-2",
    strategy: "social_proof",
    text: "\"First shop I felt I could trust\" — real Google review from a Cleveland driver",
    icon: Star,
  },

  // ── SEASONAL ──
  {
    id: "sea-spring-1",
    strategy: "seasonal",
    text: "Spring is here — potholes, salt damage, and worn tires from winter need attention now",
    cta: "Schedule Inspection",
    ctaHref: BUSINESS.phone.href,
    icon: AlertTriangle,
    seasons: ["spring"],
  },
  {
    id: "sea-summer-1",
    strategy: "seasonal",
    text: "Hot pavement destroys underinflated tires — free tire pressure check, no appointment needed",
    cta: "Stop By",
    ctaHref: "#contact",
    icon: AlertTriangle,
    seasons: ["summer"],
  },
  {
    id: "sea-fall-1",
    strategy: "seasonal",
    text: "Winter is coming — get your tires, brakes, and battery checked before the first freeze",
    cta: "Schedule Now",
    ctaHref: BUSINESS.phone.href,
    icon: Shield,
    seasons: ["fall"],
  },
  {
    id: "sea-winter-1",
    strategy: "seasonal",
    text: "Cleveland winter driving is brutal — make sure your tires have enough tread to stop safely",
    cta: "Free Check",
    ctaHref: BUSINESS.phone.href,
    icon: AlertTriangle,
    seasons: ["winter"],
  },

  // ── AUTHORITY ──
  {
    id: "auth-1",
    strategy: "authority",
    text: "OBD-II + live data — we tell you exactly what's wrong before you pay for anything",
    icon: Shield,
  },
  {
    id: "auth-2",
    strategy: "authority",
    text: "Ohio E-Check failures repaired — oxygen sensors, EVAP leaks, catalytic converters",
    cta: "Learn More",
    ctaHref: "/emissions",
    icon: Zap,
  },

  // ── LOSS AVERSION ──
  {
    id: "la-1",
    strategy: "loss_aversion",
    text: "Ignoring that check engine light? A $200 repair today can prevent a $2,000 repair next month",
    cta: "Stop the Bleed",
    ctaHref: BUSINESS.phone.href,
    icon: AlertTriangle,
  },
  {
    id: "la-2",
    strategy: "loss_aversion",
    text: "Worn brake pads cost $150 to replace — worn rotors cost $500+. Do not wait.",
    cta: "Beat the Math",
    ctaHref: BUSINESS.phone.href,
    icon: AlertTriangle,
  },

  // ── LOCAL IDENTITY ──
  {
    id: "loc-1",
    strategy: "local_identity",
    text: "Locally owned. Cleveland proud. Serving Euclid and Northeast Ohio drivers every day.",
    icon: MapPin,
  },

  // ── VALUE ANCHOR ──
  {
    id: "val-1",
    strategy: "value_anchor",
    text: "Dealership check-out fee: $150+. Our check: find the real problem at a fair price.",
    cta: "Skip the Markup",
    ctaHref: BUSINESS.phone.href,
    icon: Zap,
  },

  // ── ACIMA LEASE-TO-OWN ──
  {
    id: "acima-1",
    strategy: "loss_aversion",
    text: "Unexpected repair? Acima lease-to-own approved on the spot — drive today, pay over time.",
    disclosure: ACIMA_COMPACT_DISCLOSURE,
    cta: "Learn More",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: CreditCard,
  },
  {
    id: "acima-2",
    strategy: "value_anchor",
    text: "Need tires? Acima approves you on the spot — no credit history needed.",
    disclosure: ACIMA_COMPACT_DISCLOSURE,
    cta: "Learn More",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: CreditCard,
  },
  {
    id: "acima-3",
    strategy: "social_proof",
    text: "Returning Acima customer? You may qualify for increased spending power. Individual results vary.",
    cta: "Apply",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: CreditCard,
  },
];

// ─── FILTER LOGIC ────────────────────────────────────────
function getFilteredHardcodedNotifications(): Notification[] {
  const season = getCurrentSeason();
  const timeOfDay = getTimeOfDay();
  const dayOfWeek = getDayOfWeek();

  return ALL_NOTIFICATIONS.filter((n) => {
    if (n.seasons && !n.seasons.includes(season)) return false;
    if (n.timeOfDay && !n.timeOfDay.includes(timeOfDay)) return false;
    if (n.daysOfWeek && !n.daysOfWeek.includes(dayOfWeek)) return false;
    return true;
  });
}

// ─── STRATEGY COLOR MAP ────────────────────────────────
const strategyStyles: Record<Strategy, string> = {
  urgency: "bg-red-900/90 border-red-500/20",
  social_proof: "bg-[oklch(0.10_0.005_260)] border-primary/15",
  scarcity: "bg-amber-900/90 border-amber-500/20",
  seasonal: "bg-emerald-900/90 border-emerald-500/20",
  authority: "bg-[oklch(0.10_0.005_260)] border-[oklch(0.55_0.12_250/0.2)]",
  loss_aversion: "bg-orange-900/90 border-orange-500/20",
  local_identity: "bg-[oklch(0.10_0.005_260)] border-primary/15",
  value_anchor: "bg-teal-900/90 border-teal-500/20",
  weather: "bg-sky-900/90 border-sky-500/20",
  dynamic: "bg-[oklch(0.10_0.005_260)] border-[oklch(0.65_0.15_195/0.2)]",
};

const weatherSeverityStyles: Record<string, string> = {
  danger: "bg-red-900/90 border-red-400/25",
  warning: "bg-amber-900/90 border-amber-400/25",
  info: "bg-sky-900/90 border-sky-400/20",
};

// ─── COMPONENT ─────────────────────────────────────────
export default function NotificationBar() {
  const [location] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Suppress the rotating band on buying-intent surfaces (see
  // SUPPRESS_ON_ROUTES). The hook order above is preserved — early
  // return AFTER all hooks have been declared so the lint:hooks gate
  // passes (the project audits hooks-after-early-return).
  const isSuppressedRoute = SUPPRESS_ON_ROUTES.some((r) => location.startsWith(r));

  // Fetch weather data from the server
  const { data: weatherData } = trpc.weather.current.useQuery(undefined, {
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });

  // Fetch dynamic notifications from the database
  const { data: dynamicNotifs } = trpc.content.activeNotifications.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });

  // Fetch active specials so the band auto-features whatever is live
  // without needing a separate hero band (avoids stacking two strips +
  // pushing the hero down → LCP cost). Cached aggressively (specials
  // change daily, not minutely).
  const { data: activeSpecials } = trpc.specials.getActive.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });

  const baseNotifications = useMemo(() => getFilteredHardcodedNotifications(), []);

  // Build the final notification list: weather → specials → dynamic DB → hardcoded fallback
  const activeNotifications = useMemo(() => {
    const list: Notification[] = [];

    // 1. Weather alert first (highest priority — safety > sales)
    if (weatherData?.alert?.active) {
      const alert = weatherData.alert;
      list.push({
        id: "weather-live",
        strategy: "weather",
        text: alert.message,
        cta: alert.cta,
        ctaHref: alert.ctaHref,
        icon: ICON_MAP[alert.icon] || Cloud,
      });
    }

    // 2. Active specials (next-highest — direct revenue impact). Up to 2
    //    so the rotation doesn't get monopolized by one promo.
    if (activeSpecials && activeSpecials.length > 0) {
      for (const sp of activeSpecials.slice(0, 2)) {
        // Build a tight one-liner: "TITLE — code XYZ" or just title.
        const tightLine = sp.couponCode
          ? `${sp.title} · code ${sp.couponCode}`
          : sp.title;
        list.push({
          id: `special-${sp.id}`,
          strategy: "value_anchor",
          text: tightLine,
          cta: "See details",
          ctaHref: "/specials",
          icon: CreditCard,
        });
      }
    }

    // 3. Dynamic database messages
    if (dynamicNotifs && dynamicNotifs.length > 0) {
      for (const dn of dynamicNotifs) {
        list.push({
          id: `db-${dn.id}`,
          strategy: "dynamic",
          text: dn.message,
          cta: dn.ctaText || undefined,
          ctaHref: dn.ctaHref || undefined,
          icon: ICON_MAP[dn.icon || "wrench"] || Wrench,
        });
      }
    }

    // 4. Hardcoded fallback messages
    list.push(...baseNotifications);
    return list;
  }, [weatherData, activeSpecials, dynamicNotifs, baseNotifications]);

  // Check if dismissed in last 24 hours
  useEffect(() => {
    const dismissedAt = localStorage.getItem("nicks-notif-dismissed");
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < 24 * 60 * 60 * 1000) {
        setDismissed(true);
      } else {
        localStorage.removeItem("nicks-notif-dismissed");
      }
    }
  }, []);

  // Auto-rotate every 8 seconds
  useEffect(() => {
    if (activeNotifications.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activeNotifications.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [activeNotifications.length]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem("nicks-notif-dismissed", Date.now().toString());
  }, []);

  if (isSuppressedRoute || dismissed || activeNotifications.length === 0) return null;

  const current = activeNotifications[currentIndex % activeNotifications.length];

  // Determine bar style
  const barStyle =
    current.strategy === "weather" && weatherData?.alert
      ? weatherSeverityStyles[weatherData.alert.severity] || strategyStyles.weather
      : strategyStyles[current.strategy];

  return (
    // wave-150 — cap max-width below 360px viewports so the bar can
    // never visually crowd the floating ChatWidget bubble (right-aligned
    // at right-4, w-12 = needs ~64px+ of right-side clearance). At
    // 360px viewport: (360 - 16 left-4 - 64 right-clearance) = 280px.
    <div className="fixed bottom-4 left-4 z-50 w-[calc(100vw-5rem)] max-w-[360px] sm:max-w-[420px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className={`relative flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg ${barStyle} backdrop-blur-xl`}
        >
          <span className="text-white/80 shrink-0 mt-0.5"><current.icon className="w-4 h-4" /></span>
          <div className="flex-1 min-w-0">
            <span className="text-white/90 text-[12px] font-medium leading-snug block">
              {current.text}
            </span>
            {current.disclosure && (
              <span className="text-white/30 text-[9px] block mt-0.5">{current.disclosure}</span>
            )}
            {current.cta && current.ctaHref && (
              <a
                href={current.ctaHref}
                className="inline-flex items-center mt-1.5 text-[oklch(0.10_0.005_260)] font-semibold text-[12px] tracking-wide bg-white/90 px-4 py-2 min-h-[36px] rounded-full hover:bg-white transition-colors"
              >
                {current.cta}
              </a>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white transition-colors p-0.5 shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      {activeNotifications.length > 1 && (
        <div className="flex items-center justify-center gap-1 mt-2">
          {activeNotifications.slice(0, 8).map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              aria-label={`Show notification ${i + 1} of ${Math.min(activeNotifications.length, 8)}`}
              className="relative w-6 h-6 flex items-center justify-center"
            >
              <span
                className={`w-1 h-1 rounded-full transition-all duration-300 ${
                  i === currentIndex % Math.min(activeNotifications.length, 8)
                    ? "bg-white/70 scale-125"
                    : "bg-white/20 hover:bg-white/40"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
