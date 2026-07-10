import { prisma } from "@/lib/prisma";

// In-memory cache for hot settings with 30s TTL
const cache = new Map<string, { value: string; type: string; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

/** Get a setting value, with caching and type coercion */
export async function getSetting<T = string>(key: string, defaultValue: T): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return coerce(cached.value, cached.type) as T;
  }

  const pref = await prisma.userPreference.findUnique({ where: { key } });
  if (!pref) return defaultValue;

  cache.set(key, { value: pref.value, type: pref.type, cachedAt: now });
  return coerce(pref.value, pref.type) as T;
}

/** Set a setting value */
export async function setSetting(key: string, value: unknown, category = "system"): Promise<void> {
  const type = typeof value === "number" ? "number" :
               typeof value === "boolean" ? "boolean" :
               typeof value === "object" ? "json" : "string";
  const strValue = type === "json" ? JSON.stringify(value) : String(value);

  await prisma.userPreference.upsert({
    where: { key },
    create: { key, value: strValue, type, category },
    update: { value: strValue, type },
  });

  cache.set(key, { value: strValue, type, cachedAt: Date.now() });
}

/** Get all settings grouped by category */
export async function getAllSettings(): Promise<Record<string, Record<string, unknown>>> {
  const prefs = await prisma.userPreference.findMany();
  const grouped: Record<string, Record<string, unknown>> = {};

  const now = Date.now();
  for (const p of prefs) {
    if (!grouped[p.category]) grouped[p.category] = {};
    grouped[p.category][p.key] = coerce(p.value, p.type);
    cache.set(p.key, { value: p.value, type: p.type, cachedAt: now });
  }

  return grouped;
}

function coerce(value: string, type: string): unknown {
  switch (type) {
    case "number": return Number(value);
    case "boolean": return value === "true";
    case "json": try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

/** Invalidate the in-memory cache */
export function invalidateSettingsCache(): void {
  cache.clear();
}
