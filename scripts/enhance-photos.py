"""
v1.7 Grounded & Reliable · photo quality pass.

Honest scope: PIL filter chain, no AI super-resolution.
Source photos came from a Google Doc PDF (already lossy compression).
We can't recover detail that wasn't there — just push perceived
crispness, color, and contrast up to the ceiling the existing pixels
allow, and re-encode at higher quality so we don't compound losses.

Pipeline (per photo):
  1. UnsharpMask — radius=1.5, percent=130, threshold=2 (crisp edges
     without halos). Larger radius would chunky the smooth gradients
     (sky, walls); smaller wouldn't move the needle.
  2. Contrast +8% (ImageEnhance.Contrast(1.08)) — bumps the deeper
     blacks without crushing midtones.
  3. Color (saturation) +6% — pulls "Cleveland Tough" yellow + sky
     blue + tire-rubber black into stronger separation.
  4. Brightness +2% — tiny lift; dim shop interiors get a hair more
     legible.
  5. Re-encode WebP q=92 (was q=82). +10 quality at small size cost.

Backup of originals lives at client/public/photos-original-backup/.
Re-run is idempotent if you copy backup → photos first.
"""

import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

PHOTOS = Path(__file__).resolve().parent.parent / "client" / "public" / "photos"

if not PHOTOS.exists():
    print(f"[enhance] ERROR: {PHOTOS} not found", file=sys.stderr)
    sys.exit(1)

before_total = 0
after_total = 0
processed = 0

for path in sorted(PHOTOS.glob("*.webp")):
    before = path.stat().st_size
    before_total += before

    img = Image.open(path).convert("RGB")

    img = img.filter(ImageFilter.UnsharpMask(radius=1.5, percent=130, threshold=2))
    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Color(img).enhance(1.06)
    img = ImageEnhance.Brightness(img).enhance(1.02)

    img.save(path, format="WEBP", quality=92, method=6)

    after = path.stat().st_size
    after_total += after
    processed += 1

    delta = (after - before) / before * 100
    print(f"  {path.name:38s}  {before//1024:4d}KB -> {after//1024:4d}KB  ({delta:+5.1f}%)")

print()
print(f"[enhance] {processed} photos enhanced.")
print(f"[enhance] Total size: {before_total//1024}KB -> {after_total//1024}KB ({(after_total-before_total)/before_total*100:+.1f}%)")
