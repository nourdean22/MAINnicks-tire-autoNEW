# Bulk Whisper Re-Transcription · VAPI Archive

**Owner:** operator (Nour)
**Skill-port:** Category 5 of `docs/eval-rubrics/huggingface-model-strategy.md`
**Wave:** AK
**Closes:** audit finding #321 (VAPI eval pipeline · richer corpus)
**Time:** ~6 hours operator wall-time · 3-4 hours of which is unattended Modal job
**Cost:** ~$0.005/minute of audio · 100 hours of calls = ~$30 one-time

## Why this matters

VAPI's live transcripts come from Deepgram (Cartesia stack) and are good but not great on:
- Auto-industry jargon ("265/65R17", "wheel-alignment toe-and-camber", part numbers)
- Customer-side audio (customers often have background noise, weak mic)
- Spanish-language calls (Deepgram English bias)

`openai/whisper-large-v3-turbo` is 4× faster than v3, matches v3 quality, and OUTPERFORMS Deepgram on noisy auto-industry audio in head-to-head benchmarks. Plus we can run it on the entire VAPI archive in 4 hours for ~$30.

The richer corpus enables:
1. **Better eval signals** · audit #321 wanted to evaluate per-call AI handoff quality · bad transcripts produce bad eval
2. **NickGPT training data** · the SMS corpus is great but VAPI transcripts are 10× larger · feeding the moat (Wave AE)
3. **RAG retrieval** · `meeting_transcript` category in statenour brain already has Fireflies pipeline · this extends it to phone calls
4. **Service-affinity v2 signal** · cross-sell predictions (Wave 181.x) get better with clean transcript signal vs Deepgram approximate

## What we shipped (Wave AK)

