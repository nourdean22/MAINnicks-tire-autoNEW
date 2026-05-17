/**
 * WeatherAwareBanner — a small, clever admin card that nudges ops
 * action based on incoming weather.
 *
 * Why: rain drops tire/brake walk-ins. Snow spikes battery + tow. Heat
 * spikes A/C. A shop that knows what's rolling in tomorrow wins the
 * morning. Pulls from the existing public.weather endpoint (cached 10
 * minutes server-side). No new integrations.
 *
 * Dismissable — saved to localStorage per condition-key so we don't
 * nag the operator about the same storm twice in a row.
 */

import { useMemo, useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud, CloudRain, CloudSnow, Sun, Wind, Thermometer, X, Lightbulb,
} from "lucide-react";

type Condition =
  | "heavy_rain"
  | "snow"
  | "ice"
  | "heat_wave"
  | "cold_snap"
  | "thunderstorm"
  | "clear";

interface Nudge {
  condition: Condition;
  icon: React.ReactNode;
  color: string;
  title: string;
  insight: string;
  actionLabel: string;
  actionHint: string;
}

function classifyWeather(weather: {
  conditions?: string;
  temp?: number;
  precipChance?: number;
}): Condition {
  const cond = (weather.conditions || "").toLowerCase();
  const temp = weather.temp ?? 65;

  if (cond.includes("thunder") || cond.includes("storm")) return "thunderstorm";
  if (cond.includes("snow") || cond.includes("sleet")) return "snow";
  if (cond.includes("ice") || cond.includes("freezing")) return "ice";
  if (cond.includes("rain") && (weather.precipChance ?? 0) > 60) return "heavy_rain";
  if (temp >= 88) return "heat_wave";
  if (temp <= 20) return "cold_snap";
  return "clear";
}

function buildNudge(c: Condition): Nudge | null {
  switch (c) {
    case "heavy_rain":
      return {
        condition: c,
        icon: <CloudRain className="w-4 h-4" />,
        color: "bg-blue-500/10 border-blue-500/30 text-blue-300",
        title: "Heavy rain incoming",
        insight: "Tire walk-ins drop ~30%. Worn wipers + hydroplaning spike demand for tire tread checks and alignment.",
        actionLabel: "Prep a rainy-day special",
        actionHint: "Draft an SMS blast: \"Rainy day ahead. Free tread depth check while you wait.\"",
      };
    case "snow":
      return {
        condition: c,
        icon: <CloudSnow className="w-4 h-4" />,
        color: "bg-sky-500/10 border-sky-500/30 text-sky-300",
        title: "Snow in forecast",
        insight: "Tow + battery calls spike. Pre-warm the bay: stock jump packs, winter tires visible up front.",
        actionLabel: "Text dormant winter-tire customers",
        actionHint: "Pull customers from last winter who didn't re-swap. One SMS = 3-5 bookings historically.",
      };
    case "ice":
      return {
        condition: c,
        icon: <CloudSnow className="w-4 h-4" />,
        color: "bg-cyan-500/10 border-cyan-500/30 text-cyan-300",
        title: "Icy conditions",
        insight: "Safety-first day. Slow morning, fender-bender afternoon. Tow partners should be on standby.",
        actionLabel: "Confirm tow capacity",
        actionHint: "Ping the tow partner at 7am to confirm they're running.",
      };
    case "thunderstorm":
      return {
        condition: c,
        icon: <Wind className="w-4 h-4" />,
        color: "bg-purple-500/10 border-purple-500/30 text-purple-300",
        title: "Thunderstorms expected",
        insight: "Electrical + battery demand spikes after severe storms. Check inventory on alternators & batteries.",
        actionLabel: "Inventory check",
        actionHint: "Run inventory.list for electrical + battery stock.",
      };
    case "heat_wave":
      return {
        condition: c,
        icon: <Thermometer className="w-4 h-4" />,
        color: "bg-orange-500/10 border-orange-500/30 text-orange-300",
        title: "Heat wave",
        insight: "A/C + cooling calls will spike. Run a recharge special before the rush.",
        actionLabel: "A/C recharge campaign",
        actionHint: "Push a Meta ad for A/C recharge this week. Historical ROI 4x.",
      };
    case "cold_snap":
      return {
        condition: c,
        icon: <Thermometer className="w-4 h-4" />,
        color: "bg-slate-500/10 border-slate-500/30 text-slate-300",
        title: "Deep cold snap",
        insight: "Dead-battery calls triple below 20°F. Have jump packs + batteries up front.",
        actionLabel: "Free battery test push",
        actionHint: "Text last-30-day customers \"Free battery test — cold is coming\".",
      };
    case "clear":
    default:
      return null;
  }
}

function storageKey(condition: Condition): string {
  const today = new Date().toISOString().slice(0, 10);
  return `weather-nudge-dismissed:${today}:${condition}`;
}

interface Props {
  className?: string;
}

export default function WeatherAwareBanner({ className = "" }: Props) {
  const { data } = trpc.weather.current.useQuery(undefined, {
    refetchInterval: 30 * 60_000, // 30 minutes
    staleTime: 10 * 60_000,
  });
  const [dismissed, setDismissed] = useState(false);

  const condition = useMemo<Condition>(() => {
    if (!data?.weather) return "clear";
    const w = data.weather as {
      conditions?: string;
      temp?: number;
      precipChance?: number;
    };
    return classifyWeather(w);
  }, [data]);

  // Check dismissal on mount / condition change
  useEffect(() => {
    if (condition === "clear") return;
    const key = storageKey(condition);
    setDismissed(!!localStorage.getItem(key));
  }, [condition]);

  if (condition === "clear" || dismissed) return null;
  const nudge = buildNudge(condition);
  if (!nudge) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={condition}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className={`relative rounded-xl border p-4 ${nudge.color} ${className}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">{nudge.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-widest font-bold opacity-80">
                Weather signal
              </span>
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1">{nudge.title}</h3>
            <p className="text-xs opacity-90 leading-relaxed">{nudge.insight}</p>
            <div className="mt-2 flex items-start gap-2">
              <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
              <div className="text-[11px] opacity-80">
                <span className="font-bold">{nudge.actionLabel}:</span> {nudge.actionHint}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.setItem(storageKey(condition), "1");
              setDismissed(true);
            }}
            className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors opacity-50 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
