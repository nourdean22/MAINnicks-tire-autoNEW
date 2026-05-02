"""Decode base64-encoded Drive download JSON to disk for inspection."""
import base64
import json
import sys
from pathlib import Path

if len(sys.argv) < 3:
    print("Usage: extract-drive-images.py <input.txt> <output.bin>")
    sys.exit(1)

src = Path(sys.argv[1])
dst = Path(sys.argv[2])

raw = src.read_text(encoding="utf-8")
data = json.loads(raw)
content_b64 = data["content"]
binary = base64.b64decode(content_b64)
dst.write_bytes(binary)
print(f"Wrote {len(binary)} bytes to {dst}")
print(f"MIME: {data.get('mimeType')}")
print(f"Title: {data.get('title')}")
