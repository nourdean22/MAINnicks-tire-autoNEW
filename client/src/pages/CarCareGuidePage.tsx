/**
 * /car-care-guide — Seasonal Car Care Guide & Maintenance Tips
 * Educational content that builds trust and SEO authority.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, BookOpen, ChevronRight, Snowflake, Sun, Leaf, Droplets, Wrench, AlertTriangle, CheckCircle, Gauge } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

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
    color: "text-primary",
    bgColor: "bg-primary/10",
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

