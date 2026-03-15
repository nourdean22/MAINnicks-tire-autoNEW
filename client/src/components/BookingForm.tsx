import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Phone, Calendar, Clock, Car, Wrench, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

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

export default function BookingForm({ defaultService }: { defaultService?: string } = {}) {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    service: defaultService || "",
    vehicle: "",
    preferredDate: "",
    preferredTime: "no-preference" as "morning" | "afternoon" | "no-preference",
    message: "",
  });

  const mutation = trpc.booking.create.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.service) return;
    mutation.mutate(formData);
  };

  const update = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  if (submitted) {
    return (
      <div className="bg-card border border-border/50 p-8 lg:p-12 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h3 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-3">
          APPOINTMENT REQUESTED
        </h3>
        <p className="text-foreground/70 leading-relaxed max-w-md mx-auto">
          We received your request. Our team will call you at{" "}
          <span className="text-primary font-mono">{formData.phone}</span> to
          confirm your appointment. If you need immediate help, call us directly.
        </p>
        <a
          href="tel:2168620005"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase mt-6 hover:bg-primary/90 transition-colors"
        >
          <Phone className="w-4 h-4" />
          CALL (216) 862-0005
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border/50 p-8 lg:p-10">
      <h3 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-2">
        BOOK AN APPOINTMENT
      </h3>
      <p className="text-foreground/60 text-sm mb-8">
        Fill out the form below and we will call you to confirm. No payment required.
      </p>

      {mutation.error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Something went wrong. Please try again or call us directly.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Name */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Your Name *
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full bg-nick-dark border border-border/50 text-foreground px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors"
            placeholder="John Smith"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Phone Number *
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => update("phone", e.target.value)}
              className="w-full bg-nick-dark border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors"
              placeholder="(216) 555-0000"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Email (Optional)
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => update("email", e.target.value)}
            className="w-full bg-nick-dark border border-border/50 text-foreground px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors"
            placeholder="you@email.com"
          />
        </div>

        {/* Service */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Service Needed *
          </label>
          <div className="relative">
            <Wrench className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <select
              required
              value={formData.service}
              onChange={(e) => update("service", e.target.value)}
              className="w-full bg-nick-dark border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors appearance-none"
            >
              <option value="">Select a service...</option>
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Vehicle */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Vehicle (Optional)
          </label>
          <div className="relative">
            <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              value={formData.vehicle}
              onChange={(e) => update("vehicle", e.target.value)}
              className="w-full bg-nick-dark border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors"
              placeholder="2019 Honda Civic"
            />
          </div>
        </div>

        {/* Preferred Date */}
        <div>
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Preferred Date (Optional)
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="date"
              value={formData.preferredDate}
              onChange={(e) => update("preferredDate", e.target.value)}
              className="w-full bg-nick-dark border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Preferred Time */}
        <div className="sm:col-span-2">
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-2">
            Preferred Time
          </label>
          <div className="flex flex-wrap gap-3">
            {[
              { value: "morning", label: "Morning (9AM–12PM)" },
              { value: "afternoon", label: "Afternoon (12PM–6PM)" },
              { value: "no-preference", label: "No Preference" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update("preferredTime", opt.value)}
                className={`flex items-center gap-2 px-4 py-2.5 border font-mono text-sm transition-colors ${
                  formData.preferredTime === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/50 text-foreground/60 hover:border-foreground/30"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        <div className="sm:col-span-2">
          <label className="font-mono text-xs text-foreground/50 tracking-wider uppercase block mb-1.5">
            Describe the Problem (Optional)
          </label>
          <textarea
            value={formData.message}
            onChange={(e) => update("message", e.target.value)}
            rows={3}
            className="w-full bg-nick-dark border border-border/50 text-foreground px-4 py-3 font-mono text-sm focus:border-primary focus:outline-none transition-colors resize-none"
            placeholder="Tell us what's going on with your vehicle..."
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-6 w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            SUBMITTING...
          </>
        ) : (
          <>
            <Calendar className="w-5 h-5" />
            REQUEST APPOINTMENT
          </>
        )}
      </button>

      <p className="text-foreground/40 text-xs font-mono mt-3 text-center">
        We will call you to confirm. Walk-ins also welcome.
      </p>
    </form>
  );
}
