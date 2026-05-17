/**
 * VOICE CLONE TRAINER — pull Fireflies transcripts, extract Nour's
 * actual speaking patterns, and bake them into a tunable voice profile.
 *
 * v7 · BATCH 9 · Apr 28. The static NOUR_HIT_WORDS list is hand-curated.
 * This module mines the LIVE record (sales calls, vendor meetings, team
 * huddles already in Fireflies) for:
 *
 *   · Phrases Nour actually uses that didn't make the static list
 *   · Sentence-length distribution (median, p90)
 *   · Opening-word patterns (how Nour starts a sentence)
 *   · Closing-word patterns (how Nour ends one)
 *   · Question-vs-statement ratio
 *   · Cadence markers ("listen", "so", "right?", "you know what I mean")
 *
 * Output: a structured profile saved to brain_memory category =
 * "nour_voice_clone" that the system prompt + output critic load
 * alongside the static profile. Re-runs weekly via cron, so the voice
 * tracks Nour's evolution.
 *
 * Privacy: only Nour's spoken sentences are mined (filter on speaker
 * name match). Customer / vendor speech is dropped on the floor.
 */

import { getRecentTranscripts } from "@/lib/integrations/fireflies";
import { prisma } from "@/lib/prisma";

type FirefliesTranscript = Awaited<ReturnType<typeof getRecentTranscripts>>[number];

interface VoiceCloneProfile {
  /** Phrases mined that appear ≥3x in Nour's speech, ranked by frequency */
  hitPhrases: Array<{ phrase: string; count: number }>;
  /** Median sentence length in words */
  medianSentenceWords: number;
  /** p90 sentence length */
  p90SentenceWords: number;
  /** Top 10 sentence-opening words (lowercased, stop-words excluded) */
  openingWords: Array<{ word: string; count: number }>;
  /** Top 10 sentence-closing words */
  closingWords: Array<{ word: string; count: number }>;
  /** Ratio of question marks to total sentences (0-1) */
  questionRatio: number;
  /** Cadence/filler markers Nour uses */
  cadenceMarkers: Array<{ marker: string; count: number }>;
  /** How many transcripts went into this profile */
  transcriptsAnalyzed: number;
  /** How many sentences from Nour total */
  nourSentenceCount: number;
  /** When this profile was built */
  builtAt: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "so", "if", "of", "to", "in", "on", "at",
  "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "must", "can", "this", "that", "these", "those", "i", "you",
  "he", "she", "it", "we", "they", "my", "your", "his", "her", "its", "our",
  "their", "me", "him", "us", "them",
]);

const CADENCE_PATTERNS = [
  /\b(listen|so look|alright|right\?|you know|you know what I mean|here'?s the thing|the deal is|honestly|literally|basically)\b/gi,
];

/**
 * Filter on speaker name. Nour's Fireflies meetings tag him as "Nour"
 * or "Nour Daniels". Tighten if needed.
 */
function isNour(speaker: string): boolean {
  return /\bnour\b/i.test(speaker);
}

function nGramPhrases(sentences: string[], n: number, minCount: number): Array<{ phrase: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sent of sentences) {
    const words = sent
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      // Skip phrases that are 100% stop-words
      const allStop = words.slice(i, i + n).every((w) => STOP_WORDS.has(w));
      if (allStop) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));
}

