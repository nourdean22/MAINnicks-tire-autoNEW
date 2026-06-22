# Statenour Research Lab Operational Manual

The Statenour Research Lab is a local-first private research cockpit and grounding engine. It compiles codebases, internal databases, Obsidian vaults, and external crawled web pages into unified Markdown source packs, uploads them to Google NotebookLM for strategic digestion, and parses the outputs back into Statenour as grounded, verified claims and action items.

---

## 1. Directory Structure

All generated research packs are stored in a standard folder structure under:
`research-packs/<slug>/` relative to the monorepo root (or `RESEARCH_PACK_OUTPUT_DIR` if overridden).

```text
research-packs/<slug>/
├── 00_MANIFEST.md          # Human-readable summary of sources
├── 01_BRIEFING.md          # Pack contextual briefing template
├── 02_SOURCE_INDEX.md      # Index of sources and quality scores
├── 03_CLAIMS.md            # Extracted claims (populated by ingest)
├── 04_CONTRADICTIONS.md     # Contradictions and debate counterpoints
├── 05_ACTION_PLAN.md       # Strategic actions, tasks, and rules
├── 06_NOTEBOOKLM_GUIDE.md   # Copy-paste prompts & critique scripts
├── manifest.json           # Machine-readable manifest with hashes (Rule 9)
├── .sources-embeddings.json # Local grounding vector cache
├── notebooklm-upload/      # Grounded source documents to upload
│   ├── 00_UPLOAD_ME_FIRST.md
│   └── sources.md
└── notebooklm-output/      # Folder where NotebookLM outputs are pasted
    ├── claims.md
    └── action_plan.md
```

---

## 2. Command Line Interface Reference

### Source Pack Generation
Compiles local context and crawls specified URLs into a new source pack.

```bash
# Basic run
pnpm research:pack --topic "Ollama provider routing" --domain ai_system

# Deep run with Firecrawl web crawling, codebase context, and size limit
pnpm research:pack \
  --topic "Nick's Tire SEO Domination" \
  --domain business \
  --depth deep \
  --include-repo \
  --include-obsidian \
  --max-sources 12 \
  --source "https://developers.google.com/search/docs/fundamentals/seo-starter-guide"
```

**Generation Flags:**
* `--topic "<name>"`: (Required) Topic of the research.
* `--domain <domain>`: Domain context (`business`, `ai_system`, `health`, `personal_os`, `finance`, `legal`, `general`).
* `--depth <quick|standard|deep>`: Depth of contextual search.
* `--source "<url_or_file>"`: Specify a URL to scrape or local file to load (repeatable).
* `--include-repo`: Search codebase TS/JS/MD files for matches.
* `--include-obsidian`: Scan Obsidian note vault.
* `--include-statenour`: Scan BrainMemory database rows.
* `--max-sources <num>`: Cap the number of sources collected (default 10).
* `--no-scrape`: Completely disable Firecrawl scraping (converts URLs to placeholders).
* `--force`: Force overwrite the pack folder if it already exists.

### Research Pack Ingestion (Memory-only by default)
Ingests the pack manifest into the database as a `research_pack` memory row.

```bash
# Standard dry-run (checks what would be imported)
pnpm research:ingest --slug "nicks-tire-seo-domination" --dry-run

# Ingest and create database tasks/decisions (bypassing high-stakes warnings)
pnpm research:ingest --slug "nicks-tire-seo-domination" --create-tasks --create-decisions
```

**Ingestion Flags:**
* `--slug "<slug>"`: (Required) Slug of the generated pack.
* `--create-tasks`: Create Tasks in the database from actions.
* `--create-decisions`: Create MasteryDecisions in the database from actions.
* `--dry-run`: Simulation mode. Prints operations but does not write to the DB.
* `--allow-high-stakes-actions`: Permit task/decision creation in `health`, `finance`, or `legal` domains.
* `--force`: Force ingestion even if the content hash matches.

### NotebookLM Output Ingestion
Ingests files pasted by the operator into `notebooklm-output/`, executing vector grounding.

```bash
pnpm research:notebooklm --slug "nicks-tire-seo-domination" --create-tasks
```

---

## 3. Grounding & Hallucination Guardrail

Any claim ingested from NotebookLM is treated as unverified unless supported by source pack evidence.
The system chunks `sources.md` and generates vector embeddings locally, comparing them to the claim text:

* **Cosine Similarity >= 0.80**: Classified as `source_supported`. The `requires_source_verification` flag is cleared (`false`).
* **0.55 to 0.79**: Classified as `weak_support`. Flag remains `true`.
* **Below 0.55**: Classified as `requires_source_verification`. Flag remains `true`.

---

## 4. Domain Safety Controls (Rule 8)

High-stakes domains (`health`, `finance`, `legal`) require strict reviews:
1. All ingested memories automatically carry `requires_professional_review: true` in metadata.
2. Ingest CLIs will refuse to create tasks or decisions unless the `--allow-high-stakes-actions` flag is supplied.
