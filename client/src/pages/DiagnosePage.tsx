/**
 * "What's Wrong With My Car?" — AI-Powered Diagnostic Tool
 * Interactive symptom checker that demonstrates Nick's diagnostic expertise.
 * Guides users through symptom selection, provides AI analysis, and converts to leads.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useState, useRef } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Phone, ChevronRight, ChevronLeft,
  AlertTriangle, Gauge, ThermometerSun, Eye, Zap,
  Shield, Wrench, Car, CheckCircle, ArrowRight, Loader2,
  Volume2, Wind, CircleDot, Activity, RotateCcw
} from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

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
function VehicleStep({ vehicle, setVehicle, onNext }: {
  vehicle: { year: string; make: string; model: string; mileage: string };
  setVehicle: (v: { year: string; make: string; model: string; mileage: string }) => void;
  onNext: () => void;
}) {
function SymptomsStep({ selectedSymptoms, toggleSymptom, onNext, onBack }: {
  selectedSymptoms: string[];
  toggleSymptom: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>("sounds");


function DetailsStep({ additionalInfo, setAdditionalInfo, onAnalyze, onBack, isAnalyzing }: {
  additionalInfo: string;
  setAdditionalInfo: (s: string) => void;
  onAnalyze: () => void;
  onBack: () => void;
  isAnalyzing: boolean;
}) {
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

}
