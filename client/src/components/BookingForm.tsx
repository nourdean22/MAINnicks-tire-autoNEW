import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  Phone, Calendar, Clock, Car, Wrench, CheckCircle, AlertCircle,
  Loader2, Camera, X, ChevronRight, ChevronLeft, User, Mail, MessageSquare, AlertTriangle, Zap,
} from "lucide-react";
import { BUSINESS } from "@shared/business";

const SERVICES = [
  "Tires — New, Used, Repair",
  "Brake Repair",
  "Check Engine Light / Diagnostics",
  "Ohio E-Check / Emissions Repair",
  "Oil Change",
  "Suspension & Steering",
  "AC Repair",
  "General Repair / Other",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 35 }, (_, i) => String(CURRENT_YEAR + 1 - i));

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan",
  "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo", "Other",
];

type Step = 1 | 2 | 3;

interface PhotoFile {
  file: File;
  preview: string;
  uploading: boolean;
  url?: string;
}

export default function BookingForm({ defaultService }: { defaultService?: string } = {}) {
  const [step, setStep] = useState<Step>(1);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    service: defaultService || "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    preferredDate: "",
    preferredTime: "no-preference" as "morning" | "afternoon" | "no-preference",
    message: "",
    urgency: "whenever" as "emergency" | "this-week" | "whenever",
  });

  const mutation = trpc.booking.create.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const uploadPhoto = trpc.booking.uploadPhoto.useMutation();

  const update = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handlePhotoAdd = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newPhotos: PhotoFile[] = [];
    for (let i = 0; i < Math.min(files.length, 3 - photos.length); i++) {
      const file = files[i];
      if (file.size > 5 * 1024 * 1024) continue; // 5MB limit
      newPhotos.push({
        file,
        preview: URL.createObjectURL(file),
        uploading: true,
      });
    }
    setPhotos((prev) => [...prev, ...newPhotos]);

    // Upload each photo
    for (const photo of newPhotos) {
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.readAsDataURL(photo.file);
        });
        const { url } = await uploadPhoto.mutateAsync({
          base64,
          filename: photo.file.name,
          mimeType: photo.file.type,
        });
        setPhotos((prev) =>
          prev.map((p) => (p.preview === photo.preview ? { ...p, uploading: false, url } : p))
        );
      } catch {
        setPhotos((prev) => prev.filter((p) => p.preview !== photo.preview));
      }
    }
  }, [photos.length, uploadPhoto]);

  const removePhoto = (preview: string) => {
    setPhotos((prev) => prev.filter((p) => p.preview !== preview));
    URL.revokeObjectURL(preview);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.service) return;
    // Meta Pixel: Track booking form submission as a Schedule conversion
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("track", "Schedule", { content_name: "booking_form", content_category: formData.service });
    }
    const photoUrls = photos.filter((p) => p.url).map((p) => p.url!);
    mutation.mutate({ ...formData, photoUrls, urgency: formData.urgency });
  };

  const canGoNext = (s: Step): boolean => {
    if (s === 1) return !!formData.service;
    if (s === 2) return !!formData.name && formData.phone.length >= 7;
    return true;
  };

  // ─── SUCCESS STATE ────────────────────────────────────
  if (submitted) {
    return (
      <div className="card-vibrant bg-card/80 rounded-lg p-8 lg:p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-nick-teal/20 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-nick-teal" />
        </div>
        <h3 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-3">
          REQUEST RECEIVED
        </h3>
        <p className="text-foreground/70 leading-relaxed max-w-md mx-auto">
          We got your request for <span className="text-nick-yellow font-semibold">{formData.service}</span>.
          {formData.urgency === "emergency" ? (
            <span className="block mt-2 text-red-400 font-semibold">Emergency flagged — we will prioritize your vehicle.</span>
          ) : (
            <span className="block mt-1">Our team operates first-come, first-served.</span>
          )}
          We will reach out to{" "}
          <span className="text-nick-yellow font-mono">{formData.phone}</span> when
          we are ready for your vehicle.
        </p>
        <p className="text-foreground/50 text-sm mt-3">
          Need immediate help? Call us directly.
        </p>
        <a
          href={BUSINESS.phone.href}
          className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase mt-6 hover:bg-nick-gold transition-colors glow-yellow"
        >
          <Phone className="w-4 h-4" />
          CALL {BUSINESS.phone.display}
        </a>
      </div>
    );
  }

  // ─── STEP INDICATOR ───────────────────────────────────
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[
        { num: 1, label: "Service" },
        { num: 2, label: "Contact" },
        { num: 3, label: "Details" },
      ].map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { if (s.num < step || canGoNext(step)) setStep(s.num as Step); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-xs tracking-wider transition-all ${
              step === s.num
                ? "bg-nick-yellow text-nick-dark font-bold"
                : step > s.num
                ? "bg-nick-teal/20 text-nick-teal"
                : "bg-border/20 text-foreground/30"
            }`}
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-current">
              {step > s.num ? "✓" : s.num}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
          {i < 2 && <div className={`w-8 h-px ${step > s.num ? "bg-nick-teal/40" : "bg-border/20"}`} />}
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="card-vibrant bg-card/80 rounded-lg p-8 lg:p-10">
      <h3 className="font-heading font-bold text-2xl text-nick-yellow tracking-wider mb-1">
        BOOK AN APPOINTMENT
      </h3>
      <p className="text-foreground/60 text-sm mb-4">
        First come, first served. We will call you when we are ready for your vehicle.
      </p>

      <StepIndicator />

      {mutation.error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-md mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Something went wrong. Please try again or call us directly.
        </div>
      )}

      {/* ─── STEP 1: SERVICE ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-2">
              What do you need? *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SERVICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update("service", s)}
                  className={`flex items-center gap-3 px-4 py-3.5 border rounded-md font-mono text-sm text-left transition-all ${
                    formData.service === s
                      ? "border-nick-yellow bg-nick-yellow/10 text-nick-yellow ring-1 ring-nick-yellow/30"
                      : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                  }`}
                >
                  <Wrench className="w-4 h-4 shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Urgency Routing */}
          <div>
            <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-2">
              How urgent is this?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { value: "emergency", label: "Emergency", desc: "Unsafe to drive", icon: <AlertTriangle className="w-4 h-4" />, color: "border-red-500 bg-red-500/10 text-red-400 ring-red-500/30" },
                { value: "this-week", label: "This Week", desc: "Need it soon", icon: <Zap className="w-4 h-4" />, color: "border-nick-yellow bg-nick-yellow/10 text-nick-yellow ring-nick-yellow/30" },
                { value: "whenever", label: "Whenever", desc: "Not urgent", icon: <Clock className="w-4 h-4" />, color: "border-nick-teal bg-nick-teal/10 text-nick-teal ring-nick-teal/30" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("urgency", opt.value)}
                  className={`flex items-center gap-3 px-4 py-3 border rounded-md font-mono text-sm text-left transition-all ${
                    formData.urgency === opt.value
                      ? opt.color + " ring-1"
                      : "border-border/50 text-foreground/70 hover:border-foreground/30"
                  }`}
                >
                  {opt.icon}
                  <div>
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={!canGoNext(1)}
              onClick={() => setStep(2)}
              className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              NEXT <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: CONTACT INFO ────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-1.5">
                Your Name *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="John Smith"
                />
              </div>
            </div>

            <div>
              <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-1.5">
                Phone Number *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="(216) 555-0000"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-1.5">
                Email (Optional)
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="you@email.com"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-2 border border-border/50 text-foreground/60 px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> BACK
            </button>
            <button
              type="button"
              disabled={!canGoNext(2)}
              onClick={() => setStep(3)}
              className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              NEXT <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: VEHICLE & DETAILS ───────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Vehicle Year / Make / Model */}
          <div>
            <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-2">
              Vehicle Information (Optional)
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="relative">
                <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <select
                  value={formData.vehicleYear}
                  onChange={(e) => update("vehicleYear", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-2 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
                >
                  <option value="">Year</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <select
                value={formData.vehicleMake}
                onChange={(e) => update("vehicleMake", e.target.value)}
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
              >
                <option value="">Make</option>
                {MAKES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                type="text"
                value={formData.vehicleModel}
                onChange={(e) => update("vehicleModel", e.target.value)}
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                placeholder="Model"
              />
            </div>
          </div>

          {/* Preferred Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-1.5">
                Preferred Date (Optional)
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="date"
                  value={formData.preferredDate}
                  onChange={(e) => update("preferredDate", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-2">
                Preferred Time
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "morning", label: "AM" },
                  { value: "afternoon", label: "PM" },
                  { value: "no-preference", label: "Either" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update("preferredTime", opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border rounded-md font-mono text-sm transition-all ${
                      formData.preferredTime === opt.value
                        ? "border-nick-yellow bg-nick-yellow/10 text-nick-yellow"
                        : "border-border/50 text-foreground/60 hover:border-nick-teal/40"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Photo Upload */}
          <div>
            <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-2">
              Photos of the Problem (Optional — up to 3)
            </label>
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <div key={photo.preview} className="relative w-20 h-20 rounded-md overflow-hidden border border-border/50">
                  <img loading="lazy" src={photo.preview} alt="Vehicle photo upload preview" className="w-full h-full object-cover" />
                  {photo.uploading && (
                    <div className="absolute inset-0 bg-nick-dark/70 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-nick-yellow" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.preview)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-nick-dark/80 rounded-full flex items-center justify-center text-foreground/80 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {photos.length < 3 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-border/40 rounded-md flex flex-col items-center justify-center text-foreground/30 hover:border-nick-teal/40 hover:text-nick-teal transition-colors"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-[10px] font-mono mt-1">ADD</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handlePhotoAdd(e.target.files)}
              />
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-1.5">
              Describe the Problem (Optional)
            </label>
            <div className="relative">
              <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-nick-teal/40" />
              <textarea
                value={formData.message}
                onChange={(e) => update("message", e.target.value)}
                rows={3}
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all resize-none"
                placeholder="Tell us what's going on with your vehicle..."
              />
            </div>
          </div>

          {/* Summary Bar */}
          <div className="bg-background/40 border border-border/30 rounded-md p-4 flex flex-wrap items-center gap-4 text-sm font-mono">
            <div className="flex items-center gap-2 text-nick-yellow">
              <Wrench className="w-4 h-4" />
              <span>{formData.service}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground/60">
              <User className="w-4 h-4" />
              <span>{formData.name}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground/60">
              <Phone className="w-4 h-4" />
              <span>{formData.phone}</span>
            </div>
            {formData.vehicleYear && formData.vehicleMake && (
              <div className="flex items-center gap-2 text-foreground/60">
                <Car className="w-4 h-4" />
                <span>{formData.vehicleYear} {formData.vehicleMake} {formData.vehicleModel}</span>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-2 border border-border/50 text-foreground/60 px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> BACK
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || photos.some((p) => p.uploading)}
              className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow disabled:opacity-50"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  SUBMITTING...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  SUBMIT REQUEST
                </>
              )}
            </button>
          </div>

          <p className="text-foreground/40 text-xs font-mono text-center">
            First come, first served. Walk-ins also welcome. {BUSINESS.hours.display}.
          </p>
        </div>
      )}
    </form>
  );
}
