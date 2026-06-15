/**
 * "What's Wrong With My Car?" — AI-Powered Diagnostic Tool
 * Phase 1.11: Interactive car silhouette with clickable zones,
 * severity-coded result cards, and scan animation.
 */

import PageLayout from "@/components/PageLayout";
import ResponsivePhoto from "@/components/ResponsivePhoto";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Phone, AlertTriangle, Zap,
  Shield, Wrench, Car, ArrowRight, Loader2,
  Activity, RotateCcw, CircleDot, ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";

// Owned shop photo — real bay interior, not Manus.space CloudFront stock.
// 2026-05-06 wave-16 · pro photo pack: diagnostics needs authority +
// shop capability — interior bay with car on lift per PLACEMENT_GUIDE.md
const HERO_IMG = "/photos/interior-service-bay-car-lift.webp";

// ─── CAR ZONES ────────────────────────────────────────
type CarZone = {
  id: string;
  label: string;
  description: string;
  prefilledSymptom: string;
};

const CAR_ZONES: CarZone[] = [
  {
    id: "front",
    label: "Engine / Starting",
    description: "Engine bay, starting issues, check engine light",
    prefilledSymptom: "Engine / Starting Issues: My car is having problems with the engine area — hard starting, stalling, rough idle, knocking, check engine light, or reduced power.",
  },
  {
    id: "front-wheels",
    label: "Brakes / Tires",
    description: "Brake noise, tire wear, pulling to one side",
    prefilledSymptom: "Brakes / Tires: I'm experiencing brake or tire issues — squealing or grinding when braking, uneven tire wear, vibration, pulling to one side, or TPMS light.",
  },
  {
    id: "cabin",
    label: "AC / Heating / Electrical",
    description: "Climate control, electronics, interior comfort",
    prefilledSymptom: "AC / Heating / Electrical: There's a problem with interior comfort or electronics — AC blowing warm, heater not working, windows fogging, musty smell from vents, or electrical issues.",
  },
  {
    id: "rear",
    label: "Exhaust / Emissions",
    description: "Exhaust noise, smoke, smells from rear",
    prefilledSymptom: "Exhaust / Emissions: I'm noticing exhaust-related symptoms — loud rumble, white/blue/black smoke from tailpipe, rotten egg smell, or emissions warning.",
  },
  {
    id: "underneath",
    label: "Suspension / Steering",
    description: "Ride quality, vibrations, steering feel",
    prefilledSymptom: "Suspension / Steering / Vibration: I'm feeling ride quality issues — bumpy or bouncy ride, shaking while driving, whining when steering, clicking during turns, or fluid leaks underneath.",
  },
];

// ─── VEHICLE DATA ──────────────────────────────────────
const YEARS = Array.from({ length: 35 }, (_, i) => String(2026 - i));
const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan",
  "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo", "Other"
];

// ─── CAR SVG SILHOUETTE ────────────────────────────────

