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
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE } from "@/lib/acima";

// ─── STRATEGY TYPES ────────────────────────────────────
type Strategy = "urgency" | "social_proof" | "scarcity" | "seasonal" | "authority" | "loss_aversion" | "local_identity" | "value_anchor" | "weather" | "dynamic";

interface Notification {
  id: string;
  strategy: Strategy;
  text: string;
  cta?: string;
  ctaHref?: string;
  icon: React.ReactNode;
  seasons?: ("spring" | "summer" | "fall" | "winter")[];
  timeOfDay?: ("morning" | "afternoon" | "evening")[];
  daysOfWeek?: number[]; // 0=Sun, 6=Sat
  disclosure?: string;
}

// ─── ICON MAP ────────────────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  snowflake: <Snowflake className="w-4 h-4" />,
  cloud_rain: <CloudRain className="w-4 h-4" />,
  cloud_lightning: <CloudLightning className="w-4 h-4" />,
  wind: <Wind className="w-4 h-4" />,
  sun: <Sun className="w-4 h-4" />,
  thermometer: <Thermometer className="w-4 h-4" />,
  cloud: <Cloud className="w-4 h-4" />,
  alert_triangle: <AlertTriangle className="w-4 h-4" />,
  wrench: <Wrench className="w-4 h-4" />,
  shield: <Shield className="w-4 h-4" />,
  gauge: <Gauge className="w-4 h-4" />,
  phone: <Phone className="w-4 h-4" />,
  star: <Star className="w-4 h-4" />,
  clock: <Clock className="w-4 h-4" />,
  zap: <Zap className="w-4 h-4" />,
  map_pin: <MapPin className="w-4 h-4" />,
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
    text: "Same-day brake inspections available — call before 2 PM to get in today",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <Clock className="w-4 h-4" />,
    timeOfDay: ["morning"],
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  {
    id: "urg-2",
    strategy: "urgency",
    text: "Check engine light on? Do not wait — small problems become expensive ones fast",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "urg-3",
    strategy: "urgency",
    text: "Saturday appointments fill up fast — call now to reserve your spot",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <Clock className="w-4 h-4" />,
    daysOfWeek: [4, 5],
  },

  // ── SOCIAL PROOF ──
  {
    id: "sp-1",
    strategy: "social_proof",
    text: `4.9 stars from ${BUSINESS.reviews.countDisplay} Google reviews — Cleveland drivers trust Nick's`,
    icon: <Star className="w-4 h-4" />,
  },
  {
    id: "sp-2",
    strategy: "social_proof",
    text: "\"First shop I felt I could trust\" — real Google review from a Cleveland driver",
    icon: <Star className="w-4 h-4" />,
  },

  // ── SEASONAL ──
  {
    id: "sea-spring-1",
    strategy: "seasonal",
    text: "Spring is here — potholes, salt damage, and worn tires from winter need attention now",
    cta: "Schedule Inspection",
    ctaHref: BUSINESS.phone.href,
    icon: <AlertTriangle className="w-4 h-4" />,
    seasons: ["spring"],
  },
  {
    id: "sea-summer-1",
    strategy: "seasonal",
    text: "Hot pavement destroys underinflated tires — free tire pressure check, no appointment needed",
    cta: "Stop By",
    ctaHref: "#contact",
    icon: <AlertTriangle className="w-4 h-4" />,
    seasons: ["summer"],
  },
  {
    id: "sea-fall-1",
    strategy: "seasonal",
    text: "Winter is coming — get your tires, brakes, and battery checked before the first freeze",
    cta: "Schedule Now",
    ctaHref: BUSINESS.phone.href,
    icon: <Shield className="w-4 h-4" />,
    seasons: ["fall"],
  },
  {
    id: "sea-winter-1",
    strategy: "seasonal",
    text: "Cleveland winter driving is brutal — make sure your tires have enough tread to stop safely",
    cta: "Free Check",
    ctaHref: BUSINESS.phone.href,
    icon: <AlertTriangle className="w-4 h-4" />,
    seasons: ["winter"],
  },

  // ── AUTHORITY ──
  {
    id: "auth-1",
    strategy: "authority",
    text: "Advanced OBD-II diagnostics — we pinpoint the exact problem before you pay for anything",
    icon: <Shield className="w-4 h-4" />,
  },
  {
    id: "auth-2",
    strategy: "authority",
    text: "Ohio E-Check failures repaired — oxygen sensors, EVAP leaks, catalytic converters",
    cta: "Learn More",
    ctaHref: "/emissions",
    icon: <Zap className="w-4 h-4" />,
  },

  // ── LOSS AVERSION ──
  {
    id: "la-1",
    strategy: "loss_aversion",
    text: "Ignoring that check engine light? A $200 repair today can prevent a $2,000 repair next month",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "la-2",
    strategy: "loss_aversion",
    text: "Worn brake pads cost $150 to replace — worn rotors cost $500+. Do not wait.",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <AlertTriangle className="w-4 h-4" />,
  },

  // ── LOCAL IDENTITY ──
  {
    id: "loc-1",
    strategy: "local_identity",
    text: "Locally owned. Cleveland proud. Serving Euclid and Northeast Ohio drivers every day.",
    icon: <MapPin className="w-4 h-4" />,
  },

  // ── VALUE ANCHOR ──
  {
    id: "val-1",
    strategy: "value_anchor",
    text: "Dealership diagnostic fee: $150+. Our diagnostic: find the real problem at a fair price.",
    cta: "Call Now",
    ctaHref: BUSINESS.phone.href,
    icon: <Zap className="w-4 h-4" />,
  },

  // ── ACIMA LEASE-TO-OWN ──
  {
    id: "acima-1",
    strategy: "loss_aversion",
    text: "Unexpected repair? $10 down with Acima lease-to-own — drive today, pay over time.",
    disclosure: ACIMA_COMPACT_DISCLOSURE,
    cta: "Learn More",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: <CreditCard className="w-4 h-4" />,
  },
  {
    id: "acima-2",
    strategy: "value_anchor",
    text: "Need tires? $10 initial payment with Acima — no credit history needed.",
    disclosure: ACIMA_COMPACT_DISCLOSURE,
    cta: "Learn More",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: <CreditCard className="w-4 h-4" />,
  },
  {
    id: "acima-3",
    strategy: "social_proof",
    text: "Returning Acima customer? You may qualify for increased spending power. Individual results vary.",
    cta: "Apply",
    ctaHref: "/financing?utm_source=notification_bar",
    icon: <CreditCard className="w-4 h-4" />,
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
  const [dismissed, setDismissed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

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

  const baseNotifications = useMemo(() => getFilteredHardcodedNotifications(), []);

  // Build the final notification list: weather → dynamic DB → hardcoded fallback
  const activeNotifications = useMemo(() => {
    const list: Notification[] = [];

    // 1. Weather alert first (highest priority)
    if (weatherData?.alert?.active) {
      const alert = weatherData.alert;
      list.push({
        id: "weather-live",
        strategy: "weather",
        text: alert.message,
        cta: alert.cta,
        ctaHref: alert.ctaHref,
        icon: ICON_MAP[alert.icon] || <Cloud className="w-4 h-4" />,
      });
    }

    // 2. Dynamic database messages
    if (dynamicNotifs && dynamicNotifs.length > 0) {
      for (const dn of dynamicNotifs) {
        list.push({
          id: `db-${dn.id}`,
          strategy: "dynamic",
          text: dn.message,
          cta: dn.ctaText || undefined,
          ctaHref: dn.ctaHref || undefined,
          icon: ICON_MAP[dn.icon || "wrench"] || <Wrench className="w-4 h-4" />,
        });
      }
    }

    // 3. Hardcoded fallback messages
    list.push(...baseNotifications);
    return list;
  }, [weatherData, dynamicNotifs, baseNotifications]);

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

  if (dismissed || activeNotifications.length === 0) return null;

  const current = activeNotifications[currentIndex % activeNotifications.length];

  // Determine bar style
  const barStyle =
    current.strategy === "weather" && weatherData?.alert
      ? weatherSeverityStyles[weatherData.alert.severity] || strategyStyles.weather
      : strategyStyles[current.strategy];

  return (
    <div className={`fixed top-0 left-0 right-0 z-[60] border-b ${barStyle} backdrop-blur-xl transition-colors duration-700`}>
      <div className="container relative flex items-center justify-center min-h-[36px] py-1.5">
        {/* Progress dots */}
        <div className="absolute left-4 hidden sm:flex items-center gap-1.5">
          {activeNotifications.slice(0, 8).map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                i === currentIndex % Math.min(activeNotifications.length, 8)
                  ? "bg-white scale-125"
                  : "bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>

        {/* Notification content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 text-center px-10 sm:px-16"
          >
            <span className="text-white/80 shrink-0">{current.icon}</span>
            <span className="text-white/90 text-[12px] sm:text-[13px] font-medium tracking-[-0.005em]">
              {current.text}
              {current.disclosure && (
                <span className="hidden sm:inline text-white/40 text-[9px] ml-1">{current.disclosure}</span>
              )}
            </span>
            {current.cta && current.ctaHref && (
              <a
                href={current.ctaHref}
                className="shrink-0 ml-3 text-[oklch(0.10_0.005_260)] font-semibold text-[11px] tracking-wide bg-white/90 px-3 py-1 rounded-full hover:bg-white transition-colors hidden sm:inline-block"
              >
                {current.cta}
              </a>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Weather badge for weather alerts */}
        {current.strategy === "weather" && weatherData?.weather && (
          <div className="absolute right-12 hidden lg:flex items-center gap-1.5 text-white/50 text-xs">
            <Thermometer className="w-3 h-3" />
            <span>{weatherData.weather.temperature_f}°F</span>
          </div>
        )}

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 text-white/50 hover:text-white transition-colors p-1"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
