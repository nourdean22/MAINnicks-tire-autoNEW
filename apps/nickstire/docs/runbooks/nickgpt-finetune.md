# NickGPT · LoRA Fine-Tune Runbook

**Owner:** operator (Nour)
**Goal:** train a 3B model on operator's own SMS reply corpus → deploy via Ollama on Railway → serve via `server/services/nickgpt-client.ts`
**Time:** ~6 hours operator wall-time (4 hours of which is the training itself, unattended)
**Cost:** ~$50 first run · ~$30 monthly re-fine-tune
**Frequency:** monthly re-fine-tune (the moat compounds with more approved replies)

---

## Why we do this

NickGPT is the **compound moat** from the HuggingFace strategy port (`docs/eval-rubrics/huggingface-model-strategy.md` Cat 12). It produces SMS drafts in the operator's exact voice using exact phrasing · never sounds like ChatGPT · runs at ~$0.0001 per draft instead of $0.005 on Claude. No competitor can copy this even with full code access · the conversation history is the moat.

Once shipped, the operator → approved-reply data flywheel runs forever:
- Customer texts in → NickGPT drafts a reply → operator reviews + edits if needed → SMS sends → outbound row hits the corpus → next month's fine-tune trains on the new approved replies → quality compounds.

---

## Prerequisites

| Item | Where to set up |
|---|---|
| Modal account ($30 free credits at signup, then ~$0.50/hr GPU) | https://modal.com/signup |
| HuggingFace account (read access tokens, free) | https://huggingface.co/join |
| HF gated-model access for Llama-3.2 | Request at https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct |
| Local Python 3.11+ environment | `pyenv install 3.11.10` |
| Modal CLI installed + auth | `pip install modal && modal token new` |

Skip Modal if you'd rather use Replicate or Lambda Labs · adjust Step 4 accordingly. The training script is portable.

---

## Step 1 · Export the corpus

Run from `apps/nickstire/`:

```bash
pnpm tsx scripts/export-sms-corpus.ts --days 365 --min-pairs 500
```

This writes `data/training/nickgpt-corpus-YYYYMMDD.jsonl` with one training example per line, OpenAI-format chat messages.

**Sanity checks before proceeding:**
- ≥500 pairs (script aborts below this · widen `--days` or lower `--min-pairs`)
- p50 reply length 60–200 chars (under 60 → too many "ok"/"thanks" rows · over 200 → automation leaked through)
- Eyeball 20 random lines via `head -20 data/training/nickgpt-corpus-*.jsonl | jq -c .messages[2].content`
- If the eyeball reveals templated replies, tighten the AUTOMATION_MARKERS list in the export script and re-run

**Privacy** · the script redacts phones, emails, URLs, addresses, CC/SSN patterns. Run with `--redact-aggressive` if you want first names redacted too (recommended for first training run; you can re-export less-aggressively once trust is established).

---

## Step 2 · Upload corpus to HF Hub (or Modal volume)

Privacy decision — pick one:

**Option A · Private HF Dataset** (easiest, free private datasets up to 100GB)

```python
from huggingface_hub import HfApi
api = HfApi()
api.create_repo("YOUR_HF_USERNAME/nickgpt-corpus", repo_type="dataset", private=True)
api.upload_file(
    path_or_fileobj="data/training/nickgpt-corpus-YYYYMMDD.jsonl",
    path_in_repo="train.jsonl",
    repo_id="YOUR_HF_USERNAME/nickgpt-corpus",
    repo_type="dataset",
)
```

**Option B · Modal volume** (data never leaves Modal)

```bash
modal volume create nickgpt-data
modal volume put nickgpt-data data/training/nickgpt-corpus-YYYYMMDD.jsonl /train.jsonl
```

Recommendation · Option B for stricter privacy. Option A if you also want to iterate from a notebook.

---

## Step 3 · Create the Modal training script

Save this to `scripts/training/modal_finetune_nickgpt.py` (NEW file · runs on Modal, not in our app):

