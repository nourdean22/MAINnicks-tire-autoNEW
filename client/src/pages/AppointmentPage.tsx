/**
 * /appointment — Request an Appointment at Nick's Tire & Auto.
 * Customer-facing form for appointment requests (first come, first serve queue).
 */
import { useState, useCallback } from "react";
import PageLayout from "@/components/PageLayout";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  Phone,
  Mail,
  User,
  Car,
  Wrench,
  Send,
  CircleCheck,
  AlertCircle,
} from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────

const BRAND = {
  gold: "#FDB913",
  dark: "#0A0A0A",
  text: "#E5E5E5",
  muted: "#A0A0A0",
  card: "#141414",
  border: "#222222",
};

const SERVICE_TYPES = [
  "Oil Change",
  "Tire Service",
  "Brakes",
  "Alignment",
  "AC Service",
  "Inspection",
  "General Repair",
  "Other",
] as const;

const PREFERRED_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const TIME_SLOTS = [
  { label: "Morning (8–10am)", value: "morning" },
  { label: "Mid-Morning (10am–12pm)", value: "mid-morning" },
  { label: "Afternoon (12–3pm)", value: "afternoon" },
  { label: "Late Afternoon (3–5pm)", value: "late-afternoon" },
] as const;

// ─── TYPES ────────────────────────────────────────────

interface FormData {
  name: string;
  phone: string;
  email: string;
  vehicle: string;
  serviceType: string;
  preferredDay: string;
  preferredTime: string;
  notes: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  phone: "",
  email: "",
  vehicle: "",
  serviceType: "",
  preferredDay: "",
  preferredTime: "",
  notes: "",
};

// ─── COMPONENTS ───────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block text-xs font-bold tracking-[0.2em] uppercase px-3 py-1 rounded-full mb-4"
      style={{ background: `${BRAND.gold}20`, color: BRAND.gold }}
    >
      {children}
    </span>
  );
}

function InputField({
  label,
  icon: Icon,
  required,
  ...props
}: {
  label: string;
  icon: React.ElementType;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#C0C0C0] mb-1.5 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: BRAND.gold }} />
        {label}
        {required && <span className="text-red-400">*</span>}
      </span>
      <input
        {...props}
        required={required}
        className="w-full px-4 py-3 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] text-white placeholder:text-[#555] focus:outline-none focus:border-[#FDB913] focus:ring-1 focus:ring-[#FDB913]/30 transition-colors text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  icon: Icon,
  required,
  options,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  icon: React.ElementType;
  required?: boolean;
  options: readonly (string | { label: string; value: string })[];
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#C0C0C0] mb-1.5 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: BRAND.gold }} />
        {label}
        {required && <span className="text-red-400">*</span>}
      </span>
      <select
        required={required}
        value={value}
        onChange={onChange}
        className="w-full px-4 py-3 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] text-white focus:outline-none focus:border-[#FDB913] focus:ring-1 focus:ring-[#FDB913]/30 transition-colors text-sm appearance-none cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((opt) => {
          const val = typeof opt === "string" ? opt : opt.value;
          const lbl = typeof opt === "string" ? opt : opt.label;
          return (
            <option key={val} value={val}>
              {lbl}
            </option>
          );
        })}
      </select>
    </label>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────

