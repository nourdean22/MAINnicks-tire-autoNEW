import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-storage",
  title: "Seasonal Tire Storage Cleveland — Climate-Controlled | Nick's",
  description: "Store your off-season winter or summer tires in our climate-controlled tire hotel. Safe, secure, and ready when you are. Drive in today.",
  eyebrow: "TIRE HOTEL · SEASONAL STORAGE",
  h1: "CLIMATE-CONTROLLED TIRE STORAGE\nFOR WINTER & SUMMER SETS.",
  sub: "Stop cluttering your garage or dragging heavy, dirty tires in and out of your trunk. Nick's Tire & Auto offers climate-controlled, secure seasonal tire storage in Cleveland. We swap your wheels and store the off-season set. Walk in 7 days a week.",
  startingPrice: "$125 per season",
  pricingTitle: "STORAGE OPTIONS",
  pricingSub: "Simple seasonal storage rates. Store for winter or summer.",
  tiers: [
    {
      name: "Single Season",
      price: "$125",
      sub: "Up to 6 months storage",
      use: "Store your winter tires during summer, or summer tires during winter.",
      featured: true,
    },
    {
      name: "Year-Round",
      price: "$220",
      sub: "Annual storage package",
      use: "Includes storage for both seasons and priority access for seasonal tire swaps.",
    },
    {
      name: "Wheel Swap Package",
      price: "Add $80",
      sub: "Per seasonal swap",
      use: "Special rate to mount, balance, and install your stored wheels at swap time.",
    },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Complete care and secure handling for your seasonal tires.",
  included: [
    "Climate-controlled, dry, and clean storage facility",
    "Tire labeling with customer ID, vehicle VIN, and wheel position",
    "Rigorous inspection of tread depth and tire wear before storage",
    "Cleaning and wash of wheels/tires before placement in storage",
    "Security-monitored warehouse storage",
    "Fast swap scheduling when the weather turns",
  ],
  faqs: [
    {
      q: "How does seasonal tire storage work?",
      a: "When you drive in for a seasonal tire swap, we remove your active set, install your off-season set, and inspect, clean, label, and store the set we removed in our secure, climate-controlled warehouse. When the next season arrives, we repeat the process.",
    },
    {
      q: "Where are my tires stored?",
      a: "Tires are stored in our secure, dry, climate-controlled storage facility. This prevents the rubber from dry-rotting or degrading due to extreme temperatures, which commonly happens in backyard sheds or unheated garages.",
    },
    {
      q: "How much notice do you need to retrieve my stored tires?",
      a: "Please call or walk in to let us know 48 hours in advance when you'd like to do your seasonal swap. This gives us time to retrieve your specific tire set from our warehouse facility and have it ready at the shop.",
    },
    {
      q: "Do you store wheels (rims) as well as tires?",
      a: "Yes! We store mounted tire and wheel assemblies, or just the tires themselves. Storing tires already mounted on a secondary set of wheels is the most popular option since it makes seasonal swaps faster and cheaper.",
    },
  ],
  bookingService: "tires",
  serviceType: "Seasonal Tire Storage",
};

export default function TireStoragePage() {
  return <FocusedServicePage config={CONFIG} />;
}
