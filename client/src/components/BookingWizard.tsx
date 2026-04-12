import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { trackBookingSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Calendar, Clock, Car, Wrench, CheckCircle, AlertCircle,
  Loader2, ChevronRight, ChevronLeft, User, Mail, Users,
  AlertTriangle, Zap, Check,
  CircleDot, Thermometer, Gauge, Droplets, Settings,
} from "lucide-react";
import { BUSINESS } from "@shared/business";

// ─── SERVICE CARDS ────────────────────────────────────
const SERVICE_CARDS = [
  { key: "Tires — New, Used, Repair", label: "Tires", price: "Used from $60", icon: CircleDot },
  { key: "Brake Repair", label: "Brakes", price: "Free inspection", icon: AlertCircle },
  { key: "Check Engine Light / Diagnostics", label: "Diagnostics", price: "Written estimate", icon: Gauge },
  { key: "Ohio E-Check / Emissions Repair", label: "Emissions", price: "Walk-in today", icon: Thermometer },
  { key: "Oil Change", label: "Oil Change", price: "Competitive pricing", icon: Droplets },
  { key: "Suspension & Steering", label: "Suspension", price: "Free estimate", icon: Settings },
  { key: "AC Repair", label: "AC", price: "Free estimate", icon: Thermometer },
  { key: "General Repair / Other", label: "General/Other", price: "Free estimate", icon: Wrench },
] as const;

const URGENCY_OPTIONS = [
  { value: "emergency" as const, label: "Emergency", desc: "Unsafe to drive", dot: "bg-red-500" },
  { value: "this-week" as const, label: "This Week", desc: "Need it soon", dot: "bg-yellow-500" },
  { value: "whenever" as const, label: "No Rush", desc: "Just need it done", dot: "bg-green-500" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 2 }, (_, i) => String(CURRENT_YEAR + 1 - i));

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan",
  "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo", "Other",
];

const TIME_SLOTS = [
  { value: "morning", label: "Morning (8-10)" },
  { value: "midday", label: "Midday (10-1)" },
  { value: "afternoon", label: "Afternoon (1-4)" },
  { value: "late", label: "Late (4-6)" },
];

// Generate next 14 days for date picker
function getMinMaxDates() {
  const today = new Date();
  const max = new Date(today);
  max.setDate(max.getDate() + 14);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { min: fmt(today), max: fmt(max) };
}

// Format phone as (XXX) XXX-XXXX
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Service", "Vehicle", "Schedule", "Contact"];

// ─── SLIDE ANIMATION ─────────────────────────────────
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -200 : 200,
    opacity: 0,
  }),
};

