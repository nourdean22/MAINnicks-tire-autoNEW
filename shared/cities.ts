/**
 * City-specific landing page data for local SEO.
 * Each city page targets "[service] near [city]" search queries
 * to capture surrounding suburb traffic.
 */

export interface CityData {
  slug: string;
  name: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubline: string;
  distance: string;
  driveTime: string;
  neighborhoods: string[];
  localContent: string;
  serviceHighlights: string[];
  testimonial: {
    text: string;
    author: string;
    location: string;
  };
}

export const CITIES: CityData[] = [
  {
    slug: "euclid-auto-repair",
    name: "Euclid",
    metaTitle: "Auto Repair Euclid OH · Walk-Ins 7 Days | Nick's",
    metaDescription: "Nick's Tire & Auto — literally on Euclid Ave. Brakes, tires, diagnostics, oil, alignment for Euclid drivers. 4.9★ 1,700+ reviews. Walk-ins 7 days, financing on the spot.",
    heroHeadline: "AUTO REPAIR\nLITERALLY ON EUCLID AVE",
    heroSubline: "We are literally on Euclid Avenue — that's not a marketing flourish, it's the address. Pull up, we put the car on a lift, hand you the flashlight, write the estimate before any wrench moves. The kind of repairs your grandfather would've nodded at, with the diagnostic gear your kid's Tesla actually needs. Walk in any day. Financing on the spot.",
    distance: "0.5 miles",
    driveTime: "2 minutes",
    neighborhoods: ["Downtown Euclid", "Indian Hills", "Euclid Green", "Bluestone", "Upson"],
    localContent: "Nick's Tire & Auto sits right on Euclid Avenue. From Indian Hills, Euclid Green, or anywhere along Lakeshore Boulevard, we're 2 minutes away. Routine oil change to complex engine diagnostics — same playbook every job: lift the car, hand you the flashlight, write the estimate first. Cheaper than the dealer. More honest than the chain. The shop your grandfather would've nodded at, with the OBD-II gear your kid's Tesla needs.",
    serviceHighlights: [
      "Ohio E-Check and emissions repair (state-certified, pass guaranteed)",
      "Brake inspection on a lift you can walk under, same-day repair",
      "New + used tires with free mount, balance, valve stems, alignment check",
      "OBD-II code pull free with repair, plain-English explanation",
      "Suspension + steering tuned for Northeast Ohio pothole season",
      "Synthetic + conventional oil change, in and out before your coffee gets cold"
    ],
    testimonial: {
      text: "I live two blocks from Nick's and have been going there for three years. They always explain what is wrong before doing any work. Honest shop.",
      author: "Marcus T.",
      location: "Euclid, OH"
    }
  },
  {
    slug: "lakewood-auto-repair",
    name: "Lakewood",
    metaTitle: "Auto Repair Near Lakewood OH · 20 Min Worth Driving | Nick's",
    metaDescription: "Lakewood drivers cross town for honest auto repair. Brakes, tires, diagnostics, emissions — explained in plain English. 4.9★ 1,700+ reviews. Walk-ins 7 days.",
    heroHeadline: "AUTO REPAIR FOR\nLAKEWOOD DRIVERS",
    heroSubline: "Lakewood has plenty of mechanics. Our regulars from Birdtown and Gold Coast still drive 20 minutes east — because the diagnosis comes before the bill, the worn parts get shown on a lift, and nobody talks down to anyone. Brakes, tires, diagnostics, emissions — and a coffee maker that's been with us longer than some marriages.",
    distance: "12 miles",
    driveTime: "20 minutes",
    neighborhoods: ["Birdtown", "Gold Coast", "Rockport", "Downtown Lakewood", "Clifton Park"],
    localContent: "Lakewood drivers from Birdtown, Gold Coast, and downtown make the 20-minute drive to Nick's because the diagnosis comes before the bill. We put the car on a lift, walk you under it, and write the estimate before any wrench moves. Plain English, fair prices, no $99 diagnostic fee. Whether it's a check engine light, new tires, or a failed E-Check — same playbook every job. 4.9★ from 1,700+ Cleveland-area drivers including a lot of Lakewood regulars.",
    serviceHighlights: [
      "Brake service — pads, rotors, calipers, ABS — measured on a lift you can see",
      "New + used tires from major brands with the free install package",
      "OBD-II code pull free with repair, explained in real English",
      "Ohio E-Check + emissions repair, state-certified, pass guaranteed",
      "Cooling system, belts, hoses — caught before they tow you",
      "Steering + suspension tuned for the Lake Erie freeze-thaw"
    ],
    testimonial: {
      text: "I drive from Lakewood because I trust them. They diagnosed a problem two other shops missed. Fair price, great work.",
      author: "Jennifer S.",
      location: "Lakewood, OH"
    }
  },
  {
    // 2026-04-26 GSC tune: page had 499 impr at pos 34 / 0.2% CTR — Parma
    // searchers don't reach page 4 (where pos 34 sits) for "auto repair
    // Parma". Title rewritten to target the niche searcher who'd actually
    // drive 25 min — Parma drivers fed up with local shops, looking for
    // an honest second opinion. Emphasizes the differentiators a local
    // shop can't match (4.9★, free Uber drop-off-and-back) and is
    // honest about distance up front.
    slug: "parma-auto-repair",
    name: "Parma",
    metaTitle: "Parma Auto Repair · Free Uber Both Ways | Nick's",
    metaDescription: "Parma drivers cross town for an honest mechanic. 25 min away, free Uber drop-off + pick-up. 4.9★ 1,700+ reviews. Walk-ins 7 days, financing on the spot.",
    heroHeadline: "AUTO REPAIR\nWORTH THE DRIVE FROM PARMA",
    heroSubline: "Parma drivers tired of three different local shops giving three different prices for the same job come to Nick's Tire & Auto for one answer — the honest one. 25 minutes up I-480, and we Uber you home and back so you don't sacrifice a Saturday sitting around. 4.9★ from 1,700+ Cleveland-area drivers who came in skeptical and left with a working car.",
    distance: "15 miles",
    driveTime: "25 minutes",
    neighborhoods: ["Parma Heights", "Parmatown", "Ridgewood", "Pleasant Valley", "Snow Road"],
    localContent: "Parma is one of the largest suburbs in the Cleveland metro area, and many Parma drivers have discovered that Nick's Tire & Auto is worth the drive. We specialize in the kind of thorough, honest auto repair that is hard to find. Our technicians use advanced OBD-II diagnostic equipment to pinpoint problems accurately, which means you only pay for what actually needs to be fixed. From routine maintenance like oil changes and tire rotations to complex repairs like catalytic converter replacement and suspension work, we handle it all.",
    serviceHighlights: [
      "Full diagnostic service for check engine and warning lights",
      "Brake repair and replacement with quality parts",
      "New and used tire sales with professional installation",
      "Emissions and E-Check failure diagnosis and repair",
      "Exhaust system repair and replacement",
      "General mechanical repair and maintenance"
    ],
    testimonial: {
      text: "My mechanic in Parma retired and a friend recommended Nick's. Best decision I made. They are thorough and honest.",
      author: "Robert K.",
      location: "Parma, OH"
    }
  },
  {
    // 2026-05-03 GSC-driven add: 119+ impressions/yr across "auto repair parma
    // heights" / "parma heights auto repair" / "car repair parma heights" /
    // "parma heights car repair" — all sitting at positions 38–42 with no
    // matching landing page. This page captures all 4 query variants.
    slug: "parma-heights-auto-repair",
    name: "Parma Heights",
    metaTitle: "Parma Heights Auto Repair · Free Uber Both Ways | Nick's",
    metaDescription: "Parma Heights drivers cross town for an honest mechanic. 4.9★ 1,700+ reviews. Free Uber drop-off + pick-up. Brakes, tires, diagnostics. Walk-ins 7 days.",
    heroHeadline: "PARMA HEIGHTS\nAUTO REPAIR — WORTH THE DRIVE",
    heroSubline: "Parma Heights drivers fed up with overpriced local shops are crossing town to Nick's Tire & Auto for honest diagnostics, written estimates before any wrench moves, and payment programs approved on the spot. 25 minutes up I-480 — and we Uber you home and back so you don't lose a day sitting around.",
    distance: "16 miles",
    driveTime: "25 minutes",
    neighborhoods: ["Pleasant Lake", "Stumph Road", "York Road", "Pearl Road", "Snow Road"],
    localContent: "Parma Heights sits between Parma proper and Brooklyn Heights along the Pearl Road / York Road corridor — a working-class community where families need a mechanic who explains things twice without sighing. Nick's Tire & Auto serves Parma Heights drivers tired of being talked over by chain shops or quoted prices that change between the front desk and the parking lot. The drive up I-480 to Cleveland is 25 minutes, and we Uber you home from the shop and back when your car is ready, so a repair doesn't cost you a day of work. We handle everything — brakes, tires, oil change, diagnostics, alignment, suspension, exhaust — with written estimates before any wrench moves. Most repairs done same day. Financing approved on the spot if you need it.",
    serviceHighlights: [
      "Brake repair with free written estimate before any wrench moves",
      "New & used tires installed FREE with our complete service package",
      "Check engine light diagnostics — free scan, real-English explanation",
      "Wheel alignment to fix the damage Pearl Rd & York Rd potholes did over winter",
      "Financing approved on the spot — no credit check, drive away today",
      "Free Uber drop-off and pick-up from anywhere in Parma Heights"
    ],
    testimonial: {
      text: "Switched from a Parma Heights shop after they tried to upsell me on a $1,200 brake job I didn't need. Nick's quoted $340 with the same warranty and showed me the actual worn pads. Honest crew.",
      author: "Marcus D.",
      location: "Parma Heights, OH"
    }
  },
  {
    slug: "east-cleveland-auto-repair",
    name: "East Cleveland",
    metaTitle: "Auto Repair East Cleveland · 8 Min, Sunday Open | Nick's",
    metaDescription: "East Cleveland auto repair at Nick's Tire & Auto, just 8 min away on Euclid Ave. Brakes, tires, diagnostics, emissions. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nEAST CLEVELAND",
    heroSubline: "Just minutes from East Cleveland on Euclid Avenue, Nick's Tire & Auto provides expert auto repair with honest diagnostics and fair pricing. No surprises, no upselling.",
    distance: "3 miles",
    driveTime: "8 minutes",
    neighborhoods: ["Forest Hills", "Caledonia", "Superior", "Hayden", "Euclid-Green"],
    localContent: "East Cleveland drivers benefit from our convenient location on Euclid Avenue, just a short drive from the East Cleveland border. We serve the East Cleveland community with the same honest, expert auto repair that has made us one of the highest-rated shops in the Cleveland area. Our technicians understand the challenges of Northeast Ohio driving — from pothole damage to salt corrosion — and we repair vehicles to handle these conditions reliably.",
    serviceHighlights: [
      "Pothole damage repair — suspension, alignment, and tire replacement",
      "Brake inspection and repair with honest assessments",
      "Engine diagnostic service for all warning lights",
      "Ohio E-Check preparation and emissions repair",
      "Oil change service — conventional and synthetic",
      "Cooling system repair for all makes and models"
    ],
    testimonial: {
      text: "I have been coming here from East Cleveland for over a year. They always show me what is wrong and give me options. No pressure.",
      author: "Tanya M.",
      location: "East Cleveland, OH"
    }
  },
  {
    slug: "shaker-heights-auto-repair",
    name: "Shaker Heights",
    metaTitle: "Auto Repair Shaker Heights · 18 Min, Worth The Ride | Nick's",
    metaDescription: "Shaker Heights drivers trust Nick's Tire & Auto for quality auto repair. Brakes, tires, diagnostics. 4.9 stars, 1700+ reviews. Call (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR SHAKER HEIGHTS",
    heroSubline: "Shaker Heights drivers choose Nick's Tire & Auto for expert diagnostics, honest assessments, and fair pricing. We show you the problem before we fix it.",
    distance: "8 miles",
    driveTime: "18 minutes",
    neighborhoods: ["Shaker Square", "Fernway", "Onaway", "Lomond", "Sussex"],
    localContent: "Shaker Heights residents value quality and integrity, and that is exactly what Nick's Tire & Auto delivers. Our shop on Euclid Avenue is a straightforward drive from Shaker Heights, and many of your neighbors already trust us with their vehicles. We use advanced OBD-II diagnostic equipment to identify problems accurately, explain everything in plain language, and only recommend repairs that are truly necessary. From routine oil changes to complex engine diagnostics and Ohio E-Check failures, our experienced technicians handle it all with the care and precision Shaker Heights drivers expect.",
    serviceHighlights: [
      "Advanced engine diagnostics for check engine and warning lights",
      "Complete brake service — pads, rotors, calipers, ABS",
      "Tire sales and professional installation from major brands",
      "Ohio E-Check and emissions system diagnosis and repair",
      "Suspension and steering repair",
      "Cooling system service and repair"
    ],
    testimonial: {
      text: "I switched from the dealership to Nick's after a friend recommended them. Half the price, twice the honesty. They earned a customer for life.",
      author: "David L.",
      location: "Shaker Heights, OH"
    }
  },
  {
    slug: "cleveland-heights-auto-repair",
    name: "Cleveland Heights",
    metaTitle: "Auto Repair Cleveland Heights · 15 Min, Worth It | Nick's",
    metaDescription: "Cleveland Heights auto repair at Nick's Tire & Auto, 15 min away. Brakes, tires, diagnostics, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nCLEVELAND HEIGHTS",
    heroSubline: "Cleveland Heights drivers trust Nick's Tire & Auto for honest diagnostics, quality repairs, and transparent pricing. No surprises, no upselling.",
    distance: "7 miles",
    driveTime: "15 minutes",
    neighborhoods: ["Cedar-Fairmount", "Coventry Village", "Noble", "Forest Hill", "Severance"],
    localContent: "Cleveland Heights is known for its vibrant community and discerning residents who expect quality in everything, including auto repair. Nick's Tire & Auto has earned the trust of Cleveland Heights drivers by consistently delivering honest diagnostics and fair pricing. Our technicians take the time to show you exactly what is wrong with your vehicle before recommending any repairs. Whether you need brake work, tire replacement, an oil change, or complex engine diagnostics, we treat your car with the same care we would give our own.",
    serviceHighlights: [
      "Full diagnostic service for all dashboard warning lights",
      "Brake inspection, repair, and replacement",
      "New and used tire sales with mounting and balancing",
      "Emissions testing preparation and E-Check repair",
      "Oil change service — conventional and full synthetic",
      "Exhaust system diagnosis and repair"
    ],
    testimonial: {
      text: "Moved to Cleveland Heights last year and needed a reliable mechanic. Nick's was recommended by three different neighbors. Now I know why.",
      author: "Sarah W.",
      location: "Cleveland Heights, OH"
    }
  },
  {
    slug: "mentor-auto-repair",
    name: "Mentor",
    metaTitle: "Auto Repair Mentor · 30 Min, $200 Saved Average | Nick's",
    metaDescription: "Mentor drivers make the drive to Nick's Tire & Auto for honest auto repair. Brakes, tires, diagnostics. 4.9 stars. Worth the trip. Call (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR MENTOR DRIVERS",
    heroSubline: "Mentor drivers make the drive to Nick's Tire & Auto because they know they will get honest diagnostics, expert repairs, and prices that are fair.",
    distance: "22 miles",
    driveTime: "30 minutes",
    neighborhoods: ["Mentor-on-the-Lake", "Mentor Headlands", "Garfield Park", "Blackbrook", "Center Street"],
    localContent: "Many Mentor drivers have discovered that the drive to Nick's Tire & Auto is worth it for the quality of service they receive. While there are closer shops, our reputation for honest diagnostics and fair pricing brings customers from across Lake County. We use the same advanced diagnostic equipment found in dealerships but charge a fraction of the price. Our technicians diagnose problems accurately the first time, which saves you money and gets you back on the road faster. From routine maintenance to complex repairs, Mentor drivers trust Nick's.",
    serviceHighlights: [
      "Complete engine diagnostic service with OBD-II scanning",
      "Brake system repair — pads, rotors, calipers, lines",
      "Tire sales, mounting, balancing, and TPMS service",
      "Ohio E-Check failure diagnosis and emissions repair",
      "Suspension and alignment services",
      "General mechanical repair for all makes and models"
    ],
    testimonial: {
      text: "I drive 30 minutes from Mentor because no shop closer to me is as honest as Nick's. They diagnosed a noise three other shops could not figure out.",
      author: "Mark T.",
      location: "Mentor, OH"
    }
  },
  {
    slug: "strongsville-auto-repair",
    name: "Strongsville",
    metaTitle: "Auto Repair Strongsville · Yes, Worth The Drive | Nick's",
    metaDescription: "Strongsville drivers choose Nick's Tire & Auto for honest auto repair. Brakes, tires, diagnostics, emissions. 1700+ five-star reviews. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR FOR\nSTRONGSVILLE DRIVERS",
    heroSubline: "Strongsville drivers choose Nick's Tire & Auto for the kind of honest, thorough auto repair that is hard to find. We diagnose it right the first time.",
    distance: "20 miles",
    driveTime: "28 minutes",
    neighborhoods: ["SouthPark Mall area", "Royalton Road", "Pearl Road corridor", "Westwood", "Albion Road"],
    localContent: "Strongsville is one of Cleveland's most established suburbs, and its residents expect reliable service from every business they patronize. Nick's Tire & Auto has earned the trust of Strongsville drivers through consistent honesty and quality workmanship. We understand that driving across town for auto repair is a commitment, and we make sure every visit is worth your time. Our technicians use advanced diagnostic tools to identify issues precisely, explain your options clearly, and complete repairs efficiently so you can get back to your day.",
    serviceHighlights: [
      "Advanced computer diagnostics for all vehicle systems",
      "Complete brake service with quality OEM-grade parts",
      "Tire sales and service — all major brands available",
      "Emissions and E-Check repair for Ohio inspection",
      "Cooling system and radiator service",
      "Belt, hose, and fluid maintenance"
    ],
    testimonial: {
      text: "Worth the drive from Strongsville every time. They fixed an issue my dealership wanted $1,800 for. Nick's did it for $650. Same parts, better service.",
      author: "Chris P.",
      location: "Strongsville, OH"
    }
  },
  {
    slug: "south-euclid-auto-repair",
    name: "South Euclid",
    metaTitle: "Auto Repair South Euclid · 12 Min To The Lift | Nick's",
    metaDescription: "South Euclid auto repair at Nick's Tire & Auto, just 12 min away. Brakes, tires, diagnostics, emissions. Honest pricing. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nNEAR SOUTH EUCLID",
    heroSubline: "South Euclid drivers are 12 minutes from Nick's Tire & Auto. We put the car on a lift, hand you the flashlight, and write the estimate before any wrench moves. Same playbook every job.",
    distance: "5 miles",
    driveTime: "12 minutes",
    neighborhoods: ["Cedar Center", "Bluestone", "Bexley Park", "Oakwood", "Argonne"],
    localContent: "South Euclid residents enjoy one of the shortest drives to Nick's Tire & Auto, making us a convenient choice for all your vehicle maintenance and repair needs. Our location on Euclid Avenue is easily accessible from South Euclid via Cedar Road or Mayfield Road. We have built our reputation by treating every customer with respect, diagnosing problems honestly, and charging fair prices. Whether your check engine light just came on, you need new brakes, or your car failed its Ohio E-Check, our experienced technicians will get you back on the road quickly and affordably.",
    serviceHighlights: [
      "Check engine light diagnosis and repair",
      "Brake pad and rotor replacement",
      "Tire sales, rotation, and flat repair",
      "Ohio E-Check and emissions system repair",
      "Oil change — conventional and synthetic options",
      "Steering and suspension repair"
    ],
    testimonial: {
      text: "Living in South Euclid, Nick's is my go-to shop. Quick, honest, and they never try to sell me something I do not need.",
      author: "Angela R.",
      location: "South Euclid, OH"
    }
  },
  {
    slug: "garfield-heights-auto-repair",
    name: "Garfield Heights",
    metaTitle: "Auto Repair Garfield Heights · 20 Min, $99 Saved | Nick's",
    metaDescription: "Garfield Heights auto repair at Nick's Tire & Auto, 20 min away. Brakes, tires, diagnostics, emissions. 4.9 stars, honest pricing. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nGARFIELD HEIGHTS",
    heroSubline: "Garfield Heights drivers trust Nick's Tire & Auto for reliable auto repair. We diagnose problems accurately, explain your options, and fix it right.",
    distance: "10 miles",
    driveTime: "20 minutes",
    neighborhoods: ["Turney Road", "Granger Road", "Maple Heights border", "Garfield Park", "Marymount"],
    localContent: "Garfield Heights drivers have access to plenty of repair shops, but many choose to make the drive to Nick's Tire & Auto because of our reputation for honesty and quality. We understand that auto repair can be stressful, especially when you are not sure what is wrong with your vehicle. That is why we take the time to diagnose every issue thoroughly using advanced diagnostic equipment, show you exactly what we found, and explain your repair options in plain language before any work begins. No surprises on the bill, no unnecessary repairs.",
    serviceHighlights: [
      "Complete engine and transmission diagnostics",
      "Brake system inspection and repair",
      "New tire sales with professional mounting and balancing",
      "Emissions repair and E-Check preparation",
      "Exhaust system repair and replacement",
      "Electrical system diagnosis"
    ],
    testimonial: {
      text: "Came from Garfield Heights after reading the reviews. They were right — these guys are honest and know what they are doing. Fair prices too.",
      author: "James H.",
      location: "Garfield Heights, OH"
    }
  },
  {
    slug: "richmond-heights-auto-repair",
    name: "Richmond Heights",
    metaTitle: "Auto Repair Richmond Heights · 13 Min, Walk-Ins | Nick's",
    metaDescription: "Richmond Heights auto repair at Nick's Tire & Auto, just 13 min away on Euclid Ave. Brakes, tires, diagnostics. 4.9 stars. Call (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nNEAR RICHMOND HEIGHTS",
    heroSubline: "Richmond Heights drivers choose Nick's Tire & Auto for honest diagnostics, expert repairs, and transparent pricing. Just minutes from Richmond Heights on Euclid Avenue.",
    distance: "6 miles",
    driveTime: "13 minutes",
    neighborhoods: ["Center Plaza", "Richmond Center", "Gates Mills border", "Peacock Creek", "Emerson Circle"],
    localContent: "Richmond Heights residents benefit from our convenient location on Euclid Avenue, making us an easy choice for all your auto repair needs. We serve the Richmond Heights community with the same honest, expert service that has earned us a 4.9-star rating and over 1,700 five-star reviews. Our technicians understand Northeast Ohio driving conditions and provide thorough diagnostics using advanced OBD-II equipment. Whether you need an oil change, brake repair, tire service, or complex engine diagnostics, we handle every job with care and integrity.",
    serviceHighlights: [
      "Advanced engine diagnostics for all check engine lights",
      "Complete brake service — pads, rotors, calipers, and ABS",
      "Tire sales and professional installation from major brands",
      "Ohio E-Check and emissions system diagnosis and repair",
      "Suspension and steering repair",
      "Oil change service — conventional and synthetic options"
    ],
    testimonial: {
      text: "Living just off Euclid Avenue in Richmond Heights, Nick's is super convenient and always honest. They found an issue that saved me money down the road.",
      author: "Patricia K.",
      location: "Richmond Heights, OH"
    }
  },
  {
    slug: "lyndhurst-auto-repair",
    name: "Lyndhurst",
    metaTitle: "Auto Repair Lyndhurst · 16 Min, Free Uber Home | Nick's",
    metaDescription: "Lyndhurst auto repair at Nick's Tire & Auto, 16 min away via Mayfield Rd. Brakes, tires, diagnostics, emissions. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nLYNDHURST",
    heroSubline: "Lyndhurst drivers trust Nick's Tire & Auto for quality repairs, honest diagnostics, and fair pricing. Located just minutes away on Euclid Avenue.",
    distance: "8 miles",
    driveTime: "16 minutes",
    neighborhoods: ["Mayfield Road", "Brainard Road", "Euclid Avenue corridor", "Mayfield Heights border", "Baytowne"],
    localContent: "Lyndhurst residents appreciate quality service and fair pricing, and that is exactly what Nick's Tire & Auto delivers. Our shop on Euclid Avenue is easily accessible from Lyndhurst via Mayfield Road, making us a convenient choice for your auto repair needs. We have earned the trust of Lyndhurst drivers by showing them exactly what is wrong before recommending any repairs, explaining options in plain language, and charging honest prices. From routine maintenance like oil changes and tire rotations to complex diagnostics and Ohio E-Check repairs, we handle all your vehicle needs.",
    serviceHighlights: [
      "Engine diagnostic service using advanced OBD-II scanning",
      "Brake inspection, repair, and replacement",
      "New and used tire sales with mounting and balancing",
      "Emissions testing preparation and E-Check repair",
      "Cooling system service and repair",
      "General mechanical repair and maintenance"
    ],
    testimonial: {
      text: "Found Nick's when I moved to Lyndhurst. The honesty and quality of work is impressive. They explain everything and never push unnecessary repairs.",
      author: "Michael D.",
      location: "Lyndhurst, OH"
    }
  },
  {
    slug: "willoughby-auto-repair",
    name: "Willoughby",
    metaTitle: "Auto Repair Willoughby · 27 Min, Honest Mechanic | Nick's",
    metaDescription: "Willoughby drivers trust Nick's Tire & Auto for honest auto repair. Brakes, tires, diagnostics. 4.9 stars, fair pricing. Call (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR WILLOUGHBY DRIVERS",
    heroSubline: "Willoughby drivers make the drive to Nick's Tire & Auto for expert diagnostics, honest assessments, and quality repairs at fair prices.",
    distance: "18 miles",
    driveTime: "27 minutes",
    neighborhoods: ["Downtown Willoughby", "Willoughby Hills border", "Euclid Creek area", "Riverside", "Willoughby-Eastlake port area"],
    localContent: "Many Willoughby drivers have discovered that the drive to Nick's Tire & Auto is worth it for the level of service and integrity they receive. While there are closer shops, our reputation for honest diagnostics and fair pricing brings customers from across Lake County. We use the same advanced diagnostic equipment found in dealerships but charge a fraction of the price. Our experienced technicians diagnose problems accurately the first time, which saves you money and gets you back on the road faster. From routine maintenance to complex repairs, Willoughby drivers trust Nick's.",
    serviceHighlights: [
      "Complete engine diagnostic service with OBD-II scanning",
      "Brake system repair — pads, rotors, calipers, and lines",
      "Tire sales, mounting, balancing, and TPMS service",
      "Ohio E-Check failure diagnosis and emissions repair",
      "Suspension and alignment services",
      "Electrical system diagnosis and repair"
    ],
    testimonial: {
      text: "Work brought me from Willoughby to Cleveland. Nick's reputation is worth the 30-minute drive. They diagnosed a transmission issue that would have cost me thousands elsewhere.",
      author: "Lisa T.",
      location: "Willoughby, OH"
    }
  },
  {
    slug: "cleveland-auto-repair",
    name: "Cleveland",
    // 2026-05-06 copy wave · GSC: 283 imps at 1.1% CTR, pos 19. Old
    // title is generic "top-rated 4.9★" — every shop in town claims
    // that. New title applies operator 4 (anti-pattern: most shops
    // don't show the worn part) + operator 1 (specificity: 7 years).
    metaTitle: "Auto Repair Cleveland · We Show You The Worn Part | Nick's",
    metaDescription: "Cleveland auto shop on Euclid Ave where the worn part comes out of your car and onto the counter before you pay. 7 years, 1,700+ five-star reviews. Walk-ins 7 days.",
    heroHeadline: "CLEVELAND'S AUTO SHOP\nWHERE THE WORN PART HITS THE COUNTER.",
    heroSubline: "We're not Cleveland's biggest shop. We're not the cheapest. We're the one that puts the worn brake pad, the cracked CV boot, the seized caliper on the counter so you can see what you paid for. 1,700+ five-star reviews from drivers who came in skeptical and left with the part in their hand. Free estimates. No mystery line items. Open every day we're awake.",
    distance: "0 miles",
    driveTime: "You're here",
    neighborhoods: ["Downtown Cleveland", "East Side", "West Side", "Collinwood", "Nottingham", "Five Points", "University Circle", "Tremont", "Ohio City", "Slavic Village", "Glenville", "Hough"],
    localContent: "Nick's Tire & Auto is at 17625 Euclid Avenue in the heart of Cleveland's East Side — yes, the shop is literally on Euclid Ave. Since 2018 the formula has been boring on purpose: honest diagnostics, transparent pricing, quality work, no upsells. We show you the problem on a lift, explain your options in real English, and let you decide. That approach earned us 1,700+ five-star Google reviews and a 4.9★ rating — the highest of any independent shop in the metro. Tires, brakes, engine diagnostics, emissions, transmission, or that strange noise that started this morning. Walk-ins welcome 7 days a week, financing approved on the spot through Acima, Koalafi, Snap Finance, and American First Finance.",
    serviceHighlights: [
      "Cleveland's largest new & used tire selection with free install package",
      "Brake repair — pads, rotors, calipers, ABS diagnostics on a lift you can see",
      "Advanced engine diagnostics with OBD-II and factory-level scanners",
      "Ohio E-Check and emissions repair — we get you passing or we keep working",
      "Oil changes faster than your barista finishes your name",
      "Transmission, suspension, electrical, exhaust, and the weird rattle that started yesterday",
      "Auto-repair financing approved on the spot — all credit welcome",
      "Walk-ins welcome 7 days a week, including Sunday 9 AM–4 PM"
    ],
    testimonial: {
      text: "I have been going to Nick's for five years. They have worked on every car in my family. Honest, fast, and the prices are always fair. Best shop in Cleveland, hands down.",
      author: "James W.",
      location: "Cleveland, OH"
    }
  },
  {
    slug: "maple-heights-auto-repair",
    name: "Maple Heights",
    metaTitle: "Auto Repair Maple Heights · 15 Min, Sunday Open | Nick's",
    metaDescription: "Maple Heights auto repair at Nick's Tire & Auto, 15 min via Dunham Rd. Brakes, tires, diagnostics, emissions. Walk-ins 7 days. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nMAPLE HEIGHTS",
    heroSubline: "Maple Heights drivers trust Nick's Tire & Auto for honest diagnostics, expert repairs, and fair pricing. Located just 15 minutes away via Dunham Road or Broadway Avenue.",
    distance: "8 miles",
    driveTime: "15 minutes",
    neighborhoods: ["Dunham Road", "Broadway Avenue", "Libby Road", "Warrensville Center", "Maple Heights Center"],
    localContent: "Maple Heights residents are 15 minutes from Nick's Tire & Auto, easily accessible via Dunham Road or Broadway Avenue. The pattern Maple Heights drivers report: honest diagnostics, transparent pricing, quality repairs every visit. We use advanced OBD-II diagnostic equipment to identify problems accurately, explain everything in plain language, and only recommend repairs that are truly necessary. Brake service, new tires, oil change, or complex engine diagnostics — every vehicle handled with care and integrity. Many Maple Heights drivers made us their go-to shop after experiencing transparent, fair-priced auto repair.",
    serviceHighlights: [
      "Complete brake service — pads, rotors, calipers, and ABS diagnostics",
      "Tire sales and professional installation from major brands",
      "Check engine light diagnosis and repair",
      "Ohio E-Check and emissions system repair",
      "Oil change service — conventional and synthetic options",
      "Suspension and steering repair for Northeast Ohio roads"
    ],
    testimonial: {
      text: "I drive from Maple Heights because Nick's is honest and fair. They diagnosed an issue that another shop wanted to charge me double for. Trustworthy team.",
      author: "Denise P.",
      location: "Maple Heights, OH"
    }
  },
  {
    slug: "bedford-auto-repair",
    name: "Bedford",
    metaTitle: "Auto Repair Bedford · 18 Min, Honest Quote First | Nick's",
    metaDescription: "Bedford auto repair at Nick's Tire & Auto. Easy access via Rockside Rd and I-480. Brakes, tires, diagnostics. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR BEDFORD DRIVERS",
    heroSubline: "Bedford drivers choose Nick's Tire & Auto for expert diagnostics, honest assessments, and fair pricing. Easy access via Rockside Road and I-480 — just 18 minutes away.",
    distance: "12 miles",
    driveTime: "18 minutes",
    neighborhoods: ["Rockside Road", "Broadway Avenue", "Northfield Road", "Bedford Commons", "Ellenwood"],
    localContent: "Bedford drivers benefit from easy access to Nick's Tire & Auto via Rockside Road and I-480, making us just an 18-minute drive away. We have built a strong reputation among Bedford residents for honest, transparent auto repair. Our technicians diagnose problems accurately using advanced OBD-II equipment, show you exactly what is wrong before recommending any repairs, and charge fair prices. From routine oil changes and tire rotations to complex engine diagnostics and Ohio E-Check failures, our experienced team handles it all. Bedford drivers who value integrity and quality workmanship choose Nick's because we earn their trust on every visit.",
    serviceHighlights: [
      "Advanced engine diagnostics for check engine and warning lights",
      "Complete brake service with quality OEM-grade parts",
      "New and used tire sales with mounting and balancing",
      "Emissions testing preparation and E-Check repair",
      "Exhaust system diagnosis and repair",
      "General mechanical repair and maintenance"
    ],
    testimonial: {
      text: "Easy drive from Bedford via I-480. Nick's diagnosed a problem that two shops in Bedford missed completely. Fair price, honest people. They earned my trust.",
      author: "Kevin R.",
      location: "Bedford, OH"
    }
  },
  {
    slug: "warrensville-heights-auto-repair",
    name: "Warrensville Heights",
    metaTitle: "Auto Repair Warrensville Heights · 12 Min, Walk-Ins | Nick's",
    metaDescription: "Warrensville Heights auto repair at Nick's Tire & Auto, just 12 min away. Brakes, tires, diagnostics, emissions. Walk-ins 7 days. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nWARRENSVILLE HEIGHTS",
    heroSubline: "Warrensville Heights drivers are just 12 minutes from Nick's Tire & Auto. Located between Cleveland Heights and Garfield Heights, we provide expert auto repair with honest diagnostics and fair pricing.",
    distance: "7 miles",
    driveTime: "12 minutes",
    neighborhoods: ["Warrensville Center Road", "Emery Road", "Miles Road", "Harvard Road", "Chagrin Highlands"],
    localContent: "Warrensville Heights sits conveniently between Cleveland Heights and Garfield Heights, making Nick's Tire & Auto an easy 12-minute drive for residents. We have earned the trust of drivers throughout this community by consistently delivering honest diagnostics and quality repairs at fair prices. Our technicians use advanced diagnostic equipment to pinpoint problems accurately the first time, which saves you money and gets you back on the road faster. Whether you are dealing with a check engine light, need new brakes, or failed your Ohio E-Check, our team delivers the same transparent, high-quality service that has earned us over 1,700 five-star reviews from drivers across the Cleveland metro area.",
    serviceHighlights: [
      "Full diagnostic service for all dashboard warning lights",
      "Brake inspection, repair, and replacement",
      "Tire sales and professional installation from major brands",
      "Ohio E-Check and emissions system diagnosis and repair",
      "Oil change — conventional and full synthetic options",
      "Cooling system service and radiator repair"
    ],
    testimonial: {
      text: "Living in Warrensville Heights, Nick's is the closest honest shop I have found. They show me exactly what is wrong and never push unnecessary work. Great team.",
      author: "Tamika J.",
      location: "Warrensville Heights, OH"
    }
  },
  {
    slug: "beachwood-auto-repair",
    name: "Beachwood",
    metaTitle: "Auto Repair Beachwood · 15 Min, No Dealer Markup | Nick's",
    metaDescription: "Beachwood auto repair at Nick's Tire & Auto, 15 min away via Cedar Rd. Brakes, tires, diagnostics, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nNEAR BEACHWOOD",
    heroSubline: "Beachwood drivers choose Nick's Tire & Auto for honest diagnostics, expert repairs, and fair pricing. Just a quick drive down Cedar Road to Euclid Avenue.",
    distance: "9 miles",
    driveTime: "15 minutes",
    neighborhoods: ["Beachwood Place", "Cedar Road corridor", "Chagrin Boulevard", "Richmond Road", "Commerce Park"],
    localContent: "Beachwood residents value quality and reliability, and that is exactly what Nick's Tire & Auto delivers. Our shop on Euclid Avenue is easily accessible from Beachwood via Cedar Road, making us a convenient choice for all your vehicle maintenance and repair needs. While Beachwood has no shortage of dealerships, many drivers prefer our honest approach: we show you the problem before we fix it, explain every repair in plain language, and charge fair prices. Whether you need brake service, new tires, an oil change, or complex engine diagnostics, our experienced technicians handle it all with the care and precision Beachwood drivers expect.",
    serviceHighlights: [
      "Advanced engine diagnostics for check engine and warning lights",
      "Complete brake service — pads, rotors, calipers, ABS",
      "Tire sales and professional installation from major brands",
      "Ohio E-Check and emissions system diagnosis and repair",
      "Oil change service — conventional and synthetic options",
      "Suspension and steering repair for Northeast Ohio roads"
    ],
    testimonial: {
      text: "I switched from the Beachwood dealership to Nick's and saved hundreds. Same quality work, half the price, and they actually explain what they are doing.",
      author: "Rachel M.",
      location: "Beachwood, OH"
    }
  },
  {
    slug: "mayfield-heights-auto-repair",
    name: "Mayfield Heights",
    metaTitle: "Auto Repair Mayfield Heights · 14 Min Drop-Off | Nick's",
    metaDescription: "Mayfield Heights auto repair at Nick's Tire & Auto, 14 min away. Brakes, tires, diagnostics, emissions. 4.9 stars, honest pricing. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nMAYFIELD HEIGHTS",
    heroSubline: "Mayfield Heights drivers trust Nick's Tire & Auto for quality repairs, honest diagnostics, and fair pricing. Just 14 minutes away on Euclid Avenue.",
    distance: "8 miles",
    driveTime: "14 minutes",
    neighborhoods: ["Mayfield Road", "Golden Gate", "SOM Center Road", "Eastgate", "Lander Road"],
    localContent: "Mayfield Heights residents have easy access to Nick's Tire & Auto via Mayfield Road — a 14-minute drive. The Mayfield Heights pattern: honest diagnostics, quality repairs, fair prices. Our technicians use advanced OBD-II diagnostic equipment to pinpoint problems accurately the first time, which saves money and gets you back on the road faster. Oil change, brake repair, tire service, or complex engine diagnostics — every job handled with care and integrity. Many Mayfield Heights drivers made us their go-to shop after experiencing transparent, fair-priced auto repair.",
    serviceHighlights: [
      "Full diagnostic service for all dashboard warning lights",
      "Brake inspection, repair, and replacement",
      "New and used tire sales with mounting and balancing",
      "Emissions testing preparation and E-Check repair",
      "Oil change — conventional and full synthetic options",
      "General mechanical repair and maintenance"
    ],
    testimonial: {
      text: "Quick drive from Mayfield Heights and always worth it. Nick's diagnosed a noise that two other shops couldn't figure out. Honest and skilled.",
      author: "Steve K.",
      location: "Mayfield Heights, OH"
    }
  },
  {
    slug: "university-heights-auto-repair",
    name: "University Heights",
    metaTitle: "Auto Repair University Heights · Closer Than Dealer | Nick's",
    metaDescription: "University Heights auto repair at Nick's Tire & Auto, 14 min away. Brakes, tires, diagnostics, emissions. 4.9 stars. Walk-ins 7 days. (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nUNIVERSITY HEIGHTS",
    heroSubline: "University Heights drivers trust Nick's Tire & Auto for reliable auto repair. Honest diagnostics, fair pricing, and quality work — just 14 minutes from your door.",
    distance: "8 miles",
    driveTime: "14 minutes",
    neighborhoods: ["Cedar Road", "Warrensville Center Road", "Silsby Road", "Bushnell Road", "John Carroll area"],
    localContent: "University Heights sits right between South Euclid and Cleveland Heights, making Nick's Tire & Auto an easy 14-minute drive for residents. We serve the University Heights community with the same honest, expert service that has earned us a 4.9-star rating and over 1,700 five-star reviews. Our technicians understand Northeast Ohio driving conditions and provide thorough diagnostics using advanced OBD-II equipment. Whether you need brake work, tire replacement, an oil change, or complex engine diagnostics, we treat your car with the same care we would give our own. Many University Heights residents have made us their regular shop after experiencing our transparent pricing and no-pressure approach.",
    serviceHighlights: [
      "Check engine light diagnosis and repair",
      "Complete brake service — pads, rotors, calipers, and ABS",
      "Tire sales and professional installation from major brands",
      "Ohio E-Check and emissions system repair",
      "Oil change service — conventional and synthetic options",
      "Cooling system service and radiator repair"
    ],
    testimonial: {
      text: "Living near John Carroll, I needed a trustworthy shop. Nick's was recommended by a neighbor and they have been fantastic. Fair prices and honest work every time.",
      author: "Daniel F.",
      location: "University Heights, OH"
    }
  },
];

export function getCityBySlug(slug: string): CityData | undefined {
  return CITIES.find(c => c.slug === slug);
}
