/**
 * Predictive Maintenance — Mileage-based service interval predictions
 * For each vehicle, predicts when services are due based on manufacturer
 * intervals and actual service history.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("predictive-maintenance");

// Standard maintenance intervals in miles
const SERVICE_INTERVALS: Record<string, number> = {
  "oil-change": 5000,
  "tire-rotation": 7500,
  "air-filter": 15000,
  "cabin-filter": 15000,
  "brake-inspection": 15000,
  "coolant-flush": 30000,
  "transmission-fluid": 60000,
  "spark-plugs": 60000,
  "timing-belt": 90000,
  "power-steering-fluid": 50000,
  "differential-fluid": 50000,
  "brake-fluid-flush": 30000,
};

interface MaintenancePrediction {
  service: string;
  predictedDueDate: string;
  predictedDueMileage: number;
  confidence: "high" | "medium" | "low";
  basedOn: string;
  urgency: "overdue" | "due-soon" | "upcoming" | "future";
  estimatedCost: string;
}

const COST_ESTIMATES: Record<string, string> = {
  "oil-change": "$39-79",
  "tire-rotation": "$25-40",
  "air-filter": "$20-40",
  "cabin-filter": "$25-50",
  "brake-inspection": "Free",
  "coolant-flush": "$99-149",
  "transmission-fluid": "$149-199",
  "spark-plugs": "$100-250",
  "timing-belt": "$500-900",
  "power-steering-fluid": "$79-129",
  "differential-fluid": "$79-129",
  "brake-fluid-flush": "$89-129",
};

export function getPredictedMaintenance(params: {
  currentMileage: number;
  avgMilesPerMonth?: number;
  serviceHistory?: Array<{ service: string; mileageAtService: number; date: string }>;
}): MaintenancePrediction[] {
  const { currentMileage, avgMilesPerMonth = 1000, serviceHistory = [] } = params;
  const predictions: MaintenancePrediction[] = [];

  for (const [service, interval] of Object.entries(SERVICE_INTERVALS)) {
    const serviceKey = service.replace(/-/g, " ");
    const lastRecord = serviceHistory.find(s =>
      s.service.toLowerCase().includes(serviceKey) || serviceKey.includes(s.service.toLowerCase())
    );

    const lastMileage = lastRecord?.mileageAtService || 0;
    const milesSinceLast = currentMileage - lastMileage;
    const milesUntilDue = interval - milesSinceLast;
    const monthsUntilDue = avgMilesPerMonth > 0 ? milesUntilDue / avgMilesPerMonth : 12;

    const predictedDueDate = new Date();
    predictedDueDate.setMonth(predictedDueDate.getMonth() + Math.max(0, Math.round(monthsUntilDue)));

    let urgency: MaintenancePrediction["urgency"];
    if (milesUntilDue <= 0) urgency = "overdue";
    else if (milesUntilDue <= interval * 0.1) urgency = "due-soon";
    else if (monthsUntilDue <= 3) urgency = "upcoming";
    else urgency = "future";

    predictions.push({
      service: serviceKey.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
      predictedDueDate: predictedDueDate.toISOString().split("T")[0],
      predictedDueMileage: lastMileage + interval,
      confidence: lastRecord ? "high" : "low",
      basedOn: lastRecord
        ? `Last at ${lastMileage.toLocaleString()} mi on ${lastRecord.date}`
        : "No history — using manufacturer intervals",
      urgency,
      estimatedCost: COST_ESTIMATES[service] || "$50-200",
    });
  }

  return predictions.sort((a, b) => {
    const order = { overdue: 0, "due-soon": 1, upcoming: 2, future: 3 };
    return order[a.urgency] - order[b.urgency];
  });
}
