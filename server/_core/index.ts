import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getPublishedArticles } from "../content-generator";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Sitemap.xml (dynamic — includes published AI articles from DB)
  app.get("/sitemap.xml", async (_req, res) => {
    const baseUrl = "https://nickstire.org";
    const now = new Date().toISOString();
    const staticPages = [
      "/",
      "/tires",
      "/brakes",
      "/diagnostics",
      "/emissions",
      "/oil-change",
      "/general-repair",
      "/blog",
    ];
    const hardcodedBlogSlugs = [
      "5-signs-brakes-need-replacing",
      "check-engine-light-common-causes",
      "ohio-echeck-what-to-know",
      "when-to-replace-tires",
      "spring-car-maintenance-checklist",
      "synthetic-vs-conventional-oil",
    ];
    // Fetch published dynamic articles from DB
    let dynamicSlugs: string[] = [];
    try {
      const published = await getPublishedArticles();
      dynamicSlugs = published.map((a: any) => a.slug);
    } catch {}
    const allBlogSlugs = [...hardcodedBlogSlugs, ...dynamicSlugs];
    const urls = [
      ...staticPages.map(p => `<url><loc>${baseUrl}${p}</loc><lastmod>${now}</lastmod></url>`),
      ...allBlogSlugs.map(s => `<url><loc>${baseUrl}/blog/${s}</loc><lastmod>${now}</lastmod></url>`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.send(xml);
  });

  // Robots.txt
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://nickstire.org/sitemap.xml`);
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
