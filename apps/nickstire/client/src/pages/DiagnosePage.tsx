/**
 * "What's Wrong With My Car?" — AI-Powered Diagnostic Tool
 * Phase 1.11: Interactive car silhouette with clickable zones,
 * severity-coded result cards, and scan animation.
 */

import PageLayout from "@/components/PageLayout";
import ResponsivePhoto from "@/components/ResponsivePhoto";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick, trackEvent } from "@/components/SEO";
import { getOpenStatus } from "@/lib/shopHours";
import { getUtmData } from "@/lib/utm";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  Phone, AlertTriangle, Stethoscope,
  Shield, Wrench, Car, ArrowRight, Loader2,
  Activity, RotateCcw, CircleDot, MapPin, OctagonAlert
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import SymptomGuide from "@/components/diagnose/SymptomGuide";

// Owned shop photo — real bay interior, not Manus.space CloudFront stock.
// 2026-05-06 wave-16 · pro photo pack: diagnostics needs authority +
// shop capability — interior bay with car on lift per PLACEMENT_GUIDE.md
const HERO_IMG = "/photos/interior-service-bay-car-lift.webp";

// ─── SYMPTOM CATEGORIES ───────────────────────────────
// Symptom-first, not anatomy-first. The page used to open with "TAP THE PROBLEM
// AREA" and five engineering zones (engine / cabin / underneath / rear), which
// asks the customer to diagnose the car before they can describe it. Nobody
// thinks "my problem is in the underneath zone" — they think "my car is
// shaking" and "it won't start". These are the words people actually use.
//
// Picking one no longer dumps 150+ chars of boilerplate into the textarea for
// them to edit around. It sets the category, aims the follow-up question at
// what a tech would actually ask next, and leaves the box for THEIR words.

type CarZoneId = "front" | "front-wheels" | "cabin" | "rear" | "underneath";

const ZONE_LABEL: Record<CarZoneId, string> = {
  front: "Engine bay",
  "front-wheels": "Brakes & tires",
  cabin: "Cabin & dash",
  rear: "Exhaust",
  underneath: "Suspension & steering",
};

type Symptom = {
  id: string;
  /** Chip text — what the customer would say, not what a mechanic would. */
  label: string;
  /** Which part of the illustration lights up. Decorative only. */
  zone: CarZoneId | null;
  /** The next question a tech would actually ask. Aims their description. */
  placeholder: string;
  /** Sent when they pick a chip but don't type anything. */
  seed: string;
};

const SYMPTOMS: Symptom[] = [
  {
    id: "warning-light",
    label: "Warning light",
    zone: "cabin",
    placeholder: "Which light came on? Is it steady or flashing? Did anything change in how it drives?",
    seed: "A warning light came on.",
  },
  {
    id: "wont-start",
    label: "Won't start",
    zone: "front",
    placeholder: "Does it crank, click, or do nothing at all? Any lights on the dash? Did it start fine yesterday?",
    seed: "The car won't start.",
  },
  {
    id: "noise",
    label: "Strange noise",
    zone: null,
    placeholder: "What does it sound like — grinding, squealing, clicking, knocking, humming? When do you hear it?",
    seed: "The car is making a strange noise.",
  },
  {
    id: "shaking",
    label: "Shaking or vibration",
    zone: "underneath",
    placeholder: "When does it shake — braking, accelerating, or at a certain speed? Where do you feel it?",
    seed: "The car shakes or vibrates while driving.",
  },
  {
    id: "brakes",
    label: "Brakes",
    zone: "front-wheels",
    placeholder: "What happens when you brake — noise, pulling, a soft pedal, or taking longer to stop?",
    seed: "Something is wrong with the brakes.",
  },
  {
    id: "steering",
    label: "Steering or handling",
    zone: "underneath",
    placeholder: "Does it pull, wander, feel loose or stiff? Any noise when you turn?",
    seed: "Something is wrong with the steering or handling.",
  },
  {
    id: "leak",
    label: "Leak or puddle",
    zone: "underneath",
    placeholder: "What colour is it, and where under the car? A few drops or a real puddle?",
    seed: "The car is leaking something.",
  },
  {
    id: "smoke-smell",
    label: "Smoke or smell",
    zone: "rear",
    placeholder: "What does it smell like, or what colour is the smoke? When does it happen?",
    seed: "There's smoke or an unusual smell.",
  },
  {
    id: "overheating",
    label: "Running hot",
    zone: "front",
    placeholder: "How far do you get before the gauge climbs? Any steam, coolant loss, or heater blowing cold?",
    seed: "The engine is running hot.",
  },
  {
    id: "tire",
    label: "Tire problem",
    zone: "front-wheels",
    placeholder: "Flat, low, worn, vibrating, or a TPMS light? Which corner of the car?",
    seed: "There's a problem with a tire.",
  },
  {
    id: "ac-heat",
    label: "AC or heat",
    zone: "cabin",
    placeholder: "Blowing warm, cold, weak, or nothing at all? Any smell from the vents?",
    seed: "The AC or heat isn't working right.",
  },
  {
    id: "other",
    label: "Something else",
    zone: null,
    placeholder: "Tell us what's happening in your own words — when it started, when it happens, and whether it's getting worse.",
    seed: "",
  },
];

const DEFAULT_PLACEHOLDER =
  "Example: My brakes are squealing loudly when I slow down, especially going downhill. It started about a week ago and seems to be getting worse...";

/**
 * Shown on the "how this tool works" disclosure. Bump this when the guide copy
 * or the tool's behaviour changes — a stale date is a worse trust signal than
 * no date. Deliberately NOT a "reviewed by ASE-certified technician" byline:
 * that's a credential claim, and it only goes on the page once a tech has
 * actually read it.
 */
const CONTENT_LAST_UPDATED = "July 2026";

// ─── VEHICLE DATA ──────────────────────────────────────
// Derived from the clock, not hardcoded to 2026 — the old literal list would
// have quietly stopped offering new model years every January. Next model year
// first (dealers sell ahead), then back far enough to cover what actually rolls
// into the bays; anything older picks "Older / not listed".
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 36 }, (_, i) => String(CURRENT_YEAR + 1 - i));
/** Submitted value is deliberately short + prose-legible: it lands in the model
 *  prompt as "Vehicle: Older Honda Civic", and the server caps vehicleYear. */
