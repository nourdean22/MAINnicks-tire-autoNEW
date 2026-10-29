/**
 * Content for /discounts and /discounts/:slug (2026-10-29).
 *
 * The TERMS (offer, who qualifies, proof, fine print) live in
 * DISCOUNT_PROGRAMS in ./business.ts and are rendered from there; this file
 * holds only what is specific to each audience. Never type an offer figure
 * here: canonical-business-truth.test.ts fails on one.
 *
 * Each page has to stand on its own. Google's spam policy names "substantially
 * similar pages" as doorway abuse, and discount-pages.test.tsx caps the word
 * overlap between any two pages.
 */
import { BUSINESS, DISCOUNT_PROGRAMS, type DiscountGroup } from "./business";

export interface DiscountPageContent {
  slug: string;
  groupId: DiscountGroup["id"];
  metaTitle: string;
  metaDescription: string;
  h1: string;
  intro: string;
  sections: { heading: string; body: string }[];
  faqs: { q: string; a: string }[];
  related: { href: string; label: string }[];
}

export function getDiscountGroup(id: string): DiscountGroup | undefined {
  return DISCOUNT_PROGRAMS.groups.find((g) => g.id === id);
}

const seniors = getDiscountGroup("seniors")!;
const { usedTires, oilChange } = BUSINESS;

