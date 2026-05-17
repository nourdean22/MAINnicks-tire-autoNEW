/**
 * scripts/audit-skills-language.ts · v10.0.431
 *
 * Detects non-English skills in the registry. Flags skills whose
 * description or first-paragraph contains non-Latin scripts OR
 * known non-English markers (Spanish/Portuguese/French/German/etc).
 *
 * Output: data/skills-language-audit.json with per-skill verdict
 * (en | non-en | mixed) + sample of the foreign content.
 *
 * Why detect-only (not auto-translate):
 *   1. Skill files are operator-tools · breaking them with a
 *      bad LLM translation could degrade the assistant's behavior
 *      across the entire ecosystem
 *   2. Many skills have INTENTIONAL native-language content
 *      (e.g. legal/medical skills targeting Brazilian Portuguese)
 *   3. The recall layer (v10.0.433) operates on EMBEDDINGS, not
 *      raw text, so the model can match query intent across
 *      language boundaries already
 *
 * Output drives the operator's decision · which to translate, which
 * to leave native, which to add an English-summary alongside.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface SkillEntry {
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
  skills: SkillEntry[];
}

interface LanguageVerdict {
  name: string;
  verdict: "en" | "non-en" | "mixed" | "ambiguous";
  language?: string;
  marker?: string;
  sample?: string;
}

// Heuristic markers — high-confidence non-English signals.
// Each entry: pattern + language label. We score the skill
// against the markers; >= 1 strong hit → flag as non-English.
const NON_EN_MARKERS: { pattern: RegExp; lang: string }[] = [
  // Portuguese
  { pattern: /\b(?:protocolo|inteligência|amplificação|usuário|tarefa|antes|executar|qualquer)\b/i, lang: "pt" },
  // Spanish
  { pattern: /\b(?:tarea|usuario|antes|ejecutar|análisis|también|idioma|reporte)\b/i, lang: "es" },
  // French
  { pattern: /\b(?:tâche|utilisateur|avant|exécuter|analyse|également|rapport|réseau)\b/i, lang: "fr" },
  // German
  { pattern: /\b(?:aufgabe|benutzer|bevor|ausführen|analyse|bericht|datenbank)\b/i, lang: "de" },
  // Italian
  { pattern: /\b(?:utente|prima|eseguire|analisi|relazione|database|sistema|elaborazione)\b/i, lang: "it" },
  // Russian (Cyrillic)
  { pattern: /[Ѐ-ӿ]{4,}/, lang: "ru" },
  // CJK (Chinese/Japanese/Korean)
  { pattern: /[一-鿿]{2,}/, lang: "zh-jp-ko" },
  // Arabic
  { pattern: /[؀-ۿ]{4,}/, lang: "ar" },
  // Hebrew
  { pattern: /[֐-׿]{4,}/, lang: "he" },
];

function classify(text: string): LanguageVerdict["verdict"] | { verdict: "non-en"; lang: string; marker: string; sample: string } {
  if (!text || text.length < 30) return "ambiguous";

  const hits: { lang: string; matchText: string }[] = [];
  for (const { pattern, lang } of NON_EN_MARKERS) {
    const m = text.match(pattern);
    if (m) hits.push({ lang, matchText: m[0] });
  }

  if (hits.length === 0) return "en";

  // Latin-script European languages can have false positives (e.g.
  // "analise" appears in some english-speakers' typos). Require:
  //   · 2+ distinct marker hits, OR
  //   · any single non-Latin script hit (Cyrillic/CJK/Arabic/Hebrew)
  const langs = new Set(hits.map((h) => h.lang));
  const hasNonLatin = ["ru", "zh-jp-ko", "ar", "he"].some((l) => langs.has(l));
  if (hasNonLatin) {
    const top = hits.find((h) => ["ru", "zh-jp-ko", "ar", "he"].includes(h.lang))!;
    return {
      verdict: "non-en",
      lang: top.lang,
      marker: top.matchText.slice(0, 30),
      sample: text.slice(0, 200).replace(/\s+/g, " ").trim(),
    };
  }
  if (hits.length >= 2) {
    const top = hits[0];
    return {
      verdict: "non-en",
      lang: top.lang,
      marker: top.matchText.slice(0, 30),
      sample: text.slice(0, 200).replace(/\s+/g, " ").trim(),
    };
  }
  // Single Latin-script hit · could be mixed-content English skill
  // that uses one foreign loanword. Don't flag.
  return "en";
}

async function main() {
  const regPath = resolve(process.cwd(), "data", "skills-registry.json");
  if (!existsSync(regPath)) {
    console.error("✗ data/skills-registry.json missing · run `pnpm tsx scripts/build-skill-registry.ts` first");
    process.exit(1);
  }
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as RegistryFile;
  console.log(`=== language audit · ${reg.skills.length} skills ===\n`);

  const verdicts: LanguageVerdict[] = [];
  let nonEnglish = 0;
  let mixedScript = 0;
  let ambiguous = 0;

  for (const s of reg.skills) {
    // Combine name + description + tags as the language signal
    const tags = Array.isArray(s.tags) ? s.tags.join(" ") : "";
    const probe = `${s.name} ${s.description} ${tags}`;
    const result = classify(probe);

    if (typeof result === "string") {
      verdicts.push({ name: s.name, verdict: result });
      if (result === "ambiguous") ambiguous++;
    } else {
      verdicts.push({ name: s.name, ...result });
      nonEnglish++;
    }
  }

  // Group by language
  const byLang = new Map<string, LanguageVerdict[]>();
  for (const v of verdicts) {
    if (v.verdict === "non-en" && v.language) {
      const arr = byLang.get(v.language) ?? [];
      arr.push(v);
      byLang.set(v.language, arr);
    }
  }

  console.log(`English (or English-passing):  ${reg.skills.length - nonEnglish - ambiguous}`);
  console.log(`Non-English flagged:          ${nonEnglish}`);
  console.log(`Ambiguous (too short):        ${ambiguous}`);
  if (byLang.size > 0) {
    console.log(`\nBy language:`);
    for (const [lang, list] of [...byLang.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${lang.padEnd(10)} ${list.length} skills`);
      for (const v of list.slice(0, 3)) {
        console.log(`     · ${v.name} · "${v.sample?.slice(0, 80)}…"`);
      }
      if (list.length > 3) console.log(`     · +${list.length - 3} more`);
    }
  }

  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const outPath = resolve(dataDir, "skills-language-audit.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalSkills: reg.skills.length,
        nonEnglishCount: nonEnglish,
        ambiguousCount: ambiguous,
        verdicts,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
