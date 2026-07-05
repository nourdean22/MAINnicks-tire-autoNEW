/**
 * NonstopNickPage — the "Nonstop Nick" $7.99/mo tire membership.
 *
 * Model (per docs/2026-05-30-nonstop-nick-design.md): a loyalty/peace-of-mind
 * membership sold like a gym/AAA — most members pay and rarely trigger it
 * (breakage), but when they need it, no problem. The COPY sells absurd
 * convenience + delight; the breakage mechanism is never telegraphed.
 *
 * Voice (locked): "Pull up. We got it." Lead on effortless convenience, not a
 * parts-list ROI. "Cancel anytime" stays a quiet reassurance, never a headline.
 *
 * Build status: Chunk 1 of 5 (the page). The Join CTA points at the membership
 * Stripe Checkout once chunks 3-4 (checkout + webhook) are live + env is wired;
 * until then it falls back to call/walk-in (honest — you CAN sign up in person).
 */
import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import NonstopNickJoin from "@/components/NonstopNickJoin";

const CONFIG: ServicePageConfig = {
  // One-tap Join card rendered near the fold (under the AEO answer). Stripe-backed
  // when STRIPE_NONSTOP_NICK_PRICE_ID is set; degrades to call/walk-in until then.
  signupSlot: <NonstopNickJoin source="membership_page" />,
  canonicalPath: "/nonstop-nick",
  title: "Nonstop Nick — $7.99/mo Tire Membership | Nick's Tire & Auto",
  description:
    "Pull up, we got it. $7.99/mo covers the little tire stuff on one registered vehicle — flat repairs, valve stems, rotation, air-ups. No appointment. (216) 862-0005",
  eyebrow: "NONSTOP NICK · $7.99/MO",
  h1: "PULL UP.\nWE GOT IT.",
  sub: "Flat on the way to work? Slow leak that's been bugging you for weeks? With Nonstop Nick, you pull into Nick's on Euclid Ave, hand us the keys, and we handle it. No appointment. If it's in the plan, it's covered — and if something's outside the plan, we tell you before any work moves forward. $7.99 a month and the little tire stuff stops being your problem. 4.9★ from 1,700+ Cleveland drivers.",
  // Non-dollar startingPrice → shows as a draw chip (not a price-at-the-door).
  startingPrice: "Members: pull up anytime",

  pricingTitle: "WHAT \"WE GOT IT\" ACTUALLY MEANS",
  pricingSub: "One membership, one vehicle, no appointment — pull up 7 days a week and we handle it. $7.99/month, cancel any time you want.",
  tiers: [
    {
      name: "The Stuff That Ruins Your Morning",
      price: "Covered",
      sub: "flat repairs · rubber valve stems · slow leaks",
      use: "Nail, screw, slow leak? Tread-area puncture plugged and patched, valve stem swapped. The worry just… goes away.",
    },
    {
      name: "The Keep-It-Rolling Stuff",
      price: "Covered",
      sub: "tire rotation · air-up · tread check",
      use: "Roll in anytime to top off your air, get a tread read, or have your tires rotated so they last. The pull-up-whenever habit that makes $7.99 feel like a steal.",
      featured: true,
    },
    {
      name: "The Little Extras",
      price: "Covered",
      sub: "rim cleans · wiper & bulb swaps",
      use: "Clean wheels because they just feel better. Wiper blade or bulb gone? Bring the part, we'll put it on. We're already taking care of you — might as well.",
    },
  ],

  includedTitle: "THE FINE PRINT, IN PLAIN ENGLISH",
  includedSub: "We tell you what's in and what's out, up front — so you always know before you pull in. One registered vehicle, rims up to 19\".",
  included: [
    "Tread-area flat repairs (plug + patch)",
    "Rubber valve stem replacement",
    "Tire rotation",
    "Rim cleans",
    "Air top-off + tread check, pull up anytime",
    "Wiper blade & bulb swaps (you bring the part)",
    "One registered vehicle, rims up to 19\"",
    "Cancel any time — no contract, no cancellation fee",
  ],

  faqs: [
    {
      q: "What does Nonstop Nick cost?",
      a: "$7.99 a month, billed automatically. Cancel any time you want — no contract, no cancellation fee.",
    },
    {
      q: "Do I need an appointment?",
      a: "Never. Pull up to 17625 Euclid Ave in Cleveland (Euclid), 7 days a week, and we'll take care of you. That's the whole point.",
    },
    {
      q: "What's actually covered?",
      a: "Tread-area flat repairs, rubber valve stems, tire rotation, rim cleans, and air-ups with a tread check — on one registered vehicle — plus wiper and bulb swaps if you bring the part.",
    },
    {
      q: "What's not covered?",
      a: "Towing, sidewall damage (a sidewall puncture means a new tire, not a repair), TPMS sensors and TPMS valve stems, rims over 19 inches, and the wiper/bulb part itself. Members get our fair price on anything that's not included — we'll always tell you up front.",
    },
    {
      q: "Can I cancel?",
      a: "Any time, in seconds. No contract and no cancellation fee — we'd rather you stay because it's easy than because you're stuck.",
    },
    {
      q: "Does it work on any car?",
      a: "One registered vehicle per membership, with rims up to 19 inches. Got a second car? Just start a second membership.",
    },
    {
      q: "What's the $9.99 plan?",
      a: "Nonstop Nick+ is $9.99 a month: everything in the $7.99 plan — flat repairs, valve stems, rotation, rim cleans, air-ups — plus 15% off any repair, parts and labor. One brake or suspension job and it more than pays for itself. Pick it when you join, or upgrade at the counter.",
    },
    {
      q: "How do I sign up?",
      a: "Join online in about a minute, or just ask at the counter next time you're in — 17625 Euclid Ave, or call (216) 862-0005. You pick the vehicle the first time you use it.",
    },
  ],

  bookingService: "tires",
  serviceType: "Nonstop Nick Tire Membership",
  ctaHeadline: "JOIN NONSTOP NICK — $7.99/MO",
  ctaSub: "Pull up anytime, we got you. Sign up online in about a minute, or ask at the counter — 17625 Euclid Ave, Cleveland OH. Call or text (216) 862-0005.",
};

export default function NonstopNickPage() {
  return <FocusedServicePage config={CONFIG} />;
}
