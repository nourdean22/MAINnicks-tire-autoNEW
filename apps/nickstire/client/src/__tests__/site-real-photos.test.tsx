/**
 * Real shop photos at the site's decision points (shop-media job, W8).
 *
 * Pins three things:
 *  1. The Home hero is the real storefront photo (sign, open bays, owner out
 *     front) with descriptive alt text, and the proof row under it shows three
 *     real photos with captions.
 *  2. Every /photos/ URL a rendered page asks for (img src, every srcset
 *     candidate, every <source>) is a real file in client/public/photos. A
 *     missing -small or -medium variant fails here, not on a customer's phone,
 *     where the SPA fallback would serve HTML as a broken image.
 *  3. Every /photos/ literal anywhere in client/src or index.html resolves,
 *     and the index.html hero preloads match the hero <picture> exactly (a
 *     mismatch double-downloads the LCP image).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => window.location.search,
  useParams: () => ({}),
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
  useReducedMotion: () => true,
}));

const mockQueryResult = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) })
      : new Proxy({}, { get: () => ({
          useQuery: () => mockQueryResult,
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }) }),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

const CLIENT = resolve(__dirname, "../..");
const PHOTOS_DIR = join(CLIENT, "public", "photos");

/** Every /photos/ URL the rendered DOM can request. */
function photoUrls(container: HTMLElement): string[] {
  const urls: string[] = [];
  container.querySelectorAll("img").forEach((img) => urls.push(img.getAttribute("src") ?? ""));
  container.querySelectorAll("img[srcset], source[srcset]").forEach((el) => {
    for (const candidate of (el.getAttribute("srcset") ?? "").split(",")) {
      urls.push(candidate.trim().split(/\s+/)[0]);
    }
  });
  return urls.filter((u) => u.startsWith("/photos/"));
}

function missingFiles(urls: string[]): string[] {
  return urls.filter((u) => !existsSync(join(PHOTOS_DIR, u.slice("/photos/".length))));
}

const PAGES: Array<[string, () => Promise<{ default: React.ComponentType }>]> = [
  ["Home", () => import("../pages/Home")],
  ["TireShopNearMePage", () => import("../pages/TireShopNearMePage")],
  ["Contact", () => import("../pages/Contact")],
  ["About", () => import("../pages/About")],
  ["BrakeRepairPage", () => import("../pages/BrakeRepairPage")],
  ["TireFinderV2", () => import("../pages/TireFinderV2")],
];

async function renderPage(load: () => Promise<{ default: React.ComponentType }>) {
  const { default: Page } = await load();
  return render(React.createElement(Page));
}

describe("real shop photos: Home hero and proof row", () => {
  afterEach(cleanup);

  it("the hero is the real storefront photo with descriptive alt text", async () => {
    const { container } = await renderPage(PAGES[0][1]);
    const hero = container.querySelector('img[fetchpriority="high"]');
    expect(hero?.getAttribute("src")).toBe("/photos/nicks-tire-auto-euclid-ave-storefront-owner.webp");
    const alt = hero?.getAttribute("alt") ?? "";
    expect(alt).toMatch(/Nick's Tire & Auto/);
    expect(alt).toMatch(/Euclid Avenue/);
  });

  it("the proof row under the hero shows three captioned real photos", async () => {
    const { container } = await renderPage(PAGES[0][1]);
    const row = container.querySelector('[data-testid="home-proof-row"]');
    expect(row).toBeTruthy();
    const figures = row!.querySelectorAll("figure");
    expect(figures.length).toBe(3);
    figures.forEach((fig) => {
      expect(fig.querySelector("img")?.getAttribute("alt")?.trim()).toBeTruthy();
      expect(fig.querySelector("figcaption")?.textContent?.trim()).toBeTruthy();
    });
  });

  it("the arrival photos sit beside the directions on Home, TireShopNearMe and Contact", async () => {
    for (const name of ["Home", "TireShopNearMePage", "Contact"]) {
      const load = PAGES.find(([n]) => n === name)![1];
      const { container } = await renderPage(load);
      const arrival = container.querySelector('[data-testid="arrival-photos"]');
      expect(arrival, `${name} has no arrival photos`).toBeTruthy();
      expect(arrival!.querySelectorAll("img").length).toBe(2);
      cleanup();
    }
  });
});

describe("every /photos/ reference resolves to a real file", () => {
  afterEach(cleanup);

  // width/height are required on lazy (below-the-fold) photos, where they
  // reserve space; the eager heroes are absolutely positioned full-bleed covers.
  it.each(PAGES)("%s: every rendered /photos/ URL exists; photos carry alt, lazy ones width and height", async (_name, load) => {
    const { container } = await renderPage(load);
    const urls = photoUrls(container);
    expect(urls.length).toBeGreaterThan(0);
    expect(missingFiles(urls)).toEqual([]);
    container.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith("/photos/")) return;
      expect(img.getAttribute("alt")?.trim(), src).toBeTruthy();
      if (img.getAttribute("loading") !== "lazy") return;
      expect(img.getAttribute("width"), src).toBeTruthy();
      expect(img.getAttribute("height"), src).toBeTruthy();
    });
  });

  it("every /photos/ literal in client/src and index.html exists (comments skipped)", () => {
    const files: string[] = [join(CLIENT, "index.html")];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|html)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(CLIENT, "src"));
    const refs: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (/^\s*(\/\/|\*|\/\*|\{\/\*|<!--)/.test(line)) continue;
        for (const m of line.matchAll(/\/photos\/([\w.-]+\.webp)/g)) refs.push(`/photos/${m[1]}`);
      }
    }
    expect(refs.length).toBeGreaterThan(20);
    expect(missingFiles(refs)).toEqual([]);
  });

  it("index.html hero preloads match the Home hero <picture> sources exactly", async () => {
    const html = readFileSync(join(CLIENT, "index.html"), "utf8");
    const preloads = [...html.matchAll(/<link rel="preload" as="image" href="(\/photos\/[^"]+)"[^>]*media="([^"]+)"/g)]
      .map((m) => `${m[2]} ${m[1]}`).sort();
    const { container } = await renderPage(PAGES[0][1]);
    const hero = container.querySelector('img[fetchpriority="high"]')!;
    const picture = hero.closest("picture")!;
    const sources = [...picture.querySelectorAll("source")].map((s) => `${s.getAttribute("media")} ${s.getAttribute("srcset")}`);
    sources.push(`(min-width: 1025px) ${hero.getAttribute("src")}`);
    expect(preloads).toEqual(sources.sort());
  });
});
