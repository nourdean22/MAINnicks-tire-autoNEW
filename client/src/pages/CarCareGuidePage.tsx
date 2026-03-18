/**
 * /car-care-guide — Seasonal Car Care Guide & Maintenance Tips
 * Educational content that builds trust and SEO authority.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Menu, X, BookOpen, ChevronRight, Snowflake, Sun, Leaf, Droplets, Wrench, AlertTriangle, CheckCircle, Gauge } from "lucide-react";
import { motion, useInView } from "framer-motion";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

// ─── GUIDE DATA ────────────────────────────────────────
const SEASONAL_GUIDES = [
  {
    season: "Winter",
    icon: <Snowflake className="w-7 h-7" />,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    title: "WINTER CAR CARE",
    subtitle: "Prepare for Cleveland winters",
    tips: [
      { title: "Battery Check", desc: "Cold weather drains batteries faster. If your battery is over 3 years old, have it tested before the first freeze. A weak battery that works fine in summer can fail completely at 20 degrees." },
      { title: "Tire Tread & Pressure", desc: "Check tire tread depth with the penny test — if you can see all of Lincoln's head, your tread is too low for winter driving. Cold air also drops tire pressure about 1 PSI for every 10-degree drop in temperature." },
      { title: "Coolant / Antifreeze", desc: "Your coolant mixture should be 50/50 antifreeze and water. A weak mixture can freeze inside the engine block and crack it — one of the most expensive repairs possible." },
      { title: "Windshield Wipers & Fluid", desc: "Replace worn wiper blades before the first snow. Use winter-rated washer fluid rated to -20°F or lower. Cleveland road salt creates constant windshield grime." },
      { title: "Brake Inspection", desc: "Salt and slush accelerate brake wear. Have your brakes inspected before winter. Worn pads on icy roads is a dangerous combination." },
    ],
  },
  {
    season: "Spring",
    icon: <Droplets className="w-7 h-7" />,
    color: "text-green-400",
    bgColor: "bg-green-400/10",
    title: "SPRING RECOVERY",
    subtitle: "Undo winter damage",
    tips: [
      { title: "Alignment Check", desc: "Cleveland potholes are brutal on your suspension and alignment. If your car pulls to one side or the steering wheel vibrates, you likely need an alignment. Driving on bad alignment wears tires unevenly and costs you money." },
      { title: "Undercarriage Wash", desc: "Road salt corrodes brake lines, exhaust components, and suspension parts. Get the undercarriage washed thoroughly after winter to prevent rust damage." },
      { title: "AC System Check", desc: "Test your AC before the first hot day. If it blows warm air, the refrigerant may be low or the compressor may need attention. Catching it early is cheaper than an emergency repair in July." },
      { title: "Tire Rotation", desc: "Rotate your tires every 5,000-7,500 miles to ensure even wear. Spring is a good time to switch back from winter tires if you use them." },
      { title: "Fluid Top-Off", desc: "Check all fluids — oil, transmission, brake, power steering, and coolant. Winter driving is hard on every system." },
    ],
  },
  {
    season: "Summer",
    icon: <Sun className="w-7 h-7" />,
    color: "text-nick-yellow",
    bgColor: "bg-nick-yellow/10",
    title: "SUMMER READINESS",
    subtitle: "Beat the heat",
    tips: [
      { title: "Cooling System", desc: "Overheating is the number one cause of summer breakdowns. Check your coolant level, inspect hoses for cracks or bulges, and make sure the radiator fan is working. If your temperature gauge creeps up in traffic, do not ignore it." },
      { title: "AC Performance", desc: "If your AC is not blowing cold, the most common causes are low refrigerant, a failing compressor, or a clogged condenser. Our technicians can diagnose the exact issue with proper gauges." },
      { title: "Tire Pressure", desc: "Hot pavement increases tire temperature and pressure. Overinflated tires wear faster in the center and have less grip. Check pressure when tires are cold, first thing in the morning." },
      { title: "Oil Change", desc: "Heat breaks down oil faster. If you are due for an oil change, do not put it off during summer. Clean oil protects your engine from heat-related wear." },
      { title: "Belt & Hose Inspection", desc: "Heat accelerates rubber deterioration. A broken serpentine belt will disable your power steering, AC, and alternator all at once. A burst radiator hose will overheat your engine in minutes." },
    ],
  },
  {
    season: "Fall",
    icon: <Leaf className="w-7 h-7" />,
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    title: "FALL PREPARATION",
    subtitle: "Get ready for cold",
    tips: [
      { title: "Heater & Defroster Test", desc: "Make sure your heater and defroster work before you need them. A heater that blows cold air could mean a stuck thermostat, low coolant, or a failing heater core." },
      { title: "Battery Test", desc: "Batteries that survived summer heat often fail with the first cold snap. Have your battery tested — it takes 5 minutes and can prevent a no-start situation on a freezing morning." },
      { title: "Brake Inspection", desc: "Fall is the ideal time for a brake check before winter conditions. We inspect pads, rotors, calipers, and brake lines and show you exactly what we find." },
      { title: "Headlight Check", desc: "Days get shorter fast. Make sure all headlights, taillights, and turn signals are working. Foggy or yellowed headlight lenses reduce visibility significantly — we can restore them." },
      { title: "E-Check / Emissions", desc: "If your Ohio E-Check is due, get it done in fall before the holiday rush. If your check engine light is on, we can diagnose and repair the emissions issue so you pass inspection." },
    ],
  },
];

const MILEAGE_MILESTONES = [
  { miles: "3,000–5,000", service: "Oil Change", desc: "Conventional oil every 3,000-5,000 miles. Synthetic can go 7,500-10,000. Check your owner's manual.", icon: <Droplets className="w-5 h-5" /> },
  { miles: "5,000–7,500", service: "Tire Rotation", desc: "Rotate tires to ensure even wear. Uneven wear means you replace tires sooner.", icon: <Gauge className="w-5 h-5" /> },
  { miles: "15,000–30,000", service: "Air Filter Replacement", desc: "A clogged air filter reduces fuel economy and engine performance.", icon: <Wrench className="w-5 h-5" /> },
  { miles: "30,000", service: "Brake Inspection", desc: "Full brake inspection including pads, rotors, calipers, and fluid. Some pads last 30,000 miles, some last 70,000 — it depends on driving habits.", icon: <AlertTriangle className="w-5 h-5" /> },
  { miles: "30,000–60,000", service: "Coolant Flush", desc: "Old coolant loses its protective properties and can cause corrosion inside the cooling system.", icon: <Droplets className="w-5 h-5" /> },
  { miles: "60,000–100,000", service: "Transmission Service", desc: "Transmission fluid breaks down over time. A fluid change at 60,000-80,000 miles can prevent a $3,000+ transmission replacement.", icon: <Wrench className="w-5 h-5" /> },
];

const WARNING_SIGNS = [
  { sign: "Check Engine Light", action: "Do not ignore it. Could be anything from a loose gas cap to a failing catalytic converter. Get it scanned.", link: "/diagnose" },
  { sign: "Squealing or Grinding Brakes", action: "Squealing means pads are getting thin. Grinding means metal-on-metal — you are damaging rotors. Come in immediately.", link: "/brakes" },
  { sign: "Car Pulling to One Side", action: "Usually an alignment issue from potholes. Can also indicate uneven tire wear or a stuck brake caliper.", link: "/general-repair" },
  { sign: "Vibration While Driving", action: "Could be unbalanced tires, warped brake rotors, or worn suspension components. The cause depends on when it happens.", link: "/diagnose" },
  { sign: "Burning Smell", action: "Could be an oil leak hitting the exhaust, overheating brakes, or an electrical issue. Pull over safely and call us.", link: "/contact" },
  { sign: "AC Blowing Warm Air", action: "Low refrigerant, failing compressor, or electrical issue. Do not just add refrigerant — find the leak first.", link: "/general-repair" },
];

export default function CarCareGuidePage() {
  const [activeSeason, setActiveSeason] = useState(0);

  useEffect(() => {
    window.scrollTo(0, 0);
    // Auto-select current season
    const month = new Date().getMonth();
    if (month >= 11 || month <= 1) setActiveSeason(0); // Winter
    else if (month >= 2 && month <= 4) setActiveSeason(1); // Spring
    else if (month >= 5 && month <= 7) setActiveSeason(2); // Summer
    else setActiveSeason(3); // Fall
  }, []);

  return (
    <PageLayout>
      <SEOHead
        title="Car Care Guide — Seasonal Maintenance Tips | Nick's Tire & Auto Cleveland"
        description="Complete car care guide from Nick's Tire & Auto in Cleveland. Seasonal maintenance tips, mileage milestones, and warning signs every driver should know."
        canonicalPath="/car-care-guide"
      />
      
      
      


        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Car Care Guide" }]} />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <BookOpen className="w-6 h-6 text-nick-yellow" />
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Maintenance Education</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                CAR CARE<br />
                <span className="text-gradient-yellow">GUIDE</span>
              </h1>
              <p className="mt-6 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Everything Cleveland drivers need to know about keeping their vehicles running right. Seasonal tips, mileage milestones, and warning signs explained by our technicians.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Seasonal Guides */}
        <section className="py-12 lg:py-16 section-darker">
          <div className="hidden" />
          <div className="container pt-12">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                SEASONAL <span className="text-gradient-yellow">MAINTENANCE</span>
              </h2>
              <p className="mt-3 text-foreground/60 max-w-2xl">
                Cleveland weather puts unique demands on your vehicle. Here is what to focus on each season.
              </p>
            </FadeIn>

            {/* Season Tabs */}
            <div className="mt-8 flex flex-wrap gap-2">
              {SEASONAL_GUIDES.map((guide, i) => (
                <button
                  key={guide.season}
                  onClick={() => setActiveSeason(i)}
                  className={`flex items-center gap-2 px-5 py-2.5 font-semibold font-bold text-sm tracking-wider uppercase transition-colors ${
                    activeSeason === i
                      ? "bg-nick-yellow text-nick-dark"
                      : "border border-nick-yellow/20 text-foreground/60 hover:border-nick-yellow/50"
                  }`}
                >
                  {guide.icon}
                  {guide.season}
                </button>
              ))}
            </div>

            {/* Active Season Content */}
            <div className="mt-8">
              <FadeIn key={activeSeason}>
                <div className="border border-nick-yellow/20 bg-nick-dark/50 p-6 lg:p-10">
                  <div className="flex items-center gap-4 mb-6">
                    <div className={`w-14 h-14 ${SEASONAL_GUIDES[activeSeason].bgColor} flex items-center justify-center rounded-md ${SEASONAL_GUIDES[activeSeason].color}`}>
                      {SEASONAL_GUIDES[activeSeason].icon}
                    </div>
                    <div>
                      <h3 className="font-semibold font-bold text-foreground text-2xl lg:text-3xl tracking-wider">{SEASONAL_GUIDES[activeSeason].title}</h3>
                      <p className="text-foreground/50 text-sm font-mono">{SEASONAL_GUIDES[activeSeason].subtitle}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {SEASONAL_GUIDES[activeSeason].tips.map((tip, i) => (
                      <div key={i} className="flex gap-4">
                        <div className="w-8 h-8 bg-nick-yellow/10 flex items-center justify-center rounded shrink-0 mt-1">
                          <CheckCircle className="w-4 h-4 text-nick-yellow" />
                        </div>
                        <div>
                          <h4 className="font-semibold font-bold text-foreground text-base tracking-wider uppercase">{tip.title}</h4>
                          <p className="text-foreground/70 leading-relaxed mt-1">{tip.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 pt-6 border-t border-nick-yellow/10">
                    <a
                      href="tel:2168620005"
                      onClick={() => trackPhoneClick("car_care_guide_seasonal")}
                      className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 font-semibold font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      SCHEDULE {SEASONAL_GUIDES[activeSeason].season.toUpperCase()} SERVICE
                    </a>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Mileage Milestones */}
        <section className="py-12 lg:py-16 bg-background">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                MILEAGE <span className="text-gradient-yellow">MILESTONES</span>
              </h2>
              <p className="mt-3 text-foreground/60 max-w-2xl">
                Here is when common maintenance items are typically due. These are general guidelines — check your owner's manual for your specific vehicle.
              </p>
            </FadeIn>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {MILEAGE_MILESTONES.map((item, i) => (
                <FadeIn key={item.service} delay={i * 0.05}>
                  <div className="border border-nick-yellow/15 bg-nick-dark/30 p-6 h-full">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-nick-blue-light">{item.icon}</div>
                      <span className="font-mono text-nick-yellow text-sm tracking-wider">{item.miles} MI</span>
                    </div>
                    <h3 className="font-semibold font-bold text-foreground text-lg tracking-wider uppercase mb-2">{item.service}</h3>
                    <p className="text-foreground/60 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Warning Signs */}
        <section className="py-12 lg:py-16 section-darker">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                WARNING <span className="text-gradient-yellow">SIGNS</span>
              </h2>
              <p className="mt-3 text-foreground/60 max-w-2xl">
                Do not ignore these symptoms. Catching problems early saves money and prevents breakdowns.
              </p>
            </FadeIn>

            <div className="mt-10 space-y-4">
              {WARNING_SIGNS.map((item, i) => (
                <FadeIn key={item.sign} delay={i * 0.05}>
                  <div className="border border-nick-yellow/15 bg-nick-dark/50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="w-10 h-10 bg-nick-yellow/10 flex items-center justify-center rounded-md shrink-0">
                      <AlertTriangle className="w-5 h-5 text-nick-yellow" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold font-bold text-foreground text-base tracking-wider uppercase">{item.sign}</h3>
                      <p className="text-foreground/60 text-sm mt-1 leading-relaxed">{item.action}</p>
                    </div>
                    <Link href={item.link} className="shrink-0 inline-flex items-center gap-1 text-nick-yellow text-sm font-semibold font-bold tracking-wider uppercase hover:text-nick-gold transition-colors">
                      LEARN MORE
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 lg:py-20 bg-background">
          <div className="container text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                QUESTIONS ABOUT YOUR <span className="text-gradient-yellow">VEHICLE</span>?
              </h2>
              <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
                Our technicians are here to help. Call us, book online, or use our free diagnostic tool.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="tel:2168620005"
                  onClick={() => trackPhoneClick("car_care_guide_cta")}
                  className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 font-semibold font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  CALL NOW
                </a>
                <Link
                  href="/diagnose"
                  className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
                >
                  DIAGNOSE MY CAR
                  <ChevronRight className="w-5 h-5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        


      
    </PageLayout>
  );
}