export const DISCOUNT_PAGES: DiscountPageContent[] = [
  {
    slug: "military-veterans",
    groupId: "military",
    metaTitle: "Military & Veteran Discount, Tires & Repair · Cleveland",
    metaDescription: "Military and veteran discount on tires, brakes and repairs at Nick's Tire & Auto on Euclid Ave, Cleveland. Show your ID at the counter. Walk in 7 days.",
    h1: "Military and veteran discount on auto repair in Cleveland",
    intro: "If you served, or serve now, show your ID at the counter and the discount comes off your labor. Everything else works the way it does for every customer here: a free quick check, a written estimate, and no work until you say yes.",
    sections: [
      {
        heading: "Coming back to a car that sat",
        body: "A car parked for a deployment or a long stretch away comes back with problems a daily driver never has. The battery drains flat. Tires sit in one spot and can flat-spot or slowly lose air. Brake rotors rust over, and the first few stops grind until the rust wears off. Old fuel and old oil are worth a look too. Bring it in before you rely on it again: we check the battery, tires, brakes and fluids, then tell you what needs doing now and what can wait.",
      },
      {
        heading: "Before a long drive on orders",
        body: "Moving to a new duty station or driving home on leave puts a lot of highway miles on a car at once. A look at tread depth, tire age, brake pads and cooling hoses before you leave heads off most roadside calls. If a job can wait until you get where you are going, we say so.",
      },
      {
        heading: "Proof without the paperwork",
        body: "A veteran mark on an Ohio driver license counts, so there is no need to carry discharge papers around. If your proof is not on the list, ask at the counter before the job is written up and we will tell you straight whether it works.",
      },
    ],
    faqs: [
      { q: "Do Guard and Reserve members get the military discount?", a: "Yes. National Guard and Reserve members qualify the same as active duty, retirees and veterans. Bring an ID that shows your service." },
      { q: "Does the military discount cover tire installs?", a: "It comes off labor, so it covers mounting and installing new or used tires. It does not apply on top of a tire sale price." },
      { q: "My car sat in storage while I was deployed. What should I check first?", a: "Start with the battery and the tires, the two things that fail first on a car that sat. A free quick check tells you where you stand before you drive it far." },
    ],
    related: [
      { href: "/battery", label: "Battery testing and replacement" },
      { href: "/brakes", label: "Brake repair" },
      { href: "/tires", label: "New and used tires" },
    ],
  },
  {
    slug: "first-responders",
    groupId: "first-responders",
    metaTitle: "Police, Fire & EMS Discount on Car Repair · Cleveland",
    metaDescription: "Discount on tires, brakes and repairs for police, firefighters, EMTs, paramedics and 911 dispatchers at Nick's Tire & Auto, Euclid Ave, Cleveland.",
    h1: "Discount for police, firefighters, EMS and 911 dispatchers",
    intro: "This page covers officers, firefighters, EMTs, paramedics and the dispatchers who send them out. Volunteer firefighters count too. Show your department or agency ID before we write up the job.",
    sections: [
      {
        heading: "Built around shift work",
        body: "Twenty-four hour shifts, rotating nights and overtime make a weekday repair hard to fit in. We are open seven days, Sunday included, and there is no appointment to book. Drop the car on your way in or on a day off, and we call you with the written estimate before anyone touches it.",
      },
      {
        heading: "Your own car takes the beating",
        body: "The department maintains the cruiser and the engine. Your own car is the one that gets you to a station across the county at five in the morning in a January storm. Long commutes wear tires and brakes, and a battery that is weak in the fall tends to quit on the first cold morning. Tell us your commute and we will tell you what to watch.",
      },
      {
        heading: "Dispatchers and EMS crews count the same",
        body: "911 dispatchers, EMTs and paramedics qualify the same as officers and firefighters. If your agency ID is not handy, an Ohio EMS certification card with a photo ID works.",
      },
    ],
    faqs: [
      { q: "Do volunteer firefighters qualify?", a: "Yes. Bring your department ID, the same as a career firefighter." },
      { q: "Is the discount for my personal car or a department vehicle?", a: "It is for the car you drive yourself. Department and city vehicles go through our fleet accounts instead." },
      { q: "Can I drop the car off before a 24-hour shift?", a: "Yes. Leave it with a number we can reach, and we call with the estimate. Nothing gets done until you approve it." },
    ],
    related: [
      { href: "/fleet", label: "Fleet accounts for departments" },
      { href: "/winter-car-care-cleveland", label: "Winter car care" },
      { href: "/brakes", label: "Brake repair" },
    ],
  },
  {
    slug: "college-students",
    groupId: "students",
    metaTitle: "College Student Discount on Car Repair · Cleveland",
    metaDescription: "Student discount on labor for tires, brakes, oil changes and repairs. Show a current student ID at Nick's Tire & Auto, Euclid Ave, Cleveland. Walk in 7 days.",
    h1: "College student discount on car repair in Cleveland",
    intro: "Full time or part time, university or trade school: a current student ID gets you the discount on labor. You get the same written estimate as everyone else, and you decide what gets done.",
    sections: [
      {
        heading: "Your first Cleveland winter",
        body: "Students from somewhere warmer find out fast what lake-effect snow, road salt and potholes do to a car. Before the first snow, check three things: tread depth, battery strength and wiper blades. A free quick check covers all of them, and we will tell you which one can wait until the next paycheck.",
      },
      {
        heading: "An older car on a student budget",
        body: `Most student cars are older with plenty of miles. We start with the repair that keeps you safe, then list what can wait, in writing, so you can plan for it. Used tires start ${usedTires.priceDisplay} (${usedTires.fineprint}; ${usedTires.typicalBand}). For a bigger bill, Payment Programs can split the cost, and each provider decides approval.`,
      },
      {
        heading: "Buying a used car near campus",
        body: "Have it looked at before you hand over the money. A pre-purchase inspection shows rust, leaks and worn parts the seller may not mention, and it costs far less than a bad engine.",
      },
    ],
    faqs: [
      { q: "Do trade school and community college students qualify?", a: "Yes. Any college, university or trade school counts, as long as your student ID is current." },
      { q: "Do I need a parent with me?", a: "No. The estimate is in writing, so you can share it with whoever helps pay for the car before you say yes." },
      { q: "Is the student discount good on an oil change?", a: "Yes, it comes off the labor on any service, an oil change included. It does not combine with an oil coupon, so use whichever saves you more." },
    ],
    related: [
      { href: "/used-tires-cleveland", label: "Used tires in Cleveland" },
      { href: "/pre-purchase-inspection", label: "Pre-purchase inspection" },
      { href: "/financing", label: "Payment Programs" },
    ],
  },
  {
    slug: "seniors",
    groupId: "seniors",
    metaTitle: "Senior Discount on Auto Repair & Tires · Cleveland",
    metaDescription: `Senior discount on labor for ${seniors.qualifies.toLowerCase()} at Nick's Tire & Auto, Euclid Ave, Cleveland. Written estimate first, plain answers, walk in 7 days.`,
    h1: "Senior discount on auto repair in Cleveland",
    intro: "Show any photo ID with your date of birth when you come in and the discount comes off your labor. You get plain answers and the price in writing before any work starts.",
    sections: [
      {
        heading: "Plain answers, in writing",
        body: "We look before we talk price, show you the worn part, and write the estimate down before any work starts. If something can wait, we tell you that too. You can take the estimate home, think it over, or call a family member first. Nobody at the counter will rush you.",
      },
      {
        heading: "A car that is not driven much",
        body: "A car that mostly makes short trips for errands and appointments has different problems than a commuter car. Short trips never fully recharge the battery. Tires can crack with age long before the tread wears out, so the age of a tire matters as much as its tread. Brakes can rust from sitting. Ask for a free quick check if the car has been parked a while.",
      },
      {
        heading: "Stay or drop it off",
        body: "For a short job, have a seat and we give you an honest time. For a longer one, drop the car off and we call you when it is done.",
      },
    ],
    faqs: [
      { q: "What age is the senior discount?", a: `${seniors.qualifies}. Any photo ID with your date of birth works.` },
      { q: "How do I know if my tires are too old?", a: "Every tire has a four-digit date code on the sidewall: the week and the year it was made. We read it during a free quick check and tell you if the rubber is getting too old, even when the tread looks fine." },
      { q: "Can I use the senior discount with a coupon?", a: "No, it is one discount per visit. If a coupon saves you more, use the coupon and we will apply that instead." },
    ],
    related: [
      { href: "/battery-keeps-dying", label: "Battery keeps dying?" },
      { href: "/tires", label: "Tires" },
      { href: "/brakes", label: "Brake repair" },
    ],
  },
  {
    slug: "rideshare-delivery-drivers",
    groupId: "gig-drivers",
    metaTitle: "Uber, Lyft & DoorDash Driver Car Repair Discount · Cleveland",
    metaDescription: "Discount on labor for rideshare and delivery drivers: tires, brakes, oil. Walk in 7 days at Nick's Tire & Auto, Euclid Ave, Cleveland. Show your driver app.",
    h1: "Car repair discount for rideshare and delivery drivers",
    intro: "Open your driver profile at the counter and the discount comes off your labor. Nick's Tire & Auto is an independent shop and is not connected to any of these apps.",
    sections: [
      {
        heading: "An hour in the shop is an hour you are not earning",
        body: `We are first come, first served, seven days a week, with no appointment to wait for. Used tire installs usually take ${usedTires.turnaround.toLowerCase()}. A conventional oil change is ${oilChange.conventionalPrice} and synthetic is ${oilChange.syntheticPrice}. Tell us how long you can be off the road and we tell you honestly whether the job fits that window.`,
      },
      {
        heading: "Driving for a living wears a car faster",
        body: "Delivery and rideshare miles are mostly stop-and-go city miles, which are hard on brakes, tires and oil. Potholes on side streets knock the alignment out, and a car out of line eats the inside edge of its tires. Watch for brake noise, a pull to one side, and tread that wears unevenly across the tire.",
      },
      {
        heading: "Catch it before it costs you a shift",
        body: "A dead battery or a flat at the start of a shift costs you the shift. A free quick check every few months catches a weak battery or a nail in the tread before it strands you mid-order.",
      },
    ],
    faqs: [
      { q: "Do I need to drive full time to qualify?", a: "No. Part-time drivers qualify too, as long as the driver profile in the app is active." },
      { q: "Can you fix a flat while I wait?", a: "Most flat repairs are done while you wait. If the tire cannot be safely repaired, we show you the damage and tell you why." },
      { q: "Is Nick's connected to any of the driver apps?", a: "No. We are an independent shop. The discount is ours, and it works the same no matter which app you drive for." },
    ],
    related: [
      { href: "/oil-change", label: "Oil change" },
      { href: "/alignment", label: "Wheel alignment" },
      { href: "/used-tires-cleveland", label: "Used tires" },
    ],
  },
  {
    slug: "teachers",
    groupId: "teachers",
    metaTitle: "Teacher Discount on Car Repair & Tires · Cleveland",
    metaDescription: "Teachers, aides and school staff get a discount on labor at Nick's Tire & Auto, Euclid Ave, Cleveland. Walk in 7 days, Saturday and Sunday included.",
    h1: "Teacher discount on car repair in Cleveland",
    intro: "Classroom teachers, aides, counselors, coaches and office staff all count. Bring your school badge or a recent pay stub and the discount comes off your labor.",
    sections: [
      {
        heading: "When the school day leaves no time",
        body: "A school day can start before we open and end with a pile of grading. That is why we are open Saturday and Sunday, and why drop-offs work: leave the car, get a ride, and we call you with the written estimate.",
      },
      {
        heading: "Save the big jobs for the breaks",
        body: "Winter break, spring break and summer are the easy times for a bigger job like brakes, a timing belt or a set of tires, because you can go without the car for a day. Before driving somewhere for the holidays, a free quick check on the tires and battery is worth the stop.",
      },
      {
        heading: "A trunk full of supplies",
        body: "Teachers carry a lot: books, supplies, projects to grade. Extra weight wears tires and brakes a little faster, and a soft tire under a heavy load is a blowout risk. Once the weather turns cold, check tire pressure every month.",
      },
    ],
    faqs: [
      { q: "Do aides, coaches and cafeteria staff count?", a: "Yes. Anyone who works at a K-12 school and can show a school badge or a pay stub qualifies." },
      { q: "Do college professors qualify?", a: "This discount is for K-12 schools. College students have their own discount; see the student page." },
      { q: "Can I drop my car off on a school day?", a: "Yes. Leave it with a phone number and we call with the estimate before any work starts." },
    ],
    related: [
      { href: "/tires", label: "Tires" },
      { href: "/winter-car-care-cleveland", label: "Winter car care" },
      { href: "/brakes", label: "Brake repair" },
    ],
  },
  {
    slug: "healthcare-workers",
    groupId: "healthcare",
    metaTitle: "Nurse & Healthcare Worker Car Repair Discount · Cleveland",
    metaDescription: "Nurses, aides, techs and hospital staff get a discount on labor at Nick's Tire & Auto on Euclid Ave, Cleveland. Open 7 days for shift workers.",
    h1: "Car repair discount for nurses and healthcare workers",
    intro: "Hospital floor, clinic, nursing home or home health: show your badge or license card at the counter and the discount comes off your labor.",
    sections: [
      {
        heading: "On Euclid Ave, the same road as the hospitals",
        body: "Our shop is on Euclid Ave, the same road that runs past University Circle and Cleveland Clinic's main campus. If you work a hospital shift on the east side, getting here is a straight drive east on Euclid.",
      },
      {
        heading: "Twelve-hour shifts and night shifts",
        body: "After a night shift, a car that will not start in the parking garage is a long wait for a jump. A weak battery and a slow leak in a tire are the usual culprits on a car that sits through a long shift in the cold. A free quick check finds both before they leave you stuck.",
      },
      {
        heading: "Home health and visiting nurses",
        body: "If you drive from patient to patient, your car is part of your job. Those miles wear brakes and tires fast, so keep up with oil changes and rotate the tires so they wear evenly. A car that will not start in a patient's driveway puts your whole schedule behind, so if the battery is more than a few years old, have it tested before winter.",
      },
    ],
    faqs: [
      { q: "Do home health aides qualify?", a: "Yes. Show your agency ID badge." },
      { q: "Do nursing students qualify?", a: "Nursing students qualify under the student discount with a current student ID." },
      { q: "I work nights. When can I come in?", a: "Drop the car off on your way home in the morning, get some sleep, and we call with the estimate. Nothing is done until you approve it." },
    ],
    related: [
      { href: "/car-wont-start", label: "Car won't start?" },
      { href: "/oil-change", label: "Oil change" },
      { href: "/tires", label: "Tires and tire repair" },
    ],
  },
  {
    slug: "dancers",
    groupId: "dancers",
    metaTitle: "Dancer & Performer Discount on Car Repair · Cleveland",
    metaDescription: "Working dancers and performers get a discount on labor at Nick's Tire & Auto, Euclid Ave, Cleveland. Studio, stage and club. Walk in 7 days.",
    h1: "Car repair discount for dancers and performers",
    intro: "If dance or performing is your work, bring proof of it to the counter and the discount comes off your labor. Studio, stage, company and club all count the same.",
    sections: [
      {
        heading: "Late nights and empty parking lots",
        body: "When a set ends at two in the morning, the car has to start. A battery that cranks slowly, a tire that keeps losing air or a check-engine light you have been putting off is worth fixing before it leaves you stuck in a dark lot. A free quick check tells you which of those is urgent.",
      },
      {
        heading: "Gear, costumes and drives to gigs",
        body: "Performers drive a lot: rehearsals, auditions, shows across the region. Before a long drive to a gig, look at tread and tire pressure, and listen for brakes that squeal. Bags of gear in the trunk add weight, so keep the tires at the pressure printed on the door sticker.",
      },
      {
        heading: "Income that moves around",
        body: "Pay that changes week to week makes a surprise repair bill hard. You get a written estimate first, with what is urgent separated from what can wait. For a bigger job, Payment Programs can split the cost; each provider decides approval.",
      },
    ],
    faqs: [
      { q: "Does the discount cover club dancers?", a: "Yes. Club, studio, company and stage dancers all qualify with the same proof." },
      { q: "Do dance teachers qualify?", a: "Yes, if dance is your work. A studio ID shows that." },
      { q: "Can I come in after a late show?", a: "We are not open overnight. Drop the car off when we open and we call you when it is ready." },
    ],
    related: [
      { href: "/battery", label: "Battery testing" },
      { href: "/check-engine-light-on", label: "Check engine light on?" },
      { href: "/financing", label: "Payment Programs" },
    ],
  },
  {
    slug: "fighters",
    groupId: "fighters",
    metaTitle: "Fighter Discount: Boxing, MMA & BJJ Car Repair · Cleveland",
    metaDescription: "Boxers, MMA fighters, wrestlers and grapplers get a discount on labor at Nick's Tire & Auto, Euclid Ave, Cleveland. Show your gym card. Walk in 7 days.",
    h1: "Car repair discount for fighters and combat-sports athletes",
    intro: "Amateur or pro, striking or grappling: show your gym card or fighter license and the discount comes off your labor.",
    sections: [
      {
        heading: "Two-a-days in camp",
        body: "Fight camp means driving to the gym twice a day, often before sunrise and after dark. That is a lot of short trips, which are hard on a battery and on oil. If the car is due for an oil change or the battery is getting old, take care of it before camp starts, not in fight week.",
      },
      {
        heading: "Wet gear in a closed car",
        body: "Sweaty gear, wet wraps and gis left in the car all day put a lot of moisture into the cabin. That fogs the windows in winter and can leave the cabin air filter musty. Swapping that filter is a small job, and we can do it while you wait.",
      },
      {
        heading: "Driving to a fight out of town",
        body: "Before a long drive to a weigh-in, have the tires and brakes looked at. A blown tire on the highway the day before weigh-ins can cost you the fight. A free quick check covers tread, tire pressure and brakes. If your coach or a teammate is riding with you, that is more weight and more reason to have the tires at the right pressure.",
      },
    ],
    faqs: [
      { q: "Do amateur fighters qualify?", a: "Yes. Amateur and pro both count. A gym card shows you train." },
      { q: "Do I need a fighter license?", a: "No. A gym membership card, or the gym's app on your phone, works too." },
      { q: "Does jiu-jitsu or wrestling count?", a: "Yes. Grappling counts the same as striking." },
    ],
    related: [
      { href: "/oil-change", label: "Oil change" },
      { href: "/battery", label: "Battery testing" },
      { href: "/tires", label: "Tires" },
    ],
  },
  {
    slug: "lgbtq-friendly",
    groupId: "lgbtq",
    metaTitle: "LGBTQ+ Friendly Auto Repair & Tire Shop · Cleveland",
    metaDescription: "LGBTQ+ friendly tire and auto repair on Euclid Ave, Cleveland. Same fair price for everyone, a written estimate first, and respect at the counter.",
    h1: "LGBTQ+ friendly auto repair in Cleveland",
    intro: "Everyone who walks into Nick's Tire & Auto gets the same thing: a free quick check, a written estimate, a straight answer and the same fair price. That includes LGBTQ+ drivers. There is no special price here, because a price should never depend on who you are.",
    sections: [
      {
        heading: "What to expect at the counter",
        body: "We use the name you give us. We explain what is wrong with the car, show you the worn part, and put the price in writing before any work starts. Nobody here will talk down to you about your car, and nobody will push work you did not ask for.",
      },
      {
        heading: "One price for everyone",
        body: "Prices here do not change with who you are. If you are also a student, a veteran, a first responder, a senior or in one of the other groups on our discounts page, that discount applies to you the same as anyone else.",
      },
      {
        heading: "If something is not right",
        body: "If anyone at the shop treats you with less respect than any other customer, ask for the manager or call the shop. We want to hear about it.",
      },
    ],
    faqs: [
      { q: "Is there an LGBTQ+ discount?", a: "No. Prices are the same for everyone, and a price should never depend on who you are. If you qualify for one of our other discounts, it applies to you." },
      { q: "Can I bring my partner or a friend to the counter?", a: "Yes. Anyone you want can be part of the conversation about the car and the estimate." },
      { q: "Will you use my name and pronouns?", a: "Yes. Tell us the name and pronouns you use, and we use them." },
    ],
    related: [
      { href: "/about", label: "About Nick's" },
      { href: "/reviews", label: "Customer reviews" },
      { href: "/services", label: "All services" },
    ],
  },
];

