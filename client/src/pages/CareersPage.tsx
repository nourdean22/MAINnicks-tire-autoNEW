/**
 * /careers — Join the Team at Nick's Tire & Auto.
 * Advanced recruitment page with interactive application form.
 */
import { useState, useCallback, useRef } from "react";
import PageLayout from "@/components/PageLayout";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import {
  DollarSign,
  TrendingUp,
  Wrench,
  Users,
  ChevronDown,
  ChevronUp,
  Check,
  Upload,
  Phone,
  Mail,
  User,
  Briefcase,
  Clock,
  Star,
  Video,
  Send,
  CircleCheck,
} from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────

const BRAND = {
  gold: "#FDB913",
  dark: "#0A0A0A",
  text: "#E5E5E5",
  muted: "#A0A0A0",
  card: "#141414",
  border: "#222222",
  green: "#22C55E",
  red: "#EF4444",
};

const ROLES = [
  {
    id: "mechanic",
    title: "Mechanic",
    description:
      "Diagnose and repair vehicles — brakes, engines, transmissions, electrical. You're the backbone of the shop.",
    pay: "$22 – $38/hr + bonuses",
    requirements: [
      "2+ years hands-on experience",
      "Own tools preferred",
      "ASE certification a plus",
      "Valid driver's license",
    ],
  },
  {
    id: "tire-tech",
    title: "Tire Technician",
    description:
      "Mount, balance, patch, and rotate tires. Handle alignments. Fast-paced, physical work with room to grow.",
    pay: "$17 – $24/hr",
    requirements: [
      "Ability to lift 50+ lbs",
      "Basic tool knowledge",
      "Reliable and punctual",
      "Experience preferred but not required",
    ],
  },
  {
    id: "shop-helper",
    title: "Shop Helper",
    description:
      "Keep the shop running — move vehicles, clean bays, organize parts, assist techs. Great entry point into the trade.",
    pay: "$15 – $18/hr",
    requirements: [
      "No experience needed — we train",
      "Valid driver's license",
      "Positive attitude",
      "Willing to learn",
    ],
  },
  {
    id: "apprentice",
    title: "Apprentice / Trainee",
    description:
      "Learn from experienced mechanics while earning. We'll invest in your training and certifications. Build a real career.",
    pay: "$16 – $20/hr + training paid",
    requirements: [
      "Interest in automotive repair",
      "High school diploma or GED",
      "Eager to learn",
      "No experience required",
    ],
  },
  {
    id: "detailer",
    title: "Auto Detailer",
    description:
      "Interior and exterior detailing — wash, wax, polish, vacuum, shampoo. Make every car leave looking brand new.",
    pay: "$15 – $22/hr + tips",
    requirements: [
      "Attention to detail",
      "Experience with detailing products",
      "Physical stamina",
      "Pride in your work",
    ],
  },
] as const;

const SKILLS = [
  "Brakes",
  "Tires/Wheels",
  "Engine Repair",
  "Transmission",
  "Diagnostics/OBD-II",
  "Electrical",
  "AC/Heat",
  "Alignment",
  "Oil Change",
  "Detailing",
] as const;

const CERTIFICATIONS = [
  "ASE Certified",
  "OBD-II Certified",
  "State Inspection License",
  "EPA 608",
  "Tire Industry Association (TIA)",
] as const;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const TIME_SLOTS = [
  { label: "Morning", range: "7am–12pm" },
  { label: "Afternoon", range: "12–5pm" },
  { label: "Evening", range: "5–9pm" },
] as const;

const FAQ_ITEMS = [
  {
    q: "Do I need experience?",
    a: "Not for every role. Our Shop Helper and Apprentice positions are designed for people with zero experience. We train you from day one and invest in your growth. If you're willing to learn, we're willing to teach.",
  },
  {
    q: "What's the pay?",
    a: "Pay depends on the role and your experience. Mechanics earn $22–$38/hr plus bonuses. Tire techs start at $17/hr. Even entry-level helpers start at $15/hr. We review pay regularly and reward skill development.",
  },
  {
    q: "Is the trial day paid?",
    a: "Yes — 100%. If you opt in for a trial day, you'll be paid for your time. It's a chance for both of us to see if it's a good fit. No strings attached.",
  },
  {
    q: "What does a typical day look like?",
    a: "Shop opens at 7am. You'll work on a variety of vehicles — no two days are the same. Expect a mix of scheduled appointments and walk-ins. Lunch break is provided. Most shifts are 8–9 hours. We keep the shop clean, organized, and well-equipped.",
  },
  {
    q: "What tools do I need?",
    a: "For mechanics, having your own basic tool set is preferred but not a dealbreaker. We provide specialty tools and diagnostic equipment. For all other roles, we provide everything you need.",
  },
  {
    q: "Do you offer benefits?",
    a: "Yes. Full-time team members get paid time off, tool allowances, training stipends, and uniform coverage. We also do team events and bonuses for performance milestones.",
  },
];

