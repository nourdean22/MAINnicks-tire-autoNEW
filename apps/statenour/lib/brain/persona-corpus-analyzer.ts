/**
 * Persona Corpus Analyzer · v10.0.529.43 · Arc B F4 · Phase 3
 *
 * Companion to persona-corpus-importer.ts. The importer ingests raw
 * utterances + builds the centroid vector (good for cosine drift
 * detection). This analyzer extracts STRUCTURED voice statistics
 * the operator can read · the model can reference · and the
 * persona-anchor can surface as natural-language guidance.
 *
 * Stats produced (no AI calls · pure text-mining · cheap):
 *
 *   · sample-size · how many utterances were analyzed
 *   · length stats · mean / median / p90 word count per utterance
 *   · length bucket · "short" (< 50w) / "medium" (50-200w) / "long" (200w+)
 *   · top phrases · most frequent 2-3-grams excluding stopwords
 *   · vocabulary leans · counts of declarative vs hedging words,
 *     question marks, emphasis markers ("!", "really", "definitely")
 *   · structural tells · bullet / paragraph ratio · code-fence density ·
 *     emoji presence (caught for awareness · not a value judgment)
 *   · natural-language profile · ~150-word summary the model can read
 *     in-prompt as "this is how Nour writes"
 *
 * Run AFTER importer completes · pulls the same vector_embeddings
 * rows the importer just wrote. Cached as
 * BrainMemory(category="behavioral_persona_profile", key="current")
 * so the persona-anchor can read it without re-walking the corpus.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/persona-corpus-analyzer");

const SOURCE_TYPE = "behavioral_persona" as const;
const PROFILE_CATEGORY = "behavioral_persona_profile" as const;
const PROFILE_KEY = "current" as const;

// English stopwords + a few operator-specific filler tokens the corpus
// surfaces frequently but doesn't characterize the voice. Lowercase
// before lookup.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "for", "of",
  "to", "in", "on", "at", "by", "with", "from", "is", "was", "are",
  "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "can",
  "i", "you", "we", "they", "it", "this", "that", "these", "those",
  "me", "my", "your", "our", "their", "his", "her", "its",
  "so", "as", "than", "too", "very", "more", "less", "just", "also",
  "not", "no", "yes", "ok", "okay", "yeah", "yep", "nope",
  "what", "who", "where", "when", "why", "how", "which",
  "there", "here", "where",
  "im", "ive", "id", "ill", "youre", "youd", "weve", "well",
  "dont", "doesnt", "didnt", "wont", "wouldnt", "cant", "couldnt",
  "thats", "its", "theres", "heres",
  "get", "got", "getting",
  "like", "really", "actually", "basically",
  "go", "going", "went", "come", "came",
  "thing", "things", "stuff", "way", "ways",
]);

// Hedging vs declarative · the ratio between these is a voice tell.
const HEDGING_WORDS = new Set([
  "maybe", "perhaps", "possibly", "might", "could", "would",
  "likely", "probably", "seems", "appears", "feels", "kind of",
  "sort of", "i think", "i guess", "not sure", "uncertain",
]);

const DECLARATIVE_WORDS = new Set([
  "definitely", "absolutely", "certainly", "obviously", "clearly",
  "always", "never", "must", "should", "will", "going to",
  "this is", "that's it", "right", "wrong", "yes", "no",
]);

// Emphasis markers · operator's intensity profile.
const EMPHASIS_MARKERS = new Set([
  "really", "very", "extremely", "incredibly", "totally", "completely",
  "absolutely", "literally", "honestly",
]);

// ── Types ────────────────────────────────────────────────────────────

export interface CorpusProfile {
  sampleSize: number;
  lengthStats: {
    meanWords: number;
    medianWords: number;
    p90Words: number;
    dominantBucket: "short" | "medium" | "long";
  };
  topPhrases: Array<{ phrase: string; count: number }>;
  voiceLeans: {
    hedgingHits: number;
    declarativeHits: number;
    emphasisHits: number;
    questionMarks: number;
    exclamationMarks: number;
    /** hedging - declarative · positive = leans hedging · negative = leans declarative */
    leanScore: number;
  };
  structuralTells: {
    bulletLines: number;
    paragraphCount: number;
    codeBlockCount: number;
    emojiCount: number;
    averageBulletsPerUtterance: number;
  };
  /** Operator-readable ~150-word summary · also fed into the persona-anchor prompt. */
  summary: string;
  builtAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function median(sortedNums: number[]): number {
  if (sortedNums.length === 0) return 0;
  const mid = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2 === 0
    ? Math.round((sortedNums[mid - 1] + sortedNums[mid]) / 2)
    : sortedNums[mid];
}

function p90(sortedNums: number[]): number {
  if (sortedNums.length === 0) return 0;
  const idx = Math.min(sortedNums.length - 1, Math.floor(sortedNums.length * 0.9));
  return sortedNums[idx];
}

function buildNGrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function countMatches(lower: string, set: Set<string>): number {
  let count = 0;
  for (const word of set) {
    // word-boundary match · skip the regex compile cost for very common case
    if (word.includes(" ")) {
      let idx = 0;
      while ((idx = lower.indexOf(word, idx)) !== -1) {
        count++;
        idx += word.length;
      }
    } else {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const m = lower.match(re);
      if (m) count += m.length;
    }
  }
  return count;
}

function countEmoji(text: string): number {
  const m = text.match(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}]/gu);
  return m?.length ?? 0;
}

function countBullets(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim().length > 0);
  return lines.filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)).length;
}

function countCodeBlocks(text: string): number {
  const m = text.match(/```/g);
  return Math.floor((m?.length ?? 0) / 2);
}

// ── Main analyzer ────────────────────────────────────────────────────

/**
 * Pure text-mining · accepts an array of utterance strings · works
 * standalone without DB access. Used by the importer when embeddings
 * fail (provider out of credit / rate-limited) so the operator still
 * gets a voice profile even when the vector pipeline can't complete.
 * Also persists the resulting profile so downstream readers (chat
 * persona-anchor) pick it up immediately.
 */
export async function analyzeUtteranceTexts(
  texts: string[],
): Promise<CorpusProfile | null> {
  if (texts.length === 0) return null;
  const profile = buildProfileFromTexts(texts);
  await persistProfile(profile);
  return profile;
}

/**
 * Walk every embedded utterance (vector_embeddings.sourceType=
 * "behavioral_persona"), compute structured voice stats, persist the
 * profile, return it. Falls back to no-op when the corpus is empty.
 *
 * Pure text-mining · zero AI calls · cheap. Handles a 463-conversation
 * corpus in milliseconds.
 */
export async function analyzePersonaCorpus(): Promise<CorpusProfile | null> {
  const rows = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: SOURCE_TYPE },
      select: { content: true },
    })
    .catch((): never[] => []);
  if (rows.length === 0) {
    log.info("analyze_skipped_no_corpus");
    return null;
  }

  const texts = rows.map((r) => r.content || "").filter((t) => t.length > 0);
  const profile = buildProfileFromTexts(texts);
  await persistProfile(profile);
  return profile;
}

/**
 * Pure analysis · text array → CorpusProfile. No DB · no async work.
 * Shared by the DB-backed entry point and the no-embeddings entry point.
 */
function buildProfileFromTexts(texts: string[]): CorpusProfile {
  const wordCounts: number[] = [];
  const phraseFreq = new Map<string, number>();
  let totalParagraphs = 0;
  let totalBullets = 0;
  let totalCodeBlocks = 0;
  let totalEmoji = 0;
  let hedgingHits = 0;
  let declarativeHits = 0;
  let emphasisHits = 0;
  let questionMarks = 0;
  let exclamationMarks = 0;

  for (const text of texts) {
    if (!text || text.length === 0) continue;

    // Length
    const tokens = tokenize(text);
    wordCounts.push(tokens.length);

    // N-grams · 2-gram + 3-gram · count both, surface top later
    for (const gram of buildNGrams(tokens, 2)) {
      phraseFreq.set(gram, (phraseFreq.get(gram) ?? 0) + 1);
    }
    for (const gram of buildNGrams(tokens, 3)) {
      phraseFreq.set(gram, (phraseFreq.get(gram) ?? 0) + 1);
    }

    // Structural
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    totalParagraphs += paragraphs.length;
    totalBullets += countBullets(text);
    totalCodeBlocks += countCodeBlocks(text);
    totalEmoji += countEmoji(text);

    // Voice leans
    const lower = text.toLowerCase();
    hedgingHits += countMatches(lower, HEDGING_WORDS);
    declarativeHits += countMatches(lower, DECLARATIVE_WORDS);
    emphasisHits += countMatches(lower, EMPHASIS_MARKERS);
    questionMarks += (text.match(/\?/g) || []).length;
    exclamationMarks += (text.match(/!/g) || []).length;
  }

  // ── Length stats ──
  const sorted = [...wordCounts].sort((a, b) => a - b);
  const meanWords =
    wordCounts.length === 0
      ? 0
      : Math.round(wordCounts.reduce((s, n) => s + n, 0) / wordCounts.length);
  const medianWords = median(sorted);
  const p90Words = p90(sorted);
  const dominantBucket: "short" | "medium" | "long" =
    medianWords < 50 ? "short" : medianWords < 200 ? "medium" : "long";

  // ── Top phrases ── filter min-count 3 so noise doesn't dominate
  const topPhrases = Array.from(phraseFreq.entries())
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }));

  const leanScore = hedgingHits - declarativeHits;

  // ── Build natural-language summary ──
  const lengthBlurb =
    dominantBucket === "short"
      ? `terse · most utterances under 50 words (median ${medianWords})`
      : dominantBucket === "medium"
        ? `medium-length · most utterances 50-200 words (median ${medianWords})`
        : `long-form · most utterances over 200 words (median ${medianWords})`;

  const leanBlurb =
    leanScore < -declarativeHits * 0.3
      ? `declarative · commits to answers rather than hedges (${declarativeHits} declarative vs ${hedgingHits} hedging tokens)`
      : leanScore > hedgingHits * 0.3
        ? `cautious · hedges more than commits (${hedgingHits} hedging vs ${declarativeHits} declarative tokens)`
        : `balanced · roughly equal commit vs hedge phrasing`;

  const punctBlurb =
    exclamationMarks > questionMarks * 2
      ? `emphatic · heavy on exclamation marks (${exclamationMarks} ! vs ${questionMarks} ?)`
      : questionMarks > exclamationMarks * 2
        ? `inquisitive · heavy on question marks (${questionMarks} ? vs ${exclamationMarks} !)`
        : `even on punctuation`;

  const sampleSize = texts.length;
  const structuralBlurb =
    totalBullets > totalParagraphs * 0.3
      ? `structures heavily with bullets (${totalBullets} bullets across ${sampleSize} utterances)`
      : totalCodeBlocks > sampleSize * 0.1
        ? `code-aware · ${totalCodeBlocks} fenced code blocks in the corpus`
        : `prose-dominant · sparse bullet / code usage`;

  const topPhraseList =
    topPhrases.length > 0
      ? topPhrases
          .slice(0, 6)
          .map((p) => `"${p.phrase}" (${p.count}×)`)
          .join(" · ")
      : "no high-frequency phrases extracted";

  const summary = [
    `Voice profile from ${sampleSize} utterances:`,
    `${lengthBlurb}.`,
    `${leanBlurb}.`,
    `${punctBlurb}.`,
    `${structuralBlurb}.`,
    `Top phrases: ${topPhraseList}.`,
  ].join(" ");

  return {
    sampleSize,
    lengthStats: { meanWords, medianWords, p90Words, dominantBucket },
    topPhrases,
    voiceLeans: {
      hedgingHits,
      declarativeHits,
      emphasisHits,
      questionMarks,
      exclamationMarks,
      leanScore,
    },
    structuralTells: {
      bulletLines: totalBullets,
      paragraphCount: totalParagraphs,
      codeBlockCount: totalCodeBlocks,
      emojiCount: totalEmoji,
      averageBulletsPerUtterance:
        sampleSize === 0 ? 0 : Number((totalBullets / sampleSize).toFixed(2)),
    },
    summary,
    builtAt: new Date().toISOString(),
  };
}

async function persistProfile(profile: CorpusProfile): Promise<void> {
  try {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: PROFILE_CATEGORY, key: PROFILE_KEY },
      },
      create: {
        category: PROFILE_CATEGORY,
        key: PROFILE_KEY,
        content: profile.summary,
        source: "persona_corpus_analyzer",
        confidence: 0.9,
        metadata: profile as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["create"]["metadata"],
      },
      update: {
        content: profile.summary,
        metadata: profile as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["update"]["metadata"],
        lastSeen: new Date(),
      },
    });
  } catch (err) {
    log.warn("profile_persist_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  log.info("analyze_complete", {
    sampleSize: profile.sampleSize,
    medianWords: profile.lengthStats.medianWords,
    leanScore: profile.voiceLeans.leanScore,
    topPhrase: profile.topPhrases[0]?.phrase ?? null,
  });
}

// ── Reader · used by persona-anchor + future UI ──────────────────────

interface ProfileCache {
  profile: CorpusProfile;
  loadedAt: number;
}
let profileCache: ProfileCache | null = null;
const PROFILE_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Load the cached voice profile. Returns null when no corpus has
 * been analyzed yet. 15-min cache · the corpus rarely changes so a
 * longer TTL is fine.
 */
export async function loadPersonaProfile(): Promise<CorpusProfile | null> {
  if (profileCache && Date.now() - profileCache.loadedAt < PROFILE_CACHE_TTL_MS) {
    return profileCache.profile;
  }
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: PROFILE_CATEGORY, key: PROFILE_KEY } },
      select: { metadata: true },
    })
    .catch(() => null);
  if (!row?.metadata) return null;
  const profile = row.metadata as unknown as CorpusProfile;
  if (!profile || typeof profile !== "object" || !profile.summary) return null;
  profileCache = { profile, loadedAt: Date.now() };
  return profile;
}

/** Force cache invalidation · called after a fresh analyze run. */
export function invalidatePersonaProfileCache(): void {
  profileCache = null;
}
