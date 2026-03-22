export interface ServiceType {
  id: string;
  name: string;
  category: string;
}

export const SERVICE_CATEGORIES = [
  "Brakes",
  "Engine",
  "Tires & Wheels",
  "Electrical",
  "Cooling",
  "Suspension",
  "Fluids",
  "Exhaust",
  "Drivetrain",
] as const;

export const SERVICE_TYPES: ServiceType[] = [
  // Engine
  { id: "oil-change", name: "Oil Change", category: "Engine" },
  { id: "spark-plugs", name: "Spark Plugs", category: "Engine" },
  { id: "timing-belt", name: "Timing Belt", category: "Engine" },
  { id: "serpentine-belt", name: "Serpentine Belt", category: "Engine" },
  { id: "water-pump", name: "Water Pump", category: "Engine" },

  // Brakes
  { id: "brake-pads-front", name: "Brake Pads (Front)", category: "Brakes" },
  { id: "brake-pads-rear", name: "Brake Pads (Rear)", category: "Brakes" },
  { id: "brake-pads-rotors-front", name: "Brake Pads + Rotors (Front)", category: "Brakes" },
  { id: "brake-pads-rotors-rear", name: "Brake Pads + Rotors (Rear)", category: "Brakes" },
  { id: "full-brake-job", name: "Full Brake Job", category: "Brakes" },

  // Tires & Wheels
  { id: "tire-rotation", name: "Tire Rotation", category: "Tires & Wheels" },
  { id: "tire-balance", name: "Tire Balance", category: "Tires & Wheels" },
  { id: "wheel-alignment", name: "Wheel Alignment", category: "Tires & Wheels" },

  // Electrical
  { id: "battery-replacement", name: "Battery Replacement", category: "Electrical" },
  { id: "alternator-replacement", name: "Alternator Replacement", category: "Electrical" },
  { id: "starter-replacement", name: "Starter Replacement", category: "Electrical" },
  { id: "oxygen-sensor", name: "Oxygen Sensor", category: "Electrical" },
  { id: "check-engine-diagnostic", name: "Check Engine Light Diagnostic", category: "Electrical" },

  // Cooling
  { id: "ac-recharge", name: "AC Recharge", category: "Cooling" },
  { id: "ac-compressor", name: "AC Compressor", category: "Cooling" },
  { id: "radiator-replacement", name: "Radiator Replacement", category: "Cooling" },
  { id: "thermostat", name: "Thermostat", category: "Cooling" },
  { id: "coolant-flush", name: "Coolant Flush", category: "Cooling" },

  // Suspension
  { id: "suspension-struts-front", name: "Suspension (Struts Front)", category: "Suspension" },
  { id: "suspension-struts-rear", name: "Suspension (Struts Rear)", category: "Suspension" },
  { id: "tie-rod-ends", name: "Tie Rod Ends", category: "Suspension" },
  { id: "ball-joint", name: "Ball Joint", category: "Suspension" },

  // Fluids
  { id: "transmission-fluid-flush", name: "Transmission Fluid Flush", category: "Fluids" },
  { id: "power-steering-flush", name: "Power Steering Flush", category: "Fluids" },

  // Exhaust
  { id: "catalytic-converter", name: "Catalytic Converter", category: "Exhaust" },
  { id: "exhaust-repair", name: "Exhaust Repair", category: "Exhaust" },

  // Drivetrain
  { id: "cv-axle", name: "CV Axle", category: "Drivetrain" },
];
