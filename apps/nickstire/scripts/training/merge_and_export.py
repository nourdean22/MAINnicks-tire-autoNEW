from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-3B-Instruct", torch_dtype="bfloat16", device_map="auto")
model = PeftModel.from_pretrained(base, "/output/nickgpt-lora-final")
merged = model.merge_and_unload()
merged.save_pretrained("/output/nickgpt-merged")
AutoTokenizer.from_pretrained("Qwen/Qwen2.5-3B-Instruct").save_pretrained("/output/nickgpt-merged")
