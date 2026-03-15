/*
 * NOTIFICATION BAR — Enterprise-Grade Auto-Rotating Announcement System
 * with Weather-Reactive Alert Override
 *
 * When severe weather is detected in Cleveland via the Open-Meteo API,
 * the notification bar overrides its normal rotation with a weather-specific
 * alert that connects the weather condition to a relevant auto service.
 *
 * Strategies adapted from top SPY ETF companies:
 *
 * 1. URGENCY (Amazon) — Limited-time offers, countdown language
 * 2. SOCIAL PROOF (Apple) — Review count, trust signals, customer volume
 * 3. SCARCITY (Tesla) — Limited availability, appointment slots filling
 * 4. SEASONAL (Costco/Home Depot) — Weather-driven, seasonal maintenance
 * 5. AUTHORITY (Google) — Expertise signals, certifications, diagnostics
 * 6. LOSS AVERSION (Meta) — Cost of waiting, problem escalation warnings
 * 7. LOCAL IDENTITY (Starbucks) — Community connection, Cleveland pride
 * 8. VALUE ANCHOR (Walmart) — Price comparison, savings framing
 *
 * Rotation logic:
 * - Weather alert takes priority when active (shown first, then rotates)
 * - Messages rotate every 8 seconds with smooth animation
 * - Time-of-day awareness (morning/afternoon/evening messaging)
 * - Day-of-week awareness (weekday vs weekend messaging)
 * - Seasonal awareness (spring/summer/fall/winter)
 * - Dismissable with 24hr cookie memory
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, Phone, Star, Clock, AlertTriangle, Shield, MapPin, Zap, Snowflake, CloudRain, CloudLightning, Wind, Sun, Thermometer, Cloud } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

// ─── STRATEGY TYPES ────────────────────────────────────
type Strategy = "urgency" | "social_proof" | "scarcity" | "seasonal" | "authority" | "loss_aversion" | "local_identity" | "value_anchor" | "weather";

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
}

// ─── WEATHER ICON MAP ──────────────────────────────────
const WEATHER_ICONS: Record<string, React.ReactNode> = {
  snowflake: <Snowflake className="w-4 h-4" />,
  cloud_rain: <CloudRain className="w-4 h-4" />,
  cloud_lightning: <CloudLightning className="w-4 h-4" />,
  wind: <Wind className="w-4 h-4" />,
  sun: <Sun className="w-4 h-4" />,
  thermometer: <Thermometer className="w-4 h-4" />,
  cloud: <Cloud className="w-4 h-4" />,
  alert_triangle: <AlertTriangle className="w-4 h-4" />,
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

// ─── NOTIFICATION DATABASE ─────────────────────────────
const ALL_NOTIFICATIONS: Notification[] = [
  // ── URGENCY (Amazon-style) ──
  {
    id: "urg-1",
    strategy: "urgency",
    text: "Same-day brake inspections available — call before 2 PM to get in today",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Clock className="w-4 h-4" />,
    timeOfDay: ["morning"],
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  {
    id: "urg-2",
    strategy: "urgency",
    text: "Check engine light on? Do not wait — small problems become expensive ones fast",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "urg-3",
    strategy: "urgency",
    text: "Saturday appointments fill up fast — call now to reserve your spot",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Clock className="w-4 h-4" />,
    daysOfWeek: [4, 5], // Thu-Fri, remind about Saturday
  },

  // ── SOCIAL PROOF (Apple-style) ──
  {
    id: "sp-1",
    strategy: "social_proof",
    text: "4.9 stars from 1,683+ Google reviews — Cleveland drivers trust Nick's",
    icon: <Star className="w-4 h-4" />,
  },
  {
    id: "sp-2",
    strategy: "social_proof",
    text: "\"First shop I felt I could trust\" — real Google review from a Cleveland driver",
    icon: <Star className="w-4 h-4" />,
  },
  {
    id: "sp-3",
    strategy: "social_proof",
    text: "Thousands of Cleveland drivers choose Nick's — read our 1,683+ reviews",
    cta: "See Reviews",
    ctaHref: "#reviews",
    icon: <Star className="w-4 h-4" />,
  },

  // ── SCARCITY (Tesla-style) ──
  {
    id: "sc-1",
    strategy: "scarcity",
    text: "Limited appointment slots available this week — call to check availability",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Clock className="w-4 h-4" />,
    daysOfWeek: [1, 2, 3],
  },
  {
    id: "sc-2",
    strategy: "scarcity",
    text: "Used tire inventory changes daily — call to check what we have in your size",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Zap className="w-4 h-4" />,
  },

  // ── SEASONAL (Costco/Home Depot-style) ──
  {
    id: "sea-spring-1",
    strategy: "seasonal",
    text: "Spring is here — potholes, salt damage, and worn tires from winter need attention now",
    cta: "Schedule Inspection",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
    seasons: ["spring"],
  },
  {
    id: "sea-spring-2",
    strategy: "seasonal",
    text: "Post-winter inspection: check suspension, alignment, and tires before spring driving",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Shield className="w-4 h-4" />,
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
    id: "sea-summer-2",
    strategy: "seasonal",
    text: "AC not blowing cold? We diagnose and repair automotive AC systems",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Zap className="w-4 h-4" />,
    seasons: ["summer"],
  },
  {
    id: "sea-fall-1",
    strategy: "seasonal",
    text: "Winter is coming — get your tires, brakes, and battery checked before the first freeze",
    cta: "Schedule Now",
    ctaHref: "tel:2168620005",
    icon: <Shield className="w-4 h-4" />,
    seasons: ["fall"],
  },
  {
    id: "sea-winter-1",
    strategy: "seasonal",
    text: "Cleveland winter driving is brutal — make sure your tires have enough tread to stop safely",
    cta: "Free Check",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
    seasons: ["winter"],
  },
  {
    id: "sea-winter-2",
    strategy: "seasonal",
    text: "Snow tires, tire chains, and TPMS sensors — we have what Cleveland winters demand",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Zap className="w-4 h-4" />,
    seasons: ["winter"],
  },

  // ── AUTHORITY (Google-style) ──
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
    ctaHref: "#services",
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: "auth-3",
    strategy: "authority",
    text: "We show you the problem before we fix it — honest diagnostics, every time",
    icon: <Shield className="w-4 h-4" />,
  },

  // ── LOSS AVERSION (Meta-style) ──
  {
    id: "la-1",
    strategy: "loss_aversion",
    text: "Ignoring that check engine light? A $200 repair today can prevent a $2,000 repair next month",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "la-2",
    strategy: "loss_aversion",
    text: "Worn brake pads cost $150 to replace — worn rotors cost $500+. Do not wait.",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "la-3",
    strategy: "loss_aversion",
    text: "Driving on bald tires in Cleveland rain? One blowout costs more than four new tires",
    cta: "Check Tires",
    ctaHref: "tel:2168620005",
    icon: <AlertTriangle className="w-4 h-4" />,
  },

  // ── LOCAL IDENTITY (Starbucks-style) ──
  {
    id: "loc-1",
    strategy: "local_identity",
    text: "Locally owned. Cleveland proud. Serving Euclid and Northeast Ohio drivers every day.",
    icon: <MapPin className="w-4 h-4" />,
  },
  {
    id: "loc-2",
    strategy: "local_identity",
    text: "17625 Euclid Ave — your neighborhood tire and auto repair shop",
    cta: "Get Directions",
    ctaHref: "https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112",
    icon: <MapPin className="w-4 h-4" />,
  },

  // ── VALUE ANCHOR (Walmart-style) ──
  {
    id: "val-1",
    strategy: "value_anchor",
    text: "Dealership diagnostic fee: $150+. Our diagnostic: find the real problem at a fair price.",
    cta: "Call Now",
    ctaHref: "tel:2168620005",
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: "val-2",
    strategy: "value_anchor",
    text: "New and quality used tires at prices that make sense — not dealership markups",
    cta: "Call for Pricing",
    ctaHref: "tel:2168620005",
    icon: <Zap className="w-4 h-4" />,
  },
];

// ─── FILTER + ROTATE LOGIC ─────────────────────────────
function getActiveNotifications(): Notification[] {
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
  urgency: "bg-red-900/90 border-red-700/50",
  social_proof: "bg-primary/90 border-primary/50",
  scarcity: "bg-amber-900/90 border-amber-700/50",
  seasonal: "bg-emerald-900/90 border-emerald-700/50",
  authority: "bg-blue-900/90 border-blue-700/50",
  loss_aversion: "bg-orange-900/90 border-orange-700/50",
  local_identity: "bg-primary/90 border-primary/50",
  value_anchor: "bg-teal-900/90 border-teal-700/50",
  weather: "bg-sky-900/90 border-sky-700/50",
};

// Severity-specific weather bar colors
const weatherSeverityStyles: Record<string, string> = {
  danger: "bg-red-900/95 border-red-600/60",
  warning: "bg-amber-900/95 border-amber-600/60",
  info: "bg-sky-900/90 border-sky-700/50",
};

// ─── COMPONENT ─────────────────────────────────────────
export default function NotificationBar() {
  const [dismissed, setDismissed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Fetch weather data from the server
  const { data: weatherData } = trpc.weather.current.useQuery(undefined, {
    staleTime: 15 * 60 * 1000, // 15 minutes
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });

  const baseNotifications = useMemo(() => getActiveNotifications(), []);

  // Build the final notification list: weather alert first (if active), then regular
  const activeNotifications = useMemo(() => {
    const list: Notification[] = [];

    if (weatherData?.alert?.active) {
      const alert = weatherData.alert;
      list.push({
        id: "weather-live",
        strategy: "weather",
        text: alert.message,
        cta: alert.cta,
        ctaHref: alert.ctaHref,
        icon: WEATHER_ICONS[alert.icon] || <Cloud className="w-4 h-4" />,
      });
    }

    list.push(...baseNotifications);
    return list;
  }, [weatherData, baseNotifications]);

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

  // Determine bar style: weather alerts use severity-specific colors
  const barStyle =
    current.strategy === "weather" && weatherData?.alert
      ? weatherSeverityStyles[weatherData.alert.severity] || strategyStyles.weather
      : strategyStyles[current.strategy];

  return (
    <div className={`fixed top-0 left-0 right-0 z-[60] border-b ${barStyle} backdrop-blur-sm transition-colors duration-700`}>
      <div className="container relative flex items-center justify-center min-h-[40px] py-2">
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
            <span className="text-white/95 text-xs sm:text-sm font-medium tracking-wide">
              {current.text}
            </span>
            {current.cta && current.ctaHref && (
              <a
                href={current.ctaHref}
                className="shrink-0 ml-2 text-white font-heading font-bold text-xs tracking-widest uppercase border border-white/30 px-3 py-1 hover:bg-white/10 transition-colors hidden sm:inline-block"
              >
                {current.cta}
              </a>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Weather badge for weather alerts */}
        {current.strategy === "weather" && weatherData?.weather && (
          <div className="absolute right-12 hidden lg:flex items-center gap-1.5 text-white/50 text-xs font-mono">
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
