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
    metaTitle: "Auto Repair in Euclid, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair shop serving Euclid, Ohio. Brakes, tires, diagnostics, emissions, and oil changes. Located on Euclid Ave, minutes from downtown Euclid. Call (216) 862-0005.",
    heroHeadline: "EUCLID'S TRUSTED\nAUTO REPAIR SHOP",
    heroSubline: "Located right on Euclid Avenue, we have been serving Euclid drivers with honest diagnostics, fair pricing, and expert repairs. From brake jobs to E-Check failures, our technicians handle it all.",
    distance: "0.5 miles",
    driveTime: "2 minutes",
    neighborhoods: ["Downtown Euclid", "Indian Hills", "Euclid Green", "Bluestone", "Upson"],
    localContent: "Nick's Tire & Auto sits right on Euclid Avenue, making us the most convenient auto repair option for Euclid residents. Whether you are coming from Indian Hills, Euclid Green, or anywhere along Lakeshore Boulevard, we are just minutes away. Our shop handles everything from routine oil changes to complex engine diagnostics, and we have built a reputation in the Euclid community for transparent pricing and honest work.",
    serviceHighlights: [
      "Ohio E-Check and emissions repair for Euclid vehicles",
      "Brake inspection and repair with same-day service",
      "Full tire selection — mounting, balancing, and rotation",
      "Check engine light diagnostics using advanced OBD-II scanners",
      "Suspension and steering repair for Northeast Ohio roads",
      "Synthetic and conventional oil changes"
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
    metaTitle: "Auto Repair Near Lakewood, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Reliable auto repair serving Lakewood, Ohio drivers. Brakes, tires, diagnostics, emissions testing, and general repair. Worth the short drive for honest service. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR FOR\nLAKEWOOD DRIVERS",
    heroSubline: "Lakewood drivers trust Nick's Tire & Auto for honest diagnostics and expert repairs. Our experienced technicians handle brakes, tires, emissions, and engine diagnostics at fair prices.",
    distance: "12 miles",
    driveTime: "20 minutes",
    neighborhoods: ["Birdtown", "Gold Coast", "Rockport", "Downtown Lakewood", "Clifton Park"],
    localContent: "Many Lakewood residents make the short drive to Nick's Tire & Auto because they value honest, transparent auto repair. We understand that Lakewood drivers have plenty of local options, and we earn their trust by showing them the problem before we fix it, explaining every repair in plain language, and charging fair prices. Whether you are dealing with a check engine light, need new tires, or failed your E-Check, our team delivers the same quality service that has earned us over 1,600 five-star reviews.",
    serviceHighlights: [
      "Complete brake service — pads, rotors, calipers, and ABS diagnostics",
      "Tire sales and installation from all major brands",
      "Advanced engine diagnostics for check engine lights",
      "Ohio E-Check and emissions system repair",
      "Cooling system, belts, and hose replacement",
      "Steering and suspension repair"
    ],
    testimonial: {
      text: "I drive from Lakewood because I trust them. They diagnosed a problem two other shops missed. Fair price, great work.",
      author: "Jennifer S.",
      location: "Lakewood, OH"
    }
  },
  {
    slug: "parma-auto-repair",
    name: "Parma",
    metaTitle: "Auto Repair Near Parma, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Parma, Ohio. Expert brake, tire, diagnostic, and emissions repair. Over 1,600 five-star reviews. Call Nick's Tire & Auto at (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR PARMA DRIVERS",
    heroSubline: "Parma drivers choose Nick's Tire & Auto for expert diagnostics, quality repairs, and fair pricing. Our technicians treat every vehicle like their own.",
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
    slug: "east-cleveland-auto-repair",
    name: "East Cleveland",
    metaTitle: "Auto Repair Near East Cleveland, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving East Cleveland, Ohio. Brakes, tires, engine diagnostics, emissions repair, and more. Conveniently located on Euclid Ave. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Shaker Heights, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Shaker Heights, Ohio. Expert brake, tire, diagnostic, and emissions repair. Over 1,685 five-star reviews. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Cleveland Heights, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving Cleveland Heights, Ohio. Brakes, tires, engine diagnostics, emissions repair, and more. 4.9 stars, 1,685+ reviews. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Mentor, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Mentor, Ohio. Expert brake, tire, diagnostic, and emissions repair. Honest pricing, 4.9 stars. Call Nick's Tire & Auto at (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Strongsville, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving Strongsville, Ohio. Brakes, tires, diagnostics, emissions, and general repair. 4.9 stars, 1,685+ reviews. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Near South Euclid, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving South Euclid, Ohio. Expert brake, tire, diagnostic, and emissions repair. Honest pricing. Call Nick's Tire & Auto at (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nNEAR SOUTH EUCLID",
    heroSubline: "South Euclid drivers are just minutes from Nick's Tire & Auto. Expert diagnostics, honest assessments, and fair pricing on every repair.",
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
    metaTitle: "Auto Repair Near Garfield Heights, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving Garfield Heights, Ohio. Brakes, tires, engine diagnostics, emissions repair. 4.9 stars. Call Nick's Tire & Auto at (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Richmond Heights, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Richmond Heights, Ohio. Expert brake, tire, diagnostic, and emissions repair. Honest pricing, 4.9 stars. Call (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nNEAR RICHMOND HEIGHTS",
    heroSubline: "Richmond Heights drivers choose Nick's Tire & Auto for honest diagnostics, expert repairs, and transparent pricing. Just minutes from Richmond Heights on Euclid Avenue.",
    distance: "6 miles",
    driveTime: "13 minutes",
    neighborhoods: ["Center Plaza", "Richmond Center", "Gates Mills border", "Peacock Creek", "Emerson Circle"],
    localContent: "Richmond Heights residents benefit from our convenient location on Euclid Avenue, making us an easy choice for all your auto repair needs. We serve the Richmond Heights community with the same honest, expert service that has earned us a 4.9-star rating and over 1,685 five-star reviews. Our technicians understand Northeast Ohio driving conditions and provide thorough diagnostics using advanced OBD-II equipment. Whether you need an oil change, brake repair, tire service, or complex engine diagnostics, we handle every job with care and integrity.",
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
    metaTitle: "Auto Repair Near Lyndhurst, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving Lyndhurst, Ohio. Brakes, tires, engine diagnostics, emissions repair, and general service. 4.9 stars. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Near Willoughby, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Willoughby, Ohio. Expert brake, tire, diagnostic, and emissions repair. Honest service, 4.9 stars. Call (216) 862-0005.",
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
    metaTitle: "Auto Repair Cleveland OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Cleveland's #1 auto repair shop and tire specialist. 1,685+ Google reviews, 4.9 stars. Tires, brakes, diagnostics, emissions, oil changes. Walk-ins 7 days. $10 down financing.",
    heroHeadline: "CLEVELAND'S #1 AUTO\nREPAIR & TIRE SHOP",
    heroSubline: "Nick's Tire & Auto is Cleveland's top-rated shop for a reason. With over 1,685 five-star reviews, honest diagnostics, and the largest new and used tire selection in the area, we are the shop Cleveland trusts.",
    distance: "0 miles",
    driveTime: "You're here",
    neighborhoods: ["Downtown Cleveland", "East Side", "West Side", "Collinwood", "Nottingham", "Five Points", "University Circle", "Tremont", "Ohio City", "Slavic Village", "Glenville", "Hough"],
    localContent: "Nick's Tire & Auto is located at 17625 Euclid Avenue in the heart of Cleveland's East Side. Since 2018, we have built a reputation as the most trusted auto repair shop in Cleveland. Our secret is simple: honest diagnostics, transparent pricing, and quality work. We never sell you services you don't need. We show you the problem, explain your options, and let you decide. That approach has earned us 1,685+ five-star Google reviews and a 4.9-star rating — the highest of any independent shop in Cleveland. Whether you need new tires, brake repair, engine diagnostics, emissions testing, or any other service, Nick's is the shop Cleveland trusts. Walk-ins welcome 7 days a week, and we offer $10 down financing through Acima, Koalafi, Snap Finance, and American First Finance.",
    serviceHighlights: [
      "Cleveland's largest new and used tire selection with free premium installation",
      "Expert brake repair — pads, rotors, calipers, ABS diagnostics",
      "Advanced engine diagnostics with OBD-II and factory-level scanners",
      "Ohio E-Check and emissions repair — we get you passing",
      "Quick oil changes — conventional and synthetic",
      "Transmission, suspension, electrical, and general repair",
      "$10 down auto repair financing — all credit welcome",
      "Walk-ins welcome 7 days a week, Monday through Sunday"
    ],
    testimonial: {
      text: "I have been going to Nick's for five years. They have worked on every car in my family. Honest, fast, and the prices are always fair. Best shop in Cleveland, hands down.",
      author: "James W.",
      location: "Cleveland, OH"
    }
  }
];

export function getCityBySlug(slug: string): CityData | undefined {
  return CITIES.find(c => c.slug === slug);
}