// The hub's <title> and description live in ./routes.ts (validate:routes reads them as text).
export const DISCOUNTS_HUB = {
  h1: "Auto repair discounts at Nick's Tire & Auto",
  intro: "Show your proof at the counter and the discount comes off the labor on your bill. Find your group below to see who qualifies and what proof works.",
  faqs: [
    { q: "Can I combine two discounts?", a: "No. It is one discount per visit, and it does not combine with coupons or specials. Use whichever saves you more." },
    { q: "Does the discount work on tires?", a: "It comes off labor, so it covers mounting and installing tires. It does not apply to tires already on sale." },
    { q: "Do I need an appointment?", a: "No. Walk in any day we are open, first come, first served. For longer jobs, drop the car off and we call when it is ready." },
  ],
};

export function getDiscountPageBySlug(slug: string): DiscountPageContent | undefined {
  return DISCOUNT_PAGES.find((p) => p.slug === slug);
}

/**
 * The FAQ a page shows and marks up. Offer groups get one answer built from
 * DISCOUNT_PROGRAMS first, so the terms are never retyped per page.
 */
export function buildDiscountFaqs(page: DiscountPageContent): { q: string; a: string }[] {
  const group = getDiscountGroup(page.groupId);
  if (!group?.offer) return page.faqs;
  const { display, finePrint } = DISCOUNT_PROGRAMS.offer;
  return [
    {
      q: `How does the ${group.label.toLowerCase()} discount work?`,
      a: `${display}. Who qualifies: ${group.qualifies}. Bring one of these: ${group.proof.join("; ")}. ${finePrint.join(" ")}`,
    },
    ...page.faqs,
  ];
}
