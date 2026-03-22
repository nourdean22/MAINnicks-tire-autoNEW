/**
 * "What's Wrong With My Car?" — AI-Powered Diagnostic Tool
 * Interactive symptom checker that demonstrates Nick's diagnostic expertise.
 * Guides users through symptom selection, provides AI analysis, and converts to leads.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useState } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Phone, ChevronRight, ChevronLeft,
  AlertTriangle, Gauge, ThermometerSun, Eye, Zap,
  Shield, Wrench, Car, CheckCircle, ArrowRight, Loader2,
  Volume2, Wind, CircleDot, Activity, RotateCcw
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";



// ─── SYMPTOM DATA ──────────────────────────────────────
type SymptomCategory = {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  symptoms: { id: string; label: string; detail: string }[];
};

const SYMPTOM_CATEGORIES: SymptomCategory[] = [
  {
    id: "sounds",
    label: "Unusual Sounds",
    icon: <Volume2 className="w-6 h-6" />,
    color: "text-blue-400",
    symptoms: [
      { id: "squealing-brakes", label: "Squealing when braking", detail: "High-pitched noise when you press the brake pedal" },
      { id: "grinding-brakes", label: "Grinding when braking", detail: "Metal-on-metal grinding sound during braking" },
      { id: "clicking-turning", label: "Clicking when turning", detail: "Rhythmic clicking noise during turns" },
      { id: "knocking-engine", label: "Knocking from engine", detail: "Knocking or pinging sound from the engine bay" },
      { id: "whining-steering", label: "Whining when steering", detail: "Whining or groaning noise when turning the wheel" },
      { id: "rumbling-exhaust", label: "Loud exhaust rumble", detail: "Louder than normal exhaust noise" },
      { id: "humming-driving", label: "Humming while driving", detail: "Constant humming that changes with speed" },
      { id: "rattling-idle", label: "Rattling at idle", detail: "Rattling or vibrating noise when the car is idling" },
    ],
  },
  {
    id: "warning-lights",
    label: "Warning Lights",
    icon: <AlertTriangle className="w-6 h-6" />,
    color: "text-red-400",
    symptoms: [
      { id: "check-engine", label: "Check engine light", detail: "The check engine / MIL light is on" },
      { id: "check-engine-flashing", label: "Check engine light flashing", detail: "The check engine light is blinking or flashing" },
      { id: "abs-light", label: "ABS warning light", detail: "Anti-lock braking system warning is illuminated" },
      { id: "battery-light", label: "Battery warning light", detail: "Battery or charging system warning light" },
      { id: "oil-light", label: "Oil pressure warning", detail: "Low oil pressure warning light" },
      { id: "temp-light", label: "Temperature warning", detail: "Engine overheating warning light" },
      { id: "tpms-light", label: "Tire pressure light (TPMS)", detail: "Tire pressure monitoring system alert" },
      { id: "brake-light", label: "Brake warning light", detail: "Brake system warning indicator" },
    ],
  },
  {
    id: "performance",
    label: "Performance Issues",
    icon: <Gauge className="w-6 h-6" />,
    color: "text-amber-400",
    symptoms: [
      { id: "hard-starting", label: "Hard to start", detail: "Engine cranks but takes multiple attempts to start" },
      { id: "stalling", label: "Engine stalling", detail: "Engine dies while driving or at idle" },
      { id: "rough-idle", label: "Rough idle", detail: "Engine vibrates or runs unevenly at idle" },
      { id: "poor-acceleration", label: "Poor acceleration", detail: "Sluggish response when pressing the gas" },
      { id: "poor-fuel-economy", label: "Poor fuel economy", detail: "Getting fewer miles per gallon than usual" },
      { id: "transmission-slipping", label: "Transmission slipping", detail: "RPMs rise but car does not accelerate properly" },
      { id: "shaking-driving", label: "Shaking while driving", detail: "Vibration felt through steering wheel or seat" },
      { id: "pulling-side", label: "Pulling to one side", detail: "Vehicle drifts left or right while driving straight" },
    ],
  },
  {
    id: "smells",
    label: "Unusual Smells",
    icon: <Wind className="w-6 h-6" />,
    color: "text-emerald-400",
    symptoms: [
      { id: "burning-rubber", label: "Burning rubber smell", detail: "Smell of burning rubber from the engine or wheels" },
      { id: "burning-oil", label: "Burning oil smell", detail: "Acrid smell of burning engine oil" },
      { id: "sweet-smell", label: "Sweet/coolant smell", detail: "Sweet, syrupy smell from the engine area" },
      { id: "rotten-eggs", label: "Rotten egg smell", detail: "Sulfur or rotten egg odor from exhaust" },
      { id: "gas-smell", label: "Gasoline smell", detail: "Strong fuel odor inside or outside the vehicle" },
      { id: "musty-ac", label: "Musty smell from AC", detail: "Mold or mildew smell when AC is running" },
    ],
  },
  {
    id: "visual",
    label: "Visual Signs",
    icon: <Eye className="w-6 h-6" />,
    color: "text-purple-400",
    symptoms: [
      { id: "fluid-leak", label: "Fluid leaking underneath", detail: "Puddles or spots under the parked vehicle" },
      { id: "white-smoke", label: "White smoke from exhaust", detail: "Thick white smoke from the tailpipe" },
      { id: "blue-smoke", label: "Blue smoke from exhaust", detail: "Blue-tinted smoke from the tailpipe" },
      { id: "black-smoke", label: "Black smoke from exhaust", detail: "Dark black smoke from the tailpipe" },
      { id: "uneven-tire-wear", label: "Uneven tire wear", detail: "Tires wearing unevenly on one side or in patches" },
      { id: "rust-damage", label: "Visible rust or damage", detail: "Rust spots or physical damage on body or undercarriage" },
    ],
  },
  {
    id: "comfort",
    label: "Comfort & Climate",
    icon: <ThermometerSun className="w-6 h-6" />,
    color: "text-orange-400",
    symptoms: [
      { id: "ac-warm", label: "AC blowing warm air", detail: "Air conditioning is not cooling properly" },
      { id: "heat-not-working", label: "Heater not working", detail: "No warm air from the heating system" },
      { id: "windows-fogging", label: "Windows fogging up", detail: "Excessive interior fogging that won't clear" },
      { id: "bumpy-ride", label: "Bumpy or bouncy ride", detail: "Excessive bouncing or harsh ride quality" },
    ],
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

// ─── NAVIGATION ────────────────────────────────────────

// ─── STEP COMPONENTS ───────────────────────────────────

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold font-bold text-sm transition-all ${
            i < currentStep
              ? "bg-primary text-primary-foreground"
              : i === currentStep
              ? "bg-primary/20 text-primary border-2 border-primary"
              : "bg-card border border-border/30 text-foreground/30"
          }`}>
            {i < currentStep ? <CheckCircle className="w-4 h-4" /> : i + 1}
          </div>
          {i < totalSteps - 1 && (
            <div className={`w-8 h-0.5 ${i < currentStep ? "bg-primary" : "bg-border/30"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function VehicleStep({ vehicle, setVehicle, onNext }: {
  vehicle: { year: string; make: string; model: string; mileage: string };
  setVehicle: (v: { year: string; make: string; model: string; mileage: string }) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-2">
          TELL US ABOUT YOUR VEHICLE
        </h3>
        <p className="text-foreground/60 text-sm">
          This helps our technicians narrow down the most likely causes for your symptoms.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[12px] text-foreground/50 tracking-wide mb-2">Year</label>
          <select
            value={vehicle.year}
            onChange={(e) => setVehicle({ ...vehicle, year: e.target.value })}
            className="w-full bg-card border border-border/50 text-foreground px-4 py-3 text-[13px] focus:outline-none focus:border-primary/50 rounded-md"
          >
            <option value="">Select Year</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-foreground/50 tracking-wide mb-2">Make</label>
          <select
            value={vehicle.make}
            onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })}
            className="w-full bg-card border border-border/50 text-foreground px-4 py-3 text-[13px] focus:outline-none focus:border-primary/50 rounded-md"
          >
            <option value="">Select Make</option>
            {MAKES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-foreground/50 tracking-wide mb-2">Model</label>
          <input
            type="text"
            value={vehicle.model}
            onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
            placeholder="e.g., Camry, Civic, F-150"
            className="w-full bg-card border border-border/50 text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 rounded-md"
          />
        </div>
        <div>
          <label className="block text-[12px] text-foreground/50 tracking-wide mb-2">Approx. Mileage</label>
          <input
            type="text"
            value={vehicle.mileage}
            onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })}
            placeholder="e.g., 85,000"
            className="w-full bg-card border border-border/50 text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 rounded-md"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
        >
          NEXT: SELECT SYMPTOMS
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SymptomsStep({ selectedSymptoms, toggleSymptom, onNext, onBack }: {
  selectedSymptoms: string[];
  toggleSymptom: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>("sounds");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-2">
          WHAT SYMPTOMS ARE YOU EXPERIENCING?
        </h3>
        <p className="text-foreground/60 text-sm">
          Select all that apply. The more details you provide, the more accurate our preliminary assessment will be.
        </p>
        {selectedSymptoms.length > 0 && (
          <p className="text-[12px] text-primary mt-2">
            {selectedSymptoms.length} symptom{selectedSymptoms.length !== 1 ? "s" : ""} selected
          </p>
        )}
      </div>

      <div className="space-y-3">
        {SYMPTOM_CATEGORIES.map((cat) => (
          <div key={cat.id} className="border border-border/30 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-card/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={cat.color}>{cat.icon}</span>
                <span className="font-semibold font-bold text-foreground tracking-wider text-sm">{cat.label}</span>
                {cat.symptoms.filter(s => selectedSymptoms.includes(s.id)).length > 0 && (
                  <span className="bg-primary/20 text-primary px-2 py-0.5 text-[10px] tracking-wider rounded">
                    {cat.symptoms.filter(s => selectedSymptoms.includes(s.id)).length} SELECTED
                  </span>
                )}
              </div>
              <ChevronRight className={`w-4 h-4 text-foreground/40 transition-transform ${expandedCategory === cat.id ? "rotate-90" : ""}`} />
            </button>

            <AnimatePresence>
              {expandedCategory === cat.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {cat.symptoms.map((symptom) => {
                      const isSelected = selectedSymptoms.includes(symptom.id);
                      return (
                        <button
                          key={symptom.id}
                          onClick={() => toggleSymptom(symptom.id)}
                          className={`text-left p-3 rounded-md border transition-all ${
                            isSelected
                              ? "border-primary/50 bg-primary/10"
                              : "border-border/20 hover:border-border/40 bg-card/30"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`w-4 h-4 mt-0.5 rounded-sm border flex items-center justify-center shrink-0 ${
                              isSelected ? "bg-primary border-primary" : "border-foreground/30"
                            }`}>
                              {isSelected && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
                            </div>
                            <div>
                              <p className={`text-[13px] ${isSelected ? "text-primary" : "text-foreground/80"}`}>
                                {symptom.label}
                              </p>
                              <p className="text-[12px] text-foreground/40 mt-0.5">{symptom.detail}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 border border-border/30 text-foreground/60 px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          BACK
        </button>
        <button
          onClick={onNext}
          disabled={selectedSymptoms.length === 0}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          NEXT: ADD DETAILS
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function DetailsStep({ additionalInfo, setAdditionalInfo, onAnalyze, onBack, isAnalyzing }: {
  additionalInfo: string;
  setAdditionalInfo: (s: string) => void;
  onAnalyze: () => void;
  onBack: () => void;
  isAnalyzing: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-2">
          ANYTHING ELSE WE SHOULD KNOW?
        </h3>
        <p className="text-foreground/60 text-sm">
          When did the problem start? Does it happen all the time or only in certain conditions? Any recent repairs or maintenance?
        </p>
      </div>

      <textarea
        value={additionalInfo}
        onChange={(e) => setAdditionalInfo(e.target.value)}
        rows={5}
        placeholder="Example: The squealing started about a week ago and gets worse when I brake going downhill. I had the oil changed last month but nothing else recently..."
        className="w-full bg-card border border-border/50 text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 rounded-md resize-none"
      />

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 border border-border/30 text-foreground/60 px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          BACK
        </button>
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-70"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              ANALYZING...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              ANALYZE MY SYMPTOMS
            </>
          )}
        </button>
      </div>
    </div>
  );
}

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

function ResultsStep({ result, vehicle, onReset, onBook: _onBook }: {
  result: DiagnosisResult;
  vehicle: { year: string; make: string; model: string; mileage: string };
  onReset: () => void;
  onBook: () => void;
}) {
  const urgencyConfig = {
    low: { label: "ROUTINE", color: "text-foreground/60", bg: "bg-foreground/5 border-foreground/20", barColor: "bg-foreground/30" },
    moderate: { label: "MODERATE", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", barColor: "bg-amber-400" },
    high: { label: "HIGH PRIORITY", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", barColor: "bg-orange-400" },
    critical: { label: "URGENT — SAFETY CONCERN", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", barColor: "bg-red-400" },
  };

  const uc = urgencyConfig[result.urgency];
  const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      {/* Urgency Banner */}
      <div className={`border rounded-lg p-5 ${uc.bg}`}>
        <div className="flex items-center gap-3 mb-3">
          {(result.urgency === "high" || result.urgency === "critical") && (
            <AlertTriangle className={`w-5 h-5 ${uc.color}`} />
          )}
          <span className={`font-semibold font-bold text-sm tracking-wider ${uc.color}`}>{uc.label}</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-2 bg-background/50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${uc.barColor}`} style={{ width: `${result.urgencyScore * 20}%` }} />
          </div>
          <span className={`text-[12px] ${uc.color}`}>{result.urgencyScore}/5</span>
        </div>
        {result.safetyNote && (
          <p className={`text-[12px] ${uc.color} mt-2`}>{result.safetyNote}</p>
        )}
      </div>

      {/* Diagnosis Title */}
      <div>
        <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-2">
          {result.title}
        </h3>
        {vehicleStr && (
          <p className="text-[12px] text-foreground/40">
            <Car className="w-3.5 h-3.5 inline mr-1" />
            Analysis for: {vehicleStr}{vehicle.mileage ? ` — ${vehicle.mileage} miles` : ""}
          </p>
        )}
        <p className="text-foreground/70 text-sm mt-3 leading-relaxed">{result.summary}</p>
      </div>

      {/* Likely Causes */}
      <div>
        <h4 className="font-semibold font-bold text-sm text-nick-blue-light tracking-wide mb-4">
          MOST LIKELY CAUSES
        </h4>
        <div className="space-y-3">
          {result.likelyCauses.map((cause, i) => (
            <div key={i} className="bg-card/50 border border-border/20 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h5 className="font-semibold font-bold text-foreground tracking-wider text-sm">{cause.cause}</h5>
                <span className={`font-mono text-[10px] tracking-wider px-2 py-0.5 rounded ${
                  cause.likelihood === "High" ? "bg-primary/20 text-primary" :
                  cause.likelihood === "Medium" ? "bg-nick-blue/20 text-nick-blue-light" :
                  "bg-foreground/10 text-foreground/50"
                }`}>
                  {cause.likelihood.toUpperCase()} LIKELIHOOD
                </span>
              </div>
              <p className="text-foreground/60 text-sm leading-relaxed">{cause.explanation}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended Service & Cost */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card/50 border border-primary/20 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-4 h-4 text-primary" />
            <span className="text-[12px] text-foreground/50 tracking-wide">Recommended Service</span>
          </div>
          <p className="font-semibold font-bold text-foreground tracking-wider">{result.recommendedService}</p>
        </div>
        <div className="bg-card/50 border border-nick-blue/20 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <CircleDot className="w-4 h-4 text-nick-blue-light" />
            <span className="text-[12px] text-foreground/50 tracking-wide">Estimated Cost Range</span>
          </div>
          <p className="font-semibold font-bold text-foreground tracking-wider">{result.estimatedCostRange}</p>
          <p className="font-mono text-[10px] text-foreground/40 mt-1">*Actual cost determined after in-person diagnosis</p>
        </div>
      </div>

      {/* Next Steps */}
      <div>
        <h4 className="font-semibold font-bold text-sm text-nick-blue-light tracking-wide mb-3">
          RECOMMENDED NEXT STEPS
        </h4>
        <ol className="space-y-2">
          {result.nextSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 bg-primary/20 text-primary rounded-full flex items-center justify-center text-[12px] shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-foreground/70 text-sm leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Disclaimer */}
      <div className="bg-card/30 border border-border/20 rounded-lg p-4">
        <p className="text-[12px] text-foreground/40 leading-relaxed">
          <Shield className="w-3.5 h-3.5 inline mr-1 text-foreground/30" />
          This is a preliminary assessment based on the symptoms you described. A proper diagnosis requires an in-person inspection by our certified technicians using professional diagnostic equipment. Costs may vary based on the actual findings.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-4">
        <a
          href={BUSINESS.phone.href}
          onClick={() => trackPhoneClick("diagnose-results")}
          className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-base tracking-wide hover:opacity-90 transition-colors flex-1"
        >
          <Phone className="w-5 h-5" />
          CALL {BUSINESS.phone.display}
        </a>
        <Link
          href="/contact"
          className="flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-base tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors flex-1"
        >
          BOOK APPOINTMENT
          <ArrowRight className="w-5 h-5" />
        </Link>
      </div>

      <button
        onClick={onReset}
        className="flex items-center gap-2 text-foreground/40 hover:text-foreground/60 text-[12px] tracking-wide transition-colors mx-auto"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        START OVER
      </button>
    </div>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────

export default function DiagnosePage() {
  const [step, setStep] = useState(0); // 0=vehicle, 1=symptoms, 2=details, 3=results
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", mileage: "" });
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const diagnoseMutation = trpc.diagnose.analyze.useMutation();

  const toggleSymptom = (id: string) => {
    setSelectedSymptoms(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // Build symptom labels from selected IDs
  const getSymptomLabels = () => {
    return selectedSymptoms.map(id => {
      for (const cat of SYMPTOM_CATEGORIES) {
        const found = cat.symptoms.find(s => s.id === id);
        if (found) return `${cat.label}: ${found.label} (${found.detail})`;
      }
      return id;
    });
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const symptomLabels = getSymptomLabels();
      const response = await diagnoseMutation.mutateAsync({
        vehicleYear: vehicle.year || undefined,
        vehicleMake: vehicle.make || undefined,
        vehicleModel: vehicle.model || undefined,
        mileage: vehicle.mileage || undefined,
        symptoms: symptomLabels,
        additionalInfo: additionalInfo || undefined,
      });

      setResult(response as DiagnosisResult);
      setStep(3);
    } catch (error) {
      console.error("Diagnosis failed:", error);
      setResult({
        urgency: "moderate",
        urgencyScore: 3,
        title: "We Need to Take a Closer Look",
        summary: "Based on the symptoms you described, we recommend bringing your vehicle in for a professional diagnostic inspection. Our technicians use advanced OBD-II diagnostic equipment to pinpoint the exact cause of the issue.",
        likelyCauses: [
          {
            cause: "Professional diagnosis required",
            explanation: "The combination of symptoms you described could have multiple causes. An in-person inspection with diagnostic equipment will identify the exact issue.",
            likelihood: "High",
          },
        ],
        recommendedService: "Diagnostics",
        estimatedCostRange: "Call for estimate",
        safetyNote: "If you are experiencing any safety-related symptoms (brake issues, steering problems, warning lights), we recommend having the vehicle inspected as soon as possible.",
        nextSteps: [
          `Call ${BUSINESS.phone.display} to schedule a diagnostic appointment`,
          "Our technicians will use professional equipment to identify the exact cause",
          "We will explain the findings and provide a repair estimate before any work begins",
        ],
      });
      setStep(3);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setStep(0);
    setVehicle({ year: "", make: "", model: "", mileage: "" });
    setSelectedSymptoms([]);
    setAdditionalInfo("");
    setResult(null);
  };

  return (
    <PageLayout activeHref="/diagnose" showChat={true}>
      <SEOHead
        title="Free Car Diagnostic Tool | Nick's Tire & Auto"
        description="Describe your car symptoms and get a free preliminary diagnosis from Nick's Tire & Auto in Cleveland. AI-powered symptom checker identifies potential issues."
        canonicalPath="/diagnose"
      />
      

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 pb-12 overflow-hidden">
          <div className="absolute inset-0">
            <img loading="lazy" src={HERO_IMG} alt="Technician performing vehicle diagnostics" className="w-full h-full object-cover opacity-20" />
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
        "description": "AI-powered diagnostic tool to identify car problems and symptoms",
        "provider": {
          "@type": "LocalBusiness",
          "name": BUSINESS.name,
          "telephone": `+1-${BUSINESS.phone.dashed}`,
          "address": {
            "@type": "PostalAddress",
            "streetAddress": BUSINESS.address.street,
            "addressLocality": BUSINESS.address.city,
            "addressRegion": BUSINESS.address.state,
            "postalCode": BUSINESS.address.zip,
            "addressCountry": "US"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": BUSINESS.reviews.rating,
            "reviewCount": BUSINESS.reviews.count,
            "bestRating": "5"
          },
          "url": BUSINESS.urls.website
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
                <span className="font-mono text-nick-blue-light text-xs tracking-wide">Free Diagnostic Tool</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl lg:text-6xl text-foreground tracking-tight leading-[0.95]">
                WHAT'S WRONG WITH<br />
                <span className="text-primary">MY CAR</span>?
              </h1>
              <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
                Describe your vehicle's symptoms and our AI-powered diagnostic tool will provide a preliminary assessment. This is not a replacement for professional diagnosis — but it can help you understand what might be going on before you visit.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Diagnostic Tool */}
        <section className="bg-[oklch(0.065_0.004_260)] py-12 lg:py-16">
          <div className="container max-w-3xl">
            <FadeIn>
              <StepIndicator currentStep={step} totalSteps={4} />

              <div className="bg-card/50 border border-border/30 rounded-xl p-6 lg:p-8">
                <AnimatePresence mode="wait">
                  {step === 0 && (
                    <motion.div key="vehicle" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                      <VehicleStep vehicle={vehicle} setVehicle={setVehicle} onNext={() => setStep(1)} />
                    </motion.div>
                  )}
                  {step === 1 && (
                    <motion.div key="symptoms" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                      <SymptomsStep selectedSymptoms={selectedSymptoms} toggleSymptom={toggleSymptom} onNext={() => setStep(2)} onBack={() => setStep(0)} />
                    </motion.div>
                  )}
                  {step === 2 && (
                    <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                      <DetailsStep additionalInfo={additionalInfo} setAdditionalInfo={setAdditionalInfo} onAnalyze={handleAnalyze} onBack={() => setStep(1)} isAnalyzing={isAnalyzing} />
                    </motion.div>
                  )}
                  {step === 3 && result && (
                    <motion.div key="results" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                      <ResultsStep result={result} vehicle={vehicle} onReset={handleReset} onBook={() => {}} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Trust Section */}
        <section className="bg-[oklch(0.065_0.004_260)] py-16">
          <div className="container max-w-3xl text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-4">
                WHY USE THIS <span className="text-primary">TOOL</span>?
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm mb-2">UNDERSTAND FIRST</h3>
                  <p className="text-foreground/50 text-sm">Know what might be wrong before you visit any shop. No surprises.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-nick-blue/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Zap className="w-6 h-6 text-nick-blue-light" />
                  </div>
                  <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm mb-2">FAST & FREE</h3>
                  <p className="text-foreground/50 text-sm">Get a preliminary assessment in under 60 seconds. No cost, no obligation.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Wrench className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm mb-2">EXPERT BACKED</h3>
                  <p className="text-foreground/50 text-sm">Built on real diagnostic knowledge from professional auto technicians.</p>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-[oklch(0.065_0.004_260)] py-16">
          
          <div className="container pt-12 text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight">
                PREFER TO <span className="text-primary">TALK</span>?
              </h2>
              <p className="mt-4 text-foreground/60 text-lg max-w-xl mx-auto">
                Our technicians are happy to discuss your vehicle's symptoms over the phone. Call us for a free consultation.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("diagnose-cta")} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors">
                  <Phone className="w-5 h-5" />
                  CALL {BUSINESS.phone.display}
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                  BOOK ONLINE
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        
      </main>

      
      <section className="container pb-8">
        <FinancingCTA variant="banner" />
      </section>
      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