// ─── TYPES ────────────────────────────────────────────

interface FormData {
  name: string;
  phone: string;
  email: string;
  role: string;
  experience: number;
  skills: Record<string, number>;
  certifications: string[];
  availability: Record<string, boolean>;
  trialDay: boolean;
  referredBy: string;
  videoFile: File | null;
}

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

function SkillDots({
  skill,
  value,
  onChange,
}: {
  skill: string;
  value: number;
  onChange: (skill: string, val: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#222]">
      <span className="text-sm text-[#ccc] min-w-[120px]">{skill}</span>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((dot) => (
          <button
            key={dot}
            type="button"
            onClick={() => onChange(skill, dot === value ? 0 : dot)}
            className="w-8 h-8 rounded-full border-2 transition-all duration-150 flex items-center justify-center touch-manipulation"
            style={{
              borderColor: dot <= value ? BRAND.gold : "#333",
              background: dot <= value ? BRAND.gold : "transparent",
            }}
            aria-label={`Rate ${skill} ${dot} out of 5`}
          >
            {dot <= value && (
              <span className="text-black text-xs font-bold">{dot}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AvailabilityGrid({
  availability,
  onToggle,
}: {
  availability: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full min-w-[400px]">
        <thead>
          <tr>
            <th className="text-left text-xs text-[#666] pb-2 pr-2" />
            {DAYS.map((day) => (
              <th
                key={day}
                className="text-center text-xs font-semibold pb-2 px-1"
                style={{ color: BRAND.gold }}
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIME_SLOTS.map((slot) => (
            <tr key={slot.label}>
              <td className="text-xs text-[#999] pr-2 py-1 whitespace-nowrap">
                <div className="font-medium">{slot.label}</div>
                <div className="text-[10px] text-[#555]">{slot.range}</div>
              </td>
              {DAYS.map((day) => {
                const key = `${day}-${slot.label}`;
                const active = !!availability[key];
                return (
                  <td key={key} className="text-center p-1">
                    <button
                      type="button"
                      onClick={() => onToggle(key)}
                      className="w-10 h-10 rounded-lg border-2 transition-all duration-150 touch-manipulation flex items-center justify-center mx-auto"
                      style={{
                        borderColor: active ? BRAND.green : "#333",
                        background: active ? `${BRAND.green}20` : "transparent",
                      }}
                      aria-label={`${day} ${slot.label} availability`}
                    >
                      {active && (
                        <Check size={16} style={{ color: BRAND.green }} />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#222]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left touch-manipulation"
      >
        <span className="text-[#E5E5E5] font-medium pr-4">{q}</span>
        {open ? (
          <ChevronUp size={20} className="text-[#FDB913] shrink-0" />
        ) : (
          <ChevronDown size={20} className="text-[#666] shrink-0" />
        )}
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="pb-4 text-sm text-[#999] leading-relaxed"
        >
          {a}
        </motion.div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────

export default function CareersPage() {
  const formRef = useRef<HTMLDivElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormData>({
    name: "",
    phone: "",
    email: "",
    role: "",
    experience: 2,
    skills: {},
    certifications: [],
    availability: {},
    trialDay: false,
    referredBy: "",
    videoFile: null,
  });

  const updateField = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleCert = useCallback((cert: string) => {
    setForm((prev) => ({
      ...prev,
      certifications: prev.certifications.includes(cert)
        ? prev.certifications.filter((c) => c !== cert)
        : [...prev.certifications, cert],
    }));
  }, []);

  const updateSkill = useCallback((skill: string, val: number) => {
    setForm((prev) => ({
      ...prev,
      skills: { ...prev.skills, [skill]: val },
    }));
  }, []);

  const toggleAvailability = useCallback((key: string) => {
    setForm((prev) => ({
      ...prev,
      availability: {
        ...prev.availability,
        [key]: !prev.availability[key],
      },
    }));
  }, []);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name || !form.phone || !form.role) {
      setError("Please fill in your name, phone, and select a role.");
      return;
    }

    setSubmitting(true);

    try {
      // Build payload — exclude File object, handle video separately if needed
      const payload = {
        name: form.name,
        phone: form.phone,
        email: form.email,
        role: form.role,
        experience: form.experience,
        skills: form.skills,
        certifications: form.certifications,
        availability: Object.entries(form.availability)
          .filter(([, v]) => v)
          .map(([k]) => k),
        trialDay: form.trialDay,
        referredBy: form.referredBy,
        hasVideo: !!form.videoFile,
      };

      const res = await fetch("https://autonicks.com/api/applicants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Server error");
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(
        "Something went wrong. Please try again or call us at (289) 700-9080.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─── SUCCESS STATE ─────────────────────────────────
  if (submitted) {
    return (
      <PageLayout activeHref="/careers">
        <Helmet>
          <title>Application Received | Nick's Tire & Auto</title>
        </Helmet>
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center max-w-md"
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: `${BRAND.green}20` }}
            >
              <CircleCheck size={40} style={{ color: BRAND.green }} />
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">
              Application Received!
            </h1>
            <p className="text-[#999] text-lg mb-6">
              We'll be in touch within 48 hours. Keep your phone nearby.
            </p>
            <a
              href="tel:2897009080"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-black"
              style={{ background: BRAND.gold }}
            >
              <Phone size={18} />
              Call (289) 700-9080
            </a>
          </motion.div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activeHref="/careers">
      <Helmet>
        <title>
          Careers — Join Our Team | Nick's Tire & Auto Cleveland
        </title>
        <meta
          name="description"
          content="Now hiring mechanics, tire technicians, and apprentices at Nick's Tire & Auto. Competitive pay, growth opportunities, modern shop. Apply in 2 minutes."
        />
        <link rel="canonical" href="https://autonicks.com/careers" />
      </Helmet>

      {/* ─── HERO ──────────────────────────────────────── */}
      <section className="relative overflow-hidden py-16 md:py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-[#FDB913]/5 to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <SectionLabel>We're Hiring</SectionLabel>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 leading-tight">
            Join the Team at{" "}
            <span style={{ color: BRAND.gold }}>
              Nick's Tire & Auto
            </span>
          </h1>
          <p className="text-lg md:text-xl text-[#999] max-w-2xl mx-auto mb-8 leading-relaxed">
            We're not just fixing cars — we're building careers. Competitive
            pay, real training, a shop that respects your skills, and a team
            that has your back. Whether you're a seasoned mechanic or just
            getting started, there's a place for you here.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={scrollToForm}
              className="px-8 py-4 rounded-xl font-bold text-black text-lg transition-transform hover:scale-105 active:scale-95 touch-manipulation"
              style={{ background: BRAND.gold }}
            >
              Apply Now — Takes 2 Minutes
            </button>
            <a
              href="tel:2897009080"
              className="px-8 py-4 rounded-xl font-bold text-white text-lg border-2 border-[#333] hover:border-[#FDB913] transition-colors touch-manipulation"
            >
              Call (289) 700-9080
            </a>
          </div>
          <p className="text-sm text-[#555] mt-4">
            {ROLES.length} open positions — no resume required
          </p>
        </div>
      </section>

      {/* ─── WHY WORK HERE ─────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <SectionLabel>Why Work Here</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              More Than Just a Job
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                icon: DollarSign,
                title: "Competitive Pay",
                desc: "Top-of-market rates, performance bonuses, and regular raises. Your skills = your earning power.",
              },
              {
                icon: TrendingUp,
                title: "Growth Opportunities",
                desc: "From helper to lead tech — we promote from within. We'll pay for your ASE certs and training.",
              },
              {
                icon: Wrench,
                title: "Modern Shop",
                desc: "Clean bays, latest diagnostic equipment, organized parts room. No junkyard vibes here.",
              },
              {
                icon: Users,
                title: "Team Culture",
                desc: "No egos, no drama. Just skilled people who help each other out and take pride in their work.",
              },
            ].map((card) => (
              <motion.div
                key={card.title}
                whileHover={{ y: -4 }}
                className="p-6 rounded-2xl border border-[#222] bg-[#111]"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: `${BRAND.gold}15` }}
                >
                  <card.icon size={24} style={{ color: BRAND.gold }} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {card.title}
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  {card.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── OPEN ROLES ────────────────────────────────── */}
      <section className="py-16 px-4 bg-[#080808]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <SectionLabel>Open Positions</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Find Your Role
            </h2>
          </div>
          <div className="grid gap-4">
            {ROLES.map((role) => (
              <motion.div
                key={role.id}
                whileHover={{ scale: 1.01 }}
                className="p-6 rounded-2xl border border-[#222] bg-[#111] cursor-pointer touch-manipulation"
                onClick={() => {
                  updateField("role", role.id);
                  scrollToForm();
                }}
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Briefcase
                        size={20}
                        style={{ color: BRAND.gold }}
                      />
                      <h3 className="text-xl font-bold text-white">
                        {role.title}
                      </h3>
                    </div>
                    <p className="text-sm text-[#999] mb-3 leading-relaxed">
                      {role.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {role.requirements.map((req) => (
                        <span
                          key={req}
                          className="text-xs px-3 py-1 rounded-full bg-[#1a1a1a] text-[#888] border border-[#2a2a2a]"
                        >
                          {req}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-row md:flex-col items-center md:items-end gap-3 shrink-0">
                    <span
                      className="text-lg font-bold whitespace-nowrap"
                      style={{ color: BRAND.gold }}
                    >
                      {role.pay}
                    </span>
                    <span className="text-xs text-[#555] px-3 py-1 rounded-full border border-[#333]">
                      Tap to Apply
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── APPLICATION FORM ──────────────────────────── */}
      <section className="py-16 px-4" ref={formRef} id="apply">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <SectionLabel>Apply Now</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">
              Your Application
            </h2>
            <p className="text-[#666]">
              No resume needed. Just tell us about yourself.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2">
                <User size={16} /> Basic Info
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#666] mb-1.5 uppercase tracking-wider">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder="Your name"
                    className="w-full px-4 py-3 rounded-xl bg-[#111] border border-[#222] text-white placeholder-[#444] focus:border-[#FDB913] focus:outline-none transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#666] mb-1.5 uppercase tracking-wider">
                    Phone *
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => updateField("phone", e.target.value)}
                    placeholder="(___) ___-____"
                    className="w-full px-4 py-3 rounded-xl bg-[#111] border border-[#222] text-white placeholder-[#444] focus:border-[#FDB913] focus:outline-none transition-colors"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#666] mb-1.5 uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="you@email.com"
                  className="w-full px-4 py-3 rounded-xl bg-[#111] border border-[#222] text-white placeholder-[#444] focus:border-[#FDB913] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Role Selector */}
            <div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2 mb-3">
                <Briefcase size={16} /> Position *
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => updateField("role", role.id)}
                    className="px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all touch-manipulation"
                    style={{
                      borderColor:
                        form.role === role.id ? BRAND.gold : "#222",
                      background:
                        form.role === role.id
                          ? `${BRAND.gold}15`
                          : "#111",
                      color:
                        form.role === role.id ? BRAND.gold : "#999",
                    }}
                  >
                    {role.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Experience Slider */}
            <div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2 mb-3">
                <Clock size={16} /> Experience
              </h3>
              <div className="bg-[#111] rounded-2xl border border-[#222] p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[#999] text-sm">Years of experience</span>
                  <span
                    className="text-2xl font-bold"
                    style={{ color: BRAND.gold }}
                  >
                    {form.experience === 20 ? "20+" : form.experience}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={form.experience}
                  onChange={(e) =>
                    updateField("experience", Number(e.target.value))
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer touch-manipulation"
                  style={{
                    background: `linear-gradient(to right, ${BRAND.gold} ${(form.experience / 20) * 100}%, #333 ${(form.experience / 20) * 100}%)`,
                  }}
                />
                <div className="flex justify-between text-xs text-[#555] mt-1">
                  <span>None</span>
                  <span>5 yrs</span>
                  <span>10 yrs</span>
                  <span>15 yrs</span>
                  <span>20+</span>
                </div>
              </div>
            </div>

            {/* Skills Self-Assessment */}
            <div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2 mb-3">
                <Star size={16} /> Skills Self-Assessment
              </h3>
              <p className="text-xs text-[#555] mb-4">
                Tap to rate yourself 1–5 for each skill. Skip any that don't
                apply.
              </p>
              <div className="bg-[#111] rounded-2xl border border-[#222] p-4 md:p-6">
                {SKILLS.map((skill) => (
                  <SkillDots
                    key={skill}
                    skill={skill}
                    value={form.skills[skill] ?? 0}
                    onChange={updateSkill}
                  />
                ))}
              </div>
            </div>

            {/* Certifications */}
            <div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2 mb-3">
                <Check size={16} /> Certifications
              </h3>
              <div className="flex flex-wrap gap-2">
                {CERTIFICATIONS.map((cert) => {
                  const active = form.certifications.includes(cert);
                  return (
                    <button
                      key={cert}
                      type="button"
                      onClick={() => toggleCert(cert)}
                      className="px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all touch-manipulation flex items-center gap-2"
                      style={{
                        borderColor: active ? BRAND.gold : "#222",
                        background: active ? `${BRAND.gold}15` : "#111",
                        color: active ? BRAND.gold : "#888",
                      }}
                    >
                      {active && <Check size={14} />}
                      {cert}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Availability Builder */}
            <div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-[#666] flex items-center gap-2 mb-3">
                <Clock size={16} /> Availability
              </h3>
              <p className="text-xs text-[#555] mb-4">
                Tap the cells when you're available. Green = available.
              </p>
              <div className="bg-[#111] rounded-2xl border border-[#222] p-4">
                <AvailabilityGrid
                  availability={form.availability}
                  onToggle={toggleAvailability}
                />
              </div>
            </div>

            {/* Trial Day Toggle */}
            <div className="bg-[#111] rounded-2xl border border-[#222] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-white font-semibold mb-1">
                    Want to come for a paid trial day?
                  </h3>
                  <p className="text-xs text-[#666]">
                    Spend a day in the shop, get paid, and see if it's a fit.
                    No commitment.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateField("trialDay", !form.trialDay)}
                  className="relative w-14 h-8 rounded-full transition-colors shrink-0 touch-manipulation"
                  style={{
                    background: form.trialDay ? BRAND.green : "#333",
                  }}
                  aria-label="Toggle trial day"
                >
                  <span
                    className="absolute top-1 w-6 h-6 rounded-full bg-white transition-transform"
                    style={{
                      transform: form.trialDay
                        ? "translateX(28px)"
                        : "translateX(4px)",
                    }}
                  />
                </button>
              </div>
            </div>

            {/* Referral */}
            <div>
              <label className="block text-xs text-[#666] mb-1.5 uppercase tracking-wider">
                Who referred you? (optional)
              </label>
              <input
                type="text"
                value={form.referredBy}
                onChange={(e) => updateField("referredBy", e.target.value)}
                placeholder="Name or 'saw it online'"
                className="w-full px-4 py-3 rounded-xl bg-[#111] border border-[#222] text-white placeholder-[#444] focus:border-[#FDB913] focus:outline-none transition-colors"
              />
            </div>

            {/* Video Upload */}
            <div className="bg-[#111] rounded-2xl border border-[#222] p-6">
              <div className="flex items-start gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `${BRAND.gold}15` }}
                >
                  <Video size={24} style={{ color: BRAND.gold }} />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold mb-1">
                    Video Intro (Optional)
                  </h3>
                  <p className="text-xs text-[#666] mb-4">
                    Record a 30-second video telling us why you want to work
                    here. No resume needed — just be yourself.
                  </p>
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-[#333] text-sm text-[#888] hover:border-[#FDB913] hover:text-[#FDB913] cursor-pointer transition-colors touch-manipulation">
                    <Upload size={16} />
                    {form.videoFile
                      ? form.videoFile.name
                      : "Upload Video"}
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) =>
                        updateField(
                          "videoFile",
                          e.target.files?.[0] ?? null,
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="text-sm p-4 rounded-xl border"
                style={{
                  color: BRAND.red,
                  borderColor: `${BRAND.red}40`,
                  background: `${BRAND.red}10`,
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 rounded-xl font-bold text-lg text-black transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation flex items-center justify-center gap-3"
              style={{ background: BRAND.gold }}
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={20} />
                  Apply Now
                </>
              )}
            </button>
            <p className="text-center text-xs text-[#555]">
              We respond to every application within 48 hours.
            </p>
          </form>
        </div>
      </section>

      {/* ─── FAQ ───────────────────────────────────────── */}
      <section className="py-16 px-4 bg-[#080808]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Common Questions
            </h2>
          </div>
          <div className="bg-[#111] rounded-2xl border border-[#222] p-6">
            {FAQ_ITEMS.map((item) => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
          <div className="text-center mt-8">
            <p className="text-[#666] mb-3">Still have questions?</p>
            <a
              href="tel:2897009080"
              className="inline-flex items-center gap-2 text-[#FDB913] font-semibold hover:underline"
            >
              <Phone size={16} />
              Call (289) 700-9080
            </a>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
