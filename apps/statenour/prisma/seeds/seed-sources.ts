import { PrismaClient } from "@prisma/client";

export async function seedSources(prisma: PrismaClient) {
  const sources = [
    {
      name: "FRED Macro Indicator API",
      url: "https://api.stlouisfed.org",
      domain: "macro",
      sourceType: "official",
      authScore: 95.0,
      refreshInterval: 604800, // 7 days in seconds
    },
    {
      name: "Google Search Console SEO Rankings",
      url: "https://gsc.google.com",
      domain: "seo",
      sourceType: "primary",
      authScore: 85.0,
      refreshInterval: 86400, // 1 day in seconds
    },
    {
      name: "Google Business Profile Local Performance",
      url: "https://businessprofileperformance.googleapis.com",
      domain: "seo",
      sourceType: "primary",
      authScore: 85.0,
      refreshInterval: 86400, // 1 day
    },
    {
      name: "NHTSA Recall API",
      url: "https://api.nhtsa.gov",
      domain: "automotive",
      sourceType: "official",
      authScore: 95.0,
      refreshInterval: 2592000, // 30 days in seconds
    },
    {
      name: "AI Industry Trends API",
      url: "https://api.openai.com",
      domain: "ai",
      sourceType: "official",
      authScore: 90.0,
      refreshInterval: 86400, // 1 day in seconds
    },
    {
      name: "SEC EDGAR Financial Filings",
      url: "https://data.sec.gov/api/xbrl",
      domain: "competitor",
      sourceType: "official",
      authScore: 95.0,
      refreshInterval: 604800, // 7 days
    },
    {
      name: "Discount Tire & Competitor Prices",
      url: "https://competitor-tires.com/prices",
      domain: "competitor",
      sourceType: "primary",
      authScore: 80.0,
      refreshInterval: 86400, // 1 day
    }
  ];

  console.log("Seeding RegisteredSources...");
  for (const s of sources) {
    const existing = await prisma.registeredSource.findUnique({
      where: { url: s.url },
    });
    if (existing) {
      await prisma.registeredSource.update({
        where: { url: s.url },
        data: s,
      });
      console.log(`Updated source: ${s.name}`);
    } else {
      await prisma.registeredSource.create({
        data: s,
      });
      console.log(`Created source: ${s.name}`);
    }
  }
}
