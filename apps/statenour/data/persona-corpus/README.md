# Persona Corpus · drop your text here

This folder feeds the **behavioral persona vector** for Arc B Feature 4 ·
the second half of Ghost Nick (the first half is the 8-axis identity
snapshot · this is your actual recorded voice).

## What goes here

Anything operator-authored. The importer extracts ONLY your text —
assistant / Nick replies get filtered out per-format. Drop in:

- **ChatGPT export** · `conversations.json` from
  `chatgpt.com/settings/data → Export data → email link → unzip`.
  All historical conversations get ingested at once.
- **iCloud Notes** · export each note as a `.txt` or `.md` file (Notes
  app on Mac: select notes → Share → Export as Plain Text, or use the
  iOS Shortcut "Export Note") and drop them in this folder.
- **Plain text files** · any `.txt` / `.md` you've journaled, drafted,
  or written. Each file is treated as one utterance.
- **JSON arrays** · `["...", "...", ...]` of raw operator utterances, OR
  `[{ role: "user", content: "..." }, ...]` chat-message shape (the
  importer filters `role !== "user"`).

## How to run

```bash
pnpm tsx scripts/import-persona-corpus.ts
```

Or with a different directory:

```bash
pnpm tsx scripts/import-persona-corpus.ts --dir C:/path/to/exports
```

## What happens

1. Every file in the folder gets parsed by extension.
2. Operator utterances ≥ 40 chars get an embedding (capped at 1500
   chars each · the first paragraph carries the voice).
3. New utterances persist to `vector_embeddings` with
   `sourceType="behavioral_persona"`. Already-embedded utterances skip
   re-embed automatically (idempotent · safe to re-run).
4. All persona embeddings get mean-pooled into a centroid vector.
5. Centroid lands in `BrainMemory(category="behavioral_persona_vector",
   key="current")`.
6. The persona-anchor builder picks it up on the next chat turn
   (after the 15-min cache TTL · or restart dev).

## Limits per run

- **2000 utterances max per run** · the 463-conversation ChatGPT export
  will need 1-2 runs. The importer is idempotent · re-running picks
  up where it left off automatically.
- **50ms between embed calls** · provider-rate-limit-safe.

## What it powers

Once the centroid is built:

- **Persona-anchor prompt injection** at chat-time learns from your
  actual voice corpus, not just the 8-axis self-report.
- **Persona-drift detector** can compare new replies to the
  BEHAVIORAL anchor (future Phase) for finer-grained drift detection.

## Privacy note

These embeddings live in your local Neon database. They don't leave
your stack. The corpus folder itself is `.gitignore`-listed so the
raw text never enters git.
