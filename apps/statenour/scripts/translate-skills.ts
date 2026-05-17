/**
 * scripts/translate-skills.ts · v10.0.431
 *
 * For each non-English skill flagged by audit-skills-language.ts,
 * produce an ENGLISH 1-2 sentence summary via aiChat() (the
 * provider chain · Venice → Ollama → OpenAI fallback).
 *
 * Output: data/skills-translations.json · maps skill-name → English
 * summary. The skill-registry builder reads this sidecar and merges
 * the English summary into each skill's `description_en` field, so
 * the semantic recall + UI surface have English coverage WITHOUT
 * touching the original SKILL.md (which may have been authored
 * intentionally in a non-English language).
 *
 * Why sidecar vs inline:
 *   1. SKILL.md files are user-tools · modifying them risks breaking
 *      checksum-gated activation in some environments
 *   2. Many skills target non-English audiences by design (e.g.
 *      Brazilian-Portuguese legal skills · Chinese health-analyzers)
 *      · the original is the source of truth for those users
 *   3. Sidecar lives in our repo · we control its lifecycle
 *
 * Run: pnpm tsx scripts/translate-skills.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// v10.0.431 · dynamic-import provider AFTER env load · static
// import is hoisted before loadEnvConfig runs, so VENICE_API_KEY
// in provider.ts gets captured as undefined.
let aiChatRef: typeof import("@/lib/ai/provider")["aiChat"];

interface LanguageVerdict {
  name: string;
  verdict: "en" | "non-en" | "mixed" | "ambiguous";
  lang?: string;
  marker?: string;
  sample?: string;
}

interface AuditFile {
  generatedAt: string;
  totalSkills: number;
  nonEnglishCount: number;
  ambiguousCount: number;
  verdicts: LanguageVerdict[];
}

interface RegistryEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

interface RegistryFile {
  generatedAt: string;
  totalSkills: number;
  skills: RegistryEntry[];
}

interface TranslationsFile {
  generatedAt: string;
  totalTranslated: number;
  translations: Record<string, { lang: string; en: string; original: string }>;
}

const SYS = `You translate skill descriptions for an operator-grade AI assistant. The operator speaks English. Read the original (non-English) skill description and write ONE concise sentence in English (max 30 words) that captures:
  · what the skill does
  · what kind of input it expects
  · what value it provides

Output English ONLY. No translation footnotes. No "translation:" preamble. Just the English sentence. If the original mentions Chinese medicine / Brazilian context / specific cultural framing, preserve that fact in the English summary.`;

async function main() {
  // Dynamic import · captures the env that loadEnvConfig populated.
  const mod = await import("@/lib/ai/provider");
  aiChatRef = mod.aiChat;

  const auditPath = resolve(process.cwd(), "data", "skills-language-audit.json");
  const regPath = resolve(process.cwd(), "data", "skills-registry.json");
  if (!existsSync(auditPath) || !existsSync(regPath)) {
    console.error("✗ run audit-skills-language.ts AND build-skill-registry.ts first");
    process.exit(1);
  }

  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as AuditFile;
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as RegistryFile;
  const byName = new Map(reg.skills.map((s) => [s.name, s]));

  const targets = audit.verdicts.filter((v) => v.verdict === "non-en");
  console.log(`=== translating ${targets.length} non-English skills ===\n`);

  const translations: TranslationsFile["translations"] = {};
  // Resume support · if a partial run exists, pick up where it left off
  const outPath = resolve(process.cwd(), "data", "skills-translations.json");
  if (existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, "utf8")) as TranslationsFile;
      Object.assign(translations, prev.translations ?? {});
      console.log(`(resuming · ${Object.keys(translations).length} already translated)\n`);
    } catch {
      /* ignore */
    }
  }

  let success = 0;
  let skipped = 0;
  for (const v of targets) {
    if (translations[v.name]) {
      skipped++;
      continue;
    }
    const skill = byName.get(v.name);
    if (!skill) continue;

    const original = `${skill.name}\n\n${skill.description}`.slice(0, 800);
    process.stdout.write(`  ${v.name.padEnd(30)} [${v.lang ?? "?"}] ... `);
    try {
      const result = await aiChatRef(
        [
          { role: "system", content: SYS },
          { role: "user", content: `Skill (in ${v.lang ?? "non-English"}):\n\n${original}\n\nWrite the English summary now.` },
        ],
        "classify",
      );
      const en = (result.content ?? "").trim().slice(0, 400);
      if (en.length < 10) {
        console.log("EMPTY · skip");
        continue;
      }
      // Detect provider-fallback sentinels · aiChat returns a
      // human-friendly emergency message when all providers fail,
      // and we don't want to capture that as a translation.
      if (/I'm having trouble connecting to my AI providers/i.test(en) ||
          /provider.+failed/i.test(en) ||
          en.includes("try again")) {
        console.log("PROVIDER FALLBACK · skip");
        continue;
      }
      translations[v.name] = {
        lang: v.lang ?? "unknown",
        en,
        original: skill.description.slice(0, 240),
      };
      success++;
      console.log("✓");
      // Persist after every translation so a mid-run failure doesn't lose work
      writeFileSync(
        outPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            totalTranslated: Object.keys(translations).length,
            translations,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.log(`FAIL · ${err instanceof Error ? err.message.slice(0, 80) : err}`);
    }
  }

  if (!existsSync(resolve(process.cwd(), "data"))) {
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  }
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalTranslated: Object.keys(translations).length,
        translations,
      },
      null,
      2,
    ),
  );

  console.log(`\n  translated ${success} · cached ${skipped} · total ${Object.keys(translations).length}`);
  console.log(`  wrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