export default function BookingWizard({ defaultService }: { defaultService?: string } = {}) {
  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    service: defaultService || "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    preferredDate: "",
    preferredTime: "" as string,
    message: "",
    urgency: "whenever" as "emergency" | "this-week" | "whenever",
    textUpdates: true,
    referredBy: "",
  });

  const mutation = trpc.booking.create.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("We couldn't submit your booking. Please check your info and try again, or call (216) 862-0005."),
  });

  // Track partial form data for abandoned form recovery
  useEffect(() => {
    const handleUnload = () => {
      if (submitted) return;
      if (formData.name || formData.phone || formData.service) {
        navigator.sendBeacon('/api/track-abandoned', JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          service: formData.service,
          vehicle: `${formData.vehicleYear} ${formData.vehicleMake} ${formData.vehicleModel}`.trim(),
          step: step,
        }));
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [formData, step, submitted]);

  const update = (field: string, value: string | boolean) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const goTo = (target: Step) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };

  const canGoNext = (s: Step): boolean => {
    if (s === 1) return !!formData.service;
    if (s === 2) return true; // vehicle info is optional-ish, just needs description or can skip
    if (s === 3) return true; // schedule is optional
    if (s === 4) return !!formData.name && formData.phone.replace(/\D/g, "").length >= 10;
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.service) return;
    const phoneDigits = formData.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      toast.error("Please enter a valid 10-digit phone number.");
      return;
    }

    const { leadEventId, scheduleEventId } = trackBookingSubmission({
      service: formData.service,
      vehicle: [formData.vehicleYear, formData.vehicleMake, formData.vehicleModel].filter(Boolean).join(" "),
    });
    const userData = getUserDataForCAPI();
    const utmData = getUtmData();

    // Map preferredTime to match existing schema
    const mappedTime = (formData.preferredTime === "midday" || formData.preferredTime === "late")
      ? (formData.preferredTime === "midday" ? "morning" : "afternoon")
      : formData.preferredTime || "no-preference";

    // Prepend referral info to message if provided
    const referralPrefix = formData.referredBy.trim()
      ? `[Referral: ${formData.referredBy.trim()}] `
      : "";
    const fullMessage = referralPrefix + (formData.message || "");

    mutation.mutate({
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      service: formData.service,
      vehicleYear: formData.vehicleYear,
      vehicleMake: formData.vehicleMake,
      vehicleModel: formData.vehicleModel,
      preferredDate: formData.preferredDate,
      preferredTime: mappedTime as "morning" | "afternoon" | "no-preference",
      message: fullMessage,
      urgency: formData.urgency,
      photoUrls: [],
      pixelEventIds: { leadEventId, scheduleEventId },
      pixelUserData: userData,
      ...utmData,
    });
  };

  // ─── CONFIRMATION STATE ─────────────────────────────
  if (submitted) {
    return (
      <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8 lg:p-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 mx-auto mb-6 rounded-full bg-nick-teal/10 flex items-center justify-center"
        >
          <CheckCircle className="w-10 h-10 text-nick-teal" />
        </motion.div>
        <motion.h3
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="font-bold text-[28px] text-foreground tracking-[-0.02em] mb-2"
        >
          You're all set, {formData.name.split(" ")[0]}!
        </motion.h3>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="space-y-3"
        >
          <p className="text-foreground/60 text-sm">
            {formData.service} appointment requested
            {formData.vehicleYear && formData.vehicleMake
              ? ` for your ${formData.vehicleYear} ${formData.vehicleMake} ${formData.vehicleModel}`
              : ""}
            .
          </p>
          <p className="text-foreground/70 text-sm">
            We'll text you a confirmation shortly at {formData.phone}.
          </p>
          <div className="pt-4">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity"
            >
              <Phone className="w-4 h-4" />
              Call {BUSINESS.phone.display}
            </a>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── PROGRESS BAR ───────────────────────────────────
  const ProgressBar = () => (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const stepNum = (i + 1) as Step;
        const isCompleted = step > stepNum;
        const isCurrent = step === stepNum;
        const isFuture = step < stepNum;
        return (
          <div key={label} className="flex items-center">
            <button
              type="button"
              onClick={() => {
                if (isCompleted || (isCurrent)) {
                  if (stepNum < step) goTo(stepNum);
                }
              }}
              className="flex flex-col items-center gap-1.5 group"
              disabled={isFuture}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold transition-all ${
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "border-2 border-primary text-primary bg-transparent"
                    : "bg-[#2A2A2A] text-foreground/60"
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={`text-[11px] font-medium transition-colors hidden sm:block ${
                  isCompleted
                    ? "text-primary"
                    : isCurrent
                    ? "text-foreground/70"
                    : "text-foreground/25"
                }`}
              >
                {label}
              </span>
            </button>
            {i < 3 && (
              <div
                className={`w-8 sm:w-12 h-px mx-1 ${
                  step > stepNum ? "bg-primary/50" : "bg-foreground/[0.08]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  const { min: minDate, max: maxDate } = getMinMaxDates();

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8 lg:p-10"
    >
      <h3 className="font-bold text-[22px] text-foreground tracking-[-0.02em] mb-1">
        Schedule Your Drop-Off
      </h3>
      <p className="text-foreground/70 text-[13px] mb-5">
        Walk-ins and drop-offs welcome. Most jobs done same day.
      </p>

      <ProgressBar />

      {mutation.error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-md mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          We couldn't submit your booking. Please check your info and try again, or call (216) 862-0005.
        </div>
      )}

      <div className="relative overflow-hidden min-h-[320px]">
        <AnimatePresence mode="wait" custom={direction}>
          {/* ─── STEP 1: SERVICE SELECTION ──────────────── */}
          {step === 1 && (
            <motion.div
              key="step1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="space-y-6"
            >
              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-3">
                  What do you need? *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {SERVICE_CARDS.map((svc) => {
                    const Icon = svc.icon;
                    const selected = formData.service === svc.key;
                    return (
                      <button
                        key={svc.key}
                        type="button"
                        onClick={() => update("service", svc.key)}
                        className={`relative flex flex-col items-center gap-2 p-4 border-2 rounded-xl text-center transition-all ${
                          selected
                            ? "border-primary bg-primary/10 ring-1 ring-nick-yellow/30"
                            : "border-border/50 hover:border-foreground/30 bg-background/30"
                        }`}
                      >
                        {selected && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                        <Icon className={`w-6 h-6 ${selected ? "text-primary" : "text-foreground/70"}`} />
                        <span className={`text-[13px] font-semibold ${selected ? "text-primary" : "text-foreground/70"}`}>
                          {svc.label}
                        </span>
                        <span className={`text-[11px] ${selected ? "text-primary/70" : "text-foreground/35"}`}>
                          {svc.price}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Urgency Selector */}
              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                  How urgent is this?
                </label>
                <div className="flex gap-2">
                  {URGENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => update("urgency", opt.value)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 border rounded-full text-[13px] transition-all ${
                        formData.urgency === opt.value
                          ? opt.value === "emergency"
                            ? "border-red-500 bg-red-500/10 text-red-400 ring-1 ring-red-500/30"
                            : opt.value === "this-week"
                            ? "border-yellow-500 bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/30"
                            : "border-green-500 bg-green-500/10 text-green-400 ring-1 ring-green-500/30"
                          : "border-border/50 text-foreground/60 hover:border-foreground/30"
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${opt.dot}`} />
                      <span className="font-medium">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!canGoNext(1)}
                  onClick={() => goTo(2)}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold text-[13px] hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── STEP 2: VEHICLE INFO ──────────────────── */}
          {step === 2 && (
            <motion.div
              key="step2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="space-y-5"
            >
              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                  Vehicle Year
                </label>
                <div className="relative">
                  <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <select
                    value={formData.vehicleYear}
                    onChange={(e) => update("vehicleYear", e.target.value)}
                    aria-label="Vehicle year"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
                  >
                    <option value="">Select Year</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                    Make
                  </label>
                  <select
                    value={formData.vehicleMake}
                    onChange={(e) => update("vehicleMake", e.target.value)}
                    aria-label="Vehicle make"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
                  >
                    <option value="">Select Make</option>
                    {MAKES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                    Model
                  </label>
                  <input
                    type="text"
                    value={formData.vehicleModel}
                    onChange={(e) => update("vehicleModel", e.target.value)}
                    aria-label="Vehicle model"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    placeholder="e.g. Camry, Civic"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                  Describe what you're experiencing
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => update("message", e.target.value)}
                  rows={3}
                  aria-label="Describe your vehicle problem"
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all resize-none"
                  placeholder="Noise when braking, engine light on, pulling to one side..."
                />
              </div>

              <p className="text-foreground/60 text-[12px] flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5" />
                We've serviced 14,000+ vehicles in Cleveland
              </p>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className="flex items-center gap-2 border border-[oklch(0.17_0.004_260)] text-foreground/60 px-6 py-3 rounded-lg font-semibold text-[13px] hover:text-foreground/90 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => goTo(3)}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold text-[13px] hover:opacity-90 transition-opacity"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── STEP 3: SCHEDULE ──────────────────────── */}
          {step === 3 && (
            <motion.div
              key="step3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="space-y-5"
            >
              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                  Preferred Date
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <input
                    type="date"
                    value={formData.preferredDate}
                    onChange={(e) => update("preferredDate", e.target.value)}
                    aria-label="Preferred date"
                    min={minDate}
                    max={maxDate}
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-2">
                  Preferred Time
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TIME_SLOTS.map((slot) => (
                    <button
                      key={slot.value}
                      type="button"
                      onClick={() => update("preferredTime", slot.value)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-3 border rounded-lg text-[13px] transition-all ${
                        formData.preferredTime === slot.value
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-nick-yellow/30"
                          : "border-border/50 text-foreground/60 hover:border-foreground/30"
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 bg-nick-teal/5 border border-nick-teal/20 rounded-md px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-nick-teal animate-pulse flex-shrink-0" />
                <span className="text-[12px] text-nick-teal/80">
                  Walk-ins also welcome — first come, first served
                </span>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => goTo(2)}
                  className="flex items-center gap-2 border border-[oklch(0.17_0.004_260)] text-foreground/60 px-6 py-3 rounded-lg font-semibold text-[13px] hover:text-foreground/90 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => goTo(4)}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold text-[13px] hover:opacity-90 transition-opacity"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── STEP 4: CONTACT INFO ──────────────────── */}
          {step === 4 && (
            <motion.div
              key="step4"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="space-y-5"
            >
              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-1.5">
                  Your Name *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => update("name", e.target.value)}
                    aria-label="Your name"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    placeholder="John Smith"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-1.5">
                  Phone Number *
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => update("phone", formatPhone(e.target.value))}
                    aria-label="Phone number"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    placeholder={BUSINESS.phone.placeholder}
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-1.5">
                  Email (Optional)
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => update("email", e.target.value)}
                    aria-label="Email address"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    placeholder="you@email.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground/70 tracking-wide block mb-1.5">
                  Who referred you? (optional)
                </label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                  <input
                    type="text"
                    value={formData.referredBy}
                    onChange={(e) => update("referredBy", e.target.value)}
                    aria-label="Referral source"
                    className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                    placeholder="Friend's name, social media, etc."
                    maxLength={100}
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.textUpdates}
                  onChange={(e) => update("textUpdates", e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border/50 text-primary focus:ring-primary/30 bg-background/60"
                />
                <div>
                  <span className="text-[13px] text-foreground/70 group-hover:text-foreground/90 transition-colors">
                    Text me when my car is ready
                  </span>
                  <p className="text-[10px] text-foreground/25 mt-1 leading-relaxed">
                    By checking this box, you agree to receive text messages from Nick's Tire & Auto.
                    Msg & data rates may apply. Reply STOP to unsubscribe. Msg frequency varies.
                  </p>
                </div>
              </label>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => goTo(3)}
                  className="flex items-center gap-2 border border-[oklch(0.17_0.004_260)] text-foreground/60 px-6 py-3 rounded-lg font-semibold text-[13px] hover:text-foreground/90 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={!canGoNext(4) || mutation.isPending}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Reserving your spot...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Lock In My Spot
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