function CarSilhouette({
  activeZone,
  hoveredZone,
  onZoneClick,
  onZoneHover,
  onZoneLeave,
}: {
  activeZone: string | null;
  hoveredZone: string | null;
  onZoneClick: (id: string) => void;
  onZoneHover: (id: string) => void;
  onZoneLeave: () => void;
}) {
  const zoneColor = (id: string) => {
    if (activeZone === id) return "var(--primary)";
    if (hoveredZone === id) return "var(--brand-yellow-glow)";
    return "var(--ring-neutral)";
  };

  const zoneStroke = (id: string) => {
    if (activeZone === id || hoveredZone === id) return "var(--primary)";
    return "var(--ring-neutral-strong)";
  };

  return (
    <svg
      viewBox="0 0 800 320"
      className="w-full max-w-2xl mx-auto select-none"
      aria-label="Interactive car diagram — click a zone to select a symptom area"
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
      {hoveredZone && !activeZone && (() => {
        const zone = CAR_ZONES.find(z => z.id === hoveredZone);
        if (!zone) return null;
        return (
          <g>
            <rect x="250" y="280" width="300" height="32" rx="6" fill="var(--bg-card-elevated)" stroke="var(--primary)" strokeWidth="1" />
            <text x="400" y="301" textAnchor="middle" fill="var(--primary)" fontSize="12" fontWeight="500">
              {zone.label} — {zone.description}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── SCAN ANIMATION ────────────────────────────────────

function ScanAnimation() {
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
          <p className="text-primary font-heading text-sm tracking-widest uppercase">Scanning your vehicle...</p>
          <p className="text-foreground/40 text-xs mt-1">Our AI is analyzing your symptoms</p>
        </div>
      </div>
    </div>
  );
}

// ─── RESULT TYPES ──────────────────────────────────────

type DiagnosisResult = {
  urgency: "low" | "moderate" | "high" | "critical";
  urgencyScore: number;
  title: string;
  summary: string;
  likelyCauses: { cause: string; explanation: string; likelihood: string }[];
  recommendedService: string;
  estimatedCostRange: string;
  safetyNote: string;
  nextSteps: string[];
};

// Map urgency to severity card style
function getSeverityStyle(urgency: string) {
  switch (urgency) {
    case "low":
      return {
        border: "border-success/40",
        bg: "bg-success/8",
        badge: "bg-success/20 text-success",
        badgeText: "LOW RISK — MONITOR",
        icon: "text-success",
        dot: "var(--color-success)",
      };
    case "moderate":
      return {
        border: "border-warning/40",
        bg: "bg-warning/8",
        badge: "bg-warning/20 text-warning",
        badgeText: "NEEDS ATTENTION SOON",
        icon: "text-warning",
        dot: "var(--color-warning)",
      };
    case "high":
    case "critical":
      return {
        border: "border-danger/40",
        bg: "bg-danger/8",
        badge: "bg-danger/20 text-danger",
        badgeText: "URGENT — ADDRESS IMMEDIATELY",
        icon: "text-danger",
        dot: "var(--color-danger)",
      };
    default:
      return {
        border: "border-warning/40",
        bg: "bg-warning/8",
        badge: "bg-warning/20 text-warning",
        badgeText: "NEEDS ATTENTION",
        icon: "text-warning",
        dot: "var(--color-warning)",
      };
  }
}

// ─── MAIN PAGE ─────────────────────────────────────────

export default function DiagnosePage() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", mileage: "" });
  const [symptomText, setSymptomText] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [diagLeadName, setDiagLeadName] = useState("");
  const [diagLeadPhone, setDiagLeadPhone] = useState("");
  const [diagLeadSubmitted, setDiagLeadSubmitted] = useState(false);
  const [diagLeadSaving, setDiagLeadSaving] = useState(false);
  const submitDiagLead = trpc.lead.submit.useMutation();

  const formRef = useRef<HTMLDivElement>(null);

  const diagnoseMutation = trpc.diagnose.analyze.useMutation();

  const handleZoneClick = (zoneId: string) => {
    setSelectedZone(zoneId);
    const zone = CAR_ZONES.find(z => z.id === zoneId);
    if (zone) {
      setSymptomText(zone.prefilledSymptom);
    }
    // Scroll to form
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const performAnalysis = async (text: string) => {
    if (!text.trim()) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setResult(null);

    try {
      const symptoms = [text.trim()];
      const response = await diagnoseMutation.mutateAsync({
        vehicleYear: vehicle.year || undefined,
        vehicleMake: vehicle.make || undefined,
        vehicleModel: vehicle.model || undefined,
        mileage: vehicle.mileage || undefined,
        symptoms,
        additionalInfo: undefined,
      });

      setResult(response as DiagnosisResult);
      setShowResults(true);
    } catch (error) {
      console.error("Diagnosis failed:", error);
      setResult({
        urgency: "moderate",
        urgencyScore: 3,
        title: "We Need to Take a Closer Look",
        summary: "From what you described, we want to look at it in person. We'll hook up the OBD-II, walk through what it shows, and tell you exactly what's wrong before we touch anything.",
        likelyCauses: [
          {
            cause: "Needs a closer look in the shop",
            explanation: "In-person check with the OBD-II will tell us the exact issue.",
            likelihood: "High",
          },
        ],
        recommendedService: "Check Engine",
        estimatedCostRange: "Free check · written quote",
        safetyNote: "If you are experiencing any safety-related symptoms (brake issues, steering problems, warning lights), we want to look at the car as soon as possible.",
        nextSteps: [
          `Call ${BUSINESS.phone.display} or just walk in — we'll check it`,
          "We'll hook up the scanner and tell you exactly what's wrong",
          "You see the written quote before we touch anything. You don't pay until you say yes.",
        ],
      });
      setShowResults(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = () => performAnalysis(symptomText);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const symptomParam = params.get("symptom");
    if (symptomParam) {
      setSymptomText(symptomParam);
      performAnalysis(symptomParam);
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, []);

  const handleReset = () => {
    setSelectedZone(null);
    setVehicle({ year: "", make: "", model: "", mileage: "" });
    setSymptomText("");
    setResult(null);
    setShowResults(false);
    setIsAnalyzing(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const severity = result ? getSeverityStyle(result.urgency) : null;

  return (
    <PageLayout activeHref="/diagnose" showChat={true}>
      <SEOHead
        title="Auto Diagnostics Cleveland & Euclid · Nick's Tire & Auto"
        description="Free check-engine diagnostics in Euclid & Cleveland. Describe symptoms, get likely causes & repairs. You don't pay until you say yes. Call (216) 862-0005."
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
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Service",
              "name": "Automotive Diagnostics Service",
              "description": "Tell us the symptom, we tell you what's likely wrong + how urgent.",
              "provider": {
                "@type": "AutoRepair",
                "@id": `${BUSINESS.urls.website}/#localbusiness`
              },
              "areaServed": {
                "@type": "City",
                "name": "Cleveland"
              }
            })}} />

            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                  <Activity className="w-6 h-6 text-primary" />
                </div>
                <span className="font-mono text-primary/70 text-xs tracking-wide">AI-Powered Diagnostic Tool</span>
              </div>
              <h1 className="font-heading text-4xl lg:text-6xl text-foreground tracking-tight leading-[0.95]">
                WHAT'S WRONG WITH<br />
                <span className="text-primary">MY CAR</span>?
              </h1>
              <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
                Tap an area on the car below to select the problem zone, describe your symptoms, and our AI will provide a preliminary diagnosis in seconds. If you have brake squealing or grinding, check out our <Link href="/brakes" className="underline text-primary hover:text-primary-foreground font-semibold">brake symptoms list</Link>. For shaking or vibrations, check our <Link href="/tires" className="underline text-primary hover:text-primary-foreground font-semibold">tire options</Link>, see our <Link href="/financing" className="underline text-primary hover:text-primary-foreground font-semibold">financing options for repairs</Link>, or <Link href="/contact" className="underline text-primary hover:text-primary-foreground font-semibold">contact us</Link> directly.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Interactive Car Silhouette */}
        <section className="bg-background py-12 lg:py-16">
          <div className="container max-w-4xl">
            <FadeIn>
              <div className="text-center mb-8">
                <h2 className="font-heading text-2xl text-foreground tracking-tight mb-2">
                  TAP THE <span className="text-primary">PROBLEM AREA</span>
                </h2>
                <p className="text-foreground/50 text-sm">Click a zone on the car to get started</p>
              </div>

              <CarSilhouette
                activeZone={selectedZone}
                hoveredZone={hoveredZone}
                onZoneClick={handleZoneClick}
                onZoneHover={setHoveredZone}
                onZoneLeave={() => setHoveredZone(null)}
              />

              {/* Zone pills */}
              <div className="flex flex-wrap justify-center gap-2 mt-6">
                {CAR_ZONES.map((zone) => (
                  <button
                    key={zone.id}
                    onClick={() => handleZoneClick(zone.id)}
                    className={`px-4 py-2 rounded-full text-xs font-heading tracking-wider transition-all border ${
                      selectedZone === zone.id
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-card border-border text-foreground/50 hover:border-primary/50 hover:text-primary/70"
                    }`}
                  >
                    {zone.label}
                  </button>
                ))}
              </div>
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
                    DESCRIBE YOUR SYMPTOMS
                  </h3>
                  <p className="text-foreground/40 text-xs mb-4">
                    {selectedZone
                      ? "We've pre-filled based on your selection. Edit or add more detail below."
                      : "What's happening with your car? Be as specific as possible."}
                  </p>
                  <textarea
                    value={symptomText}
                    onChange={(e) => setSymptomText(e.target.value)}
                    rows={5}
                    placeholder="Example: My brakes are squealing loudly when I slow down, especially going downhill. It started about a week ago and seems to be getting worse..."
                    className="w-full bg-background border border-border text-foreground px-4 py-3 text-sm rounded-md placeholder:text-foreground/25 focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
                  />
                </div>

                {/* Scan button */}
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !symptomText.trim()}
                  className="w-full flex items-center justify-center gap-3 bg-primary text-black px-8 py-4 rounded-md font-heading text-base tracking-wider hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      SCANNING...
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      SCAN MY CAR
                    </>
                  )}
                </button>
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
                <ScanAnimation />
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {showResults && result && severity && (
            <motion.section
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="bg-background py-12 lg:py-16"
            >
              <div className="container max-w-3xl space-y-6">
                {/* Severity banner */}
                <div className={`${severity.bg} ${severity.border} border rounded-xl p-5`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: severity.dot }} />
                    <span className={`font-heading text-sm tracking-wider ${severity.badge.split(" ")[1]}`}>
                      {severity.badgeText}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: severity.dot }}
                        initial={{ width: 0 }}
                        animate={{ width: `${result.urgencyScore * 20}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: severity.dot }}>{result.urgencyScore}/5</span>
                  </div>
                  {result.safetyNote && (
                    <p className="text-xs mt-2" style={{ color: severity.dot }}>
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                      {result.safetyNote}
                    </p>
                  )}
                </div>

                {/* Diagnosis title */}
                <div>
                  <h2 className="font-heading text-3xl text-foreground tracking-tight mb-2">
                    {result.title}
                  </h2>
                  {(vehicle.year || vehicle.make || vehicle.model) && (
                    <p className="text-xs text-foreground/40">
                      <Car className="w-3.5 h-3.5 inline mr-1" />
                      Analysis for: {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                      {vehicle.mileage ? ` — ${vehicle.mileage} miles` : ""}
                    </p>
                  )}
                  <p className="text-foreground/70 text-sm mt-3 leading-relaxed">{result.summary}</p>
                </div>

                {/* Likely Causes as severity-coded cards */}
                <div className="space-y-3 stagger-in">
                  <h3 className="font-heading text-sm text-primary tracking-wider">POSSIBLE CAUSES</h3>
                  {result.likelyCauses.map((cause, i) => {
                    // Assign severity color per cause based on likelihood
                    const causeStyle = cause.likelihood === "High"
                      ? { border: "border-danger/30", bg: "bg-danger/5", dot: "var(--color-danger)" }
                      : cause.likelihood === "Medium"
                      ? { border: "border-warning/30", bg: "bg-warning/5", dot: "var(--color-warning)" }
                      : { border: "border-success/30", bg: "bg-success/5", dot: "var(--color-success)" };

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
                          <span className="text-[10px] tracking-wider px-2 py-0.5 rounded" style={{ color: causeStyle.dot, backgroundColor: `${causeStyle.dot}20` }}>
                            {cause.likelihood.toUpperCase()} LIKELIHOOD
                          </span>
                        </div>
                        <p className="text-foreground/60 text-sm leading-relaxed ml-[18px]">{cause.explanation}</p>

                        {/* Book This Repair CTA */}
                        <div className="mt-3 ml-[18px]">
                          <Link
                            href="/contact"
                            className="inline-flex items-center gap-1.5 text-primary text-xs font-heading tracking-wider hover:text-primary/80 transition-colors"
                          >
                            BOOK THIS REPAIR
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
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
                    <p className="font-heading text-foreground tracking-wider">{result.recommendedService}</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <CircleDot className="w-4 h-4 text-foreground/40" />
                      <span className="text-xs text-foreground/50 tracking-wide">Estimated Cost Range</span>
                    </div>
                    <p className="font-heading text-foreground tracking-wider">{result.estimatedCostRange}</p>
                    <p className="text-[10px] text-foreground/30 mt-1">*Actual cost determined after in-person diagnosis</p>
                  </div>
                </div>

                {/* Next Steps */}
                <div>
                  <h3 className="font-heading text-sm text-primary tracking-wider mb-3">RECOMMENDED NEXT STEPS</h3>
                  <ol className="space-y-2">
                    {result.nextSteps.map((step, i) => (
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
                    This is a preliminary read based on the symptoms you described. For the real answer we want the car in front of us. ASE-certified hands, OBD-II tools, written quote before anyone touches a wrench.
                  </p>
                </div>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <a
                    href={BUSINESS.phone.href}
                    onClick={() => trackPhoneClick("diagnose-results")}
                    className="flex items-center justify-center gap-2 bg-primary text-black px-8 py-4 rounded-md font-heading text-base tracking-wider hover:bg-primary/90 transition-colors flex-1"
                  >
                    <Phone className="w-5 h-5" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <Link
                    href="/contact"
                    className="flex items-center justify-center gap-2 border-2 border-primary/40 text-primary px-8 py-4 rounded-md font-heading text-base tracking-wider hover:bg-primary/10 hover:border-primary transition-colors flex-1"
                  >
                    SCHEDULE DROP-OFF
                    <ArrowRight className="w-5 h-5" />
                  </Link>
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
                              problem: `Symptom: ${result?.recommendedService || "check"} — ${result?.urgency || "unknown"} urgency. ${symptomText.slice(0, 200)}`,
                              source: "popup",
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

      </main>

    </PageLayout>
  );
}
