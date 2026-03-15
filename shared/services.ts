/**
 * Centralized service data for Nick's Tire & Auto.
 * Used by both the homepage service grid and individual service pages.
 * Each service includes SEO-optimized content following the brand's
 * Problem → Explanation → Diagnostic Authority → Solution → Local Trust → CTA structure.
 */

export interface ServiceData {
  slug: string;
  num: string;
  title: string;
  shortDesc: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubline: string;
  problems: {
    question: string;
    answer: string;
  }[];
  process: {
    step: string;
    detail: string;
  }[];
  whyUs: string[];
  keywords: string[];
}

export const SERVICES: ServiceData[] = [
  {
    slug: "tires",
    num: "01",
    title: "TIRES",
    shortDesc: "New and used tires. Mounting, balancing, rotation, TPMS sensors, and flat repair. We carry all major brands at fair prices.",
    metaTitle: "Tire Shop Cleveland OH | New & Used Tires | Nick's Tire & Auto",
    metaDescription: "Cleveland's trusted tire shop. New and used tires, mounting, balancing, rotation, TPMS sensors, and flat repair. Fair prices. Call (216) 862-0005.",
    heroHeadline: "CLEVELAND'S TIRE EXPERTS",
    heroSubline: "New tires, used tires, flat repair, TPMS sensors, mounting, and balancing. We carry all major brands at prices that make sense.",
    problems: [
      {
        question: "Tires wearing unevenly?",
        answer: "Uneven tire wear usually points to alignment problems, worn suspension components, or improper inflation. We inspect the tread pattern to determine the root cause. Inner-edge wear often means a camber issue. Outer-edge wear suggests toe misalignment. Center wear means overinflation. We fix the underlying problem so your new tires last as long as they should.",
      },
      {
        question: "TPMS light on?",
        answer: "The Tire Pressure Monitoring System light means at least one tire is significantly under or overinflated, or the sensor itself has failed. We check all four tire pressures, inspect the TPMS sensors, and replace any faulty units. Driving on underinflated tires increases blowout risk and wears tires faster.",
      },
      {
        question: "Need tires but on a budget?",
        answer: "We carry quality used tires with verified tread depth alongside new tires from major brands. Our technicians help you find the right tire for your vehicle and driving conditions at a price that works for your budget. No pressure, no upselling.",
      },
      {
        question: "Vibration at highway speed?",
        answer: "Vibration through the steering wheel at 55-70 mph usually means one or more tires are out of balance. A separated tire belt can also cause this. We spin-balance all four tires and inspect for belt separation or other damage that could cause vibration.",
      },
    ],
    process: [
      { step: "Inspection", detail: "We measure tread depth across all tires, check for uneven wear patterns, sidewall damage, and proper inflation." },
      { step: "Recommendation", detail: "Based on your vehicle, driving habits, and budget, we recommend the right tires. No pressure to buy the most expensive option." },
      { step: "Mounting & Balancing", detail: "Professional mounting on our tire machine with computer spin-balancing to eliminate vibration." },
      { step: "TPMS Reset", detail: "We reset your Tire Pressure Monitoring System sensors so your dashboard reads correctly." },
      { step: "Final Check", detail: "Torque all lug nuts to manufacturer spec and verify tire pressure matches your vehicle's requirements." },
    ],
    whyUs: [
      "New and quality used tires at fair prices",
      "All major brands available",
      "Professional mounting and computer balancing",
      "TPMS sensor replacement and programming",
      "Flat repair and patching",
      "Tire rotation service",
      "No appointment needed for tire pressure checks",
    ],
    keywords: ["tire shop Cleveland", "tires Cleveland OH", "used tires Cleveland", "tire repair Cleveland", "TPMS sensor replacement", "tire balancing Cleveland", "flat tire repair"],
  },
  {
    slug: "brakes",
    num: "02",
    title: "BRAKES",
    shortDesc: "Brake pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem before we fix it. Every time.",
    metaTitle: "Brake Repair Cleveland OH | Pads, Rotors, ABS | Nick's Tire & Auto",
    metaDescription: "Expert brake repair in Cleveland. Brake pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem before we fix it. Call (216) 862-0005.",
    heroHeadline: "BRAKE REPAIR DONE RIGHT",
    heroSubline: "Squealing, grinding, or soft pedal? We diagnose the exact problem, show you the worn parts, and fix it at a fair price. No guesswork.",
    problems: [
      {
        question: "Brakes squealing?",
        answer: "Squealing usually means your brake pads have worn down to the built-in wear indicator — a small metal tab designed to make noise when the pads are thin. This is your warning to replace them before metal contacts the rotor. Replacing pads early costs significantly less than replacing pads and rotors together.",
      },
      {
        question: "Brakes grinding?",
        answer: "Grinding means the brake pad material is completely gone and metal is contacting the rotor directly. This damages the rotor surface and can compromise braking performance. Do not wait — grinding brakes get more expensive every mile you drive. We inspect the full system and replace what is needed.",
      },
      {
        question: "Brake pedal feels soft or spongy?",
        answer: "A soft brake pedal usually indicates air in the brake lines, a brake fluid leak, or a failing master cylinder. This is a safety concern that requires immediate attention. We pressure-test the system, check all brake lines and connections, and bleed the system to restore firm pedal feel.",
      },
      {
        question: "ABS light on?",
        answer: "The ABS warning light means the Anti-lock Braking System has detected a fault. Common causes include a failed wheel speed sensor, damaged tone ring, or ABS module issue. We use diagnostic scanners to read the specific fault code and pinpoint the exact component that needs attention.",
      },
    ],
    process: [
      { step: "Visual Inspection", detail: "We remove the wheels and measure brake pad thickness, rotor condition, and check all hardware." },
      { step: "Show You the Problem", detail: "We show you the worn parts and explain exactly what needs replacement and why." },
      { step: "Repair", detail: "Replace pads, resurface or replace rotors, rebuild calipers, or replace brake lines as needed." },
      { step: "Brake Fluid Service", detail: "Bleed the system to remove air and old fluid, ensuring firm pedal feel and proper function." },
      { step: "Road Test", detail: "Test drive to verify quiet operation, proper stopping distance, and no pulling to one side." },
    ],
    whyUs: [
      "We show you the problem before any work begins",
      "Brake pads, rotors, calipers, and lines",
      "ABS diagnostics and wheel speed sensor replacement",
      "Brake fluid flush and bleeding",
      "No surprise charges — the quote is the price",
      "Experienced technicians who specialize in brake systems",
    ],
    keywords: ["brake repair Cleveland", "brake pads Cleveland", "rotor replacement Cleveland OH", "ABS diagnostics", "brake service Cleveland", "squealing brakes repair"],
  },
  {
    slug: "diagnostics",
    num: "03",
    title: "DIAGNOSTICS",
    shortDesc: "Check engine light, OBD-II code reading, advanced computer diagnostics. We pinpoint the exact cause so you only pay for what you need.",
    metaTitle: "Check Engine Light Repair Cleveland | OBD-II Diagnostics | Nick's Tire & Auto",
    metaDescription: "Check engine light on? Advanced OBD-II diagnostics in Cleveland. We pinpoint the exact cause so you only pay for what you need. Call (216) 862-0005.",
    heroHeadline: "ADVANCED DIAGNOSTICS",
    heroSubline: "Check engine light, warning lights, performance problems. We use advanced OBD-II scanners to find the exact cause — not guess at it.",
    problems: [
      {
        question: "Check engine light on?",
        answer: "The check engine light can be triggered by hundreds of different issues, from a loose gas cap to a failing catalytic converter. Many shops just read the code and replace parts until the light goes off. We use advanced diagnostic scanners to read the code, then perform targeted testing to confirm the actual failed component before recommending any repair.",
      },
      {
        question: "Multiple warning lights on the dashboard?",
        answer: "When several warning lights illuminate at once, it often points to an electrical issue, a failing alternator, or a communication problem between vehicle modules. We perform a full system scan to identify which modules are reporting faults and trace the root cause rather than chasing individual symptoms.",
      },
      {
        question: "Car running rough or misfiring?",
        answer: "Engine misfires can be caused by worn spark plugs, failed ignition coils, fuel injector problems, or vacuum leaks. We use live data from the diagnostic scanner to identify which cylinder is misfiring and test the specific components in that cylinder to find the failed part.",
      },
      {
        question: "Poor fuel economy?",
        answer: "A sudden drop in fuel economy usually means a sensor is sending incorrect data to the engine computer. Common culprits include oxygen sensors, mass airflow sensors, and coolant temperature sensors. We read the live sensor data to identify which reading is out of range.",
      },
    ],
    process: [
      { step: "Code Scan", detail: "Read all diagnostic trouble codes stored in every vehicle module, not just the engine." },
      { step: "Live Data Analysis", detail: "Monitor real-time sensor readings to identify values that are out of normal range." },
      { step: "Component Testing", detail: "Test the specific suspected component to confirm it has actually failed before replacing it." },
      { step: "Root Cause Identification", detail: "Determine why the component failed to prevent the same problem from returning." },
      { step: "Clear & Verify", detail: "After repair, clear codes and verify the fix with a test drive and re-scan." },
    ],
    whyUs: [
      "Advanced OBD-II diagnostic scanners",
      "We test before we replace — no parts guessing",
      "Full system scan, not just engine codes",
      "Live data analysis to catch intermittent problems",
      "Clear explanation of what is wrong and what it costs to fix",
      "Fair diagnostic fees that apply toward the repair",
    ],
    keywords: ["check engine light Cleveland", "OBD-II diagnostics Cleveland", "car diagnostics Cleveland OH", "engine light repair", "auto diagnostics Cleveland", "vehicle computer diagnostics"],
  },
  {
    slug: "emissions",
    num: "04",
    title: "EMISSIONS & E-CHECK",
    shortDesc: "Failed Ohio E-Check? We diagnose and repair emissions problems — oxygen sensors, EVAP leaks, catalytic converters — and get you passing.",
    metaTitle: "Ohio E-Check Repair Cleveland | Emissions Repair | Nick's Tire & Auto",
    metaDescription: "Failed Ohio E-Check? We diagnose and repair emissions problems in Cleveland. Oxygen sensors, EVAP leaks, catalytic converters. Call (216) 862-0005.",
    heroHeadline: "E-CHECK & EMISSIONS REPAIR",
    heroSubline: "Failed your Ohio E-Check? We diagnose the exact emissions problem, repair it, and make sure all monitors complete so you pass inspection.",
    problems: [
      {
        question: "Failed Ohio E-Check?",
        answer: "Ohio E-Check failures are usually caused by a check engine light, incomplete readiness monitors, or high tailpipe emissions. Many shops just clear the code and send you back — which does not work because the monitors need time to reset. We diagnose the actual cause, repair it, and ensure all emissions monitors complete before you return for re-testing.",
      },
      {
        question: "Check engine light causing E-Check failure?",
        answer: "Any illuminated check engine light is an automatic E-Check failure. The most common emissions-related codes involve oxygen sensors, catalytic converter efficiency, EVAP system leaks, and EGR valve problems. We read the specific code and test the failed component to provide an accurate repair estimate.",
      },
      {
        question: "Readiness monitors not complete?",
        answer: "Ohio E-Check requires that your vehicle's emissions monitors show 'ready' status. After a repair or battery disconnect, these monitors need specific driving conditions to reset. We know the exact drive cycles for each vehicle to get monitors to complete as quickly as possible.",
      },
      {
        question: "Catalytic converter problems?",
        answer: "A failing catalytic converter triggers a P0420 or P0430 code and will fail E-Check. Before replacing this expensive component, we verify the converter is actually the problem and not an upstream issue like a misfiring engine that is damaging the converter. Fixing the root cause first can save you hundreds.",
      },
    ],
    process: [
      { step: "E-Check Report Review", detail: "We review your failed E-Check report to understand exactly which tests failed and why." },
      { step: "Diagnostic Scan", detail: "Full OBD-II scan to read emissions-related codes and check readiness monitor status." },
      { step: "Component Testing", detail: "Test the specific emissions components — oxygen sensors, catalytic converter, EVAP system, EGR valve." },
      { step: "Repair", detail: "Fix the root cause of the emissions failure with quality parts." },
      { step: "Drive Cycle & Verify", detail: "Complete the required drive cycle to reset monitors and verify the repair before you return for re-testing." },
    ],
    whyUs: [
      "Specialized in Ohio E-Check failures",
      "We fix the root cause, not just clear codes",
      "Oxygen sensor, EVAP, and catalytic converter expertise",
      "We verify monitors are complete before you re-test",
      "Know the drive cycles for every vehicle make and model",
      "Honest assessment — we tell you if repair cost exceeds vehicle value",
    ],
    keywords: ["Ohio E-Check repair Cleveland", "emissions repair Cleveland", "E-Check failure repair", "catalytic converter Cleveland", "oxygen sensor replacement Cleveland", "EVAP leak repair Cleveland"],
  },
  {
    slug: "oil-change",
    num: "05",
    title: "OIL CHANGE",
    shortDesc: "Conventional and synthetic oil changes with filter replacement. Quick, affordable, done right.",
    metaTitle: "Oil Change Cleveland OH | Synthetic & Conventional | Nick's Tire & Auto",
    metaDescription: "Quick, affordable oil changes in Cleveland. Conventional and full synthetic options with filter replacement. No appointment needed. Call (216) 862-0005.",
    heroHeadline: "OIL CHANGE SERVICE",
    heroSubline: "Conventional and synthetic oil changes with filter replacement. Quick service, fair prices, and we check your vehicle while it is here.",
    problems: [
      {
        question: "When should I change my oil?",
        answer: "Most modern vehicles using synthetic oil can go 5,000 to 7,500 miles between changes. Vehicles using conventional oil should be changed every 3,000 to 5,000 miles. Severe driving conditions — short trips, stop-and-go traffic, extreme temperatures — may require more frequent changes. We check your manufacturer recommendations and driving conditions to give you an honest interval.",
      },
      {
        question: "Conventional or synthetic?",
        answer: "Synthetic oil provides better protection in extreme temperatures, lasts longer between changes, and flows better during cold Cleveland winters. Conventional oil costs less upfront but needs more frequent changes. We recommend what your engine actually needs based on the manufacturer specification, not what makes us the most money.",
      },
      {
        question: "Oil light on the dashboard?",
        answer: "An oil pressure warning light means your engine is not getting adequate lubrication. This is serious — continued driving can cause engine damage. Pull over safely and call us. Low oil level, a failing oil pump, or a clogged oil filter are common causes. We diagnose the issue and get you back on the road safely.",
      },
      {
        question: "Oil looks dark or dirty?",
        answer: "Oil darkens as it collects contaminants from the engine — this is normal and means it is doing its job. However, oil that looks gritty, smells burnt, or has a milky appearance may indicate a problem. We check oil condition during every service and let you know if anything looks concerning.",
      },
    ],
    process: [
      { step: "Drain Old Oil", detail: "We drain the old oil completely and remove the used filter." },
      { step: "New Filter", detail: "Install a quality oil filter matched to your engine specifications." },
      { step: "Fill with Fresh Oil", detail: "Add the correct type and amount of oil per your manufacturer's specification." },
      { step: "Multi-Point Check", detail: "While your vehicle is up, we check tire pressure, fluid levels, belts, and hoses at no extra charge." },
      { step: "Reset Reminder", detail: "Reset your oil life monitor so your dashboard tracks the next change correctly." },
    ],
    whyUs: [
      "Conventional and full synthetic options",
      "Correct oil weight per manufacturer spec",
      "Quality filters, not the cheapest option",
      "Free multi-point inspection with every oil change",
      "Quick service, usually under 30 minutes",
      "No appointment needed for oil changes",
      "Honest recommendation on change intervals",
    ],
    keywords: ["oil change Cleveland", "synthetic oil change Cleveland OH", "oil change near me", "quick oil change Cleveland", "oil change service Cleveland"],
  },
  {
    slug: "general-repair",
    num: "06",
    title: "GENERAL REPAIR",
    shortDesc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more. If it is broken, we fix it.",
    metaTitle: "Auto Repair Cleveland OH | Suspension, Steering, Exhaust | Nick's Tire & Auto",
    metaDescription: "Full-service auto repair in Cleveland. Suspension, steering, exhaust, cooling systems, belts, hoses, and more. Honest work at fair prices. Call (216) 862-0005.",
    heroHeadline: "FULL-SERVICE AUTO REPAIR",
    heroSubline: "Suspension, steering, exhaust, cooling systems, belts, hoses, electrical, and more. If it is broken, we diagnose it and fix it right.",
    problems: [
      {
        question: "Car pulling to one side?",
        answer: "Pulling usually indicates an alignment issue, uneven tire pressure, or a worn suspension component like a tie rod end or ball joint. We check tire pressure first, then inspect the suspension and steering components. If alignment is needed, we identify and replace any worn parts first so the alignment holds.",
      },
      {
        question: "Hearing clunks or rattles?",
        answer: "Clunking over bumps typically points to worn sway bar links, strut mounts, or ball joints. Rattling at idle might be an exhaust heat shield or loose component. We road-test your vehicle to reproduce the noise, then inspect the likely components to find the exact source.",
      },
      {
        question: "Engine overheating?",
        answer: "Overheating can be caused by a coolant leak, failed thermostat, bad water pump, clogged radiator, or a blown head gasket. Do not continue driving an overheating engine — serious damage happens quickly. We pressure-test the cooling system to find leaks and diagnose the root cause.",
      },
      {
        question: "Exhaust louder than normal?",
        answer: "A sudden increase in exhaust noise usually means a hole or crack in the exhaust pipe, a failed gasket, or a deteriorated muffler. Besides being loud, exhaust leaks can allow carbon monoxide into the cabin. We inspect the full exhaust system from the manifold to the tailpipe.",
      },
    ],
    process: [
      { step: "Listen & Inspect", detail: "We listen to your description of the problem, then perform a visual and hands-on inspection." },
      { step: "Diagnose", detail: "Use diagnostic tools, road testing, and component testing to identify the exact failed part." },
      { step: "Explain & Quote", detail: "Show you what we found, explain the repair in plain language, and provide a written estimate." },
      { step: "Repair", detail: "Fix the problem using quality parts. We do not cut corners on components that affect safety." },
      { step: "Verify", detail: "Road test after repair to confirm the problem is resolved and everything operates correctly." },
    ],
    whyUs: [
      "Suspension, steering, and alignment",
      "Exhaust system repair and replacement",
      "Cooling system diagnostics and repair",
      "Belt and hose replacement",
      "Electrical diagnostics",
      "We explain every repair in plain language",
      "Written estimates before any work begins",
    ],
    keywords: ["auto repair Cleveland", "suspension repair Cleveland", "steering repair Cleveland OH", "exhaust repair Cleveland", "cooling system repair", "Cleveland mechanic", "car repair Cleveland"],
  },
];

export function getServiceBySlug(slug: string): ServiceData | undefined {
  return SERVICES.find((s) => s.slug === slug);
}