```python
import modal

app = modal.App("nickgpt-finetune")

# GPU + dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.0",
        "transformers==4.46.0",
        "datasets==3.0.1",
        "peft==0.13.0",
        "trl==0.11.0",
        "accelerate==1.0.0",
        "bitsandbytes==0.44.0",
        "huggingface_hub==0.25.0",
    )
    .env({"HF_TOKEN": modal.Secret.from_name("huggingface-token")})
)

volume = modal.Volume.from_name("nickgpt-data", create_if_missing=True)
out_volume = modal.Volume.from_name("nickgpt-output", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G",  # ~$1.10/hr · 4hr ≈ $4.50 for 3B-LoRA
    timeout=6 * 3600,
    volumes={"/data": volume, "/output": out_volume},
    secrets=[modal.Secret.from_name("huggingface-token")],
)
def train():
    import os
    import torch
    from datasets import load_dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    BASE_MODEL = "meta-llama/Llama-3.2-3B-Instruct"

    # 4-bit quant for memory efficiency on A10G
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
    )

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
    )
    model = prepare_model_for_kbit_training(model)

    lora = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    dataset = load_dataset("json", data_files="/data/train.jsonl", split="train")
    # 90/10 train/eval split
    split = dataset.train_test_split(test_size=0.1, seed=42)

    cfg = SFTConfig(
        output_dir="/output/nickgpt-lora",
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        warmup_ratio=0.1,
        logging_steps=10,
        eval_steps=50,
        eval_strategy="steps",
        save_steps=100,
        save_total_limit=2,
        bf16=True,
        optim="paged_adamw_8bit",
        max_seq_length=1024,
        packing=False,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=cfg,
        train_dataset=split["train"],
        eval_dataset=split["test"],
        peft_config=lora,
    )

    trainer.train()
    trainer.save_model("/output/nickgpt-lora-final")
    print("Training complete · adapters saved to /output/nickgpt-lora-final")

@app.local_entrypoint()
def main():
    train.remote()
```

Then run:

```bash
modal secret create huggingface-token HF_TOKEN=hf_xxxxx
modal run scripts/training/modal_finetune_nickgpt.py
```

Watch the logs. ~4 hours for 500-2000 pairs on A10G. Tune `num_train_epochs` to 2 if loss converges fast, or 5 if it's still descending.

**Eval signal** · loss should drop from ~2.5 to ~1.2 over training. If it plateaus at 2.0+, the corpus is too noisy · re-run export with stricter filters.

---

## Step 4 · Merge LoRA + convert to GGUF (for Ollama)

```python
# scripts/training/merge_and_export.py · run on Modal or local GPU
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.2-3B-Instruct", torch_dtype="bfloat16", device_map="auto")
model = PeftModel.from_pretrained(base, "/output/nickgpt-lora-final")
merged = model.merge_and_unload()
merged.save_pretrained("/output/nickgpt-merged")
AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-3B-Instruct").save_pretrained("/output/nickgpt-merged")
```

