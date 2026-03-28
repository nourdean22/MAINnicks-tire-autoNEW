/**
 * Smart Scheduler — Availability, no-show prediction, seasonal demand
 */
import { createLogger } from "../lib/logger";

const log = createLogger("scheduler");

const BAYS = 4;
const SLOTS_PER_DAY = ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
const SERVICE_DURATIONS: Record<string, number> = {
  "oil-change": 1, "flat-repair": 1, "diagnostics": 1, "emissions": 1,
  "brakes": 2, "tires": 2, "alignment": 1, "ac-repair": 2,
  "suspension": 3, "transmission": 4, "engine": 4, "general": 2,
};

export function getAvailableSlots(date: string, existingBookings: Array<{ time: string; duration: number }>): string[] {
  const bookedCounts = new Map<string, number>();
  for (const b of existingBookings) {
    bookedCounts.set(b.time, (bookedCounts.get(b.time) || 0) + 1);
  }
  return SLOTS_PER_DAY.filter(slot => (bookedCounts.get(slot) || 0) < BAYS);
}

export function getServiceDuration(serviceType: string): number {
  const key = serviceType.toLowerCase().replace(/\s+/g, "-");
  return SERVICE_DURATIONS[key] || 2;
}

/** No-show risk prediction based on historical patterns */
export function predictNoShowRisk(params: {
  isNewCustomer: boolean;
  dayOfWeek: number;
  timeSlot: string;
  hasConfirmedViaSms: boolean;
  previousNoShows: number;
  totalAppointments: number;
}): { risk: number; factors: string[] } {
  let risk = 10; // Base 10% risk
  const factors: string[] = [];

  if (params.isNewCustomer) { risk += 15; factors.push("new-customer"); }
  if (params.dayOfWeek === 1) { risk += 5; factors.push("monday"); } // Mondays have higher no-shows
  if (params.timeSlot.includes("8:00")) { risk += 5; factors.push("early-morning"); }
  if (!params.hasConfirmedViaSms) { risk += 10; factors.push("unconfirmed"); }
  if (params.previousNoShows > 0) {
    const noShowRate = params.totalAppointments > 0 ? params.previousNoShows / params.totalAppointments : 0.5;
    risk += Math.round(noShowRate * 40);
    factors.push("history-of-no-shows");
  }
  if (params.hasConfirmedViaSms) { risk -= 10; factors.push("sms-confirmed"); }

  return { risk: Math.max(0, Math.min(100, risk)), factors };
}

/** Upsell recommendations based on vehicle + service history */
export function getUpsellRecommendations(params: {
  currentService: string;
  vehicleYear?: number;
  vehicleMake?: string;
  mileage?: number;
  lastServices?: Array<{ service: string; date: string; mileage?: number }>;
}): Array<{ service: string; reason: string; urgency: "low" | "medium" | "high"; estimatedCost: string }> {
  const recommendations: Array<{ service: string; reason: string; urgency: "low" | "medium" | "high"; estimatedCost: string }> = [];
  const mileage = params.mileage || 0;
  const vehicleAge = params.vehicleYear ? new Date().getFullYear() - params.vehicleYear : 5;

  // Universal upsells based on current service
  if (params.currentService.includes("oil") && mileage > 30000) {
    const lastAlignment = params.lastServices?.find(s => s.service.includes("alignment"));
    if (!lastAlignment || (lastAlignment.mileage && mileage - lastAlignment.mileage > 15000)) {
      recommendations.push({ service: "Wheel Alignment", reason: "Last alignment was 15K+ miles ago. Cleveland roads are tough on alignment.", urgency: "medium", estimatedCost: "$79-99" });
    }
  }

  if (params.currentService.includes("brake") && mileage > 60000) {
    recommendations.push({ service: "Brake Fluid Flush", reason: "Brake fluid absorbs moisture over time, reducing braking performance.", urgency: "medium", estimatedCost: "$89-129" });
  }

  if (params.currentService.includes("tire") && vehicleAge >= 3) {
    recommendations.push({ service: "TPMS Sensor Check", reason: "TPMS sensors have a battery life of 5-7 years.", urgency: "low", estimatedCost: "$25-45/sensor" });
  }

  // Mileage-based recommendations
  if (mileage > 60000 && mileage < 70000) {
    recommendations.push({ service: "Transmission Fluid Service", reason: "Recommended at 60K miles to prevent transmission issues.", urgency: "medium", estimatedCost: "$149-199" });
  }
  if (mileage > 90000 && mileage < 105000) {
    recommendations.push({ service: "Timing Belt Inspection", reason: "Most timing belts need replacement at 90-100K miles.", urgency: "high", estimatedCost: "$500-900" });
  }
  if (mileage > 30000) {
    const lastCoolant = params.lastServices?.find(s => s.service.includes("coolant"));
    if (!lastCoolant) {
      recommendations.push({ service: "Coolant Flush", reason: "Recommended every 30K miles or 2 years to prevent overheating.", urgency: "low", estimatedCost: "$99-149" });
    }
  }

  return recommendations.slice(0, 3); // Max 3 recommendations
}

/** Seasonal service predictor */
export function getSeasonalFocus(): { month: string; services: string[]; promoIdea: string } {
  // Use Eastern Time — Railway runs UTC
  const etDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const month = etDate.getMonth(); // 0-11
  const SEASONAL: Record<number, { services: string[]; promoIdea: string }> = {
    0: { services: ["battery", "winter-tires", "heating"], promoIdea: "Free battery test with any service" },
    1: { services: ["battery", "wiper-blades", "heating"], promoIdea: "Winter survival package: battery + wipers + fluid check" },
    2: { services: ["alignment", "suspension", "tires"], promoIdea: "Pothole damage check — free alignment inspection" },
    3: { services: ["alignment", "brakes", "tires"], promoIdea: "Spring vehicle health check — 21 points, free" },
    4: { services: ["ac-repair", "coolant", "tires"], promoIdea: "AC system check before summer — $49" },
    5: { services: ["ac-repair", "coolant", "brakes"], promoIdea: "Road trip ready package: AC + tires + brakes" },
    6: { services: ["ac-repair", "coolant", "tires"], promoIdea: "Beat the heat — AC recharge special" },
    7: { services: ["ac-repair", "brakes", "back-to-school"], promoIdea: "Back to school vehicle safety check — free" },
    8: { services: ["brakes", "tires", "oil-change"], promoIdea: "Fall maintenance: oil + tires + brakes bundle" },
    9: { services: ["winter-prep", "tires", "battery"], promoIdea: "Winter prep package: tires + battery + fluids" },
    10: { services: ["winter-tires", "battery", "heating"], promoIdea: "Early bird winter tire swap — book now, beat the rush" },
    11: { services: ["battery", "winter-tires", "heating"], promoIdea: "Holiday travel prep — full vehicle inspection free" },
  };
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return { month: monthNames[month], ...SEASONAL[month] };
}
