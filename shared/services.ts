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
  /** Service-specific CTA text for hero button (e.g., "SCHEDULE BRAKE INSPECTION") */
  heroCTA?: string;
  /** Turnaround time messaging (e.g., "Most brake jobs completed same day") */
  turnaround?: string;
  /** Pricing transparency note (e.g., "Free brake inspection · No diagnostic fee with repair") */
  pricingNote?: string;
  /** Urgency/safety note for critical services */
  urgencyNote?: string;
  /** Warning signs that indicate you need this service */
  signs?: string[];
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
  /** AEO-optimized quick answers for Google AI Overviews and featured snippets */
  quickAnswers?: {
    question: string;
    answer: string;
  }[];
  /** Items included in this service */
  includedItems?: string[];
  /** Pricing tiers for transparency */
  pricingTiers?: { label: string; range: string }[];
  /** Estimated duration range */
  duration?: string;
  /** Starting price anchor for the service page hero */
  startingPrice?: string;

  // ─── PILLAR PAGE FIELDS (for comprehensive service guides) ───
  /** Extended intro paragraph for pillar pages */
  pillarIntro?: string;
  /** Seasonal urgency callout */
  seasonalCTA?: string;
  /** Detailed cost breakdown with descriptions */
  costBreakdown?: {
    service: string;
    range: string;
    description: string;
  }[];
  /** Comprehensive FAQ beyond quickAnswers */
  faq?: {
    question: string;
    answer: string;
  }[];
  /** Internal link callouts to related pages */
  relatedLinks?: {
    href: string;
    label: string;
    description: string;
  }[];
}

