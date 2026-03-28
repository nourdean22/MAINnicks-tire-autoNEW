import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getWeatherAlert, type WeatherData } from "./weather";
import { SERVICES, getServiceBySlug } from "../shared/services";

// ─── HELPERS ───────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── WEATHER ALERT LOGIC TESTS ─────────────────────────

describe("getWeatherAlert", () => {
  it("returns danger alert for heavy snow", () => {
    const weather: WeatherData = {
      temperature_f: 28,
      wind_speed_mph: 15,
      weather_code: 75, // heavy snow
      weather_condition: "heavy_snow",
      is_day: true,
      precipitation_mm: 5,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("danger");
    expect(alert.message).toContain("Heavy snow");
    expect(alert.message).toContain("28°F");
    expect(alert.icon).toBe("snowflake");
  });

  it("returns danger alert for freezing rain", () => {
    const weather: WeatherData = {
      temperature_f: 30,
      wind_speed_mph: 10,
      weather_code: 67, // freezing rain heavy
      weather_condition: "freezing_rain_heavy",
      is_day: true,
      precipitation_mm: 3,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("danger");
    expect(alert.message).toContain("Freezing rain");
    expect(alert.icon).toBe("alert_triangle");
  });

  it("returns danger alert for extreme cold", () => {
    const weather: WeatherData = {
      temperature_f: 5,
      wind_speed_mph: 20,
      weather_code: 0, // clear
      weather_condition: "clear",
      is_day: true,
      precipitation_mm: 0,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("danger");
    expect(alert.message).toContain("Extreme cold");
    expect(alert.message).toContain("5°F");
  });

  it("returns warning alert for thunderstorm", () => {
    const weather: WeatherData = {
      temperature_f: 72,
      wind_speed_mph: 25,
      weather_code: 95, // thunderstorm
      weather_condition: "thunderstorm",
      is_day: true,
      precipitation_mm: 10,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("warning");
    expect(alert.message).toContain("Thunderstorm");
  });

  it("returns warning alert for heavy rain", () => {
    const weather: WeatherData = {
      temperature_f: 55,
      wind_speed_mph: 12,
      weather_code: 65, // heavy rain
      weather_condition: "heavy_rain",
      is_day: true,
      precipitation_mm: 8,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("warning");
    expect(alert.message).toContain("Heavy rain");
  });

  it("returns warning alert for high winds", () => {
    const weather: WeatherData = {
      temperature_f: 50,
      wind_speed_mph: 45,
      weather_code: 2, // partly cloudy
      weather_condition: "partly_cloudy",
      is_day: true,
      precipitation_mm: 0,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("warning");
    expect(alert.message).toContain("High winds");
    expect(alert.message).toContain("45 mph");
  });

  it("returns info alert for light snow at above-freezing temp", () => {
    const weather: WeatherData = {
      temperature_f: 36,
      wind_speed_mph: 8,
      weather_code: 71, // light snow
      weather_condition: "light_snow",
      is_day: true,
      precipitation_mm: 1,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("info");
    expect(alert.message).toContain("Light snow");
  });

  it("returns warning for light snow at freezing temp (icy roads)", () => {
    const weather: WeatherData = {
      temperature_f: 32,
      wind_speed_mph: 8,
      weather_code: 71, // light snow
      weather_condition: "light_snow",
      is_day: true,
      precipitation_mm: 1,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    // At 32°F with precipitation, the icy roads warning takes priority
    expect(alert.severity).toBe("warning");
  });

  it("returns info alert for fog", () => {
    const weather: WeatherData = {
      temperature_f: 45,
      wind_speed_mph: 3,
      weather_code: 45, // fog
      weather_condition: "fog",
      is_day: true,
      precipitation_mm: 0,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("info");
    expect(alert.message).toContain("Foggy");
  });

  it("returns info alert for hot day", () => {
    const weather: WeatherData = {
      temperature_f: 90,
      wind_speed_mph: 5,
      weather_code: 1, // mainly clear
      weather_condition: "mainly_clear",
      is_day: true,
      precipitation_mm: 0,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("info");
    expect(alert.message).toContain("90°F");
  });

  it("returns inactive alert for mild clear weather", () => {
    const weather: WeatherData = {
      temperature_f: 65,
      wind_speed_mph: 8,
      weather_code: 0, // clear
      weather_condition: "clear",
      is_day: true,
      precipitation_mm: 0,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(false);
  });

  it("returns warning for icy precipitation near freezing", () => {
    const weather: WeatherData = {
      temperature_f: 31,
      wind_speed_mph: 10,
      weather_code: 61, // light rain
      weather_condition: "light_rain",
      is_day: true,
      precipitation_mm: 2,
    };
    const alert = getWeatherAlert(weather);
    expect(alert.active).toBe(true);
    expect(alert.severity).toBe("warning");
    expect(alert.message).toContain("icy roads");
  });

  it("always includes a CTA href for active alerts", () => {
    const conditions: WeatherData[] = [
      { temperature_f: 5, wind_speed_mph: 10, weather_code: 0, weather_condition: "clear", is_day: true, precipitation_mm: 0 },
      { temperature_f: 28, wind_speed_mph: 15, weather_code: 75, weather_condition: "heavy_snow", is_day: true, precipitation_mm: 5 },
      { temperature_f: 72, wind_speed_mph: 25, weather_code: 95, weather_condition: "thunderstorm", is_day: true, precipitation_mm: 10 },
    ];

    for (const weather of conditions) {
      const alert = getWeatherAlert(weather);
      if (alert.active) {
        expect(alert.ctaHref).toBeTruthy();
        expect(alert.cta).toBeTruthy();
        expect(alert.message.length).toBeGreaterThan(10);
      }
    }
  });
});

// ─── SERVICE DATA TESTS ────────────────────────────────

describe("shared/services", () => {
  it("has at least 6 core services", () => {
    expect(SERVICES.length).toBeGreaterThanOrEqual(6);
  });

  it("each service has required fields", () => {
    for (const service of SERVICES) {
      expect(service.slug).toBeTruthy();
      expect(service.title).toBeTruthy();
      expect(service.metaTitle).toBeTruthy();
      expect(service.metaDescription).toBeTruthy();
      expect(service.heroHeadline).toBeTruthy();
      expect(service.heroSubline).toBeTruthy();
      expect(service.problems.length).toBeGreaterThanOrEqual(3);
      expect(service.process.length).toBeGreaterThanOrEqual(4);
      expect(service.whyUs.length).toBeGreaterThanOrEqual(5);
      expect(service.keywords.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("all slugs are unique", () => {
    const slugs = SERVICES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("getServiceBySlug returns correct service", () => {
    const tires = getServiceBySlug("tires");
    expect(tires).toBeDefined();
    expect(tires!.title).toBe("TIRES");

    const brakes = getServiceBySlug("brakes");
    expect(brakes).toBeDefined();
    expect(brakes!.title).toBe("BRAKES");
  });

  it("getServiceBySlug returns undefined for invalid slug", () => {
    expect(getServiceBySlug("nonexistent")).toBeUndefined();
  });

  it("meta descriptions are under 160 characters", () => {
    for (const service of SERVICES) {
      expect(service.metaDescription.length).toBeLessThanOrEqual(160);
    }
  });

  it("all core service slugs are present", () => {
    const coreSlugs = ["tires", "brakes", "diagnostics", "emissions", "oil-change", "general-repair"];
    const actualSlugs = SERVICES.map((s) => s.slug);
    for (const slug of coreSlugs) {
      expect(actualSlugs).toContain(slug);
    }
  });

  it("each problem has both question and answer", () => {
    for (const service of SERVICES) {
      for (const problem of service.problems) {
        expect(problem.question).toBeTruthy();
        expect(problem.answer).toBeTruthy();
        expect(problem.answer.length).toBeGreaterThan(50); // Substantial answers
      }
    }
  });
});

// ─── WEATHER ENDPOINT TEST ─────────────────────────────

describe("weather.current tRPC endpoint", () => {
  it("returns weather data or null without error", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // This calls the actual Open-Meteo API
    const result = await caller.weather.current();

    // Should return an object with alert and weather keys
    expect(result).toHaveProperty("alert");
    expect(result).toHaveProperty("weather");

    // If weather data was fetched, validate structure
    if (result.weather) {
      expect(typeof result.weather.temperature_f).toBe("number");
      expect(typeof result.weather.wind_speed_mph).toBe("number");
      expect(typeof result.weather.weather_code).toBe("number");
    }

    // If alert is active, validate structure
    if (result.alert?.active) {
      expect(result.alert.severity).toMatch(/^(info|warning|danger)$/);
      expect(result.alert.message.length).toBeGreaterThan(0);
      expect(result.alert.ctaHref).toBeTruthy();
    }
  });
});

// ─── BLOG DATA TESTS ──────────────────────────────

import { BLOG_ARTICLES, getArticleBySlug } from "../shared/blog";

describe("shared/blog", () => {
  it("has at least 5 articles", () => {
    expect(BLOG_ARTICLES.length).toBeGreaterThanOrEqual(5);
  });

  it("all slugs are unique", () => {
    const slugs = BLOG_ARTICLES.map(a => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("each article has required fields", () => {
    for (const article of BLOG_ARTICLES) {
      expect(article.slug).toBeTruthy();
      expect(article.title).toBeTruthy();
      expect(article.metaTitle).toBeTruthy();
      expect(article.metaDescription).toBeTruthy();
      expect(article.category).toBeTruthy();
      expect(article.publishDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.readTime).toBeTruthy();
      expect(article.heroImage).toMatch(/^https:\/\//);
      expect(article.excerpt.length).toBeGreaterThan(20);
      expect(article.sections.length).toBeGreaterThanOrEqual(3);
      expect(article.relatedServices.length).toBeGreaterThanOrEqual(1);
      expect(article.tags.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("meta descriptions are under 160 characters", () => {
    for (const article of BLOG_ARTICLES) {
      expect(article.metaDescription.length).toBeLessThanOrEqual(160);
    }
  });

  it("getArticleBySlug returns correct article", () => {
    const article = getArticleBySlug("5-signs-brakes-need-replacing");
    expect(article).toBeDefined();
    expect(article!.category).toBe("Brake Repair");
  });

  it("getArticleBySlug returns undefined for invalid slug", () => {
    expect(getArticleBySlug("nonexistent-article")).toBeUndefined();
  });

  it("each section has heading and substantial content", () => {
    for (const article of BLOG_ARTICLES) {
      for (const section of article.sections) {
        expect(section.heading).toBeTruthy();
        expect(section.content.length).toBeGreaterThan(50);
      }
    }
  });

  it("related services reference valid routes", () => {
    const validRoutes = SERVICES.map(s => `/${s.slug}`);
    for (const article of BLOG_ARTICLES) {
      for (const svc of article.relatedServices) {
        expect(validRoutes).toContain(svc);
      }
    }
  });
});

// ─── GOOGLE REVIEWS ENDPOINT TEST ──────────────────

describe("reviews.google tRPC endpoint", () => {
  it("returns review data or null without crashing", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // This calls the actual Google Places API via proxy
    const result = await caller.reviews.google();

    // Should return either valid data or null
    if (result !== null) {
      expect(typeof result.rating).toBe("number");
      expect(result.rating).toBeGreaterThanOrEqual(1);
      expect(result.rating).toBeLessThanOrEqual(5);
      expect(typeof result.totalReviews).toBe("number");
      expect(result.totalReviews).toBeGreaterThan(0);
      expect(result.name).toBeTruthy();
      expect(Array.isArray(result.reviews)).toBe(true);
      if (result.reviews.length > 0) {
        expect(result.reviews[0].authorName).toBeTruthy();
        expect(typeof result.reviews[0].rating).toBe("number");
      }
    }
  });
});

// ─── CONTENT GENERATOR TESTS ─────────────────────────

import { getCurrentSeason, type Season } from "./content-generator";

describe("content-generator", () => {
  it("getCurrentSeason returns a valid season", () => {
    const season = getCurrentSeason();
    expect(["spring", "summer", "fall", "winter"]).toContain(season);
  });

  it("content.activeNotifications returns an array without error", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.content.activeNotifications();
    expect(Array.isArray(result)).toBe(true);
  });

  it("content.publishedArticles returns an array without error", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.content.publishedArticles();
    expect(Array.isArray(result)).toBe(true);
  });

  it("content.currentSeason returns a valid season object", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.content.currentSeason();
    expect(result).toHaveProperty("season");
    expect(["spring", "summer", "fall", "winter"]).toContain(result.season);
  });

  it("content.articleBySlug returns null for nonexistent slug", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.content.articleBySlug({ slug: "nonexistent-article-slug" });
    expect(result).toBeNull();
  });

  it("contentAdmin endpoints require admin auth", async () => {
    const ctx = createAuthContext(); // regular user, not admin
    const caller = appRouter.createCaller(ctx);

    // Regular user should be denied
    await expect(caller.contentAdmin.allArticles()).rejects.toThrow();
    await expect(caller.contentAdmin.allNotifications()).rejects.toThrow();
    await expect(caller.contentAdmin.generationLog()).rejects.toThrow();
  });
});

// ─── BOOKING VALIDATION TESTS ──────────────────────────

describe("booking.create tRPC endpoint", () => {
  it("rejects booking with missing required fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.booking.create({
        name: "",
        phone: "2165551234",
        service: "Tires",
        vehicle: "2019 Honda Civic",
        preferredTime: "morning",
      } as any)
    ).rejects.toThrow();
  });

  it("rejects booking with invalid phone format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.booking.create({
        name: "John Smith",
        phone: "123", // too short
        service: "Tires",
        vehicle: "2019 Honda Civic",
        preferredTime: "morning",
      } as any)
    ).rejects.toThrow();
  });
});

// ─── INSTAGRAM FEED TESTS ─────────────────────────────

import { getInstagramPosts, getInstagramAccount } from "./instagram";

describe("instagram feed", () => {
  it("getInstagramPosts returns an array of posts", async () => {
    const posts = await getInstagramPosts(6);
    expect(Array.isArray(posts)).toBe(true);
    // If cache exists, should have posts
    if (posts.length > 0) {
      expect(posts[0]).toHaveProperty("id");
      expect(posts[0]).toHaveProperty("caption");
      expect(posts[0]).toHaveProperty("link");
      expect(posts[0]).toHaveProperty("likes");
      expect(posts[0]).toHaveProperty("comments");
      expect(posts[0]).toHaveProperty("type");
    }
  });

  it("getInstagramPosts respects limit parameter", async () => {
    const posts = await getInstagramPosts(3);
    expect(posts.length).toBeLessThanOrEqual(3);
  });

  it("getInstagramAccount returns account info or null", async () => {
    const account = await getInstagramAccount();
    if (account) {
      expect(account).toHaveProperty("username");
      expect(account).toHaveProperty("followers");
      expect(account).toHaveProperty("posts");
      expect(typeof account.followers).toBe("number");
    }
  });

  it("instagram.posts tRPC endpoint returns data without error", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.instagram.posts({ limit: 6 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("instagram.account tRPC endpoint returns data without error", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.instagram.account();
    // Returns account or null
    if (result) {
      expect(result.username).toBeTruthy();
    }
  });
});

// ─── LEAD CAPTURE TESTS ───────────────────────────────

describe("lead capture", () => {
  it("lead.submit rejects missing name", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.lead.submit({
        name: "",
        phone: "2165551234",
        source: "popup",
      })
    ).rejects.toThrow();
  });

  it("lead.submit rejects missing phone", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.lead.submit({
        name: "John Smith",
        phone: "123", // too short
        source: "popup",
      })
    ).rejects.toThrow();
  });

  it("lead.list requires admin auth", async () => {
    const ctx = createAuthContext(); // regular user, not admin
    const caller = appRouter.createCaller(ctx);
    await expect(caller.lead.list()).rejects.toThrow();
  });

  it("lead.sheetUrl requires admin auth", async () => {
    const ctx = createAuthContext(); // regular user, not admin
    const caller = appRouter.createCaller(ctx);
    await expect(caller.lead.sheetUrl()).rejects.toThrow();
  });
});

// ─── CHAT ASSISTANT TESTS ─────────────────────────────

describe("chat assistant", () => {
  it("chat.message rejects empty message", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chat.message({
        message: "",
      })
    ).rejects.toThrow();
  });
});

// ─── GOOGLE SHEETS SYNC TESTS ─────────────────────────

import { isSheetConfigured, getSpreadsheetUrl } from "./sheets-sync";

describe("google sheets sync", () => {
  it("isSheetConfigured returns a boolean", () => {
    const result = isSheetConfigured();
    expect(typeof result).toBe("boolean");
  });

  it("getSpreadsheetUrl returns a string", () => {
    const url = getSpreadsheetUrl();
    expect(typeof url).toBe("string");
    if (isSheetConfigured()) {
      expect(url).toContain("docs.google.com/spreadsheets");
    }
  });
});

// ─── GEMINI AI TESTS ──────────────────────────────────

import { scoreLead } from "./gemini";

describe("gemini AI lead scoring", () => {
  it("scoreLead returns a valid score structure", async () => {
    const result = await scoreLead("My brakes are grinding and making loud noise", "2018 Toyota Camry");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("reason");
    expect(result).toHaveProperty("recommendedService");
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(5);
    expect(typeof result.reason).toBe("string");
    expect(typeof result.recommendedService).toBe("string");
  });

  it("scoreLead handles empty problem gracefully", async () => {
    const result = await scoreLead("", undefined);
    expect(result).toHaveProperty("score");
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(5);
  });
});

// ─── AI SEARCH TESTS ─────────────────────────────────

import { keywordSearch, aiSearch } from "./search";

describe("keyword search", () => {
  it("returns results for 'tires'", () => {
    const results = keywordSearch("tires");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe("service");
    expect(results[0].title.toLowerCase()).toContain("tire");
    expect(results[0].url).toBe("/tires");
  });

  it("returns results for 'brakes'", () => {
    const results = keywordSearch("brakes");
    expect(results.length).toBeGreaterThan(0);
    const serviceResult = results.find(r => r.type === "service");
    expect(serviceResult).toBeDefined();
    expect(serviceResult!.url).toBe("/brakes");
  });

  it("returns results for 'check engine light'", () => {
    const results = keywordSearch("check engine light");
    expect(results.length).toBeGreaterThan(0);
    // Should match diagnostics service or FAQ
    const hasRelevant = results.some(r =>
      r.title.toLowerCase().includes("diagnostic") ||
      r.title.toLowerCase().includes("check engine") ||
      r.description.toLowerCase().includes("check engine")
    );
    expect(hasRelevant).toBe(true);
  });

  it("returns results for 'book appointment'", () => {
    const results = keywordSearch("book appointment");
    expect(results.length).toBeGreaterThan(0);
    const bookingResult = results.find(r => r.url.includes("booking"));
    expect(bookingResult).toBeDefined();
  });

  it("returns empty for very short queries", () => {
    const results = keywordSearch("a");
    expect(results).toEqual([]);
  });

  it("returns max 8 results", () => {
    const results = keywordSearch("car repair service");
    expect(results.length).toBeLessThanOrEqual(8);
  });

  it("results are sorted by relevance (descending)", () => {
    const results = keywordSearch("oil change");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevance).toBeGreaterThanOrEqual(results[i].relevance);
    }
  });

  it("deduplicates results by URL", () => {
    const results = keywordSearch("tires");
    const urls = results.map(r => r.url);
    const uniqueUrls = new Set(urls);
    expect(urls.length).toBe(uniqueUrls.size);
  });

  it("returns blog results for 'maintenance tips'", () => {
    const results = keywordSearch("maintenance tips");
    const hasBlog = results.some(r => r.type === "blog" || r.type === "page");
    expect(hasBlog).toBe(true);
  });

  it("returns contact page for 'phone number'", () => {
    const results = keywordSearch("phone");
    const contactResult = results.find(r => r.url.includes("contact"));
    expect(contactResult).toBeDefined();
  });
});

describe("AI search", () => {
  it("returns results and summary for a car problem description", { timeout: 30000 }, async () => {
    const result = await aiSearch("my car is shaking when I brake");
    expect(result).toHaveProperty("aiSummary");
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    // Each result should have required fields
    for (const r of result.results) {
      expect(r).toHaveProperty("type");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("url");
      expect(r).toHaveProperty("relevance");
    }
  });
});

// ─── SITEMAP & ROBOTS.TXT ────────────────────────────────

describe("sitemap.xml", () => {
  it("returns valid XML with all public pages and blog posts", async () => {
    const res = await fetch("http://localhost:3000/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    // Should contain urlset root element
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    // Should contain all public service pages
    expect(xml).toContain("https://nickstire.org/");
    expect(xml).toContain("https://nickstire.org/tires");
    expect(xml).toContain("https://nickstire.org/brakes");
    expect(xml).toContain("https://nickstire.org/diagnostics");
    expect(xml).toContain("https://nickstire.org/emissions");
    expect(xml).toContain("https://nickstire.org/oil-change");
    expect(xml).toContain("https://nickstire.org/general-repair");
    expect(xml).toContain("https://nickstire.org/blog");
    // Should contain blog post URLs
    expect(xml).toContain("https://nickstire.org/blog/5-signs-brakes-need-replacing");
    expect(xml).toContain("https://nickstire.org/blog/check-engine-light-common-causes");
    expect(xml).toContain("https://nickstire.org/blog/ohio-echeck-what-to-know");
    expect(xml).toContain("https://nickstire.org/blog/when-to-replace-tires");
    expect(xml).toContain("https://nickstire.org/blog/spring-car-maintenance-checklist");
    expect(xml).toContain("https://nickstire.org/blog/synthetic-vs-conventional-oil");
    // Should NOT contain admin pages
    expect(xml).not.toContain("https://nickstire.org/admin");
  });
});

describe("robots.txt", () => {
  it("returns valid robots.txt that blocks admin and api", async () => {
    const res = await fetch("http://localhost:3000/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Allow: /");
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain("Sitemap: https://nickstire.org/sitemap.xml");
  });
});
