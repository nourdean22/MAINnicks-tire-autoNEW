/**
 * AI-Powered Search for Nick's Tire & Auto
 * Two modes:
 * 1. Instant keyword matching — fast, no API call
 * 2. AI natural language search — uses LLM for complex queries
 */

import { SERVICES } from "../shared/services";
import { BLOG_ARTICLES } from "../shared/blog";
import { invokeLLM } from "./_core/llm";

export interface SearchResult {
  type: "service" | "blog" | "page" | "faq";
  title: string;
  description: string;
  url: string;
  relevance: number; // 0-100
  icon?: string;
}

// ─── STATIC PAGES ──────────────────────────────────────
const STATIC_PAGES = [
  {
    title: "Book an Appointment",
    description: "Schedule your service online — pick your service, pick your time, done.",
    url: "/#booking",
    keywords: ["book", "appointment", "schedule", "reserve", "online booking"],
  },
  {
    title: "Contact Us",
    description: "17625 Euclid Ave, Cleveland, OH 44112 — (216) 862-0005 — Mon-Sat 8AM-6PM, Sun 9AM-4PM",
    url: "/#contact",
    keywords: ["contact", "phone", "address", "location", "directions", "hours", "map", "call"],
  },
  {
    title: "Customer Reviews",
    description: "4.9 stars from real Cleveland drivers. Read what our customers say about us.",
    url: "/#reviews",
    keywords: ["reviews", "testimonials", "ratings", "stars", "feedback", "google reviews"],
  },
  {
    title: "Blog & Maintenance Tips",
    description: "Helpful articles about car maintenance, repairs, and seasonal tips from our technicians.",
    url: "/blog",
    keywords: ["blog", "tips", "articles", "advice", "maintenance", "how to"],
  },
];

// ─── KEYWORD SEARCH (INSTANT) ──────────────────────────
export function keywordSearch(query: string): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  const results: SearchResult[] = [];
  const words = q.split(/\s+/);

  // Search services
  for (const svc of SERVICES) {
    let score = 0;
    const searchText = `${svc.title} ${svc.shortDesc} ${svc.keywords.join(" ")} ${svc.problems.map(p => `${p.question} ${p.answer}`).join(" ")}`.toLowerCase();

    for (const word of words) {
      if (svc.title.toLowerCase().includes(word)) score += 40;
      if (svc.keywords.some(k => k.toLowerCase().includes(word))) score += 30;
      if (svc.shortDesc.toLowerCase().includes(word)) score += 20;
      if (searchText.includes(word)) score += 10;
    }

    // Exact title match bonus
    if (svc.title.toLowerCase().includes(q)) score += 50;

    if (score > 0) {
      results.push({
        type: "service",
        title: svc.title,
        description: svc.shortDesc,
        url: `/${svc.slug}`,
        relevance: Math.min(score, 100),
        icon: "wrench",
      });
    }
  }

  // Search blog articles
  for (const article of BLOG_ARTICLES) {
    let score = 0;
    const searchText = `${article.title} ${article.excerpt} ${article.tags.join(" ")} ${article.category}`.toLowerCase();

    for (const word of words) {
      if (article.title.toLowerCase().includes(word)) score += 40;
      if (article.tags.some(t => t.toLowerCase().includes(word))) score += 25;
      if (article.excerpt.toLowerCase().includes(word)) score += 15;
      if (searchText.includes(word)) score += 10;
    }

    if (article.title.toLowerCase().includes(q)) score += 50;

    if (score > 0) {
      results.push({
        type: "blog",
        title: article.title,
        description: article.excerpt.slice(0, 120) + "...",
        url: `/blog/${article.slug}`,
        relevance: Math.min(score, 100),
        icon: "book",
      });
    }
  }

  // Search FAQ items from services
  for (const svc of SERVICES) {
    for (const prob of svc.problems) {
      let score = 0;
      const searchText = `${prob.question} ${prob.answer}`.toLowerCase();

      for (const word of words) {
        if (prob.question.toLowerCase().includes(word)) score += 35;
        if (searchText.includes(word)) score += 15;
      }

      if (score > 0) {
        results.push({
          type: "faq",
          title: prob.question,
          description: prob.answer.slice(0, 120) + "...",
          url: `/${svc.slug}#faq`,
          relevance: Math.min(score, 100),
          icon: "help",
        });
      }
    }
  }

  // Search static pages
  for (const page of STATIC_PAGES) {
    let score = 0;
    for (const word of words) {
      if (page.title.toLowerCase().includes(word)) score += 40;
      if (page.keywords.some(k => k.includes(word))) score += 30;
      if (page.description.toLowerCase().includes(word)) score += 15;
    }

    if (score > 0) {
      results.push({
        type: "page",
        title: page.title,
        description: page.description,
        url: page.url,
        relevance: Math.min(score, 100),
        icon: "link",
      });
    }
  }

  // Sort by relevance, deduplicate by URL
  const seen = new Set<string>();
  return results
    .sort((a, b) => b.relevance - a.relevance)
    .filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .slice(0, 8);
}