export default function AppointmentPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const update = useCallback(
    (field: keyof FormData) =>
      (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >,
      ) => {
        setForm((f) => ({ ...f, [field]: e.target.value }));
        setError("");
      },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.name.trim() || !form.phone.trim()) {
        setError("Name and phone number are required.");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        const res = await fetch("https://autonicks.com/api/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error("Request failed");
        setSubmitted(true);
      } catch {
        setError(
          "Something went wrong. Please call us at (216) 862-0005 instead.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [form],
  );

  return (
    <PageLayout activeHref="/appointment">
      <Helmet>
        <title>Schedule Service — Nick's Tire & Auto | Cleveland OH</title>
        <meta
          name="description"
          content="Request an appointment at Nick's Tire & Auto in Cleveland. Oil changes, tires, brakes, alignment, AC, and more. Mon-Fri 8am-5pm, Sat 8am-2pm."
        />
      </Helmet>

      {/* ── HERO ── */}
      <section className="relative py-20 sm:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A0A0A] via-[#111] to-[#0A0A0A]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #FDB913 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative container max-w-3xl mx-auto text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <SectionLabel>Appointments</SectionLabel>
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase tracking-tight"
              style={{ color: BRAND.text }}
            >
              Schedule Your{" "}
              <span style={{ color: BRAND.gold }}>Service</span>
            </h1>
            <p className="mt-4 text-base sm:text-lg" style={{ color: BRAND.muted }}>
              Request an appointment online and we'll get back to you fast.
              Walk-ins are always welcome too.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── FORM + SIDEBAR ── */}
      <section className="py-16 sm:py-20" style={{ background: BRAND.dark }}>
        <div className="container max-w-5xl mx-auto px-4">
          <div className="grid lg:grid-cols-[1fr_320px] gap-10">
            {/* ── Form ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              {submitted ? (
                <div
                  className="rounded-2xl p-10 text-center border"
                  style={{
                    background: BRAND.card,
                    borderColor: BRAND.border,
                  }}
                >
                  <CircleCheck
                    className="w-16 h-16 mx-auto mb-4"
                    style={{ color: "#22C55E" }}
                  />
                  <h2
                    className="text-2xl font-bold mb-2"
                    style={{ color: BRAND.text }}
                  >
                    Request Received!
                  </h2>
                  <p style={{ color: BRAND.muted }} className="text-base">
                    We'll confirm your appointment within 2 hours.
                    <br />
                    If you need immediate help, call us at{" "}
                    <a
                      href="tel:2168620005"
                      className="font-semibold hover:underline"
                      style={{ color: BRAND.gold }}
                    >
                      (216) 862-0005
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="rounded-2xl p-6 sm:p-8 border space-y-5"
                  style={{
                    background: BRAND.card,
                    borderColor: BRAND.border,
                  }}
                >
                  <h2
                    className="text-xl font-bold mb-1"
                    style={{ color: BRAND.text }}
                  >
                    Request an Appointment
                  </h2>
                  <p
                    className="text-sm mb-6"
                    style={{ color: BRAND.muted }}
                  >
                    Fill out the form below and we'll reach out to confirm.
                  </p>

                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-4">
                    <InputField
                      label="Full Name"
                      icon={User}
                      required
                      placeholder="John Doe"
                      value={form.name}
                      onChange={update("name")}
                    />
                    <InputField
                      label="Phone Number"
                      icon={Phone}
                      required
                      type="tel"
                      placeholder="(216) 555-1234"
                      value={form.phone}
                      onChange={update("phone")}
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <InputField
                      label="Email"
                      icon={Mail}
                      type="email"
                      placeholder="john@email.com"
                      value={form.email}
                      onChange={update("email")}
                    />
                    <InputField
                      label="Vehicle Info"
                      icon={Car}
                      placeholder="2018 Honda Civic"
                      value={form.vehicle}
                      onChange={update("vehicle")}
                    />
                  </div>

                  <SelectField
                    label="Service Type"
                    icon={Wrench}
                    required
                    options={SERVICE_TYPES}
                    placeholder="Select a service..."
                    value={form.serviceType}
                    onChange={update("serviceType")}
                  />

                  <div className="grid sm:grid-cols-2 gap-4">
                    <SelectField
                      label="Preferred Day"
                      icon={Calendar}
                      options={PREFERRED_DAYS}
                      placeholder="Select a day..."
                      value={form.preferredDay}
                      onChange={update("preferredDay")}
                    />
                    <SelectField
                      label="Preferred Time"
                      icon={Clock}
                      options={TIME_SLOTS}
                      placeholder="Select a time..."
                      value={form.preferredTime}
                      onChange={update("preferredTime")}
                    />
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-[#C0C0C0] mb-1.5 flex items-center gap-1.5">
                      <Wrench
                        className="w-3.5 h-3.5"
                        style={{ color: BRAND.gold }}
                      />
                      Additional Notes
                    </span>
                    <textarea
                      rows={3}
                      placeholder="Anything else we should know? Describe the issue, mileage, etc."
                      value={form.notes}
                      onChange={update("notes")}
                      className="w-full px-4 py-3 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] text-white placeholder:text-[#555] focus:outline-none focus:border-[#FDB913] focus:ring-1 focus:ring-[#FDB913]/30 transition-colors text-sm resize-none"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-bold text-sm uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: BRAND.gold,
                      color: BRAND.dark,
                    }}
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-[#0A0A0A] border-t-transparent rounded-full animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Request Appointment
                      </>
                    )}
                  </button>
                </form>
              )}
            </motion.div>

            {/* ── Sidebar ── */}
            <motion.aside
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="space-y-6"
            >
              {/* Shop Hours */}
              <div
                className="rounded-2xl p-6 border"
                style={{
                  background: BRAND.card,
                  borderColor: BRAND.border,
                }}
              >
                <h3
                  className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2"
                  style={{ color: BRAND.gold }}
                >
                  <Clock className="w-4 h-4" />
                  Shop Hours
                </h3>
                <ul className="space-y-2 text-sm" style={{ color: BRAND.muted }}>
                  <li className="flex justify-between">
                    <span>Monday – Friday</span>
                    <span className="font-medium text-white">8am – 5pm</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Saturday</span>
                    <span className="font-medium text-white">8am – 2pm</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Sunday</span>
                    <span className="text-red-400">Closed</span>
                  </li>
                </ul>
              </div>

              {/* Quick Contact */}
              <div
                className="rounded-2xl p-6 border"
                style={{
                  background: BRAND.card,
                  borderColor: BRAND.border,
                }}
              >
                <h3
                  className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2"
                  style={{ color: BRAND.gold }}
                >
                  <Phone className="w-4 h-4" />
                  Need Help Now?
                </h3>
                <p className="text-sm mb-3" style={{ color: BRAND.muted }}>
                  Call or text us directly for immediate assistance.
                </p>
                <a
                  href="tel:2168620005"
                  className="block text-center py-3 rounded-lg font-bold text-sm border transition-colors hover:bg-[#FDB913]/10"
                  style={{
                    borderColor: BRAND.gold,
                    color: BRAND.gold,
                  }}
                >
                  (216) 862-0005
                </a>
              </div>

              {/* What to Expect */}
              <div
                className="rounded-2xl p-6 border"
                style={{
                  background: BRAND.card,
                  borderColor: BRAND.border,
                }}
              >
                <h3
                  className="text-sm font-bold uppercase tracking-wider mb-4"
                  style={{ color: BRAND.gold }}
                >
                  What to Expect
                </h3>
                <ol
                  className="space-y-3 text-sm"
                  style={{ color: BRAND.muted }}
                >
                  <li className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: `${BRAND.gold}20`,
                        color: BRAND.gold,
                      }}
                    >
                      1
                    </span>
                    Submit your request above
                  </li>
                  <li className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: `${BRAND.gold}20`,
                        color: BRAND.gold,
                      }}
                    >
                      2
                    </span>
                    We confirm within 2 hours
                  </li>
                  <li className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: `${BRAND.gold}20`,
                        color: BRAND.gold,
                      }}
                    >
                      3
                    </span>
                    Show up and we take care of the rest
                  </li>
                </ol>
              </div>
            </motion.aside>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
