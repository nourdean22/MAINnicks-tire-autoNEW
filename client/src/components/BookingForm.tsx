import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { trackBookingSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import {
  Phone, Calendar, Clock, Car, Wrench, CheckCircle, AlertCircle,
  Loader2, Camera, X, ChevronRight, ChevronLeft, User, Mail, MessageSquare, AlertTriangle, Zap, HelpCircle, MapPin,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { SERVICES as SERVICES_DATA } from "@shared/services";

const SERVICES = [
  "Tires — New, Used, Repair",
  "Brake Repair",
  "Wheel Alignment",
  "TPMS / Tire Sensors",
  "Check Engine Light / Diagnostics",
  "Ohio E-Check / Emissions Repair",
  "Oil Change",
  "Suspension & Steering",
  "AC Repair",
  "General Repair / Other",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 27 }, (_, i) => String(CURRENT_YEAR + 1 - i));

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan",
  "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo", "Other",
];

// Upsell mapping based on selected service
const UPSELL_MAP: Record<string, { suggestion: string; price: string; note: string }[]> = {
  "Oil Change": [{ suggestion: "Tire Rotation", price: "$29.99", note: "Usually $49.99 with oil change" }],
  "Brake Repair": [{ suggestion: "Alignment Check", price: "$39.99", note: "Recommended after brake work" }],
  "Tires — New, Used, Repair": [{ suggestion: "Wheel Alignment", price: "$79.99", note: "Required for even tire wear" }],
  "Ohio E-Check / Emissions Repair": [{ suggestion: "Oil Change", price: "$39.99", note: "Keep your engine clean" }],
  "Check Engine Light / Diagnostics": [{ suggestion: "Code Scan Report", price: "FREE", note: "We'll email you the full report" }],
};