Then convert to GGUF (Ollama's serving format):

```bash
# llama.cpp convert script · install via `pip install llama-cpp-python`
python -m llama_cpp.convert_hf_to_gguf /output/nickgpt-merged --outfile nickgpt.gguf --outtype q4_k_m
```

`q4_k_m` quantization · 4-bit · loses ~1% quality · 3B model becomes ~1.8GB file (Ollama-friendly on a small Railway box).

---

## Step 5 · Deploy to Ollama on Railway

Create a new Railway service in the `natural-appreciation` project:

```yaml
# railway.toml in a new repo OR Dockerfile-based service
[build]
builder = "DOCKERFILE"

[deploy]
healthcheckPath = "/api/version"
restartPolicyType = "ON_FAILURE"
```

```dockerfile
# Dockerfile
FROM ollama/ollama:latest
COPY nickgpt.gguf /models/nickgpt.gguf
COPY Modelfile /Modelfile
RUN ollama serve & sleep 2 && ollama create nickgpt -f /Modelfile
EXPOSE 11434
CMD ["ollama", "serve"]
```

```
# Modelfile
FROM /models/nickgpt.gguf
PARAMETER temperature 0.5
PARAMETER num_predict 320
SYSTEM "You are Nick, the owner-operator of Nick's Tire & Auto in Cleveland/Euclid, Ohio. You text customers personally — never sound like a chatbot. Be direct, helpful, and honest. Customers don't pay until they say yes to the work. Keep replies under 320 characters when possible."
```

Push the new repo. Railway builds and deploys. Note the service URL (e.g. `https://nickgpt-ollama-production.up.railway.app`).

**Security** · add a basic auth layer via Caddy or set `NICKGPT_AUTH_TOKEN` and require the bearer header in your reverse proxy. The Ollama container itself doesn't auth by default.

---

## Step 6 · Wire the nickstire app

Set in Railway · nickstire service env:

```
NICKGPT_OLLAMA_URL=https://nickgpt-ollama-production.up.railway.app
NICKGPT_MODEL_NAME=nickgpt
NICKGPT_AUTH_TOKEN=<your-shared-secret>   # if you added auth
```

Then enable the feature flag:

```bash
# from admin tab session
fetch("/api/trpc/featureFlags.toggle", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({"0":{"json":{"key":"nickgpt_drafter_enabled","value":true}}})
})
```

Verify · the next inbound SMS that triggers a draft should log `source: "nickgpt-ollama"` instead of `fallback-claude`.

---

## Step 7 · Eval + monitoring

After 1 week with the flag ON, look at:

| Metric | Where | Healthy |
|---|---|---|
| Latency p95 | nickgpt-client logs | <2000ms |
| Operator-edit rate | (% of drafts operator changes before sending) | <30% means voice fidelity is good |
| Fallback rate | log entries with `source: "fallback-*"` | <5% means Ollama is reliable |
| Customer reply rate | `sms_messages.replyCount` per outbound | match or beat pre-NickGPT baseline |

If operator-edit rate >50%, the model didn't learn the voice well · re-run export with more pairs or tighter filters, then re-fine-tune.

---

## Step 8 · Monthly re-fine-tune (the compounding move)

First Sunday of each month:

```bash
# 1. Export updated corpus (includes the last month's approved replies)
pnpm tsx scripts/export-sms-corpus.ts --days 365 --min-pairs 500

# 2. Re-upload to Modal volume
modal volume put nickgpt-data data/training/nickgpt-corpus-YYYYMMDD.jsonl /train.jsonl

# 3. Re-run training
modal run scripts/training/modal_finetune_nickgpt.py

# 4. Re-export to GGUF + Railway deploy (Steps 4–5)

# 5. Restart Railway service · Ollama reloads model · zero-config swap on nickstire side
```

Each month the model gets sharper at operator voice. The first re-fine-tune typically shows the biggest improvement (the seed corpus is noisier than the curated next-month data).

---

## Rollback

If NickGPT quality regresses · turn the flag OFF · the fallback kicks in:

```bash
fetch("/api/trpc/featureFlags.toggle", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({"0":{"json":{"key":"nickgpt_drafter_enabled","value":false}}})
})
```

The nickstire app silently routes to Claude/Venice. No deploy needed.

---

## Cost ceiling

| Item | Cost |
|---|---|
| Modal A10G GPU · 4hr per training | $4.50 |
| Modal storage · ~5GB persistent | $0.10/mo |
| HF dataset · private | $0 |
| Railway · Ollama container | ~$15/mo (small instance) |
| Per-draft inference | ~$0.0001 |
| **Monthly steady state** | **~$50** (training run + serving + drafts) |

vs Claude SMS-drafting baseline at ~$50/mo on Claude API depending on volume. **Cost-neutral OR slight savings** in steady state, with **better voice fidelity** + **compounding moat**.

---

## Skill-port lineage

This runbook is the operational layer of `docs/eval-rubrics/huggingface-model-strategy.md` Cat 12 (the compound moat). Pairs with:

- `scripts/export-sms-corpus.ts` (the data exporter)
- `server/services/nickgpt-client.ts` (the serving stub)
- `docs/eval-rubrics/autonomous-action-tiers.md` (NickGPT drafts are Tier-1 reviewable · operator approves before send)
- `docs/eval-rubrics/security-audit.md` (Domain 4 secrets · NICKGPT_AUTH_TOKEN rotation discipline)
- Memory · F25e SMS gateway routing (Wave 103 · NickGPT drafts route via `{ via: "shop" }` like every other customer-facing SMS)

Future · once NickGPT drafts beat Claude on operator-edit-rate, candidate to enable `smart_sms_auto_reply` for low-risk intents (price questions · hours · directions) · operator out of the loop for those drafts.