const OLDER_VEHICLE_VALUE = "Older";
const OLDER_VEHICLE_LABEL = "Older / not listed";
// Discontinued domestics (Pontiac, Saturn, Mercury, Oldsmobile) stay on the
// list on purpose — they're still rolling into an east-side Cleveland shop, and
// omitting them pushed real customers onto "Other".
const MAKES = [
  "Acura", "Alfa Romeo", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet",
  "Chrysler", "Dodge", "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hummer",
  "Hyundai", "Infiniti", "Jaguar", "Jeep", "Kia", "Land Rover", "Lexus",
  "Lincoln", "Mazda", "Mercedes-Benz", "Mercury", "Mini", "Mitsubishi",
  "Nissan", "Oldsmobile", "Plymouth", "Pontiac", "Porsche", "Ram", "Saab",
  "Saturn", "Subaru", "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo",
  "Other",
];

// ─── CAR SVG SILHOUETTE ────────────────────────────────

/**
 * Decorative car illustration that MIRRORS the symptom buttons above it.
 *
 * It used to be the primary control: the only way in was clicking `<g>`
 * elements with mouse handlers — not focusable, no accessible name, no key
 * handling — so a keyboard or screen-reader user had no route into the tool at
 * all. Now the chips are the real, accessible control and this is aria-hidden:
 * mouse users still get the point-at-the-car affordance, and everyone else gets
 * an equivalent (better) path instead of a broken duplicate in the a11y tree.
 */
function CarSilhouette({
  activeZone,
  hoveredZone,
  onZoneClick,
  onZoneHover,
  onZoneLeave,
}: {
  activeZone: CarZoneId | null;
  hoveredZone: CarZoneId | null;
  onZoneClick: (id: CarZoneId) => void;
  onZoneHover: (id: CarZoneId) => void;
  onZoneLeave: () => void;
}) {
  const zoneColor = (id: CarZoneId) => {
    if (activeZone === id) return "var(--primary)";
    if (hoveredZone === id) return "var(--brand-yellow-glow)";
    return "var(--ring-neutral)";
  };

  const zoneStroke = (id: CarZoneId) => {
    if (activeZone === id || hoveredZone === id) return "var(--primary)";
    return "var(--ring-neutral-strong)";
  };

  return (
    <svg
      viewBox="0 0 800 320"
      className="w-full max-w-2xl mx-auto select-none"
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      {/* Car body outline */}
      <path
        d="M120,200 L120,170 Q120,160 130,155 L200,130 Q220,123 250,115 L330,100 Q370,95 420,93 L500,93 Q540,95 560,100 L620,115 Q650,125 670,140 L700,160 Q710,168 710,178 L710,200"
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="2.5"
      />
      {/* Roof line */}
      <path
        d="M280,100 Q290,60 350,50 L480,50 Q530,52 560,70 L600,100"
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="2"
      />
      {/* Window */}
      <path
        d="M290,98 Q298,65 355,55 L475,55 Q525,57 550,73 L590,98"
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1.5"
      />
      {/* Bottom line */}
      <line x1="140" y1="210" x2="690" y2="210" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />

      {/* Front wheel */}
      <circle cx="220" cy="210" r="35" fill="var(--background)" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
      <circle cx="220" cy="210" r="22" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <circle cx="220" cy="210" r="8" fill="rgba(255,255,255,0.1)" />

      {/* Rear wheel */}
      <circle cx="610" cy="210" r="35" fill="var(--background)" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
      <circle cx="610" cy="210" r="22" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <circle cx="610" cy="210" r="8" fill="rgba(255,255,255,0.1)" />

      {/* Headlight */}
      <ellipse cx="130" cy="165" rx="12" ry="8" fill="rgba(253,185,19,0.15)" stroke="rgba(253,185,19,0.3)" strokeWidth="1" />
      {/* Taillight */}
      <ellipse cx="700" cy="165" rx="8" ry="8" fill="rgba(244,67,54,0.2)" stroke="rgba(244,67,54,0.4)" strokeWidth="1" />

      {/* ── CLICKABLE ZONES ── */}

      {/* Zone 1: Front (engine) */}
      <g
        className="cursor-pointer glow-on-hover"
        onClick={() => onZoneClick("front")}
        onMouseEnter={() => onZoneHover("front")}
        onMouseLeave={onZoneLeave}
      >
        <rect
          x="110" y="110" width="140" height="95"
          rx="8"
          fill={zoneColor("front")}
          stroke={zoneStroke("front")}
          strokeWidth="1.5"
          fillOpacity={activeZone === "front" ? 0.18 : 0.6}
        />
        <text x="180" y="158" textAnchor="middle" fill={activeZone === "front" || hoveredZone === "front" ? "var(--primary)" : "rgba(255,255,255,0.5)"} fontSize="12" fontWeight="600">
          ENGINE
        </text>
      </g>

      {/* Zone 2: Front wheels (brakes/tires) */}
      <g
        className="cursor-pointer glow-on-hover"
        onClick={() => onZoneClick("front-wheels")}
        onMouseEnter={() => onZoneHover("front-wheels")}
        onMouseLeave={onZoneLeave}
      >
        <rect
          x="170" y="210" width="100" height="50"
          rx="8"
          fill={zoneColor("front-wheels")}
          stroke={zoneStroke("front-wheels")}
          strokeWidth="1.5"
          fillOpacity={activeZone === "front-wheels" ? 0.18 : 0.6}
        />
        <text x="220" y="240" textAnchor="middle" fill={activeZone === "front-wheels" || hoveredZone === "front-wheels" ? "var(--primary)" : "rgba(255,255,255,0.5)"} fontSize="11" fontWeight="600">
          BRAKES/TIRES
        </text>
      </g>

      {/* Zone 3: Cabin (AC/heating/electrical) */}
      <g
        className="cursor-pointer glow-on-hover"
        onClick={() => onZoneClick("cabin")}
        onMouseEnter={() => onZoneHover("cabin")}
        onMouseLeave={onZoneLeave}
      >
        <rect
          x="270" y="48" width="290" height="90"
          rx="8"
          fill={zoneColor("cabin")}
          stroke={zoneStroke("cabin")}
          strokeWidth="1.5"
          fillOpacity={activeZone === "cabin" ? 0.18 : 0.6}
        />
        <text x="415" y="98" textAnchor="middle" fill={activeZone === "cabin" || hoveredZone === "cabin" ? "var(--primary)" : "rgba(255,255,255,0.5)"} fontSize="12" fontWeight="600">
          AC / ELECTRICAL
        </text>
      </g>

      {/* Zone 4: Rear (exhaust) */}
      <g
        className="cursor-pointer glow-on-hover"
        onClick={() => onZoneClick("rear")}
        onMouseEnter={() => onZoneHover("rear")}
        onMouseLeave={onZoneLeave}
      >
        <rect
          x="580" y="110" width="135" height="95"
          rx="8"
          fill={zoneColor("rear")}
          stroke={zoneStroke("rear")}
          strokeWidth="1.5"
          fillOpacity={activeZone === "rear" ? 0.18 : 0.6}
        />
        <text x="647" y="158" textAnchor="middle" fill={activeZone === "rear" || hoveredZone === "rear" ? "var(--primary)" : "rgba(255,255,255,0.5)"} fontSize="12" fontWeight="600">
          EXHAUST
        </text>
      </g>

      {/* Zone 5: Underneath (suspension) */}
      <g
        className="cursor-pointer glow-on-hover"
        onClick={() => onZoneClick("underneath")}
        onMouseEnter={() => onZoneHover("underneath")}
        onMouseLeave={onZoneLeave}
      >
        <rect
          x="280" y="210" width="320" height="50"
          rx="8"
          fill={zoneColor("underneath")}
          stroke={zoneStroke("underneath")}
          strokeWidth="1.5"
          fillOpacity={activeZone === "underneath" ? 0.18 : 0.6}
        />
        <text x="440" y="240" textAnchor="middle" fill={activeZone === "underneath" || hoveredZone === "underneath" ? "var(--primary)" : "rgba(255,255,255,0.5)"} fontSize="12" fontWeight="600">
          SUSPENSION / STEERING
        </text>
      </g>

      {/* Tooltip for hovered zone */}
      {hoveredZone && !activeZone && (
        <g>
          <rect x="275" y="280" width="250" height="32" rx="6" fill="var(--bg-card-elevated)" stroke="var(--primary)" strokeWidth="1" />
          <text x="400" y="301" textAnchor="middle" fill="var(--primary)" fontSize="12" fontWeight="500">
            {ZONE_LABEL[hoveredZone]}
          </text>
        </g>
      )}
    </svg>
  );
}