function topWords(sentences: string[], extractor: (s: string) => string | null): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sent of sentences) {
    const w = extractor(sent);
    if (!w) continue;
    const lower = w.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (lower.length < 2) continue;
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function trainVoiceClone(): Promise<VoiceCloneProfile> {
  let transcripts: FirefliesTranscript[] = [];
  try {
    transcripts = await getRecentTranscripts(20);
  } catch (err) {
    console.warn("[voice-clone] Fireflies fetch failed:", err instanceof Error ? err.message : err);
    transcripts = [];
  }

  const nourSentences: string[] = [];
  for (const t of transcripts) {
    for (const s of t.sentences) {
      if (isNour(s.speaker) && s.text && s.text.length > 5) {
        nourSentences.push(s.text);
      }
    }
  }

  // Sentence lengths
  const sentenceLengths = nourSentences.map((s) => s.split(/\s+/).length);
  const medianSentenceWords = Math.round(median(sentenceLengths));
  const p90SentenceWords = Math.round(percentile(sentenceLengths, 90));

  // Hit phrases (2-grams + 3-grams)
  const bigrams = nGramPhrases(nourSentences, 2, 3);
  const trigrams = nGramPhrases(nourSentences, 3, 3);
  const hitPhrases = [...trigrams, ...bigrams].slice(0, 30);

  // Opening / closing words
  const openingWords = topWords(nourSentences, (s) => {
    const m = s.trim().match(/^[a-zA-Z']+/);
    return m ? m[0] : null;
  });
  const closingWords = topWords(nourSentences, (s) => {
    const m = s.trim().match(/[a-zA-Z']+[.!?]?\s*$/);
    return m ? m[0].replace(/[.!?]/g, "") : null;
  });

  // Question ratio
  const questionCount = nourSentences.filter((s) => s.trim().endsWith("?")).length;
  const questionRatio = nourSentences.length > 0 ? questionCount / nourSentences.length : 0;

  // Cadence markers
  const cadenceMap = new Map<string, number>();
  for (const sent of nourSentences) {
    for (const pat of CADENCE_PATTERNS) {
      const matches = sent.match(pat) ?? [];
      for (const m of matches) {
        const lower = m.toLowerCase();
        cadenceMap.set(lower, (cadenceMap.get(lower) ?? 0) + 1);
      }
    }
  }
  const cadenceMarkers = [...cadenceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([marker, count]) => ({ marker, count }));

  const profile: VoiceCloneProfile = {
    hitPhrases,
    medianSentenceWords,
    p90SentenceWords,
    openingWords,
    closingWords,
    questionRatio: Math.round(questionRatio * 100) / 100,
    cadenceMarkers,
    transcriptsAnalyzed: transcripts.length,
    nourSentenceCount: nourSentences.length,
    builtAt: new Date().toISOString(),
  };

  // Persist to brain_memory
  const key = `voice_clone:${new Date().toISOString().slice(0, 10)}`;
  await prisma.brainMemory
    .create({
      data: {
        category: "nour_voice_clone",
        key,
        source: "voice_clone_trainer",
        content: `Voice clone profile built ${new Date().toISOString()} from ${transcripts.length} transcripts (${nourSentences.length} sentences). Median ${medianSentenceWords} words/sent. Top phrase: ${hitPhrases[0]?.phrase ?? "n/a"}.`,
        confidence: 0.85,
        metadata: profile as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch((err: unknown) => {
      console.warn("[voice-clone] persist failed:", err instanceof Error ? err.message : err);
    });

  return profile;
}

/**
 * Load the latest voice clone profile from brain_memory. Used by
 * system-prompt assembly + output critic.
 */
export async function loadLatestVoiceCloneProfile(): Promise<VoiceCloneProfile | null> {
  const row = await prisma.brainMemory
    .findFirst({
      where: { category: "nour_voice_clone" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    })
    .catch(() => null);

  if (!row?.metadata) return null;
  return row.metadata as unknown as VoiceCloneProfile;
}

/**
 * Build a clone-augmented voice prompt block. Add to system prompt when
 * intent is creative / decision / analytical.
 */
export function buildClonedVoicePrompt(profile: VoiceCloneProfile | null): string {
  if (!profile || profile.nourSentenceCount < 50) {
    // Not enough data — fallback to static prompt only
    return "";
  }
  const topPhrases = profile.hitPhrases.slice(0, 8).map((h) => `"${h.phrase}"`).join(", ");
  const topOpenings = profile.openingWords.slice(0, 5).map((w) => `"${w.word}"`).join(", ");
  const cadence = profile.cadenceMarkers.slice(0, 5).map((m) => `"${m.marker}"`).join(", ");

  return `## Live voice clone (mined from ${profile.transcriptsAnalyzed} of Nour's actual recordings)
- Real phrases Nour uses: ${topPhrases}
- How Nour opens sentences: ${topOpenings}
- Cadence/filler patterns: ${cadence || "(none distinct)"}
- Median sentence length: ${profile.medianSentenceWords} words (target this; never exceed ${profile.p90SentenceWords})
- Question ratio: ${(profile.questionRatio * 100).toFixed(0)}% of sentences end with "?". Mirror this when conversational.`;
}
