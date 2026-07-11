#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRERENDERED = path.join(ROOT, "prerendered");
const CANONICAL_ORIGIN = "https://nickstire.org";
const PHONE_DIGITS = "2168620005";
const BUSINESS_NAME = "Nick's Tire";

const ROUTES = [
  "/", "/tires", "/brakes", "/oil-change", "/diagnostics",
  "/emissions", "/services", "/about", "/contact",
];

function routeFile(route) {
  return route === "/"
    ? path.join(PRERENDERED, "index.html")
    : path.join(PRERENDERED, route.slice(1), "index.html");
}

function textMatch(html, regex) {
  return regex.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizedDigits(value) {
  return value.replace(/\D/g, "");
}

function inspect(route) {
  const file = routeFile(route);
  const errors = [];
  if (!fs.existsSync(file)) return [`${route}: missing ${path.relative(ROOT, file)}`];

  const html = fs.readFileSync(file, "utf8");
  const title = textMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = textMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || textMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const canonical = textMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || textMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const h1 = textMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim();
  const expectedCanonical = `${CANONICAL_ORIGIN}${route === "/" ? "" : route}`;

  if (!title || title.length < 10) errors.push(`${route}: missing or weak title`);
  if (!description || description.length < 50) errors.push(`${route}: missing or weak meta description`);
  if (!h1) errors.push(`${route}: missing H1`);
  if (canonical.replace(/\/$/, "") !== expectedCanonical.replace(/\/$/, "")) {
    errors.push(`${route}: canonical ${canonical || "missing"} != ${expectedCanonical}`);
  }
  if (!html.includes(BUSINESS_NAME)) errors.push(`${route}: business name missing`);
  if (!normalizedDigits(html).includes(PHONE_DIGITS)) errors.push(`${route}: primary phone missing`);
  if (!/<script[^>]+type=["']application\/ld\+json["']/i.test(html)) errors.push(`${route}: JSON-LD missing`);
  if (/autonicks\.com|example\.com|localhost:\d+/i.test(html)) errors.push(`${route}: stale or placeholder host found`);
  if (/href=["'](?:#|javascript:void\(0\))["']/i.test(html)) errors.push(`${route}: placeholder primary link found`);

  return errors;
}

if (!fs.existsSync(PRERENDERED)) {
  console.error("[prerender:semantic] prerendered/ is missing");
  process.exit(1);
}

const failures = ROUTES.flatMap(inspect);
if (failures.length) {
  console.error(`[prerender:semantic] FAIL · ${failures.length} semantic issue(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[prerender:semantic] OK · ${ROUTES.length} key routes match current identity and metadata rules`);