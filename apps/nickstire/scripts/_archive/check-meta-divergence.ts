/**
 * Sweep for metaDescription divergence between routes.ts (prerender source)
 * and cities.ts / services.ts (SPA runtime source). Reports any path that
 * has a different description between the two stores.
 */
import { ALL_ROUTES } from "../shared/routes";
import { CITIES } from "../shared/cities";
import { SERVICES } from "../shared/services";

const divergences: Array<{ path: string; route: string; data: string }> = [];

for (const c of CITIES) {
  const routePath = `/${c.slug}`;
  const route = ALL_ROUTES.find((r) => r.path === routePath);
  if (!route) {
    console.log(`MISSING route entry for city /${c.slug}`);
    continue;
  }
  if (route.description !== c.metaDescription) {
    divergences.push({
      path: routePath,
      route: route.description,
      data: c.metaDescription,
    });
  }
}

// Services use top-level paths (not /services/{slug}). Map services.ts slug → route path.
const SERVICE_SLUG_TO_PATH: Record<string, string> = {
  tires: "/tires",
  brakes: "/brakes",
  diagnostics: "/diagnostics",
  emissions: "/emissions",
  "oil-change": "/oil-change",
  "general-repair": "/general-repair",
  "ac-repair": "/ac-repair",
  transmission: "/transmission",
  electrical: "/electrical",
  battery: "/battery",
  exhaust: "/exhaust",
  cooling: "/cooling",
  "pre-purchase-inspection": "/pre-purchase-inspection",
  "belts-hoses": "/belts-hoses",
  "starter-alternator": "/starter-alternator",
};

for (const s of SERVICES) {
  const routePath = SERVICE_SLUG_TO_PATH[s.slug];
  if (!routePath) {
    console.log(`MISSING slug→path map for service ${s.slug}`);
    continue;
  }
  const route = ALL_ROUTES.find((r) => r.path === routePath);
  if (!route) {
    console.log(`MISSING route entry for service ${routePath} (slug ${s.slug})`);
    continue;
  }
  if (route.description !== s.metaDescription) {
    divergences.push({
      path: routePath,
      route: route.description,
      data: s.metaDescription,
    });
  }
}

console.log(`\n${divergences.length} divergences found between routes.ts and cities.ts/services.ts\n`);
for (const d of divergences) {
  console.log(`--- ${d.path}`);
  console.log(`routes.ts: ${d.route}`);
  console.log(`source:    ${d.data}`);
  console.log("");
}

process.exit(divergences.length === 0 ? 0 : 1);