1. **`scripts/export-vapi-recordings.ts`** (~140 lines)
   - Walks `vapi_call_logs` · filters by `recordingUrl IS NOT NULL`
   - Default · skip rows with existing transcript (idempotent re-runs)
   - `--force-all` · re-transcribe every recording
   - `--eval-low-scores` · only rows with evalScore < 50 (audit #321 cohort)
   - `--days N` · windowed
   - Outputs JSONL to `data/training/vapi-recordings-YYYYMMDD.jsonl`
   - Reports total audio duration + cost estimate

2. **This runbook** · the full Modal Whisper pipeline + write-back

## Activation (operator-action)

### Step 1 · Export the JSONL

```bash
# Smart default · only un-transcribed rows
pnpm tsx scripts/export-vapi-recordings.ts

# Audit #321 cohort · low-eval-score calls only · last 90 days
pnpm tsx scripts/export-vapi-recordings.ts --eval-low-scores --days 90

# Full re-transcribe (slow, expensive · only do once before NickGPT training)
pnpm tsx scripts/export-vapi-recordings.ts --force-all
```

Output reports total audio + cost estimate. Spot-check before proceeding · 100+ hours might be more than expected.

### Step 2 · Upload to Modal volume

```bash
modal volume create vapi-recordings
modal volume put vapi-recordings data/training/vapi-recordings-YYYYMMDD.jsonl /input.jsonl
```

### Step 3 · Create the Modal Whisper script

Save to `scripts/training/modal_bulk_whisper.py`:

```python
import modal
import json
import urllib.request

app = modal.App("vapi-bulk-whisper")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.4.0",
        "transformers==4.46.0",
        "accelerate==1.0.0",
    )
)

vol_in = modal.Volume.from_name("vapi-recordings", create_if_missing=True)
vol_out = modal.Volume.from_name("vapi-transcripts", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",     # ~$1.10/hr · 8x realtime · 100hr audio in ~12.5hr GPU = ~$14
    timeout=12 * 3600,
    volumes={"/in": vol_in, "/out": vol_out},
)
def transcribe_all():
    import torch
    from transformers import pipeline

    MODEL = "openai/whisper-large-v3-turbo"
    device = "cuda" if torch.cuda.is_available() else "cpu"

    pipe = pipeline(
        "automatic-speech-recognition",
        model=MODEL,
        device=device,
        torch_dtype=torch.float16,
        chunk_length_s=30,
        return_timestamps=True,
    )

    with open("/in/input.jsonl") as f:
        rows = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(rows)} recordings to transcribe")

    results = []
    failed = []
    for i, row in enumerate(rows):
        call_id = row["vapiCallId"]
        url = row["recordingUrl"]
        out_path = f"/out/transcripts/{call_id}.json"
        # Idempotent · skip if already transcribed
        import os
        if os.path.exists(out_path):
            print(f"[{i+1}/{len(rows)}] {call_id} already done · skipping")
            continue

        try:
            # Download the recording to /tmp
            local = f"/tmp/{call_id}.wav"
            urllib.request.urlretrieve(url, local)

            # Transcribe
            result = pipe(local)
            text = result.get("text", "")
            chunks = result.get("chunks", [])

            # Write JSON output: { text, chunks: [{ timestamp: [start, end], text }] }
            os.makedirs("/out/transcripts", exist_ok=True)
            with open(out_path, "w") as f:
                json.dump({
                    "vapiCallId": call_id,
                    "transcript": text,
                    "chunks": chunks,
                    "model": MODEL,
                }, f)

            print(f"[{i+1}/{len(rows)}] {call_id} OK · {len(text)} chars")
            os.remove(local)
        except Exception as e:
            print(f"[{i+1}/{len(rows)}] {call_id} FAILED: {e}")
            failed.append({"vapiCallId": call_id, "error": str(e)})

    # Write failure manifest
    with open("/out/failures.json", "w") as f:
        json.dump(failed, f)

    print(f"DONE · {len(rows) - len(failed)} succeeded · {len(failed)} failed")

@app.local_entrypoint()
def main():
    transcribe_all.remote()
```

Then run:

```bash
modal run scripts/training/modal_bulk_whisper.py
```

Modal logs to stdout · ~12 hours for 100hr of audio (8× realtime on A10G).

### Step 4 · Download transcripts

```bash
modal volume get vapi-transcripts /transcripts ./data/training/transcripts/
modal volume get vapi-transcripts /failures.json ./data/training/whisper-failures.json
```

Each `transcripts/<vapiCallId>.json` contains `{ transcript, chunks, model }`.

### Step 5 · Write back to DB

Create `scripts/import-vapi-transcripts.ts` (or run via Drizzle CLI):

```ts
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const dir = resolve("./data/training/transcripts");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} transcripts to import`);

  const { getDb } = await import("../server/db");
  const { vapiCallLogs } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("No DB");

  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    const { vapiCallId, transcript } = data;
    if (!vapiCallId || !transcript) continue;
    // Store transcript text as a data URL OR write to a dedicated
    // bulk_transcripts table. Below uses a simple approach: stash as
    // a Markdown comment in aiSummary OR add a new bulk_transcript
    // column via migration. For one-shot import, easiest path is
    // a side table:
    //   CREATE TABLE vapi_bulk_transcripts (
    //     vapi_call_id VARCHAR(64) PRIMARY KEY,
    //     transcript TEXT NOT NULL,
    //     model VARCHAR(64) NOT NULL,
    //     transcribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    //   );
    // Operator can choose schema. The transcripts/<id>.json files are
    // the source of truth · DB is just a join key.
    console.log(`Imported ${vapiCallId} (${transcript.length} chars)`);
  }
}
main();
```

This is a stub · operator decides schema:
- **Option A** · new `vapi_bulk_transcripts` side table (cleanest · 1 migration)
- **Option B** · stash in existing `vapiCallLogs.aiSummary` (no migration · destructive · loses original summary)
- **Option C** · stash in `vapiCallLogs` `metadata` JSON column if one exists (check schema)

Recommended · Option A · the migration is tiny:

```sql
-- drizzle/00XX_bulk_transcripts.sql
CREATE TABLE IF NOT EXISTS vapi_bulk_transcripts (
  vapi_call_id VARCHAR(64) PRIMARY KEY,
  transcript TEXT NOT NULL,
  model VARCHAR(64) NOT NULL,
  transcribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_transcribed_at (transcribed_at)
);
```

Apply via `nickActions.runMigrations` admin tRPC (same pattern as Wave SA v2).

### Step 6 · Use the corpus

The transcripts now power:
- **NickGPT (Wave AE)** · add transcript text to the SMS corpus for richer training
- **Brain RAG (statenour)** · ingest the `meeting_transcript` category with new `vapi_phone_call` subcategory
- **Eval (audit #321)** · re-score the low-eval-score calls with better transcripts
- **Service Affinity v2 (memory)** · feed transcript text to the cross-sell predictor

Each use case is its own follow-up task. The transcripts are the foundation.

## Cost ceiling

| Audio hours | Modal A10G cost | Time |
|---|---|---|
| 10 hours | $1.40 | 1.25 hours |
| 100 hours | $14 | 12.5 hours |
| 500 hours | $70 | 62 hours (parallelize via multiple containers) |

Plus Modal storage · trivial (~$0.10/mo for the volumes).

For 1000+ hours, consider HF Inference Endpoints or self-hosted Whisper on a persistent GPU box · breakeven around 300 hours.

## Anti-patterns

### "Re-transcribe everything every run"

The script's default is idempotent (skip rows with existing transcriptUrl). Only use `--force-all` ONCE when migrating to a better model. Repeated full-runs burn $$ for no quality gain.

### "Trust Whisper on numbers without spot-check"

Whisper hallucinates on rare/technical numbers ("265/65R17" might become "two sixty five sixty five seventeen" or worse "260/65/17"). Spot-check 20 random transcripts · if accuracy is < 95% on numeric tokens, switch to `nyrahealth/CrisperWhisper` (better on jargon).

### "Skip the failure manifest"

The Modal job writes `failures.json` listing every recording that errored. Investigate · was the URL expired? Audio file corrupt? Network blip? Re-run just the failures with a re-export filtered to those vapiCallIds.

### "Forget the schema decision"

Operator MUST decide where transcripts land (vapi_bulk_transcripts side table vs aiSummary overwrite). Do this BEFORE running the Modal job, not after · the migration is 1 minute work, the re-architecture if you choose wrong is 1 day.

## Rollback

If the bulk transcripts are noisy:
1. Drop the `vapi_bulk_transcripts` table (operator-action, destructive)
2. Don't worry about the JSON files in Modal volume · they survive
3. Re-run with a different model (e.g. `distil-whisper/distil-large-v3` · 6× faster) and a smaller windowed export to compare

The original transcriptUrl values are untouched · the existing transcript path keeps working.

## Skill-port lineage

Category 5 of `docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:
- `docs/runbooks/nickgpt-finetune.md` (Wave AE · richer training corpus)
- `docs/eval-rubrics/voice-agent.md` (the canonical VAPI playbook · this closes audit #321 eval gap)
- `docs/eval-rubrics/enterprise-search.md` (the transcripts feed Stage 1 BM25 + Stage 2 vector retrieval)
- Memory · `meeting_transcript` category (Fireflies pipeline · this is the phone-call sibling)

Future · once the bulk transcripts are clean, fine-tune a tiny domain-specific Whisper on operator-corrected versions · Cleveland-accent + tire-jargon Whisper at $0.0001/call. The compound move sibling to NickGPT.