type Step = 1 | 2;

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
  const [notSureMode, setNotSureMode] = useState(false);
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
      if (file.size > 5 * 1024 * 1024) continue;
      newPhotos.push({
        file,
        preview: URL.createObjectURL(file),
        uploading: true,
      });
    }
    setPhotos((prev) => [...prev, ...newPhotos]);

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
        const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
        const mime = allowedMimes.includes(photo.file.type as any)
          ? (photo.file.type as (typeof allowedMimes)[number])
          : "image/jpeg";
        const { url } = await uploadPhoto.mutateAsync({
          base64,
          filename: photo.file.name,
          mimeType: mime,
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
    
    const { leadEventId, scheduleEventId } = trackBookingSubmission({
      service: formData.service,
      vehicle: [formData.vehicleYear, formData.vehicleMake, formData.vehicleModel].filter(Boolean).join(" "),
    });
    const userData = getUserDataForCAPI();
    const photoUrls = photos.filter((p) => p.url).map((p) => p.url!);
    const utmData = getUtmData();
    
    mutation.mutate({
      ...formData,
      photoUrls,
      urgency: formData.urgency,
      pixelEventIds: { leadEventId, scheduleEventId },
      pixelUserData: userData,
      ...utmData,
    });
  };

  const canGoNext = (s: Step): boolean => {
    if (s === 1) return !!formData.service;
    if (s === 2) return !!formData.name && formData.phone.length >= 7;
    return true;
  };

  // ─── SUCCESS STATE ────────────────────────────────────
  if (submitted) {
    const upsells = UPSELL_MAP[formData.service] || [];
    
    return (
      <div className="space-y-6">
        {/* Rich Confirmation Card */}
        <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8 lg:p-12">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-nick-teal/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-nick-teal" />
          </div>
          <h3 className="font-bold text-[24px] text-foreground tracking-[-0.02em] mb-2 text-center">
            ✅ You're booked!
          </h3>
          <p className="text-primary/80 text-sm font-medium text-center mb-6">
            {BUSINESS.taglines.meme} We'll see you soon.
          </p>

          {/* Service & Vehicle Info */}
          <div className="bg-background/40 border border-border/30 rounded-md p-5 mb-6 space-y-3">
            <div className="flex items-start gap-3">
              <Wrench className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-foreground/40 text-xs uppercase font-semibold tracking-wide">Service</div>
                <div className="text-foreground text-base font-semibold">{formData.service}</div>
              </div>
            </div>
            {formData.vehicleYear && formData.vehicleMake && (
              <div className="flex items-start gap-3">
                <Car className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-foreground/40 text-xs uppercase font-semibold tracking-wide">Vehicle</div>
                  <div className="text-foreground text-base font-semibold">
                    {formData.vehicleYear} {formData.vehicleMake} {formData.vehicleModel}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Location & Contact Info */}
          <div className="space-y-2 mb-6 text-sm">
            <div className="flex items-center gap-2 text-foreground/60">
              <MapPin className="w-4 h-4 text-primary" />
              <span>{BUSINESS.address.full}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground/60">
              <Phone className="w-4 h-4 text-primary" />
              <span>{BUSINESS.phone.display}</span>
            </div>
          </div>

          {/* What Happens Next */}
          <div className="bg-primary/5 border border-primary/10 rounded-md p-5 mb-6">
            <h4 className="font-semibold text-foreground mb-3 text-sm">What happens next:</h4>
            <ol className="space-y-2 text-sm text-foreground/70">
              <li className="flex gap-2">
                <span className="font-semibold text-primary">1.</span>
                <span>We'll send you a text confirmation shortly</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">2.</span>
                <span>You'll get a reminder before your appointment</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">3.</span>
                <span>When you arrive, pull into any open bay</span>
              </li>
            </ol>
          </div>

          {/* Payment options callout */}
          <div className="bg-nick-teal/5 border border-nick-teal/20 rounded-md p-4 mb-4 text-center">
            <p className="text-sm text-nick-teal">
              Need to pay over time? <a href="/financing?utm_source=booking_form" className="font-semibold underline hover:no-underline">See lease-to-own &amp; financing options →</a>
            </p>
          </div>

          <p className="text-foreground/40 text-xs text-center mb-6">
            Need to change something? Just reply to our text or call us.
          </p>

          <a
            href={BUSINESS.phone.href}
            className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity w-full"
          >
            <Phone className="w-4 h-4" />
            Call {BUSINESS.phone.display}
          </a>
        </div>

        {/* Upsell Section */}
        {upsells.length > 0 && (
          <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8">
            <h4 className="font-semibold text-foreground mb-4 text-sm">
              Customers who book {formData.service} also add:
            </h4>
            <div className="space-y-3">
              {upsells.map((upsell, idx) => (
                <div key={idx} className="flex items-start justify-between gap-4 p-4 bg-background/40 border border-border/30 rounded-md">
                  <div>
                    <div className="font-semibold text-foreground text-sm">{upsell.suggestion}</div>
                    <div className="text-foreground/50 text-xs mt-1">{upsell.note}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="text-primary font-bold text-sm">{upsell.price}</div>
                    <button
                      type="button"
                      className="text-xs bg-primary/20 text-primary px-3 py-1.5 rounded hover:bg-primary/30 transition-colors font-medium whitespace-nowrap"
                    >
                      Add to appointment
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referral Callout */}
        <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 text-center">
          <p className="text-foreground/60 text-sm">
            Know someone who needs car help?{" "}
            <a href="/refer" className="text-primary font-semibold hover:underline">
              Refer a friend and earn $20 →
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ─── STEP INDICATOR ───────────────────────────────────
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[
        { num: 1, label: "Service & Vehicle" },
        { num: 2, label: "Contact Info" },
      ].map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { if (s.num < step || canGoNext(step)) setStep(s.num as Step); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
              step === s.num
                ? "bg-primary text-primary-foreground"
                : step > s.num
                ? "bg-nick-teal/10 text-nick-teal"
                : "bg-foreground/[0.05] text-foreground/25"
            }`}
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold border border-current">
              {step > s.num ? "✓" : s.num}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
          {i < 1 && <div className={`w-8 h-px ${step > s.num ? "bg-nick-teal/30" : "bg-foreground/[0.06]"}`} />}
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8 lg:p-10">
      <h3 className="font-bold text-[22px] text-foreground tracking-[-0.02em] mb-1">
        Book an Appointment
      </h3>
      <p className="text-foreground/40 text-[13px] mb-5">
        Walk-ins welcome! Same-day appointments available.
      </p>

      <StepIndicator />

      {mutation.error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-md mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Something went wrong. Please try again or call us directly.
        </div>
      )}

      {/* ─── STEP 1: SERVICE + VEHICLE + PHOTO + MESSAGE ─── */}
      {step === 1 && (
        <div className="space-y-5">
          {/* Service Selection or "Not Sure" Textarea */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block">
                What do you need? *
              </label>
              <button
                type="button"
                onClick={() => setNotSureMode(!notSureMode)}
                className="text-[11px] text-nick-teal/60 hover:text-nick-teal flex items-center gap-1 transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {notSureMode ? "Pick a service" : "Not sure?"}
              </button>
            </div>

            {notSureMode ? (
              <textarea
                value={formData.message}
                onChange={(e) => update("message", e.target.value)}
                rows={4}
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all resize-none"
                placeholder="Describe what's going on with your vehicle or what service you need..."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SERVICES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update("service", s)}
                    className={`flex items-center gap-3 px-4 py-3.5 border rounded-md text-[13px] text-left transition-all ${
                      formData.service === s
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-nick-yellow/30"
                        : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                    }`}
                  >
                    <Wrench className="w-4 h-4 shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Vehicle Information */}
          <div>
            <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-2">
              Vehicle Information (Optional)
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="relative">
                <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <select
                  value={formData.vehicleYear}
                  onChange={(e) => update("vehicleYear", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-2 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
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
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all appearance-none"
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
                className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-3 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                placeholder="Model"
              />
            </div>
          </div>

          {/* Photo Upload */}
          <div>
            <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-2">
              Photos of the Problem (Optional — up to 3)
            </label>
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <div key={photo.preview} className="relative w-20 h-20 rounded-md overflow-hidden border border-border/50">
                  <img loading="lazy" src={photo.preview} alt="Vehicle photo upload preview" className="w-full h-full object-cover" />
                  {photo.uploading && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.preview)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-background/80 rounded-full flex items-center justify-center text-foreground/80 hover:text-red-400"
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
                  <span className="text-[10px] mt-1">ADD</span>
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

          {/* Urgency Routing */}
          <div>
            <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-2">
              How urgent is this?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { value: "emergency", label: "Emergency", desc: "Unsafe to drive", icon: <AlertTriangle className="w-4 h-4" />, color: "border-red-500 bg-red-500/10 text-red-400 ring-red-500/30" },
                { value: "this-week", label: "This Week", desc: "Need it soon", icon: <Zap className="w-4 h-4" />, color: "border-primary bg-primary/10 text-primary ring-nick-yellow/30" },
                { value: "whenever", label: "Whenever", desc: "Not urgent", icon: <Clock className="w-4 h-4" />, color: "border-nick-teal bg-nick-teal/10 text-nick-teal ring-nick-teal/30" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("urgency", opt.value)}
                  className={`flex items-center gap-3 px-4 py-3 border rounded-md text-[13px] text-left transition-all ${
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
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold text-[13px] hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: CONTACT INFO + DATE/TIME ──────────── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Same-Day Available Badge */}
          <div className="flex items-center gap-2 bg-nick-teal/10 border border-nick-teal/30 rounded-md px-4 py-3">
            <div className="w-2 h-2 rounded-full bg-nick-teal animate-pulse" />
            <span className="text-sm font-medium text-nick-teal">Walk-ins welcome! Same-day appointments available.</span>
          </div>

          {/* Contact Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-1.5">
                Your Name *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="John Smith"
                />
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-1.5">
                Phone Number *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="(216) 555-0000"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-1.5">
                Email (Optional)
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                  placeholder="you@email.com"
                />
              </div>
            </div>
          </div>

          {/* Preferred Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-1.5">
                Preferred Date (Optional)
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nick-teal/40" />
                <input
                  type="date"
                  value={formData.preferredDate}
                  onChange={(e) => update("preferredDate", e.target.value)}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-10 pr-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-foreground/40 tracking-wide block mb-2">
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
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border rounded-md text-[13px] transition-all ${
                      formData.preferredTime === opt.value
                        ? "border-primary bg-primary/10 text-primary"
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

          {/* Summary Bar */}
          <div className="bg-background/40 border border-border/30 rounded-md p-4 flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-primary">
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
              onClick={() => setStep(1)}
              className="flex items-center gap-2 border border-[oklch(0.17_0.004_260)] text-foreground/40 px-6 py-3 rounded-lg font-semibold text-[13px] hover:text-foreground/60 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || photos.some((p) => p.uploading)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg font-semibold text-[14px] hover:opacity-90 transition-opacity disabled:opacity-50 md:px-8 min-h-[44px]"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Book Today
                </>
              )}
            </button>
          </div>

          <p className="text-foreground/25 text-[12px] text-center">
            {BUSINESS.hours.display}. Walk-ins also welcome.
          </p>
        </div>
      )}
    </form>
  );
}
