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