// ─── REVIEW ANIMATION ──────────────────────────────────
// Was a "scanning your vehicle" sweep with a car outline. Nothing here is
// connected to the car — it reads typed text — so the sweep + "scanning"
// wording claimed a capability the tool does not have. Kept the motion, told
// the truth about what it's doing.

function ReviewAnimation() {
  return (
    <div className="relative w-full max-w-2xl mx-auto my-12">
      {/* Car outline ghost */}
      <div className="relative h-48 bg-card rounded-xl border border-border overflow-hidden flex items-center justify-center">
        <Car className="w-24 h-24 text-foreground/10" />
        {/* Sweeping gold line */}
        <motion.div
          className="absolute top-0 left-0 w-1 h-full"
          style={{ background: "linear-gradient(180deg, transparent, var(--primary), transparent)", boxShadow: "0 0 20px 4px var(--ring-yellow)" }}
          animate={{ x: [0, 600, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Horizontal scan line */}
        <motion.div
          className="absolute left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg, transparent 0%, var(--primary) 30%, var(--primary) 70%, transparent 100%)", boxShadow: "0 0 12px 2px var(--brand-yellow-glow)" }}
          animate={{ y: [-80, 80, -80] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
          <p className="text-primary font-heading text-sm tracking-widest uppercase">Reviewing what you described...</p>
          <p className="text-foreground/40 text-xs mt-1">Matching your words against common causes</p>
        </div>
      </div>
    </div>
  );
}

// ─── RESULT TYPES ──────────────────────────────────────
// Inferred from the router instead of hand-mirrored. The old local copy had
// already drifted (`likelihood: string`) and let the server change shape
// without the compiler noticing here.

type DiagnosisResult = RouterOutputs["diagnose"]["analyze"];
type DiagnosisAnalyzed = Extract<DiagnosisResult, { status: "ai" }>;
type RedFlag = DiagnosisResult["redFlags"][number];

/**
 * How likely a cause is, in words a customer can act on. The model ranks
 * possibilities from a text description — it has no calibrated confidence — so
 * "HIGH LIKELIHOOD" was false precision dressed up as measurement.
 */
const LIKELIHOOD_LABEL: Record<DiagnosisAnalyzed["likelyCauses"][number]["likelihood"], string> = {
  high: "Common possibility",
  medium: "Also possible",
  low: "Less common",
};

/**
 * Urgency → the one thing the customer actually came here to find out: can I
 * keep driving this, and how soon do I need to deal with it?
 *
 * The old badges answered a different question. "LOW RISK — MONITOR" and
 * "URGENT — ADDRESS IMMEDIATELY" are risk-register labels; they tell you a
 * severity tier, not what to do on a Tuesday morning with one car. And `high`
 * and `critical` both rendered "URGENT — ADDRESS IMMEDIATELY", collapsing
 * "book it this week" and "do not drive this car" into one banner — the single
 * most consequential distinction on the page.
 */
function getSeverityStyle(urgency: string) {
  switch (urgency) {
    case "low":
      return {
        border: "border-success/40",
        bg: "bg-success/8",
        badge: "bg-success/20 text-success",
        badgeText: "KEEP AN EYE ON IT",
        verdict: "Safe to drive. Book it if it gets worse or starts bugging you.",
        icon: "text-success",
        dot: "var(--color-success)",
      };
    case "moderate":
      return {
        border: "border-warning/40",
        bg: "bg-warning/8",
        badge: "bg-warning/20 text-warning",
        badgeText: "GET IT CHECKED SOON",
        verdict: "Fine to drive for now — get it looked at in the next week or two before it grows.",
        icon: "text-warning",
        dot: "var(--color-warning)",
      };
    case "high":
      return {
        border: "border-warning/50",
        bg: "bg-warning/10",
        badge: "bg-warning/20 text-warning",
        badgeText: "GET IT CHECKED TODAY",
        verdict: "Don't sit on this one. Drive it straight here if it feels normal — call us if it doesn't.",
        icon: "text-warning",
        dot: "var(--color-warning)",
      };
    case "critical":
      return {
        border: "border-danger/40",
        bg: "bg-danger/8",
        badge: "bg-danger/20 text-danger",
        badgeText: "STOP DRIVING IT",
        verdict: "This is a safety issue. Don't drive it — call us and we'll tell you what to do next.",
        icon: "text-danger",
        dot: "var(--color-danger)",
      };
    default:
      return {
        border: "border-warning/40",
        bg: "bg-warning/8",
        badge: "bg-warning/20 text-warning",
        badgeText: "GET IT CHECKED",
        verdict: "Bring it by and we'll tell you what's going on.",
        icon: "text-warning",
        dot: "var(--color-warning)",
      };
  }
}

// ─── MAIN PAGE ─────────────────────────────────────────

/** Live open/closed line for the "don't wait" hero card. Mounted-gated so
 *  prerendered HTML carries no stale status and hydration can't mismatch. */
function DiagnoseOpenStatusLine() {
  const [status, setStatus] = useState<{ isOpen: boolean; label: string } | null>(null);
  useEffect(() => {
    setStatus(getOpenStatus());
    const id = setInterval(() => setStatus(getOpenStatus()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!status) return null;
  return (
    <p className="mt-3 text-[12px] font-semibold">
      {status.isOpen ? (
        <span className="text-emerald-400">Bays are open right now.</span>
      ) : (
        <span className="text-foreground/50">
          Closed right now &mdash; {status.label.toLowerCase()}. Pull up early, be first in line.
        </span>
      )}
    </p>
  );
}

/** Mirrors the server cap (routers/public.ts). Enforced here so a long, useful
 *  description shows a counter instead of being silently rejected. */
const SYMPTOM_MAX_LEN = 2000;

/** Plain-language reason we couldn't check, for the customer — never a stack. */
function describeCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/TOO_MANY_REQUESTS|429|rate limit/i.test(message)) {
    return "You've run a few checks in a row, so we've paused for a minute. Call us and we'll just look at it.";
  }
  if (/Failed to fetch|NetworkError|offline/i.test(message)) {
    return "We couldn't reach the shop's system — check your connection, or call us.";
  }
  return "Something went wrong on our end, so we didn't check your symptoms.";
}

export default function DiagnosePage() {
  const [selectedSymptomId, setSelectedSymptomId] = useState<string | null>(null);
  const [hoveredZone, setHoveredZone] = useState<CarZoneId | null>(null);
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", mileage: "" });
  const [symptomText, setSymptomText] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [diagLeadName, setDiagLeadName] = useState("");
  const [diagLeadPhone, setDiagLeadPhone] = useState("");
  const [diagLeadSubmitted, setDiagLeadSubmitted] = useState(false);
  const [diagLeadSaving, setDiagLeadSaving] = useState(false);
  const submitDiagLead = trpc.lead.submit.useMutation();

  const formRef = useRef<HTMLDivElement>(null);

  const diagnoseMutation = trpc.diagnose.analyze.useMutation();

  const selectedSymptom = SYMPTOMS.find((s) => s.id === selectedSymptomId) ?? null;
  /** The illustration follows the buttons — it is not the control. */
  const activeZone: CarZoneId | null = selectedSymptom?.zone ?? null;

  const handleSymptomSelect = (id: string) => {
    // Toggle off if they tap the same chip again — a chip they can't unpick is
    // a trap, since the category rides along on what we send.
    setSelectedSymptomId((current) => (current === id ? null : id));
  };

  /** Mouse-only affordance: clicking the car picks that zone's first symptom. */
  const handleZoneClick = (zoneId: CarZoneId) => {
    const match = SYMPTOMS.find((s) => s.zone === zoneId);
    if (match) setSelectedSymptomId(match.id);
  };

  const performAnalysis = async (text: string) => {
    const trimmed = text.trim();
    // A chip alone is enough to act on — "Won't start" is a real report even if
    // they type nothing else. Only a blank box AND no chip is a no-op.
    const description = trimmed || selectedSymptom?.seed || "";
    if (!description) return;
    // Category leads so the model (and the tech reading the lead) gets the frame
    // before the prose, without us having stuffed it into the customer's box.
    const composed = selectedSymptom && trimmed
      ? `${selectedSymptom.label}: ${trimmed}`
      : description;

    setIsAnalyzing(true);
    setShowResults(false);
    setResult(null);
    setErrorMessage(null);
    trackEvent("diagnose_check_started", { symptom: selectedSymptomId ?? "none" });

    try {
      const response = await diagnoseMutation.mutateAsync({
        vehicleYear: vehicle.year || undefined,
        vehicleMake: vehicle.make || undefined,
        vehicleModel: vehicle.model || undefined,
        mileage: vehicle.mileage || undefined,
        symptoms: [composed.slice(0, SYMPTOM_MAX_LEN)],
        additionalInfo: undefined,
      });

      setResult(response);
      setShowResults(true);
      // Only the shape of the outcome — never the customer's symptom text.
      trackEvent("diagnose_check_completed", {
        status: response.status,
        urgency: response.status === "ai" ? response.urgency : "unknown",
        redFlags: response.redFlags.length,
      });
    } catch (error) {
      // 2026-07-16 · this catch used to build a complete, confident-looking
      // DiagnosisResult and render it exactly like a real answer. A customer
      // could not tell an AI conclusion from a dropped request — and the most
      // common trigger was their own detailed description tripping the old
      // 200-char server cap. Tell them the truth and route them to a human.
      console.error("Symptom check failed:", error);
      setErrorMessage(describeCheckError(error));
      setShowResults(true);
      trackEvent("diagnose_check_failed", { reason: describeCheckError(error).slice(0, 60) });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = () => performAnalysis(symptomText);

  // Prefill only. This used to call performAnalysis() on mount, so every
  // crawler hit, link-preview fetch, shared URL and refresh of a `?symptom=`
  // link burned a rate-limited AI call that no human ever read. The customer
  // presses the button.
  //
  // `?category=` is the deep-link target for GBP posts / Instagram / the
  // problem pages: land them on the right chip, ready to describe it — never
  // auto-running a check nobody asked for.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const symptomParam = params.get("symptom");
    const categoryParam = params.get("category");
    const known = categoryParam && SYMPTOMS.some((s) => s.id === categoryParam);
    if (!symptomParam && !known) return;
    if (known) setSelectedSymptomId(categoryParam);
    if (symptomParam) setSymptomText(symptomParam.slice(0, SYMPTOM_MAX_LEN));
    const timer = setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleReset = () => {
    setSelectedSymptomId(null);
    setVehicle({ year: "", make: "", model: "", mileage: "" });
    setSymptomText("");
    setResult(null);
    setErrorMessage(null);
    setShowResults(false);
    setIsAnalyzing(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const analyzed = result?.status === "ai" ? result : null;
  const severity = analyzed ? getSeverityStyle(analyzed.urgency) : null;
  /** Red flags are matched server-side in code, so they survive an AI outage. */
  const redFlags: RedFlag[] = result?.redFlags ?? [];

  return (
    <PageLayout activeHref="/diagnose" showChat={true}>
      {/* Description no longer promises "repair costs" — the tool has no
          pricing data and the invented cost range was removed, so that was a
          promise the page could not keep the moment a visitor arrived. */}
      <SEOHead
        title="What's Wrong With My Car? Free Symptom Checker · Nick's Tire & Auto"
        description="Not sure what's wrong with your car? Describe the symptom and get likely causes, how urgent it is, and the safest next step — free. Then bring it to Nick's in Euclid."
        canonicalPath="/diagnose"
      />

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 pb-12 overflow-hidden">
          <div className="absolute inset-0">
            {/* LCP fix · hero image (rendered at 20% opacity as bg, but still LCP candidate) */}
            <ResponsivePhoto loading="eager" fetchPriority="high" src={HERO_IMG} alt="Auto diagnostics at Nick's Tire & Auto Cleveland — check engine light + warning light testing" className="w-full h-full object-cover opacity-20" objectPosition="center 45%" />
            <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/95 to-background" />
          </div>

          <div className="relative container">
            <Breadcrumbs items={[
              { label: "What's Wrong With My Car?" },
            ]} />
            <LocalBusinessSchema />
            {/* WebApplication, not Service. This page is the free symptom-checker
                TOOL; /diagnostics is the commercial diagnostic SERVICE. Emitting
                `Service: "Automotive Diagnostics Service"` here re-sent the exact
                commercial signal the /diagnose vs /diagnostics split removed, and
                put the two pages back in competition for the same queries. */}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "What's Wrong With My Car? — Free Symptom Checker",
              "applicationCategory": "UtilitiesApplication",
              "operatingSystem": "All",
              "browserRequirements": "Requires JavaScript",
              "description": "Describe what your car is doing and get possible causes, how urgent it is, and the safest next step. Preliminary only — not an OBD-II scan.",
              "url": `${BUSINESS.urls.website}/diagnose`,
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "publisher": {
                "@type": "AutoRepair",
                "@id": `${BUSINESS.urls.website}/#localbusiness`
              }
            })}} />

            {/* Two-column hero at lg: headline column + the "don't wait"
                card filling the previously-empty right half of the hero.
                Stacks under the headline on mobile. */}
            <div className="grid lg:grid-cols-[1fr_400px] gap-8 lg:gap-12 items-center">
              <FadeIn>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                    <Activity className="w-6 h-6 text-primary" />
                  </div>
                  <span className="font-mono text-primary/70 text-xs tracking-wide">Free vehicle symptom check</span>
                </div>
                {/* H1 keeps the exact-match phrase on purpose. It's the query
                    this page exists to answer, it's what holds /diagnose apart
                    from the commercial /diagnostics page, and prerender:semantic
                    -check pins title/H1 alignment. The friendlier "tell us what
                    it's doing" framing lives in the subhead instead. */}
                <h1 className="font-heading text-4xl lg:text-6xl text-foreground tracking-tight leading-[0.95]">
                  WHAT'S WRONG WITH<br />
                  <span className="text-primary">MY CAR</span>?
                </h1>
                <p className="mt-3 text-foreground/80 text-xl font-semibold">
                  Tell us what it&apos;s doing. We&apos;ll tell you what it probably is.
                </p>
                {/* Was "our AI will provide a preliminary diagnosis in seconds" —
                    same overclaim as the old "SCAN MY CAR" button. It doesn't
                    diagnose; it narrows things down from your words. Say what
                    they get, then what it costs them (nothing). */}
                <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
                  Describe what&apos;s happening and we&apos;ll walk you through the likely causes, how
                  urgent it is, and the safest next step &mdash; in about a minute. It&apos;s free, and
                  the real check happens when you pull in. Squealing or grinding? See our <Link href="/brakes" className="underline text-primary hover:text-primary-foreground font-semibold">brake symptoms list</Link>. Shaking or vibration? Check our <Link href="/tires" className="underline text-primary hover:text-primary-foreground font-semibold">tire options</Link> or <Link href="/financing" className="underline text-primary hover:text-primary-foreground font-semibold">financing for repairs</Link>.
                </p>
                <p className="mt-4 text-foreground/45 text-sm">
                  Free quick check · Written quote before any work · {BUSINESS.reviews.rating}★ from {BUSINESS.reviews.countDisplay} drivers
                </p>
              </FadeIn>

              <FadeIn>
                <div className="rounded-2xl border border-white/[0.08] bg-[oklch(0.08_0.005_260)]/85 backdrop-blur-[12px] p-6 sm:p-7">
                  <p className="font-mono text-primary/70 text-[10px] uppercase tracking-widest mb-2">
                    Straight talk
                  </p>
                  <h2 className="font-heading text-2xl sm:text-3xl font-black text-foreground uppercase tracking-tight leading-tight">
                    Don&apos;t guess.<br />
                    Don&apos;t wait.<br />
                    <span className="text-primary">Get down here.</span>
                  </h2>
                  <p className="mt-3 text-foreground/65 text-sm leading-relaxed">
                    Googling a noise at midnight doesn&apos;t fix it &mdash; and
                    small problems get expensive while you sit on them. Bring
                    us the worry instead: we read the codes, show you
                    what&apos;s actually going on, and answer every question
                    you&apos;ve got. We love this work &mdash; it&apos;s why the
                    bays are open 7 days a week.
                  </p>
                  <DiagnoseOpenStatusLine />
                  <div className="mt-5 flex flex-col sm:flex-row gap-3">
                    <a
                      href={BUSINESS.phone.href}
                      onClick={() => trackPhoneClick("diagnose-dont-wait-card")}
                      className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-primary text-black text-[13px] font-black uppercase tracking-wide active:scale-95 transition-transform hover:brightness-110"
                    >
                      Call {BUSINESS.phone.display}
                    </a>
                    <Link
                      href="/booking"
                      onClick={() => trackEvent("diagnose_dropoff_link_click", { source: "dont-wait-card" })}
                      className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full border border-white/15 text-foreground text-[13px] font-bold uppercase tracking-wide active:scale-95 transition-transform hover:border-white/30"
                    >
                      How drop-off works
                    </Link>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Symptom-first selector. Was "TAP THE PROBLEM AREA" + 5 anatomy
            zones, which asked the customer to locate the fault before they
            could report it. These are real <button>s — the car illustration
            below is now decorative and mirrors them. */}
        <section className="bg-background py-12 lg:py-16">
          <div className="container max-w-4xl">
            <FadeIn>
              <div className="text-center mb-8">
                <h2 className="font-heading text-2xl text-foreground tracking-tight mb-2">
                  WHAT&apos;S IT <span className="text-primary">DOING</span>?
                </h2>
                <p className="text-foreground/50 text-sm">
                  Pick the closest one &mdash; you can add the details next. Not sure? Skip straight to describing it.
                </p>
              </div>

              <div
                role="group"
                aria-label="What is the car doing?"
                className="flex flex-wrap justify-center gap-2"
              >
                {SYMPTOMS.map((symptom) => {
                  const active = selectedSymptomId === symptom.id;
                  return (
                    <button
                      key={symptom.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleSymptomSelect(symptom.id)}
                      onMouseEnter={() => symptom.zone && setHoveredZone(symptom.zone)}
                      onMouseLeave={() => setHoveredZone(null)}
                      className={`min-h-[44px] px-4 py-2 rounded-full text-sm font-heading tracking-wide transition-all border ${
                        active
                          ? "bg-primary/15 border-primary text-primary"
                          : "bg-card border-border text-foreground/60 hover:border-primary/50 hover:text-primary/80"
                      }`}
                    >
                      {symptom.label}
                    </button>
                  );
                })}
              </div>

              <CarSilhouette
                activeZone={activeZone}
                hoveredZone={hoveredZone}
                onZoneClick={handleZoneClick}
                onZoneHover={setHoveredZone}
                onZoneLeave={() => setHoveredZone(null)}
              />
            </FadeIn>
          </div>
        </section>

        {/* Symptom Input & Vehicle Info */}
        <section ref={formRef} className="bg-background py-12 lg:py-16">
          <div className="container max-w-3xl">
            <FadeIn>
              <div className="bg-card border border-border rounded-xl p-6 lg:p-8 space-y-6">
                {/* Vehicle Info (collapsible) */}
                <div>
                  <h3 className="font-heading text-lg text-foreground tracking-tight mb-1">
                    VEHICLE DETAILS <span className="text-foreground/30 text-xs font-normal">(optional)</span>
                  </h3>
                  <p className="text-foreground/40 text-xs mb-4">Helps narrow down the most likely causes</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <select
                      value={vehicle.year}
                      onChange={(e) => setVehicle({ ...vehicle, year: e.target.value })}
                      className="bg-background border border-border text-foreground px-3 py-2.5 text-sm rounded-md focus:outline-none focus:border-primary/50"
                    >
                      <option value="">Year</option>
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                      {/* Shipped in the P0 wave as a declared-but-never-rendered
                          constant — the list just stopped at 36 years back with
                          no way out. An east-side shop sees plenty older. */}
                      <option value={OLDER_VEHICLE_VALUE}>{OLDER_VEHICLE_LABEL}</option>
                    </select>
                    <select
                      value={vehicle.make}
                      onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })}
                      className="bg-background border border-border text-foreground px-3 py-2.5 text-sm rounded-md focus:outline-none focus:border-primary/50"
                    >
                      <option value="">Make</option>
                      {MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input
                      type="text"
                      value={vehicle.model}
                      onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
                      placeholder="Model"
                      className="bg-background border border-border text-foreground px-3 py-2.5 text-sm rounded-md placeholder:text-foreground/25 focus:outline-none focus:border-primary/50"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={vehicle.mileage}
                      onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })}
                      placeholder="Mileage"
                      className="bg-background border border-border text-foreground px-3 py-2.5 text-sm rounded-md placeholder:text-foreground/25 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-border" />

                {/* Symptom text area */}
                <div>
                  <h3 className="font-heading text-lg text-foreground tracking-tight mb-1">
                    {selectedSymptom ? `TELL US ABOUT THE ${selectedSymptom.label.toUpperCase()}` : "DESCRIBE YOUR SYMPTOMS"}
                  </h3>
                  <p className="text-foreground/40 text-xs mb-4">
                    {selectedSymptom
                      // Aim the question instead of pre-filling their box. The
                      // old flow dumped ~180 chars of boilerplate in here and
                      // told them to edit around it.
                      ? "In your own words — the more you tell us, the better we can narrow it down."
                      : "What's happening with your car? Be as specific as possible."}
                  </p>
                  <textarea
                    value={symptomText}
                    onChange={(e) => setSymptomText(e.target.value.slice(0, SYMPTOM_MAX_LEN))}
                    maxLength={SYMPTOM_MAX_LEN}
                    rows={5}
                    aria-describedby="symptom-help symptom-count"
                    placeholder={selectedSymptom ? selectedSymptom.placeholder : DEFAULT_PLACEHOLDER}
                    className="w-full bg-background border border-border text-foreground px-4 py-3 text-sm rounded-md placeholder:text-foreground/25 focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
                  />
                  <div className="mt-2 flex items-start justify-between gap-4">
                    <p id="symptom-help" className="text-foreground/40 text-xs leading-relaxed">
                      Helps most if you say: when it started · when it happens · any warning lights · is it getting worse
                    </p>
                    <span
                      id="symptom-count"
                      aria-live="polite"
                      className={`shrink-0 text-xs tabular-nums ${symptomText.length > SYMPTOM_MAX_LEN * 0.9 ? "text-warning" : "text-foreground/30"}`}
                    >
                      {symptomText.length}/{SYMPTOM_MAX_LEN}
                    </span>
                  </div>
                </div>

                {/* Check button */}
                {/* A chip on its own is a real report ("Won't start") — don't
                    hold the button hostage to the textarea. Only nothing-at-all
                    is a no-op. */}
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || (!symptomText.trim() && !selectedSymptom?.seed)}
                  className="w-full flex items-center justify-center gap-3 bg-primary text-black px-8 py-4 rounded-md font-heading text-base tracking-wider hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      CHECKING...
                    </>
                  ) : (
                    <>
                      <Stethoscope className="w-5 h-5" />
                      CHECK MY SYMPTOMS
                    </>
                  )}
                </button>

                {/* Say what this is before they use it, not after. Nothing here
                    touches the car — calling it a "scan" was borrowed authority. */}
                <p className="text-center text-foreground/35 text-xs leading-relaxed">
                  This is a preliminary symptom check &mdash; not an OBD-II scan or a confirmed
                  diagnosis. It reads what you typed. The scan happens at the shop, and it&apos;s free.
                </p>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Scan Animation (while analyzing) */}
        <AnimatePresence>
          {isAnalyzing && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-background overflow-hidden"
            >
              <div className="container max-w-3xl">
                <ReviewAnimation />
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {showResults && (
            <motion.section
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="bg-background py-12 lg:py-16"
            >
              <div className="container max-w-3xl space-y-6">

                {/* Safety comes first and comes from code, not the model. These
                    are matched server-side from the customer's own words, so an
                    AI outage can never swallow "don't drive it". */}
                {redFlags.length > 0 && (
                  <div className="border-2 border-danger/60 bg-danger/10 rounded-xl p-5" role="alert">
                    <div className="flex items-center gap-2 mb-3">
                      <OctagonAlert className="w-5 h-5 text-danger shrink-0" />
                      <span className="font-heading text-danger text-sm tracking-wider">
                        STOP — READ THIS FIRST
                      </span>
                    </div>
                    <ul className="space-y-3">
                      {redFlags.map((flag) => (
                        <li key={flag.id}>
                          <p className="text-danger font-bold text-sm">{flag.label}</p>
                          <p className="text-foreground/70 text-sm leading-relaxed mt-0.5">{flag.guidance}</p>
                        </li>
                      ))}
                    </ul>
                    <a
                      href={BUSINESS.phone.href}
                      onClick={() => trackPhoneClick("diagnose-red-flag")}
                      className="mt-4 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full bg-danger text-white text-[13px] font-black uppercase tracking-wide active:scale-95 transition-transform"
                    >
                      <Phone className="w-4 h-4" />
                      Call us now — {BUSINESS.phone.display}
                    </a>
                  </div>
                )}

                {/* We could not check. An honest dead end that routes to a human
                    — NOT a canned card dressed up as an AI conclusion. */}
                {(errorMessage || result?.status === "unavailable") && (
                  <div className="border border-border bg-card rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      <h2 className="font-heading text-foreground text-base tracking-wider">
                        WE COULDN&apos;T CHECK THIS ONE
                      </h2>
                    </div>
                    <p className="text-foreground/60 text-sm leading-relaxed">
                      {errorMessage ?? "Our symptom checker didn't come back with an answer, so we're not going to guess at one."}
                    </p>
                    <p className="text-foreground/60 text-sm leading-relaxed mt-2">
                      That&apos;s on us, not you &mdash; and it costs you nothing to just bring it in.
                      Quick checks are free and you see a written quote before anyone touches a wrench.
                    </p>
                  </div>
                )}

                {analyzed && severity && (
                  <>
                {/* Severity banner */}
                <div className={`${severity.bg} ${severity.border} border rounded-xl p-5`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: severity.dot }} />
                    <span className={`font-heading text-sm tracking-wider ${severity.badge.split(" ")[1]}`}>
                      {severity.badgeText}
                    </span>
                  </div>
                  {/* The verdict, in plain words, before any of the analysis.
                      This is the one thing they came to find out. */}
                  <p className="text-foreground/80 text-sm leading-relaxed mb-3">{severity.verdict}</p>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: severity.dot }}
                        initial={{ width: 0 }}
                        animate={{ width: `${analyzed.urgencyScore * 20}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: severity.dot }}>{analyzed.urgencyScore}/5</span>
                  </div>
                  {analyzed.safetyNote && (
                    <p className="text-xs mt-2" style={{ color: severity.dot }}>
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                      {analyzed.safetyNote}
                    </p>
                  )}
                </div>

                {/* Diagnosis title */}
                <div>
                  <h2 className="font-heading text-3xl text-foreground tracking-tight mb-2">
                    {analyzed.title}
                  </h2>
                  {(vehicle.year || vehicle.make || vehicle.model) && (
                    <p className="text-xs text-foreground/40">
                      <Car className="w-3.5 h-3.5 inline mr-1" />
                      Analysis for: {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                      {vehicle.mileage ? ` — ${vehicle.mileage} miles` : ""}
                    </p>
                  )}
                  <p className="text-foreground/70 text-sm mt-3 leading-relaxed">{analyzed.summary}</p>
                </div>

                {/* Possible causes. Ranked, not measured — see LIKELIHOOD_LABEL. */}
                <div className="space-y-3 stagger-in">
                  <h3 className="font-heading text-sm text-primary tracking-wider">POSSIBLE CAUSES</h3>
                  <p className="text-foreground/40 text-xs -mt-1">
                    Ranked from what you described. The inspection is what confirms it.
                  </p>
                  {analyzed.likelyCauses.map((cause, i) => {
                    // Neutral chips. These used to be danger/warning-coded, which
                    // painted a *possibility* in the same red as a confirmed
                    // safety finding. Urgency belongs to the banner above.
                    const causeStyle = cause.likelihood === "high"
                      ? { border: "border-primary/30", bg: "bg-primary/5", dot: "var(--primary)" }
                      : { border: "border-border", bg: "bg-card", dot: "var(--ring-neutral-strong)" };

                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.15 }}
                        className={`${causeStyle.bg} ${causeStyle.border} border rounded-xl p-5`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: causeStyle.dot }} />
                            <h4 className="font-heading text-foreground tracking-wider text-sm">{cause.cause}</h4>
                          </div>
                          <span className="text-[10px] tracking-wider px-2 py-0.5 rounded whitespace-nowrap text-foreground/50 bg-foreground/5">
                            {LIKELIHOOD_LABEL[cause.likelihood]}
                          </span>
                        </div>
                        <p className="text-foreground/60 text-sm leading-relaxed ml-[18px]">{cause.explanation}</p>
                        {/* No "BOOK THIS REPAIR" link here. We have not confirmed
                            any repair — booking a specific job off a guessed cause
                            sells work nobody verified, and it scattered the page's
                            conversion across N speculative links. One action group
                            lives below the result. */}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Service & Cost */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-card border border-primary/20 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="w-4 h-4 text-primary" />
                      <span className="text-xs text-foreground/50 tracking-wide">Recommended Service</span>
                    </div>
                    <p className="font-heading text-foreground tracking-wider">{analyzed.recommendedService}</p>
                  </div>
                  {/* Was "Estimated Cost Range" + a dollar figure the model made
                      up: no labor guide, no parts feed, no pricing table behind
                      it. A persuasive invented number on a repair quote is the
                      one thing that can't be hand-waved, so the card now states
                      the shop's real, verifiable offer instead. */}
                  <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <CircleDot className="w-4 h-4 text-foreground/40" />
                      <span className="text-xs text-foreground/50 tracking-wide">What it costs to find out</span>
                    </div>
                    <p className="font-heading text-foreground tracking-wider">{analyzed.costNote}</p>
                    <p className="text-[10px] text-foreground/30 mt-1">Repair price comes from the inspection — you approve it before any work.</p>
                  </div>
                </div>

                {/* Next Steps */}
                <div>
                  <h3 className="font-heading text-sm text-primary tracking-wider mb-3">RECOMMENDED NEXT STEPS</h3>
                  <ol className="space-y-2">
                    {analyzed.nextSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-6 h-6 bg-primary/20 text-primary rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-foreground/70 text-sm leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Disclaimer */}
                <div className="bg-card/50 border border-border rounded-xl p-4">
                  <p className="text-xs text-foreground/40 leading-relaxed">
                    <Shield className="w-3.5 h-3.5 inline mr-1 text-foreground/30" />
                    This is a preliminary read of what you typed &mdash; not an OBD-II scan and not a
                    confirmed diagnosis. For the real answer we want the car in front of us:
                    ASE-certified hands, OBD-II tools, written quote before anyone touches a wrench.
                  </p>
                </div>
                  </>
                )}

                {/* ONE action group, in every state. The page used to scatter
                    conversion across per-cause "book this repair" links, a
                    "schedule drop-off" button and a lead form — all pointing at
                    /contact, which is a form, not the booking flow. High-intent
                    visitors got sent sideways. Confirm it → call → directions. */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Link
                    href="/booking"
                    onClick={() => trackEvent("diagnose_booking_click", {
                      urgency: analyzed?.urgency ?? "unknown",
                      service: analyzed?.recommendedService ?? "unknown",
                      redFlags: redFlags.length,
                    })}
                    className="flex items-center justify-center gap-2 bg-primary text-black px-6 py-4 rounded-md font-heading text-sm tracking-wider hover:bg-primary/90 transition-colors sm:col-span-3"
                  >
                    LET NICK&apos;S CONFIRM IT
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <a
                    href={BUSINESS.phone.href}
                    onClick={() => trackPhoneClick("diagnose-results")}
                    className="flex items-center justify-center gap-2 border-2 border-primary/40 text-primary px-6 py-4 rounded-md font-heading text-sm tracking-wider hover:bg-primary/10 hover:border-primary transition-colors sm:col-span-2"
                  >
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <a
                    href={BUSINESS.urls.googleMapsDirectionsNamed}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent("diagnose_directions_click", { urgency: analyzed?.urgency ?? "unknown" })}
                    className="flex items-center justify-center gap-2 border border-border text-foreground/70 px-6 py-4 rounded-md font-heading text-sm tracking-wider hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <MapPin className="w-4 h-4" />
                    DIRECTIONS
                  </a>
                </div>

                {/* Lead Capture */}
                {!diagLeadSubmitted ? (
                  <div className="bg-foreground/5 border border-foreground/10 rounded-xl p-5">
                    <h4 className="font-heading text-foreground text-sm tracking-wider mb-1">WANT US TO LOOK AT IT?</h4>
                    <p className="text-foreground/50 text-xs mb-4">Leave your number — we'll check it out when you come in. Quick checks are free.</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input type="text" placeholder="Your name" value={diagLeadName} onChange={e => setDiagLeadName(e.target.value)}
                        className="flex-1 bg-foreground/5 border border-foreground/10 rounded px-3 py-2.5 text-foreground text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50" />
                      <input type="tel" placeholder="Phone number" value={diagLeadPhone} onChange={e => setDiagLeadPhone(e.target.value)}
                        className="flex-1 bg-foreground/5 border border-foreground/10 rounded px-3 py-2.5 text-foreground text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50" />
                      <button
                        disabled={!diagLeadName || !diagLeadPhone || diagLeadPhone.replace(/\D/g, "").length < 7 || diagLeadSaving}
                        onClick={async () => {
                          setDiagLeadSaving(true);
                          try {
                            await submitDiagLead.mutateAsync({
                              name: diagLeadName,
                              phone: diagLeadPhone,
                              vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim() || undefined,
                              // Lead the note with where it came from + any red
                              // flag, so whoever picks this up in the CRM knows
                              // it's a symptom-checker lead and whether it's hot.
                              problem: [
                                "[/diagnose symptom check]",
                                redFlags.length ? `RED FLAG: ${redFlags.map((f) => f.label).join(", ")}.` : "",
                                analyzed ? `Checker said: ${analyzed.recommendedService} — ${analyzed.urgency} urgency.` : "Checker did not return a result.",
                                symptomText.slice(0, 1200),
                              ].filter(Boolean).join(" "),
                              // NOTE: still "popup" — `leads.source` is a MySQL
                              // enum with no "diagnose" member, and writing one
                              // before the DDL lands coerces the column to ''.
                              // The enum promotion ships with its own migration;
                              // until then getUtmData() below at least gives
                              // these leads the session attribution they were
                              // missing entirely.
                              source: "popup",
                              // Every other lead form on the site spreads this.
                              // /diagnose did not — so its leads reached the CRM
                              // with no landing page, no referrer, no session id
                              // and no UTMs, which is why the tool has never been
                              // creditable for a single booked job.
                              ...getUtmData(),
                            });
                            setDiagLeadSubmitted(true);
                          } catch {
                            // 2026-05-23 · was a bare `catch {}` that swallowed
                            // all errors. Customer rapid-clicks Send on a
                            // network blip → button keeps reverting to "Send"
                            // with no feedback → they walk away thinking it
                            // went through. Route them to the phone.
                            toast.error("Couldn't reach the shop — call (216) 862-0005.");
                          } finally {
                            setDiagLeadSaving(false);
                          }
                        }}
                        className="px-6 py-2.5 rounded bg-primary text-black font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 whitespace-nowrap"
                      >
                        {diagLeadSaving ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 text-center">
                    <p className="font-bold text-emerald-400 text-sm">We'll have a look when you come in!</p>
                    <p className="text-foreground/50 text-xs mt-1">Quick checks are free — just walk in.</p>
                  </div>
                )}

                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 text-foreground/40 hover:text-foreground/60 text-xs tracking-wider transition-colors mx-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  START OVER
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* The crawlable half of the page. The tool's answers are generated
            per-visitor and never reach an index — without this, /diagnose has
            nothing for Google to read but nav chrome and a form. */}
        <SymptomGuide />

        {/* How this tool works. Google's people-first guidance asks who made
            the content, how, and why — and a symptom checker that won't explain
            itself is exactly the thing a reader should distrust. */}
        <section className="bg-background pb-16" aria-labelledby="how-it-works-heading">
          <div className="container max-w-3xl">
            <div className="bg-card/50 border border-border rounded-xl p-5">
              <h2 id="how-it-works-heading" className="font-heading text-sm text-foreground tracking-wider mb-3">
                HOW THIS TOOL WORKS
              </h2>
              <ul className="space-y-2 text-xs text-foreground/50 leading-relaxed">
                <li>
                  <strong className="text-foreground/70">It reads your words, not your car.</strong> Nothing here
                  connects to your vehicle and no trouble codes are read. You describe what it&apos;s doing, and we
                  narrow down what usually causes that.
                </li>
                <li>
                  <strong className="text-foreground/70">Safety checks run in plain code, not the AI.</strong> Things
                  like &ldquo;won&apos;t stop&rdquo;, a flashing check-engine light or an oil-pressure warning are
                  matched directly from what you typed &mdash; so the warning still shows even if the rest of the
                  check fails.
                </li>
                <li>
                  <strong className="text-foreground/70">We don&apos;t quote prices from a description.</strong> We
                  have no way to price a repair we haven&apos;t seen. The quick check is free and the quote is written,
                  after we look at it.
                </li>
                <li>
                  <strong className="text-foreground/70">It can be wrong.</strong> It&apos;s a starting point built
                  from common causes &mdash; the real answer comes from an ASE-certified tech with the car on the lift.
                  If it says stop driving, take that seriously.
                </li>
                <li>
                  <strong className="text-foreground/70">What we keep.</strong> Your description is used to run the
                  check. We only store it if you choose to leave your name and number.
                </li>
              </ul>
              <p className="mt-4 text-[11px] text-foreground/35">
                Written by the team at {BUSINESS.name}, {BUSINESS.address.full} &middot; Last updated {CONTENT_LAST_UPDATED}
              </p>
            </div>
          </div>
        </section>

      </main>

    </PageLayout>
  );
}