// ─── AI SEARCH (NATURAL LANGUAGE) ──────────────────────
const aiSearchCache = new Map<string, { result: { results: SearchResult[]; aiSummary: string }; timestamp: number }>();
const AI_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function aiSearch(query: string): Promise<{
  results: SearchResult[];
  aiSummary: string;
}> {
  // Check cache first
  const cacheKey = query.toLowerCase().trim();
  const cached = aiSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < AI_CACHE_TTL) {
    return cached.result;
  }

  // First get keyword results as a baseline
  const keywordResults = keywordSearch(query);

  // Build context about all available content
  const serviceList = SERVICES.map(s => `- ${s.title} (/${s.slug}): ${s.shortDesc}`).join("\n");
  const blogList = BLOG_ARTICLES.map(a => `- ${a.title} (/blog/${a.slug}): ${a.excerpt.slice(0, 80)}`).join("\n");
  const faqList = SERVICES.flatMap(s => s.problems.map(p => `- ${p.question} (/${s.slug}#faq)`)).join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are the search assistant for Nick's Tire & Auto, a trusted auto repair shop in Cleveland, Ohio. A customer is searching the website. Your job is to understand what they need and recommend the most relevant pages.

Available content on the website:

SERVICES:
${serviceList}

BLOG ARTICLES:
${blogList}

FAQ QUESTIONS:
${faqList}

OTHER PAGES:
- Book an Appointment (/#booking)
- Contact Us (/#contact)
- Customer Reviews (/#reviews)
- Blog & Tips (/blog)

Respond in JSON format with:
1. "summary": A brief, helpful 1-2 sentence response to the customer's question in plain language. Speak like a knowledgeable mechanic. If they describe a car problem, briefly explain what it might be and direct them to the right service.
2. "results": An array of up to 5 most relevant pages, each with "type" (service/blog/faq/page), "title", "description" (brief helpful text), "url", and "relevance" (0-100).

Be direct and helpful. No hype. No jargon.`,
        },
        {
          role: "user",
          content: query,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "search_results",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string", description: "Brief helpful response to the customer" },
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", description: "service, blog, faq, or page" },
                    title: { type: "string" },
                    description: { type: "string" },
                    url: { type: "string" },
                    relevance: { type: "number" },
                  },
                  required: ["type", "title", "description", "url", "relevance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "results"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("No response from AI");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);
    const result = {
      aiSummary: parsed.summary,
      results: parsed.results.map((r: any) => ({
        ...r,
        icon: r.type === "service" ? "wrench" : r.type === "blog" ? "book" : r.type === "faq" ? "help" : "link",
      })),
    };

    // Cache the result
    aiSearchCache.set(cacheKey, { result, timestamp: Date.now() });
    // Evict old entries to prevent memory leak
    if (aiSearchCache.size > 100) {
      const oldest = Array.from(aiSearchCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) aiSearchCache.delete(oldest[0]);
    }

    return result;
  } catch (err) {
    console.error("[AI Search] Error:", err);
    // Fall back to keyword results
    return {
      aiSummary: "",
      results: keywordResults,
    };
  }
}
