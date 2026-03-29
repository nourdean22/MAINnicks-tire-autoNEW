/**
 * Seasonal landing page data for time-sensitive local SEO.
 * Each page targets seasonal search queries like "winter tires Cleveland"
 * or "summer AC repair near me".
 */

export interface SeasonalData {
  slug: string;
  season: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubline: string;
  intro: string;
  checklist: {
    title: string;
    description: string;
  }[];
  commonProblems: {
    problem: string;
    explanation: string;
    solution: string;
  }[];
  ctaText: string;
}

export const SEASONAL_PAGES: SeasonalData[] = [
  {
    slug: "winter-car-care-cleveland",
    season: "Winter",
    metaTitle: "Winter Car Care Cleveland | Snow Tires & Cold Weather Prep | Nick's Tire & Auto",
    metaDescription: "Prepare your vehicle for Cleveland winters. Snow tires, battery testing, antifreeze, brake inspection, and winter safety checks. Call Nick's Tire & Auto at (216) 862-0005.",
    heroHeadline: "WINTER CAR CARE\nFOR CLEVELAND DRIVERS",
    heroSubline: "Cleveland winters are hard on vehicles. Salt, ice, potholes, and freezing temperatures take a toll on tires, batteries, brakes, and cooling systems. We help you prepare before the first snowfall.",
    intro: "Northeast Ohio winters bring some of the toughest driving conditions in the country. Between lake-effect snow, sub-zero wind chills, and roads covered in salt and brine, your vehicle needs to be ready. At Nick's Tire & Auto, we perform comprehensive winter preparation services to keep you safe and avoid breakdowns when temperatures drop.",
    checklist: [
      {
        title: "Snow Tires / Winter Tires",
        description: "All-season tires lose grip below 45 degrees Fahrenheit. Winter tires use a softer rubber compound and deeper tread patterns designed for snow and ice. We carry a full selection of winter tires and handle mounting, balancing, and TPMS sensor transfer."
      },
      {
        title: "Battery Testing & Replacement",
        description: "Cold weather reduces battery capacity by up to 50 percent. A battery that works fine in summer can fail on the first cold morning. We test your battery's cold cranking amps and replace it if needed before it leaves you stranded."
      },
      {
        title: "Antifreeze / Coolant Check",
        description: "Your coolant system prevents the engine from freezing in winter and overheating in summer. We check coolant concentration, inspect hoses for cracks, and flush the system if the coolant is past its service life."
      },
      {
        title: "Brake Inspection",
        description: "Stopping on snow and ice requires brakes in top condition. We inspect pads, rotors, calipers, and brake fluid to ensure maximum stopping power when road conditions are worst."
      },
      {
        title: "Wiper Blades & Washer Fluid",
        description: "Visibility is critical in winter storms. We install winter-rated wiper blades and fill your washer fluid reservoir with freeze-resistant solution rated to negative 20 degrees."
      },
      {
        title: "Belts & Hoses",
        description: "Rubber components become brittle in cold weather. A cracked serpentine belt or radiator hose can leave you stranded. We inspect all belts and hoses and replace any that show signs of wear."
      }
    ],
    commonProblems: [
      {
        problem: "Car will not start on cold mornings",
        explanation: "This is usually a weak battery or corroded battery terminals. Cold temperatures reduce the chemical reaction inside the battery, and if it is already marginal, it will not produce enough power to turn the starter.",
        solution: "We test the battery and charging system, clean or replace terminals, and install a new battery if needed. We also check the starter motor and alternator."
      },
      {
        problem: "Vehicle sliding or poor traction in snow",
        explanation: "All-season tires harden in cold temperatures and lose grip. Worn tread compounds the problem. Many drivers do not realize their tires are past the safe tread depth until they experience a slide.",
        solution: "We measure tread depth, inspect tire condition, and recommend winter tires or replacement all-seasons based on your driving needs and budget."
      },
      {
        problem: "Heater blowing cold air",
        explanation: "A heater that blows cold air usually indicates low coolant, a stuck thermostat, or a clogged heater core. All of these are repairable and should be addressed before winter.",
        solution: "We diagnose the heating system, check coolant levels, test the thermostat, and inspect the heater core to restore full heat output."
      }
    ],
    ctaText: "Schedule your winter preparation service before the first snowfall. Our technicians will inspect your vehicle and make sure it is ready for Cleveland's toughest season."
  },
  {
    slug: "summer-car-care-cleveland",
    season: "Summer",
    metaTitle: "Summer Car Care Cleveland | AC Repair & Hot Weather Prep | Nick's Tire & Auto",
    metaDescription: "Keep your vehicle cool and reliable this summer. AC repair, coolant system service, tire inspection, and summer safety checks in Cleveland. Call (216) 862-0005.",
    heroHeadline: "SUMMER CAR CARE\nFOR CLEVELAND DRIVERS",
    heroSubline: "Hot pavement, long road trips, and heavy AC use put extra stress on your vehicle. We help Cleveland drivers stay cool and avoid breakdowns all summer long.",
    intro: "Summer in Cleveland brings heat, humidity, and road trip season. Your vehicle's cooling system, air conditioning, tires, and brakes all work harder in hot weather. At Nick's Tire & Auto, we perform summer vehicle inspections to catch problems before they leave you stranded on the highway or sweating in a parking lot with a dead AC system.",
    checklist: [
      {
        title: "Air Conditioning Service",
        description: "If your AC is blowing warm or lukewarm air, it likely needs a refrigerant recharge or has a leak in the system. We diagnose AC problems, check refrigerant levels, inspect the compressor, and repair leaks to restore full cold air."
      },
      {
        title: "Cooling System Inspection",
        description: "Your engine runs hotter in summer, and the cooling system has to work harder. We check coolant levels, inspect the radiator, water pump, thermostat, and hoses, and flush the system if the coolant is degraded."
      },
      {
        title: "Tire Inspection & Pressure",
        description: "Hot pavement increases tire temperature and pressure. Under-inflated or worn tires are more likely to blow out in summer heat. We check tread depth, inspect for damage, and set pressures to manufacturer specifications."
      },
      {
        title: "Brake Check",
        description: "Summer driving often means more highway miles and heavier braking. We inspect brake pads, rotors, and fluid to ensure your stopping power is reliable for road trips and daily driving."
      },
      {
        title: "Battery Test",
        description: "Heat is actually harder on batteries than cold. High temperatures accelerate internal corrosion and fluid evaporation. We test battery health and replace it if it is showing signs of weakness."
      },
      {
        title: "Fluid Top-Off",
        description: "We check and top off all essential fluids including engine oil, transmission fluid, power steering fluid, brake fluid, and windshield washer fluid."
      }
    ],
    commonProblems: [
      {
        problem: "AC blowing warm air",
        explanation: "The most common cause is low refrigerant due to a slow leak in the AC system. Other causes include a failing compressor, clogged condenser, or a faulty blend door actuator.",
        solution: "We perform a full AC diagnostic, check refrigerant pressure, inspect for leaks using UV dye, and repair or replace the failed component to restore cold air."
      },
      {
        problem: "Engine overheating in traffic",
        explanation: "Stop-and-go traffic in summer heat puts maximum stress on the cooling system. Low coolant, a failing water pump, stuck thermostat, or clogged radiator can all cause overheating.",
        solution: "We diagnose the cooling system, pressure test for leaks, check the water pump and thermostat, and flush or repair the system as needed."
      },
      {
        problem: "Tire blowout on the highway",
        explanation: "Hot pavement combined with under-inflated or worn tires dramatically increases blowout risk. Many blowouts happen because drivers do not check tire pressure regularly in summer.",
        solution: "We inspect all four tires plus the spare, measure tread depth, check for sidewall damage, and set pressures to the correct specification. We replace any tires that are unsafe."
      }
    ],
    ctaText: "Get your vehicle summer-ready before the heat hits. Our technicians will make sure your AC, cooling system, tires, and brakes are all in top shape for the season ahead."
  }
];

export function getSeasonalBySlug(slug: string): SeasonalData | undefined {
  return SEASONAL_PAGES.find(s => s.slug === slug);
}
