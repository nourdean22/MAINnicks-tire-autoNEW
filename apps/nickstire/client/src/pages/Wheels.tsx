import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/wheels",
  title: "Custom Wheels & OEM Rims Cleveland — Sales & Install | Nick's",
  description: "Custom wheels, steel wheels, and wheel+tire packages. Professional mounting, balancing, and fitment. Euclid Ave walk-in shop.",
  eyebrow: "CUSTOM WHEELS · STEEL RIMS",
  h1: "CUSTOM WHEELS & OEM RIMS\nSALES, MOUNTING & FITMENT.",
  sub: "Upgrade your ride or replace a damaged wheel. Nick's Tire & Auto on Euclid Ave offers custom alloy wheels, durable steel rims, and complete wheel-and-tire packages. Professional mounting, high-precision balancing, and custom fitments. Walk in 7 days.",
  startingPrice: "$499 and up",
  pricingTitle: "WHEEL PACKAGES",
  pricingSub: "Upgrade options for all vehicle classes and styles.",
  tiers: [
    {
      name: "Steel Wheels",
      price: "From $65 / wheel",
      sub: "Durable replacement rims",
      use: "Ideal for winter tire setups or replacing damaged OEM steel wheels.",
    },
    {
      name: "Alloy Wheels",
      price: "From $120 / wheel",
      sub: "Upgraded style & performance",
      use: "Upgraded custom looks, lighter weight, and improved heat dissipation.",
    },
    {
      name: "Wheel & Tire Set",
      price: "From $499 / set",
      sub: "Complete package deal",
      use: "Includes 4 wheels, 4 tires, free mounting, high-speed balancing, and valve stems.",
      featured: true,
    },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Every wheel purchase or installation is backed by our Euclid Ave team.",
  included: [
    "High-precision laser wheel balancing",
    "Professional, scratch-free mounting on specialized changers",
    "TPMS sensor swapping or programming",
    "Vehicle fitment verification and offset checking",
    "New valve stems or custom lug nuts as needed",
    "Free alignment check with any full package purchase",
  ],
  faqs: [
    {
      q: "Do you sell custom wheels and rims?",
      a: "Yes! We sell custom alloy wheels and durable steel rims. You can buy the wheels on their own, or combine them with a new set of tires for a discounted package price.",
    },
    {
      q: "Can you mount low-profile tires or large wheels?",
      a: "Absolutely. We have scratch-free tire changers and precision wheel balancers capable of handling oversized custom wheels, low-profile performance tires, and heavy-duty truck wheels.",
    },
    {
      q: "What is the benefit of steel wheels for winter?",
      a: "Steel wheels are heavier and highly durable, making them ideal for winter driving in Cleveland. They resist salt corrosion better than alloys and protect your expensive custom or OEM wheels from winter pothole damage.",
    },
    {
      q: "Do you install customer-supplied wheels?",
      a: "Yes! If you purchased wheels online and need them professionally mounted and balanced, drive right in. We will inspect them for safety, verify vehicle fitment, and install them.",
    },
  ],
  bookingService: "tires",
  serviceType: "Wheel Sales & Installation",
};

export default function WheelsPage() {
  return <FocusedServicePage config={CONFIG} />;
}
