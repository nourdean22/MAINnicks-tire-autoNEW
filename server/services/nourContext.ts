/**
 * Nour Context Loader — Injects deep personal context into Nick AI.
 *
 * Sources:
 * - master-context.md (who Nour is, strengths, weaknesses, patterns)
 * - conversation-portrait.md (analysis of 463 conversations)
 * - people-map.md (key people in Nour's life)
 * - open-loops.md (unresolved items)
 *
 * This gives Nick AI DEEP understanding of Nour as a person,
 * not just his business metrics.
 */

import { createLogger } from "../lib/logger";
import fs from "fs";
import path from "path";

const log = createLogger("nour-context");

let _cachedContext: string | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Load Nour's personal context for injection into Nick AI.
 * Returns a compact summary that fits within token limits.
 */
export function getNourPersonalContext(): string {
  const now = Date.now();
  if (_cachedContext && now - _cacheTime < CACHE_TTL) return _cachedContext;

  const contextDir = path.resolve(import.meta.dirname, "..", "data", "nour-context");
  const altDir = path.resolve(import.meta.dirname, "../..", "data", "nour-context");
  const dir = fs.existsSync(contextDir) ? contextDir : fs.existsSync(altDir) ? altDir : null;

  if (!dir) {
    _cachedContext = "";
    _cacheTime = now;
    return "";
  }

  const sections: string[] = [];

  // Master context — extract key sections only (keep under 2KB)
  try {
    const master = fs.readFileSync(path.join(dir, "master-context.md"), "utf-8");

    // Extract who Nour is
    const whoMatch = master.match(/## Who Nour Actually Is\n([\s\S]*?)(?=\n---|\n## )/);
    if (whoMatch) sections.push("WHO: " + whoMatch[1].trim().slice(0, 500));

    // Extract strengths
    const strengthMatch = master.match(/## Actual Strengths[\s\S]*?(?=\n---|\n## Actual Weaknesses)/);
    if (strengthMatch) {
      const strengths = strengthMatch[0].match(/\d\.\s\*\*([^*]+)\*\*/g)?.map(s => s.replace(/\d\.\s\*\*/g, "").replace(/\*\*/g, "")) || [];
      sections.push("STRENGTHS: " + strengths.join(", "));
    }

    // Extract weaknesses
    const weakMatch = master.match(/## Actual Weaknesses[\s\S]*?(?=\n---|\n## )/);
    if (weakMatch) {
      const weaknesses = weakMatch[0].match(/\d\.\s\*\*([^*]+)\*\*/g)?.map(s => s.replace(/\d\.\s\*\*/g, "").replace(/\*\*/g, "")) || [];
      sections.push("WEAKNESSES: " + weaknesses.join(", "));
    }

    // Extract what he's building
    const buildMatch = master.match(/## What He's Building[\s\S]*?(?=\n---|\n## )/);
    if (buildMatch) sections.push("BUILDING: " + buildMatch[0].slice(0, 300).replace(/\n/g, " ").trim());
  } catch (e) { console.warn("[services/nourContext] operation failed:", e); }

  // Conversation portrait — key thesis
  try {
    const portrait = fs.readFileSync(path.join(dir, "conversation-portrait.md"), "utf-8");
    const thesisMatch = portrait.match(/## Thesis\n([\s\S]*?)(?=\n## )/);
    if (thesisMatch) sections.push("PATTERN: " + thesisMatch[1].trim().slice(0, 300));
  } catch (e) { console.warn("[services/nourContext] operation failed:", e); }

  // People map
  try {
    const people = fs.readFileSync(path.join(dir, "people-map.md"), "utf-8");
    sections.push("PEOPLE: " + people.slice(0, 400).replace(/\n/g, " ").trim());
  } catch (e) { console.warn("[services/nourContext] operation failed:", e); }

  // Open loops
  try {
    const loops = fs.readFileSync(path.join(dir, "open-loops.md"), "utf-8");
    sections.push("OPEN LOOPS: " + loops.slice(0, 300).replace(/\n/g, " ").trim());
  } catch (e) { console.warn("[services/nourContext] operation failed:", e); }

  const context = sections.length > 0
    ? "\n\nNOUR'S PERSONAL CONTEXT (from 463 conversations analyzed):\n" + sections.join("\n")
    : "";

  _cachedContext = context;
  _cacheTime = now;
  return context;
}