export const SERVICES: ServiceData[] = [
  {
    slug: "tires",
    num: "01",
    title: "TIRES",
    shortDesc: "New and used tires. Mounting, balancing, rotation, TPMS sensors, and flat repair. We carry all major brands at fair prices.",
    metaTitle: "Tire Shop Cleveland OH | New & Used Tires | Nick's Tire & Auto",
    metaDescription: "New & used tires from $60 in Cleveland. Same-day mounting & balancing. 4.9★ (1,700+ reviews). Walk-ins welcome. Call (216) 862-0005.",
    heroHeadline: "CLEVELAND'S TIRE EXPERTS",
    heroSubline: "New tires, used tires, flat repair, TPMS sensors, mounting, and balancing. We carry all major brands at prices that make sense.",
    heroCTA: "GET A TIRE QUOTE",
    turnaround: "Most tire installations completed in under an hour. Walk-ins welcome.",
    pricingNote: "Free tire pressure checks · Fair prices on all major brands · Quality used tires available",
    urgencyNote: "Tires below the legal tread limit triple your stopping distance on wet roads. Cleveland's freeze-thaw cycles and potholes accelerate wear — don't wait for a blowout.",
    signs: [
      "Tread depth below 2/32 of an inch (the penny test)",
      "Visible cracks, bulges, or blisters on the sidewall",
      "Vibration through the steering wheel at highway speed",
      "TPMS warning light on your dashboard",
      "Uneven wear across the tread surface",
      "Tires are more than 6 years old regardless of tread depth",
    ],
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
    quickAnswers: [
      {
        question: "How much does it cost to replace tires in Cleveland?",
        answer: "Tire replacement cost in Cleveland ranges from $80 to $250 per tire depending on size, brand, and type. At Nick's Tire & Auto, we carry new and quality used tires to fit every budget. Installation includes mounting, balancing, and a new valve stem. Call (216) 862-0005 for a quote specific to your vehicle."
      },
      {
        question: "How often should I rotate my tires?",
        answer: "Tires should be rotated every 5,000 to 7,500 miles, or approximately every other oil change. Regular rotation ensures even tread wear across all four tires, which extends tire life and maintains safe handling. Cleveland's pothole-heavy roads make rotation especially important to catch uneven wear early."
      },
      {
        question: "Can I drive on a tire with low tread?",
        answer: "Driving on tires with tread depth below 2/32 of an inch is unsafe and illegal in Ohio. Low tread significantly reduces grip in rain and snow, increasing stopping distance by up to 80 percent on wet roads. Use the penny test: insert a penny head-first into the tread. If you can see all of Lincoln's head, the tire needs replacement."
      },
      {
        question: "What causes tires to wear unevenly?",
        answer: "Uneven tire wear is caused by misalignment, worn suspension components, improper tire pressure, or lack of rotation. Inner-edge wear indicates a camber problem. Outer-edge wear suggests toe misalignment. Center wear means overinflation. A qualified technician can diagnose the root cause by reading the wear pattern."
      }
    ],
    includedItems: [
      "Tire mounting on your wheels",
      "Computer spin balancing",
      "New valve stems",
      "TPMS sensor reset",
      "Old tire disposal",
      "Torque to manufacturer spec",
    ],
    pricingTiers: [
      { label: "New tires (each)", range: "$80–$250" },
      { label: "Used tires (each)", range: "$40–$80" },
      { label: "Flat repair", range: "$15–$25" },
      { label: "TPMS sensor", range: "$45–$85" },
    ],
    duration: "30-60 min",
    startingPrice: "See tire prices",

  },
  {
    slug: "brakes",
    num: "02",
    title: "BRAKES",
    shortDesc: "Brake pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem before we fix it. Every time.",
    metaTitle: "Brake Repair Cleveland OH | Pads, Rotors, ABS | Nick's Tire & Auto",
    metaDescription: "Brake repair starting at $89 in Euclid/Cleveland. Pads, rotors, calipers. 36-month warranty on labor. Book online or call (216) 862-0005.",
    heroHeadline: "BRAKE REPAIR DONE RIGHT",
    heroSubline: "Squealing, grinding, or soft pedal? We diagnose the exact problem, show you the worn parts, and fix it at a fair price. No guesswork.",
    heroCTA: "SCHEDULE BRAKE INSPECTION",
    turnaround: "Most brake jobs completed same day. Drop off in the morning, drive home by afternoon.",
    pricingNote: "Free brake inspection · We show you the problem before quoting · No surprise charges",
    urgencyNote: "Grinding brakes get more expensive every mile. Metal-on-metal contact damages rotors and can compromise stopping distance.",
    signs: [
      "High-pitched squealing when you press the brake pedal",
      "Grinding or scraping metal sound during braking",
      "Brake pedal feels soft, spongy, or goes to the floor",
      "Vehicle pulls to one side when braking",
      "ABS warning light illuminated on the dashboard",
      "Steering wheel vibration when braking at highway speed",
    ],
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
    quickAnswers: [
      {
        question: "How much does brake repair cost in Cleveland?",
        answer: "Brake pad replacement in Cleveland typically costs between $150 and $350 per axle. If rotors need resurfacing or replacement, the total can range from $300 to $600 per axle. At Nick's Tire & Auto, we provide a free brake inspection and written estimate before any work begins. Call (216) 862-0005."
      },
      {
        question: "How do I know if my brakes need replacing?",
        answer: "Common signs your brakes need service include squealing or grinding noises when stopping, a pulsating brake pedal, the vehicle pulling to one side during braking, or a longer stopping distance than normal. A dashboard brake warning light is an immediate signal to have your brakes inspected by a qualified technician."
      },
      {
        question: "How long do brake pads last?",
        answer: "Brake pads typically last between 30,000 and 70,000 miles depending on driving habits, vehicle weight, and pad material. City driving with frequent stops wears pads faster than highway driving. Cleveland drivers who navigate stop-and-go traffic daily should have brakes inspected every 15,000 miles."
      },
      {
        question: "Is it safe to drive with squealing brakes?",
        answer: "Squealing brakes are a warning sign that should not be ignored. A high-pitched squeal usually means the brake pad wear indicators are contacting the rotor, indicating the pads are nearly worn through. Continued driving can damage the rotors and calipers, increasing repair cost significantly. Have your brakes inspected as soon as possible."
      }
    ],
    includedItems: [
      "Brake pad replacement (front or rear)",
      "Rotor inspection (resurface or replace if needed)",
      "Brake fluid check",
      "Caliper inspection",
      "Road test after service",
      "Written estimate before any work begins",
    ],
    pricingTiers: [
      { label: "Brake inspection", range: "FREE" },
      { label: "Front brake pads", range: "$149–$299" },
      { label: "Rear brake pads", range: "$149–$299" },
      { label: "Rotor replacement (per axle)", range: "$200–$400" },
      { label: "Full brake job (pads + rotors)", range: "$349–$599" },
    ],
    duration: "1-3 hours",
    startingPrice: "FREE inspection",

  },
  {
    slug: "diagnostics",
    num: "03",
    title: "DIAGNOSTICS",
    shortDesc: "Check engine light, OBD-II code reading, advanced computer diagnostics. We pinpoint the exact cause so you only pay for what you need.",
    metaTitle: "Check Engine Light Repair Cleveland | OBD-II Diagnostics | Nick's Tire & Auto",
    metaDescription: "Check engine light? OBD-II diagnostics in Cleveland. We find the real problem — no guessing. 4.9★ rated. Call (216) 862-0005.",
    heroHeadline: "ADVANCED DIAGNOSTICS",
    heroSubline: "Check engine light, warning lights, performance problems. We use advanced OBD-II scanners to find the exact cause — not guess at it.",
    heroCTA: "SCHEDULE DIAGNOSTICS",
    turnaround: "Most diagnostic scans completed within the hour. Complex issues may require extended testing.",
    pricingNote: "Diagnostic fee applies toward repair · No charge for code reading · Written estimate before any work",
    urgencyNote: "Ignoring a check engine light can turn a $200 sensor repair into a $1,500 catalytic converter replacement. Early diagnosis costs far less than delayed damage.",
    signs: [
      "Check engine light or service engine soon light on",
      "Multiple warning lights illuminated at once",
      "Engine running rough, misfiring, or stalling",
      "Sudden drop in fuel economy",
      "Vehicle hesitating or lacking power during acceleration",
      "Strange smells from the engine bay or exhaust",
    ],
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
    quickAnswers: [
      {
        question: "Why is my check engine light on?",
        answer: "A check engine light indicates your vehicle's onboard computer has detected a problem with the engine, emissions, or drivetrain systems. Common causes include a loose gas cap, failing oxygen sensor, catalytic converter issue, or misfiring spark plugs. An OBD-II diagnostic scan reads the specific trouble code to identify the exact problem."
      },
      {
        question: "How much does a check engine light diagnosis cost in Cleveland?",
        answer: "A basic OBD-II code read is often free at parts stores, but a full diagnostic evaluation at a repair shop typically costs $80 to $150 in Cleveland. At Nick's Tire & Auto, our technicians go beyond reading codes — we use live data analysis to pinpoint the actual failed component so you only pay for the repair you need."
      },
      {
        question: "Can I drive with the check engine light on?",
        answer: "A steady check engine light usually means you can drive to a shop safely, but should have it diagnosed soon. A flashing check engine light indicates a severe misfire that can damage the catalytic converter. If the light is flashing, reduce speed and have the vehicle inspected immediately to prevent expensive secondary damage."
      },
      {
        question: "What is an OBD-II diagnostic scan?",
        answer: "OBD-II stands for On-Board Diagnostics, second generation. It is a standardized system in all vehicles made after 1996 that monitors engine performance and emissions. A diagnostic scan tool connects to the OBD-II port under the dashboard and reads trouble codes stored by the vehicle's computer, helping technicians identify the source of a problem."
      }
    ],
    includedItems: [
      "Full OBD-II system scan",
      "Live sensor data analysis",
      "Component-level testing",
      "Root cause identification",
      "Written diagnostic report",
      "Clear codes and verify after repair",
    ],
    pricingTiers: [
      { label: "Basic code read", range: "FREE" },
      { label: "Full diagnostic evaluation", range: "$59.99" },
      { label: "Diagnostic fee credited toward repair", range: "Yes" },
    ],
    duration: "30-60 min",
    startingPrice: "$59.99 (credited toward repair)",

  },
  {
    slug: "emissions",
    num: "04",
    title: "EMISSIONS & E-CHECK",
    shortDesc: "Failed Ohio E-Check? We diagnose and repair emissions problems — oxygen sensors, EVAP leaks, catalytic converters — and get you passing.",
    metaTitle: "Ohio E-Check Repair Cleveland | Emissions Repair | Nick's Tire & Auto",
    metaDescription: "Failed Ohio E-Check? We diagnose and repair emissions problems in Cleveland. Oxygen sensors, EVAP leaks, catalytic converters. Call (216) 862-0005.",
    heroHeadline: "OHIO E-CHECK & EMISSIONS EXPERTS",
    heroSubline: "Failed your Ohio E-Check? We diagnose the exact emissions problem, repair it, and make sure all monitors complete so you pass inspection.",
    heroCTA: "SCHEDULE E-CHECK REPAIR",
    turnaround: "Most emissions repairs completed in 1–2 days. Drive cycle verification included.",
    pricingNote: "Free E-Check report review · Honest assessment if repair cost exceeds vehicle value",
    urgencyNote: "Ohio requires a passing E-Check for vehicle registration renewal. Driving with a failed E-Check can result in registration issues.",
    signs: [
      "Failed Ohio E-Check inspection report",
      "Check engine light on with emissions-related code",
      "Readiness monitors showing \"not ready\" status",
      "Strong exhaust smell or visible smoke from tailpipe",
      "Reduced fuel economy beyond normal variation",
      "Vehicle registration renewal approaching with pending E-Check",
    ],
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
    quickAnswers: [
      {
        question: "Why did my car fail the Ohio E-Check?",
        answer: "The most common reasons for Ohio E-Check failure are a faulty oxygen sensor, an EVAP system leak, a failing catalytic converter, or incomplete readiness monitors. The E-Check tests your vehicle's emissions control systems through an OBD-II scan. If any emissions monitor shows 'not ready' or a trouble code is stored, the vehicle will fail."
      },
      {
        question: "How much does it cost to fix an E-Check failure in Cleveland?",
        answer: "E-Check repair costs in Cleveland range from $100 for a simple sensor replacement to $1,500 or more for catalytic converter replacement. The most common repairs — oxygen sensors and EVAP leaks — typically cost between $150 and $400. A proper diagnosis identifies the exact cause so you avoid replacing parts unnecessarily."
      },
      {
        question: "How long does it take to fix an emissions problem?",
        answer: "Most emissions repairs take one to three hours once the problem is diagnosed. However, after the repair is complete, the vehicle must complete a drive cycle for the emissions monitors to reset. This can take 50 to 100 miles of mixed driving. Our technicians know the exact drive cycle procedures for each vehicle to get monitors ready as quickly as possible."
      },
      {
        question: "What Ohio counties require E-Check testing?",
        answer: "Ohio E-Check emissions testing is required in seven Northeast Ohio counties: Cuyahoga, Geauga, Lake, Lorain, Medina, Portage, and Summit. Vehicles model year 1996 and newer that are registered in these counties must pass the E-Check every two years. The test is an OBD-II scan that checks for emissions-related trouble codes and monitor readiness."
      }
    ],
    includedItems: [
      "E-Check report review",
      "Full emissions diagnostic scan",
      "Oxygen sensor testing",
      "EVAP system inspection",
      "Catalytic converter evaluation",
      "Drive cycle completion and monitor verification",
    ],
    pricingTiers: [
      { label: "E-Check test", range: "$24.99" },
      { label: "Oxygen sensor replacement", range: "$150–$350" },
      { label: "EVAP leak repair", range: "$150–$400" },
      { label: "Catalytic converter", range: "$800–$1,500" },
    ],
    duration: "20-40 min (test) / 1-2 days (repair)",
    startingPrice: "From $24.99",

  },
  {
    slug: "oil-change",
    num: "05",
    title: "OIL CHANGE",
    shortDesc: "Conventional and synthetic oil changes with filter replacement. Quick, affordable, done right.",
    metaTitle: "Oil Change Cleveland OH | Synthetic & Conventional | Nick's Tire & Auto",
    metaDescription: "Quick oil changes in Euclid/Cleveland. Conventional from $39, synthetic from $69. No appointment needed. (216) 862-0005.",
    heroHeadline: "OIL CHANGE SERVICE",
    heroSubline: "Conventional and synthetic oil changes with filter replacement. Quick service, fair prices, and we check your vehicle while it is here.",
    heroCTA: "SCHEDULE OIL CHANGE",
    turnaround: "Most oil changes done in under 30 minutes. No appointment needed.",
    pricingNote: "Free multi-point inspection with every oil change · Correct oil weight per manufacturer spec",
    signs: [
      "Oil change reminder light or maintenance required indicator",
      "Oil looks dark, gritty, or smells burnt on the dipstick",
      "Engine running louder than normal",
      "Over 5,000 miles since last synthetic oil change",
      "Over 3,000 miles since last conventional oil change",
      "Oil level low on the dipstick between changes",
    ],
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
    quickAnswers: [
      {
        question: "How often should I change my oil?",
        answer: "Most modern vehicles with synthetic oil should have an oil change every 5,000 to 7,500 miles or every six months, whichever comes first. Vehicles using conventional oil should change every 3,000 to 5,000 miles. Check your owner's manual for the manufacturer's recommendation. Cleveland's cold winters and stop-and-go traffic can accelerate oil degradation."
      },
      {
        question: "How much does an oil change cost in Cleveland?",
        answer: "A conventional oil change in Cleveland typically costs between $30 and $50. A full synthetic oil change ranges from $60 to $90 depending on the vehicle and oil capacity. At Nick's Tire & Auto, every oil change includes a new filter and a free multi-point vehicle inspection. Call (216) 862-0005."
      },
      {
        question: "What is the difference between synthetic and conventional oil?",
        answer: "Synthetic oil is chemically engineered to provide better protection at extreme temperatures, resist breakdown longer, and flow more easily in cold weather. Conventional oil is refined from crude petroleum and costs less but requires more frequent changes. Most manufacturers now recommend synthetic or synthetic blend oil for optimal engine protection."
      },
      {
        question: "What happens if I skip an oil change?",
        answer: "Skipping oil changes allows old oil to break down and form sludge inside the engine. Sludge restricts oil flow, increases friction, and causes accelerated wear on internal components. Over time, this can lead to overheating, reduced fuel economy, and eventually catastrophic engine failure. Regular oil changes are the single most important maintenance for engine longevity."
      }
    ],
    includedItems: [
      "Drain old oil completely",
      "Quality oil filter replacement",
      "Fill with correct weight oil",
      "Multi-point vehicle inspection",
      "Fluid level check",
      "Oil life monitor reset",
    ],
    pricingTiers: [
      { label: "Conventional oil change", range: "$39.99" },
      { label: "Synthetic blend", range: "$54.99" },
      { label: "Full synthetic", range: "$69.99–$89.99" },
    ],
    duration: "15-30 min",
    startingPrice: "From $39.99",

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
    heroCTA: "DESCRIBE YOUR PROBLEM",
    turnaround: "Most repairs completed same day or next day. We call you with updates.",
    pricingNote: "Free estimates · Written quote before any work begins · No hidden fees",
    signs: [
      "Clunking, rattling, or knocking sounds over bumps",
      "Vehicle pulling to one side while driving or braking",
      "Exhaust louder than normal or visible smoke",
      "Engine temperature gauge reading higher than usual",
      "Fluid leaks under the vehicle (coolant, oil, transmission)",
      "Steering feels loose, wanders, or vibrates",
    ],
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
    quickAnswers: [
      {
        question: "How do I find a trustworthy mechanic in Cleveland?",
        answer: "Look for a shop with a high volume of verified Google reviews, transparent pricing, and technicians who explain repairs before performing them. Nick's Tire & Auto has over 1,700 Google reviews at 4.9 stars. We provide written estimates, show you the problem before we fix it, and never pressure you into unnecessary repairs."
      },
      {
        question: "What are signs my car needs suspension repair?",
        answer: "Common signs of suspension problems include a rough or bouncy ride, the vehicle pulling to one side, uneven tire wear, nose-diving when braking, or clunking noises over bumps. Cleveland's pothole-heavy roads are particularly hard on suspension components. Have your suspension inspected if you notice any of these symptoms."
      },
      {
        question: "How much does auto repair cost in Cleveland?",
        answer: "Auto repair costs in Cleveland vary widely by service. Oil changes run $30 to $90, brake jobs $150 to $600 per axle, and suspension work $200 to $1,500 depending on the component. At Nick's Tire & Auto, we provide a written estimate before any work begins so there are no surprises on the bill."
      },
      {
        question: "Why is my car making a strange noise?",
        answer: "Strange vehicle noises indicate specific problems. Squealing from the front usually means worn brake pads or a loose belt. Grinding suggests metal-on-metal contact in brakes or transmission. Clunking over bumps points to worn suspension components. Humming at highway speed often indicates a wheel bearing issue. A diagnostic inspection can identify the exact source."
      }
    ],
    includedItems: [
      "Visual and hands-on inspection",
      "Diagnostic testing as needed",
      "Written estimate before work",
      "Quality replacement parts",
      "Post-repair road test",
      "Repair warranty included",
    ],
    pricingTiers: [
      { label: "Diagnostic inspection", range: "FREE with repair" },
      { label: "Repair costs", range: "Varies by service" },
    ],
    duration: "Varies — we'll call with estimate",
    startingPrice: "FREE estimates",

  },
  // ─── PHASE 2: NEW SERVICE PAGES ─────────────────────────
  {
    slug: "ac-repair",
    num: "07",
    title: "AC & HEATING",
    shortDesc: "AC recharge, compressor, condenser, evaporator, heater core, and blower motor repair. Stay comfortable year-round.",
    metaTitle: "AC Repair Cleveland OH | Complete Auto AC Guide | Nick's Tire & Auto",
    metaDescription: "Complete guide to auto AC repair in Cleveland. Costs, common problems, symptoms, and expert diagnosis. Recharge from $149. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "CLEVELAND'S COMPLETE GUIDE TO AUTO AC REPAIR",
    heroSubline: "Everything you need to know about your car's air conditioning system — common problems, repair costs, and when to get service. From the technicians Cleveland drivers trust.",
    heroCTA: "FIX MY AC",
    turnaround: "Most AC repairs completed same day. Recharges done in 30-60 minutes.",
    pricingNote: "AC inspection with repair · No charge for leak check with service",
    urgencyNote: "Don't wait until July — Cleveland summers are brutal. AC systems that sit all winter often develop leaks from dried-out seals. Get your AC checked in spring before the first heat wave hits and every shop in town is backed up.",
    signs: [
      "AC blowing warm or hot air",
      "Weak airflow from vents",
      "Strange smell when AC is on (musty or sweet)",
      "AC cycles on and off rapidly",
      "AC works sometimes but not consistently",
      "Hissing or bubbling sounds from the dash area",
      "Heater not producing warm air",
      "Foggy windshield that won't clear",
      "Water dripping inside the car on the passenger side",
      "AC compressor making a loud clunk when engaging",
    ],
    problems: [
      {
        question: "AC blows warm air?",
        answer: "This is the number one AC complaint we hear. The most common cause is low refrigerant from a slow leak — often from deteriorated O-rings, a pinhole in the condenser, or a leaking evaporator core. We perform a comprehensive leak test using UV dye injection and an electronic refrigerant sniffer. If the system is simply low, a recharge brings it back to cold. But if there is a leak — and there usually is if your system lost refrigerant — we locate and repair the source before recharging. Other causes include compressor failure (the pump that pressurizes refrigerant), a blocked condenser (the radiator-like component in front of your car), or a failed expansion valve. We test each component systematically so you only pay for what is actually broken.",
      },
      {
        question: "AC works intermittently — cold sometimes, warm others?",
        answer: "Intermittent AC is one of the trickier problems because it works fine when you bring it to the shop. Common causes include a cycling compressor clutch (the electromagnetic clutch engages and disengages the compressor — when it starts to fail, it cuts in and out), an electrical issue like a bad relay or pressure switch, or a failing blend door actuator. The blend door controls whether air flows through the heater core or evaporator. When the actuator motor fails, the door can get stuck in a halfway position, mixing hot and cold air unpredictably. We test the compressor clutch engagement, check the electrical circuits, and verify blend door operation to find the intermittent cause.",
      },
      {
        question: "Strange noise when AC is on?",
        answer: "Noises that only happen when the AC is running point to specific components. A squealing or screeching sound usually means the serpentine belt is slipping — the AC compressor adds load to the belt, and a worn or loose belt cannot handle it. A grinding or growling noise indicates a failing compressor bearing — the internal bearings are wearing out and the compressor needs replacement before it seizes and sends metal debris through your entire AC system. A rattling sound can be debris caught in the blower fan or a loose condenser mounting bracket. We identify the noise source and fix it before it causes collateral damage.",
      },
      {
        question: "Musty smell from the vents?",
        answer: "That musty, gym-locker smell coming from your vents is mold and bacteria growing on the evaporator core. The evaporator sits behind your dashboard and gets wet every time the AC runs — condensation forms on its cold surface. Normally this moisture drains out through a tube under the car. But if the drain gets clogged or the evaporator stays damp, mold colonizes the surface and every time you turn on the fan, you breathe it in. The first fix is replacing the cabin air filter — a dirty filter traps moisture and feeds mold. If that does not solve it, we treat the evaporator with an antimicrobial spray and clear the condensate drain. Regular cabin filter changes prevent this from coming back.",
      },
      {
        question: "AC doesn't turn on at all?",
        answer: "When you press the AC button and nothing happens — no click from the compressor, no change in engine sound — the issue is usually electrical. We start with the simple stuff: a blown AC fuse or a failed AC relay. These are cheap fixes. If the fuse and relay are good, we check the AC pressure switch (the system will not engage the compressor if refrigerant is too low or too high — a safety feature). Next we test the compressor clutch coil itself and verify power and ground signals. On newer vehicles, the AC system is controlled by the body control module, so we also check for diagnostic codes that might disable the system.",
      },
      {
        question: "Weak airflow from vents?",
        answer: "Weak airflow usually points to a clogged cabin air filter, a failing blower motor, or a stuck blend door actuator. We start with the cabin filter since it is cheap and common — a severely clogged filter can reduce airflow by 50% or more. Then we test the blower motor and check the actuators if the filter is not the issue. A blower motor resistor failure can also cause the fan to only work on certain speeds.",
      },
    ],
    process: [
      { step: "Test & Inspect", detail: "Check refrigerant pressure on both high and low sides, test compressor engagement, measure vent temperatures at every vent, inspect belts, hoses, and all visible AC components." },
      { step: "Leak Detection", detail: "UV dye injection and electronic refrigerant sniffer to find any leaks in the system. We check the compressor shaft seal, condenser, evaporator, hose connections, and service ports." },
      { step: "Diagnose", detail: "Identify the exact failed component — compressor, condenser, evaporator, expansion valve, blend door actuator, or blower motor. We explain what failed and why." },
      { step: "Written Estimate", detail: "You get a written estimate with the exact cost before we touch anything. No surprises." },
      { step: "Repair & Recharge", detail: "Replace the failed part, evacuate the system, pull a vacuum to remove moisture, recharge with the exact manufacturer-specified refrigerant amount, and verify cold air output at every vent." },
    ],
    whyUs: [
      "Full AC system diagnostics — not just a recharge and hope for the best",
      "Compressor, condenser, evaporator, and expansion valve replacement",
      "AC recharge with proper leak detection first",
      "Heater core and blower motor service",
      "Cabin air filter replacement and evaporator cleaning",
      "Climate control and blend door actuator diagnostics",
      "Written estimates before any work — no surprises",
      "Same-day service for most AC repairs",
    ],
    keywords: ["AC repair Cleveland", "auto AC recharge Cleveland", "car heater repair", "AC not blowing cold Cleveland", "auto climate control repair", "car AC cost Cleveland", "AC compressor replacement Cleveland", "auto AC leak repair"],
    quickAnswers: [
      { question: "How much does car AC repair cost in Cleveland?", answer: "AC repair costs in Cleveland depend on the problem. A refrigerant recharge runs $149 to $199. Compressor replacement costs $499 to $899. Condenser replacement is $399 to $699. Evaporator replacement ranges from $599 to $999. AC hose repair runs $149 to $299. At Nick's Tire & Auto we diagnose the issue first and give you a written estimate before any work begins." },
      { question: "Why is my car AC blowing warm air?", answer: "The most common reason is low refrigerant from a leak. Other causes include a failed compressor, clogged condenser, bad expansion valve, or electrical issue. A proper diagnosis requires checking refrigerant pressure on both high and low sides and testing each component in the system. Do not just add refrigerant — find out why it is low first." },
    ],
    includedItems: ["AC system pressure test (high and low side)", "Vent temperature measurement at every vent", "UV dye leak detection", "Electronic refrigerant sniffer test", "Written estimate before work", "Refrigerant recharge included with repair", "Post-repair verification of cold air output"],
    pricingTiers: [
      { label: "Refrigerant recharge", range: "$149–$199" },
      { label: "Compressor replacement", range: "$499–$899" },
      { label: "Condenser replacement", range: "$399–$699" },
      { label: "Evaporator replacement", range: "$599–$999" },
      { label: "AC hose repair", range: "$149–$299" },
    ],
    duration: "Recharge: 30-60 min. Component repair: 2-4 hours. Evaporator: 4-8 hours.",
    startingPrice: "From $149",

    // ─── PILLAR PAGE CONTENT ───────────────────────────────
    pillarIntro: "Your car's air conditioning system is more complex than most drivers realize. It is a sealed loop of high-pressure refrigerant that cycles between liquid and gas states to absorb heat from your cabin and release it outside. The system includes a compressor (the pump), a condenser (releases heat outside), an evaporator (absorbs heat inside the cabin), an expansion valve (controls refrigerant flow), and a network of hoses, O-rings, and sensors. When any one of these components fails, the whole system stops working. Cleveland's climate is especially hard on AC systems — freezing winters cause O-ring seals to dry out and crack, and humid summers push the system to its limits. This guide covers every common AC problem, what causes it, what it costs to fix, and how to tell if your shop is giving you an honest diagnosis.",

    seasonalCTA: "Don't wait until July — Cleveland summers are brutal. The first 90-degree day, every AC shop in Northeast Ohio is booked solid. Get your system checked in spring while we can get you in same-day. AC seals dry out over winter and small leaks become big problems once you start using the system daily.",

    costBreakdown: [
      {
        service: "Refrigerant Recharge",
        range: "$149–$199",
        description: "Includes leak test, system evacuation, and recharge with R-134a or R-1234yf refrigerant to manufacturer spec. If we find a leak, we quote the repair separately. A recharge without a leak test is a waste of money — the refrigerant will just leak out again.",
      },
      {
        service: "Compressor Replacement",
        range: "$499–$899",
        description: "The compressor is the heart of the AC system. Replacement includes the compressor, new refrigerant oil, system flush to remove debris, new receiver/drier, evacuation, and recharge. Price varies by vehicle — some compressors are easy to access, others require removing other components.",
      },
      {
        service: "Condenser Replacement",
        range: "$399–$699",
        description: "The condenser sits in front of your radiator and is vulnerable to road debris. Replacement includes the new condenser, receiver/drier, evacuation, and recharge. Rock damage and corrosion from Cleveland road salt are the most common causes of condenser leaks.",
      },
      {
        service: "Evaporator Replacement",
        range: "$599–$999",
        description: "The evaporator is buried behind your dashboard, making it the most labor-intensive AC repair. The dashboard often needs to come apart to access it. The wide price range reflects the huge variation in labor between vehicles. We quote your specific vehicle before starting.",
      },
      {
        service: "AC Hose Repair",
        range: "$149–$299",
        description: "AC hoses carry refrigerant between components. They develop leaks at crimped fittings and where they flex near the compressor. Hose replacement includes new O-rings, evacuation, and recharge.",
      },
    ],

    faq: [
      {
        question: "How often should I service my car's AC system?",
        answer: "Unlike oil changes, AC systems do not need regular scheduled service. A properly sealed AC system can go the entire life of the vehicle without needing refrigerant. If your AC is blowing cold, leave it alone. If it starts blowing warm, that means refrigerant has leaked out and you need a diagnosis — not just a top-off. The one maintenance item is your cabin air filter, which should be replaced every 15,000 to 20,000 miles or once a year.",
      },
      {
        question: "Is it worth repairing AC on an older car?",
        answer: "It depends on the repair. A $149 recharge on a car worth $3,000 makes sense. A $900 evaporator replacement on that same car might not. We give you an honest assessment based on the repair cost versus the value of your vehicle. We will never push an expensive repair on a car that is not worth it.",
      },
      {
        question: "Can I just add refrigerant myself with a can from the auto parts store?",
        answer: "Those DIY recharge kits can actually cause more harm than good. They do not measure how much refrigerant is already in the system, so you can easily overcharge it — which damages the compressor. They also contain stop-leak sealant that can clog your expansion valve and contaminate the system. If your AC is low on refrigerant, there is a leak, and adding more just delays the real repair while the leak gets worse.",
      },
      {
        question: "Why does my AC smell bad when I first turn it on?",
        answer: "That musty smell is mold growing on the evaporator core. The evaporator gets wet from condensation every time the AC runs. If moisture does not drain properly or the cabin air filter is dirty, mold and bacteria thrive. Replace your cabin air filter and we can treat the evaporator with an antimicrobial spray. Running the fan on high without AC for the last few minutes of your drive helps dry the evaporator and prevents mold growth.",
      },
      {
        question: "What is the difference between R-134a and R-1234yf refrigerant?",
        answer: "R-134a has been the standard automotive refrigerant for decades. Starting around 2015, manufacturers began switching to R-1234yf because it has a much lower environmental impact. The two are not interchangeable — your vehicle uses one or the other. R-1234yf is more expensive per pound, which is one reason newer vehicle AC repairs cost a bit more. We stock both and use whatever your vehicle requires.",
      },
      {
        question: "How long does an AC repair take?",
        answer: "A refrigerant recharge takes 30 to 60 minutes. Compressor, condenser, or hose replacement is typically 2 to 4 hours. Evaporator replacement is the longest at 4 to 8 hours because of dashboard removal. We complete most AC repairs same-day. For evaporator jobs, we may need your vehicle overnight.",
      },
      {
        question: "My AC works fine on the highway but blows warm in stop-and-go traffic. Why?",
        answer: "At highway speed, air flows through the condenser and helps cool the refrigerant. In stop-and-go traffic, the condenser fan is supposed to do that job. If the condenser fan motor has failed, the fan relay is bad, or the condenser is partially blocked with debris, the system cannot shed heat at low speeds. We check condenser fan operation, clean debris from the condenser, and test the fan circuit.",
      },
    ],

    relatedLinks: [
      {
        href: "/car-ac-not-blowing-cold",
        label: "Car AC Not Blowing Cold Air?",
        description: "Detailed symptom guide covering every reason your AC might not be cooling — from low refrigerant to compressor failure. Includes diagnostic steps you can check yourself before bringing it in.",
      },
      {
        href: "/diagnostics",
        label: "Diagnostic Services",
        description: "Our full diagnostic process for all vehicle systems, including AC. We use advanced scan tools and live data to pinpoint problems accurately.",
      },
    ],
  },
  {
    slug: "transmission",
    num: "08",
    title: "TRANSMISSION",
    shortDesc: "Transmission fluid service, diagnostics, repair, and rebuilds. We handle both automatic and manual transmissions.",
    metaTitle: "Transmission Repair Cleveland OH | Nick's Tire & Auto",
    metaDescription: "Transmission repair and service in Cleveland. Fluid changes, diagnostics, solenoid repair, rebuilds. Automatic and manual. Honest diagnosis. (216) 862-0005.",
    heroHeadline: "TRANSMISSION SERVICE & REPAIR",
    heroSubline: "Transmission problems get expensive fast if ignored. Our technicians diagnose transmission issues accurately and give you honest repair options — from a simple fluid service to a full rebuild.",
    heroCTA: "DIAGNOSE MY TRANSMISSION",
    turnaround: "Fluid service same day. Repairs 1-3 days. Rebuilds quoted individually.",
    pricingNote: "Free diagnostic scan · Written estimate before any work",
    urgencyNote: "Driving with a slipping transmission causes further damage. Get it checked early to save thousands.",
    signs: [
      "Transmission slipping between gears",
      "Hard or delayed shifts",
      "Grinding or shaking during gear changes",
      "Transmission warning light on dashboard",
      "Burning smell from under the vehicle",
      "Fluid leak (red or brown) under the car",
    ],
    problems: [
      { question: "Transmission slipping?", answer: "Slipping means the transmission momentarily loses power between gear changes. Common causes include low fluid, worn clutch packs, or a failing torque converter. We start with a fluid level and condition check, then scan for transmission codes. Early intervention can often prevent a full rebuild." },
      { question: "Hard or delayed shifting?", answer: "Hard shifts can indicate low or dirty transmission fluid, a failing shift solenoid, or internal wear. We check fluid condition first — dark or burnt-smelling fluid often means internal damage. A fluid and filter change fixes many shift quality issues when caught early." },
      { question: "Transmission fluid leak?", answer: "Transmission fluid is typically red or dark brown. Leaks commonly come from the pan gasket, cooler lines, axle seals, or the front pump seal. We identify the leak source, repair it, and top off the fluid to the correct level." },
      { question: "Check engine light with transmission codes?", answer: "Modern transmissions are computer-controlled. A check engine light with transmission-related codes (P0700, P0730, P0750 series) tells us exactly where to look. We read and interpret the codes, then test the specific components — solenoids, sensors, wiring, or internal parts." },
    ],
    process: [
      { step: "Scan & Test", detail: "Read transmission codes, check fluid level and condition, road test for shift quality." },
      { step: "Diagnose", detail: "Test solenoids, pressure, and converter operation. Identify the specific failed component." },
      { step: "Recommend", detail: "Explain findings and provide options — fluid service, component repair, or rebuild with written estimate." },
      { step: "Repair", detail: "Perform the agreed repair. Verify proper operation with road test." },
    ],
    whyUs: [
      "Automatic and manual transmission service",
      "Transmission fluid exchange and filter replacement",
      "Solenoid and sensor diagnostics",
      "Torque converter evaluation",
      "Honest rebuild vs. repair assessment",
      "Written estimates before any work",
    ],
    keywords: ["transmission repair Cleveland", "transmission service Cleveland OH", "transmission slipping fix", "transmission fluid change Cleveland"],
    quickAnswers: [
      { question: "How much does transmission repair cost in Cleveland?", answer: "Transmission repair costs range widely. Fluid service runs $150 to $300. Solenoid replacement costs $200 to $600. A full transmission rebuild ranges from $1,500 to $3,500 depending on the vehicle. Nick's Tire & Auto provides a written estimate after diagnosis so you know the exact cost." },
      { question: "How do I know if my transmission is going bad?", answer: "Warning signs include slipping between gears, delayed or hard shifting, grinding or shaking during shifts, a burning smell, transmission fluid leaks (red fluid), or a dashboard warning light. Early diagnosis is critical — small transmission issues become expensive rebuilds quickly." },
    ],
    includedItems: ["Computer code scan", "Fluid level and condition check", "Road test", "Written estimate", "Post-repair verification"],
    pricingTiers: [
      { label: "Fluid service", range: "$150–$300" },
      { label: "Solenoid/sensor repair", range: "$200–$600" },
      { label: "Full rebuild", range: "$1,500–$3,500" },
    ],
    duration: "Fluid service: 1 hour. Repairs: 1-3 days.",
    startingPrice: "From $150",
  },
  {
    slug: "electrical",
    num: "09",
    title: "ELECTRICAL",
    shortDesc: "Battery, alternator, starter, wiring, fuses, power windows, and complete electrical diagnostics.",
    metaTitle: "Auto Electrical Repair Cleveland OH | Nick's Tire & Auto",
    metaDescription: "Auto electrical repair in Cleveland. Battery, alternator, starter, wiring, power windows, fuses. Expert diagnostics. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "ELECTRICAL DIAGNOSTICS & REPAIR",
    heroSubline: "Modern vehicles have thousands of circuits. When electrical problems strike, our technicians use advanced diagnostic tools to trace the issue to the exact component — no guesswork.",
    heroCTA: "DIAGNOSE ELECTRICAL ISSUE",
    turnaround: "Battery and alternator: same day. Wiring issues: 1-2 days.",
    pricingNote: "Free battery test · Charging system check included",
    signs: [
      "Car won't start or slow cranking",
      "Battery keeps dying overnight",
      "Dimming headlights or interior lights",
      "Dashboard warning lights flickering",
      "Power windows, locks, or seats not working",
      "Burning smell from wiring",
    ],
    problems: [
      { question: "Car won't start?", answer: "A no-start condition can be the battery, starter motor, ignition switch, or a wiring issue. We test the battery and charging system first. If the battery is good, we test starter draw and ignition circuits to find the exact cause." },
      { question: "Battery keeps dying?", answer: "A battery that dies overnight typically has a parasitic drain — something is drawing power when the car is off. We perform a current draw test to measure the drain, then systematically isolate circuits to find the component causing it. Common culprits include aftermarket stereos, faulty door switches, and trunk lights." },
      { question: "Alternator failing?", answer: "Signs of alternator failure include dimming lights, a dead battery, a whining noise from the engine, and a battery or charging system warning light. We load-test the alternator to measure its output. A failing alternator will eventually leave you stranded." },
      { question: "Electrical gremlins?", answer: "Intermittent electrical problems like flickering lights, random warning lights, or components that work sometimes are often caused by corroded grounds, loose connections, or damaged wiring. Cleveland road salt accelerates corrosion. We trace circuits with a multimeter and wiring diagrams to find the fault." },
    ],
    process: [
      { step: "Test", detail: "Battery load test, alternator output test, starter draw test, charging system check." },
      { step: "Diagnose", detail: "Use wiring diagrams and diagnostic tools to trace the electrical fault to the specific component." },
      { step: "Quote", detail: "Explain the problem and provide a written estimate for the repair." },
      { step: "Repair", detail: "Replace the failed component, repair wiring, verify all electrical systems operate correctly." },
    ],
    whyUs: [
      "Battery testing and replacement",
      "Alternator and starter service",
      "Parasitic drain diagnosis",
      "Wiring repair and connector service",
      "Power window and lock repair",
      "Advanced circuit diagnostics",
    ],
    keywords: ["auto electrical repair Cleveland", "car battery replacement Cleveland", "alternator repair Cleveland OH", "car won't start Cleveland", "electrical diagnostics Cleveland"],
    quickAnswers: [
      { question: "How much does it cost to replace a car battery in Cleveland?", answer: "A car battery replacement at Nick's Tire & Auto costs $120 to $250 depending on the battery size and type. We include a free charging system test with every battery replacement to make sure the alternator is charging properly." },
      { question: "Why does my car battery keep dying?", answer: "Repeated battery failure is usually caused by a parasitic electrical drain, a failing alternator that isn't charging properly, or the battery itself being worn out. A parasitic drain test measures how much current flows when the car is off and identifies which circuit is drawing power." },
    ],
    includedItems: ["Free battery test", "Charging system check", "Written estimate", "Post-repair verification"],
    pricingTiers: [
      { label: "Battery replacement", range: "$120–$250" },
      { label: "Alternator replacement", range: "$350–$700" },
      { label: "Starter replacement", range: "$250–$500" },
    ],
    duration: "Battery/alternator: 1-2 hours. Wiring: varies.",
    startingPrice: "FREE battery test",
  },
  {
    slug: "battery",
    num: "10",
    title: "BATTERY SERVICE",
    shortDesc: "Battery testing, replacement, terminal cleaning, and charging system diagnostics. Don't get stranded.",
    metaTitle: "Battery Testing & Replacement Cleveland | Nick's Tire & Auto",
    metaDescription: "Car battery testing and replacement in Cleveland. Free battery test. Charging system check. All makes and models. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "BATTERY TESTING & REPLACEMENT",
    heroSubline: "Cleveland winters kill batteries. Don't wait until you're stranded. We test your battery for free and replace it on the spot if needed.",
    heroCTA: "TEST MY BATTERY FREE",
    turnaround: "Battery replacement done in 15–30 minutes. Walk in anytime.",
    pricingNote: "FREE battery test · No appointment needed",
    signs: [
      "Slow cranking when starting",
      "Clicking sound when turning the key",
      "Battery warning light on dashboard",
      "Headlights dimmer than usual",
      "Battery more than 3 years old",
      "Needed a jump start recently",
    ],
    problems: [
      { question: "How long do car batteries last?", answer: "Most car batteries last 3 to 5 years. Cleveland's extreme temperatures — freezing winters and hot summers — shorten battery life. If your battery is over 3 years old, get it tested before winter. We test batteries for free and can tell you exactly how much life is left." },
      { question: "Car clicking but won't start?", answer: "A rapid clicking sound means the battery has enough voltage to engage the starter solenoid but not enough power to turn the engine. This is usually a dead or weak battery. We test it on the spot and can replace it immediately." },
      { question: "Do I need a battery or alternator?", answer: "A dead battery can be caused by the battery itself being bad OR by an alternator that isn't charging. We test both — the battery under load and the alternator output — to determine which one actually failed. Replacing the wrong one wastes your money." },
    ],
    process: [
      { step: "Free Test", detail: "Load test your battery and measure cold cranking amps vs. the manufacturer spec." },
      { step: "Check System", detail: "Test alternator output and charging voltage to make sure the charging system is healthy." },
      { step: "Replace", detail: "If needed, install the correct battery for your vehicle. Clean terminals and apply anti-corrosion treatment." },
      { step: "Verify", detail: "Confirm the new battery holds charge and the charging system is working properly." },
    ],
    whyUs: [
      "Free battery testing — walk in anytime",
      "Correct battery for your vehicle in stock",
      "Terminal cleaning and anti-corrosion treatment",
      "Charging system verification included",
      "Battery recycling handled for you",
      "Most replacements done in 30 minutes",
    ],
    keywords: ["car battery Cleveland", "battery replacement Cleveland OH", "battery test near me", "dead battery Cleveland", "car battery service"],
    includedItems: ["Free load test", "Charging system check", "Terminal cleaning", "Anti-corrosion treatment", "Old battery recycling"],
    pricingTiers: [
      { label: "Battery test", range: "FREE" },
      { label: "Battery replacement", range: "$120–$250" },
    ],
    duration: "15–30 minutes",
    startingPrice: "FREE test",
  },
  {
    slug: "exhaust",
    num: "11",
    title: "EXHAUST & MUFFLER",
    shortDesc: "Muffler, catalytic converter, exhaust pipe, manifold, and resonator repair. Quiet your ride and pass emissions.",
    metaTitle: "Exhaust & Muffler Repair Cleveland OH | Nick's Tire & Auto",
    metaDescription: "Exhaust and muffler repair in Cleveland. Catalytic converter, exhaust pipe, manifold, resonator. Pass Ohio E-Check. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "EXHAUST & MUFFLER REPAIR",
    heroSubline: "Loud exhaust, failed emissions, or a check engine light for a catalytic converter — we handle the entire exhaust system from manifold to tailpipe.",
    heroCTA: "FIX MY EXHAUST",
    turnaround: "Most exhaust repairs completed same day.",
    pricingNote: "Free exhaust inspection · Emissions-related repairs can help you pass E-Check",
    signs: [
      "Exhaust louder than normal",
      "Rattling or vibration from underneath",
      "Check engine light for catalytic converter",
      "Failed Ohio E-Check / emissions test",
      "Smell of exhaust inside the cabin",
      "Visible rust holes in exhaust pipes",
    ],
    problems: [
      { question: "Exhaust suddenly louder?", answer: "A sudden increase in exhaust noise usually means a hole, crack, or separated connection in the exhaust system. Cleveland road salt causes exhaust components to rust and fail. We inspect the full system on the lift and identify which section needs repair or replacement." },
      { question: "Failed emissions / E-Check?", answer: "A failed Ohio E-Check often points to a catalytic converter issue, oxygen sensor failure, or exhaust leak. We read the OBD-II codes, test the catalytic converter efficiency, and check oxygen sensor readings to determine the exact cause." },
      { question: "Catalytic converter check engine light?", answer: "A P0420 or P0430 code means catalytic converter efficiency is below threshold. This can be the converter itself, an upstream oxygen sensor giving bad data, or an exhaust leak before the sensor. We test all three before recommending converter replacement." },
    ],
    process: [
      { step: "Inspect", detail: "Full visual inspection on the lift from exhaust manifold to tailpipe." },
      { step: "Diagnose", detail: "Read codes, test oxygen sensors, measure backpressure, and check converter efficiency." },
      { step: "Quote", detail: "Written estimate for repair or replacement of the failed components." },
      { step: "Repair", detail: "Replace or repair the exhaust components. Verify no leaks and proper operation." },
    ],
    whyUs: [
      "Complete exhaust system service",
      "Catalytic converter diagnostics",
      "Ohio E-Check / emissions repair",
      "Muffler and resonator replacement",
      "Exhaust manifold repair",
      "Custom exhaust work available",
    ],
    keywords: ["exhaust repair Cleveland", "muffler repair Cleveland OH", "catalytic converter Cleveland", "E-Check repair Cleveland", "exhaust leak repair"],
    includedItems: ["Full exhaust inspection", "Code reading", "Written estimate", "Post-repair leak check"],
    pricingTiers: [
      { label: "Muffler replacement", range: "$150–$400" },
      { label: "Exhaust pipe section", range: "$100–$300" },
      { label: "Catalytic converter", range: "$500–$2,000" },
    ],
    duration: "1–4 hours depending on repair",
    startingPrice: "From $100",
  },
  {
    slug: "cooling",
    num: "12",
    title: "COOLING SYSTEM",
    shortDesc: "Radiator, water pump, thermostat, coolant flush, hoses, and overheating diagnostics. Don't blow a head gasket.",
    metaTitle: "Cooling System Repair Cleveland OH | Radiator Service | Nick's Tire & Auto",
    metaDescription: "Cooling system and radiator repair in Cleveland. Water pump, thermostat, coolant flush, hose replacement. Don't risk overheating. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "COOLING SYSTEM & RADIATOR",
    heroSubline: "An overheating engine can destroy itself in minutes. We diagnose cooling system problems fast and get your engine running at the right temperature.",
    heroCTA: "FIX OVERHEATING",
    turnaround: "Most cooling repairs completed same day. Coolant flush: 1 hour.",
    pricingNote: "Free cooling system pressure test with repair",
    urgencyNote: "Stop driving immediately if your temperature gauge is in the red. Engine damage from overheating costs thousands.",
    signs: [
      "Temperature gauge reading high or in the red",
      "Coolant leak under the vehicle (green, orange, or pink fluid)",
      "Sweet smell from the engine or inside the cabin",
      "Low coolant warning light",
      "Heater blowing cold air in winter",
      "Steam coming from under the hood",
    ],
    problems: [
      { question: "Engine overheating?", answer: "Pull over immediately. Overheating damages head gaskets, warps cylinder heads, and can destroy the engine. Common causes include a coolant leak, stuck thermostat, failed water pump, clogged radiator, or a blown head gasket. We pressure-test the system to find the leak and diagnose the root cause." },
      { question: "Coolant leaking?", answer: "Coolant leaks come from radiator cracks, worn hoses, water pump seals, heater core, or head gaskets. We use a pressure tester to pressurize the cooling system and find exactly where it is leaking. The color and location of the leak tells us a lot about the source." },
      { question: "Need a coolant flush?", answer: "Coolant breaks down over time and loses its ability to protect against corrosion and freezing. We recommend a coolant flush every 30,000 miles or 3 years. We drain the old coolant, flush the system, and refill with the correct coolant type for your vehicle." },
    ],
    process: [
      { step: "Pressure Test", detail: "Pressurize the cooling system to find any leaks — radiator, hoses, water pump, heater core." },
      { step: "Diagnose", detail: "Check thermostat operation, water pump flow, radiator condition, and head gasket integrity." },
      { step: "Quote", detail: "Written estimate for repair. Explain what failed and why." },
      { step: "Repair", detail: "Replace failed components, flush system if needed, refill with correct coolant, verify operating temperature." },
    ],
    whyUs: [
      "Radiator repair and replacement",
      "Water pump replacement",
      "Thermostat service",
      "Coolant flush and fill",
      "Hose replacement",
      "Head gasket testing",
    ],
    keywords: ["cooling system repair Cleveland", "radiator repair Cleveland OH", "car overheating fix Cleveland", "water pump replacement", "coolant flush Cleveland"],
    includedItems: ["Pressure test", "Temperature check", "Written estimate", "Correct coolant type for your vehicle"],
    pricingTiers: [
      { label: "Coolant flush", range: "$100–$180" },
      { label: "Thermostat replacement", range: "$150–$350" },
      { label: "Water pump", range: "$300–$700" },
      { label: "Radiator replacement", range: "$400–$900" },
    ],
    duration: "1–4 hours depending on repair",
    startingPrice: "From $100",
  },
  {
    slug: "pre-purchase-inspection",
    num: "13",
    title: "PRE-PURCHASE INSPECTION",
    shortDesc: "Buying a used car? We inspect it bumper-to-bumper before you hand over your money. Don't buy someone else's problems.",
    metaTitle: "Pre-Purchase Car Inspection Cleveland | Nick's Tire & Auto",
    metaDescription: "Used car inspection in Cleveland before you buy. Bumper-to-bumper check. Engine, transmission, brakes, frame, tires. Know what you're buying. (216) 862-0005.",
    heroHeadline: "PRE-PURCHASE INSPECTION",
    heroSubline: "Buying a used car is a gamble — unless you get it inspected first. Our technicians check everything from engine health to frame condition so you know exactly what you are buying.",
    heroCTA: "SCHEDULE INSPECTION",
    turnaround: "Inspections completed in 1-2 hours. Walk-ins welcome.",
    pricingNote: "Comprehensive inspection · Written report with photos",
    signs: [
      "You are about to buy a used car",
      "Private seller says 'nothing wrong with it'",
      "Dealer won't let you take it to your mechanic",
      "Price seems too good to be true",
      "Vehicle has unknown service history",
      "Out-of-state vehicle (different climate wear patterns)",
    ],
    problems: [
      { question: "Why do I need a pre-purchase inspection?", answer: "A pre-purchase inspection can save you thousands by catching hidden problems before you buy. We check engine compression, transmission operation, brake condition, suspension wear, fluid leaks, frame rust, tire condition, and electrical systems. A $150 inspection can prevent a $3,000 surprise." },
      { question: "What do you check?", answer: "We inspect the engine (compression, leaks, noises), transmission (shift quality, fluid condition), brakes (pad thickness, rotor condition), suspension (worn components, alignment), tires (tread depth, uneven wear), electrical (battery, charging, lights), body (rust, accident damage), and frame (structural integrity, undercarriage corrosion)." },
      { question: "Can I bring any car for inspection?", answer: "Yes. We inspect all makes and models. If you are buying from a private seller, arrange to bring the vehicle to our shop. If buying from a dealer, tell them you want an independent inspection. Any seller who refuses an inspection is a red flag." },
    ],
    process: [
      { step: "Drop Off", detail: "Bring the vehicle to our shop or have the seller bring it. Takes 1-2 hours." },
      { step: "Full Inspection", detail: "Bumper-to-bumper check: engine, transmission, brakes, suspension, tires, electrical, body, frame." },
      { step: "Written Report", detail: "Detailed report of everything found — good, bad, and ugly. Includes photos." },
      { step: "Consultation", detail: "We go through the findings with you and tell you whether the car is worth buying at the asking price." },
    ],
    whyUs: [
      "150+ point inspection",
      "Written report with photos",
      "Honest assessment — we tell you the truth",
      "All makes and models",
      "Typically completed in 1-2 hours",
      "Can save you thousands on a bad purchase",
    ],
    keywords: ["pre-purchase inspection Cleveland", "used car inspection Cleveland OH", "buy used car Cleveland", "car inspection before buying"],
    includedItems: ["Engine inspection", "Transmission test", "Brake measurement", "Suspension check", "Tire assessment", "Electrical test", "Frame inspection", "Written report with photos"],
    pricingTiers: [
      { label: "Pre-purchase inspection", range: "$100–$175" },
    ],
    duration: "1–2 hours",
    startingPrice: "From $100",
  },
  {
    slug: "belts-hoses",
    num: "14",
    title: "BELTS & HOSES",
    shortDesc: "Serpentine belt, timing belt, radiator hoses, heater hoses. Prevent breakdowns with preventive replacement.",
    metaTitle: "Belt & Hose Replacement Cleveland OH | Nick's Tire & Auto",
    metaDescription: "Serpentine belt, timing belt, and hose replacement in Cleveland. Prevent breakdowns. Expert service, fair prices. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "BELT & HOSE SERVICE",
    heroSubline: "Belts and hoses are rubber — they crack, dry out, and fail with age and heat. A $50 belt replacement prevents a $500 tow and a ruined day.",
    heroCTA: "CHECK MY BELTS",
    turnaround: "Serpentine belt: under 1 hour. Timing belt: 4-8 hours.",
    pricingNote: "Belt inspection included with any service · No appointment needed",
    signs: [
      "Squealing noise from engine on startup",
      "Visible cracks on belt surface",
      "Coolant leak from a hose connection",
      "Belt is more than 60,000 miles or 5 years old",
      "AC or power steering stops working suddenly",
      "Engine overheating from burst hose",
    ],
    problems: [
      { question: "Squealing noise from engine?", answer: "A squealing noise on startup or when turning the steering wheel is usually a worn or loose serpentine belt. The belt drives your alternator, AC compressor, power steering pump, and water pump. A failed belt disables all of them at once." },
      { question: "When should I replace my timing belt?", answer: "Most manufacturers recommend timing belt replacement between 60,000 and 100,000 miles. Check your owner's manual. A broken timing belt on an interference engine causes catastrophic valve and piston damage costing $2,000 to $5,000. Preventive replacement is far cheaper." },
      { question: "Coolant hose leaking?", answer: "Radiator and heater hoses deteriorate from the inside out. They may look fine on the outside but be soft and swollen. We squeeze-test all hoses during inspections. A burst hose causes immediate overheating and potential engine damage." },
    ],
    process: [
      { step: "Inspect", detail: "Visual and physical inspection of all belts and hoses. Check for cracks, glazing, softness, and leaks." },
      { step: "Recommend", detail: "Identify any belts or hoses due for replacement based on condition and mileage." },
      { step: "Replace", detail: "Install new belt or hose with correct tension. Replace coolant if hoses were changed." },
      { step: "Verify", detail: "Run the engine, check for leaks, verify belt alignment and tension." },
    ],
    whyUs: [
      "Serpentine belt replacement",
      "Timing belt and water pump service",
      "Radiator and heater hose replacement",
      "Belt tensioner and idler pulley service",
      "Preventive maintenance inspections",
      "Quality replacement parts",
    ],
    keywords: ["serpentine belt Cleveland", "timing belt replacement Cleveland", "hose replacement Cleveland OH", "belt squeal fix", "car belt repair near me"],
    includedItems: ["Belt condition inspection", "Hose squeeze test", "Written estimate", "Proper belt tension"],
    pricingTiers: [
      { label: "Serpentine belt", range: "$80–$200" },
      { label: "Timing belt + water pump", range: "$500–$1,200" },
      { label: "Radiator/heater hose", range: "$80–$250" },
    ],
    duration: "Belt: 30 min–1 hr. Timing belt: 4–8 hrs.",
    startingPrice: "From $80",
  },
  {
    slug: "starter-alternator",
    num: "15",
    title: "STARTER & ALTERNATOR",
    shortDesc: "Starter motor, alternator, and charging system diagnostics and replacement. Get back on the road fast.",
    metaTitle: "Starter & Alternator Repair Cleveland OH | Nick's Tire & Auto",
    metaDescription: "Starter and alternator repair in Cleveland. Charging system diagnostics. Same-day replacement. All makes and models. Walk-ins welcome. (216) 862-0005.",
    heroHeadline: "STARTER & ALTERNATOR",
    heroSubline: "If your car won't start or your battery keeps dying, the starter or alternator is likely the culprit. We test both and replace only what actually failed.",
    heroCTA: "DIAGNOSE NO-START",
    turnaround: "Most starter and alternator replacements completed same day.",
    pricingNote: "Free charging system test · Only replace what's actually failed",
    signs: [
      "Car won't start — clicking or grinding sound",
      "Battery keeps dying even after replacement",
      "Dimming headlights and dashboard lights",
      "Battery warning light on dashboard",
      "Whining noise from the engine",
      "Electrical accessories acting erratically",
    ],
    problems: [
      { question: "Starter or battery?", answer: "A clicking sound when turning the key can be either. We load-test the battery first — if it passes, the starter is likely failed. If the battery is dead, we test the alternator to make sure it was actually charging. This prevents you from replacing the wrong part." },
      { question: "Alternator or battery?", answer: "A failing alternator won't keep the battery charged, so it mimics a bad battery. We test alternator output under load. A healthy alternator produces 13.5 to 14.5 volts. Below that, the alternator needs replacement." },
      { question: "How long do starters and alternators last?", answer: "Starters typically last 100,000 to 150,000 miles. Alternators last 80,000 to 150,000 miles. Cleveland's temperature extremes and stop-and-go driving reduce these lifespans. If your vehicle has high mileage and shows any symptoms, get tested proactively." },
    ],
    process: [
      { step: "Test Battery", detail: "Load test the battery. If it's good, the problem is elsewhere." },
      { step: "Test Charging", detail: "Measure alternator output under load. Check for voltage drop in the charging circuit." },
      { step: "Test Starter", detail: "Measure starter draw. A high-draw starter is failing internally." },
      { step: "Replace", detail: "Replace the failed component, verify proper operation, clear any stored codes." },
    ],
    whyUs: [
      "Free charging system test",
      "Battery, starter, AND alternator testing",
      "Same-day replacement",
      "We test first — only replace what failed",
      "All makes and models",
      "Quality replacement parts with warranty",
    ],
    keywords: ["starter replacement Cleveland", "alternator repair Cleveland OH", "car won't start fix Cleveland", "charging system repair"],
    includedItems: ["Free charging system test", "Battery load test", "Starter draw test", "Written estimate", "Post-repair verification"],
    pricingTiers: [
      { label: "Starter replacement", range: "$250–$500" },
      { label: "Alternator replacement", range: "$350–$700" },
      { label: "Charging system test", range: "FREE" },
    ],
    duration: "1–3 hours",
    startingPrice: "FREE test",
  },
];

export function getServiceBySlug(slug: string): ServiceData | undefined {
  return SERVICES.find((s) => s.slug === slug);
}
