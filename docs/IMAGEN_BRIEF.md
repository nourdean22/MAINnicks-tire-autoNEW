# Imagen Brief — Custom Visual Assets for Nickstire

> Pre-baked prompts for the imagen skill (Gemini 3 Pro Image preview)
> to generate custom hero/illustration visuals tied to the nickstire
> brand. Generated 2026-05-07 (wave-48). Run when `GEMINI_API_KEY` is
> configured in env.

---

## Why this exists

The site currently uses generic CloudFront stock photography for blog
hero images and some service-page secondary visuals. Per
DESIGN_PHILOSOPHY.md ("imagery system" rule): "Every photo should answer
one question: would a customer who actually visited the shop recognize
this as their experience? If yes → ship. If the image looks generic-
stock or generic-AI-generated, it actively hurts the trust signal even
if it's pretty."

Custom-generated visuals tied to the EUCLID GRIT register would replace
generic photo-pack imagery on:

- 3 pillar article hero images (currently using `hero-tires.webp` and
  `hero-main.webp` from the existing photo pool)
- 14 competitor comparison page social-share OG images (currently
  inheriting site default)
- Service page secondary illustrations (optional — service photos
  exist but could be supplemented)

---

## How to run

Prerequisites:
1. Set `GEMINI_API_KEY` in `.env`
2. Verify imagen skill scripts exist at
   `~/.claude/skills/imagen/scripts/generate_image.py`

Then for each prompt below:

```bash
python ~/.claude/skills/imagen/scripts/generate_image.py \
  "PROMPT_TEXT" \
  "client/public/photos/generated/SLUG.png" \
  --size 2K
```

Then add to git, reference from the relevant article/page, and rebuild.

---

## Prompts (8 total)

### A. Pillar #1 — Complete Cleveland Tire Guide

**File:** `client/public/photos/generated/pillar-tire-guide-hero.png`

**Prompt:**
```
A close-up overhead photograph of a worn but well-maintained Goodyear
all-season tire sitting on stained concrete shop floor, with snow salt
stains visible on the sidewall and a vintage tread-depth gauge resting
on the tread. Cinematic dim warehouse lighting from a single overhead
sodium-vapor lamp. Slight film grain. Wide angle, slightly elevated
viewing angle. Color palette: deep cool greys, asphalt blacks, with
the brand-yellow tire-warning text on the sidewall barely catching
the light. Photorealistic, documentary-style, not advertising-styled.
No people. No watermarks.
```

### B. Pillar #2 — Cleveland Auto Repair Owner's Manual

**File:** `client/public/photos/generated/pillar-repair-manual-hero.png`

**Prompt:**
```
A flat-lay photograph of a vintage shop manual open on a steel workbench,
surrounded by a torque wrench, a brass-handled flashlight, a paper coffee
cup with rings on the cover, a clipboard with a written estimate visible,
and an oil-stained shop rag. Cool overhead industrial lighting, slight
film grain. Documentary photography style. The shop manual is
hand-annotated with pencil margin notes. Color palette: oxblood reds
of vintage auto parts catalogs, deep cool greys, paper-cream highlights.
Photorealistic. No people. No watermarks. Wide aspect ratio (16:9).
```

### C. Pillar #3 — Cleveland Pothole + Salt Damage Guide

**File:** `client/public/photos/generated/pillar-pothole-salt-hero.png`

**Prompt:**
```
A close-up photograph from below a vehicle on a lift, showing rusted
brake lines and salt-corroded suspension components, with a mechanic's
LED inspection light pointed at one of the lines. Cleveland-winter
documentary photography style. Warm light from the inspection lamp
contrasted against cool industrial shop lighting in the background.
The visible underside has the characteristic orange-red rust pattern
of multiple Ohio winters of road salt exposure. Slight film grain.
No watermarks. No people visible (just the inspection light cone +
underside detail). Photorealistic, gritty.
```

### D. Comparison hub — `/best-tire-shops-cleveland`

**File:** `client/public/photos/generated/comparison-hub-hero.png`

**Prompt:**
```
A wide-aspect editorial photograph of an empty Cleveland intersection
at dawn, with a vintage hand-painted YELLOW shop sign visible on the
right side of the frame reading "TIRE & AUTO REPAIR." The sky is the
characteristic Lake Erie morning grey-blue with subtle pink accent.
The asphalt is wet from overnight rain, reflecting the sodium-vapor
streetlight overhead. Slight film grain. Cleveland-winter documentary
photography. The yellow sign is the only saturated color in the
otherwise muted scene. Color palette: cold grey skies, asphalt
reflections, single accent of brand yellow. Photorealistic. No people.
No watermarks. Wide aspect ratio (16:9).
```

### E. OG image template — Conrad's alternative comparison

**File:** `client/public/photos/generated/og-conrads-vs-nicks.png`

**Prompt:**
```
A photographic split-frame image: left half shows the cluttered counter
of a chain auto shop waiting room with branded signage and corporate
upsell pamphlets, slightly desaturated; right half shows a single yellow
shop sign on Euclid Avenue with a written estimate clipboard hanging
from a workbench. The right half is in warm golden-hour light; the left
half is in cool fluorescent shop lighting. Documentary photography style.
Slight film grain. Photorealistic. No people. No watermarks. 1200x630
aspect ratio (Open Graph standard).
```

### F. OG image template — Best tire shops Cleveland

**File:** `client/public/photos/generated/og-best-tire-shops.png`

**Prompt:**
```
A photographic top-down view of three tire shops' business cards laid
on a workbench: one chain corporate card, one mid-tier independent, and
one hand-printed yellow card with "Nick's Tire & Auto · 17625 Euclid
Ave" visible. Soft directional lighting. The yellow card is slightly
elevated and in sharper focus. Documentary photography style. Slight
film grain. Photorealistic. No people. No watermarks. 1200x630 aspect
ratio.
```

### G. Service page secondary — Brakes

**File:** `client/public/photos/generated/service-brakes-detail.png`

**Prompt:**
```
A macro close-up photograph of a brake pad and rotor cross-section
showing wear patterns. The pad is approximately 2/32 inch thick (near
replacement). A measurement caliper is partially visible. Industrial
shop lighting. Slight film grain. Documentary photography style.
Color palette: oxblood-red brake-dust patina on the rotor surface,
metallic greys, copper accents from the pad backing plate. The texture
detail of pad wear is the focus. Photorealistic. No people. No
watermarks.
```

### H. Service page secondary — Diagnostics

**File:** `client/public/photos/generated/service-diagnostics-detail.png`

**Prompt:**
```
A macro photograph of an OBD-II scanner display showing diagnostic
trouble codes (P0420, P0301) on its LCD screen, with the scanner cable
plugged into a vehicle's diagnostic port partially visible. Cool
fluorescent shop lighting on the scanner; warm interior cabin light
softly visible. Documentary photography style. Slight film grain.
Color palette: green LCD glow against deep grey scanner housing,
warm oxblood and tan interior accents. Photorealistic. No people. No
watermarks.
```

---

## Style guide for any future imagen prompts

To stay in the EUCLID GRIT register (per DESIGN_PHILOSOPHY.md):

- **Always specify "documentary photography style" + "photorealistic"**
- **Always include "slight film grain"** to match the site-wide grain overlay
- **Color palette anchor:** cool greys + cinema black + ONE accent (brand yellow when intentional)
- **Lighting:** prefer "cool fluorescent shop lighting" or "sodium-vapor streetlight" or "industrial overhead lamp"
- **Composition:** documentary-style wide angles + macro close-ups; AVOID
  centered hero compositions with everything balanced (reads as
  marketing render)
- **No people** unless the prompt is explicitly about a mechanic's
  hands at work — generic smiling-people stock kills the brand
- **No watermarks, signatures, or text overlays**
- **Always specify aspect ratio** (16:9 for hero, 1200x630 for OG)
- **Include "Cleveland-winter" or "Cleveland-specific"** when relevant
  to ground the image in place

### Forbidden style descriptors (would produce AI-slop output)

- ❌ "Premium" "luxury" "elegant" "sleek" "modern" — all read as generic
  marketing-render
- ❌ "Vibrant colors" "bright" "cheerful" — wrong register for trade brand
- ❌ "Minimalist" "clean" — reads SaaS/Apple
- ❌ "3D render" "CGI" "illustration" — we want photographic
- ❌ "Studio lighting" "white background" — too commercial
- ❌ Any descriptors of human skin, faces, or expressions

---

## Wiring the generated images into the site

Once images are generated, update:

1. **shared/blog.ts** — replace `heroImage` URLs in pillar articles:
   - `complete-cleveland-tire-guide` → `/photos/generated/pillar-tire-guide-hero.png`
   - `cleveland-auto-repair-owners-manual` → `/photos/generated/pillar-repair-manual-hero.png`
   - `cleveland-pothole-salt-damage-guide` → `/photos/generated/pillar-pothole-salt-hero.png`

2. **client/src/components/competitor/ComparisonPage.tsx** — add `ogImage`
   prop support and pass per-page OG image:
   - `/best-tire-shops-cleveland` → `og-best-tire-shops.png`
   - `/conrads-tire-alternative-cleveland` → `og-conrads-vs-nicks.png`
   - (Generate similar for Mavis, Discount Tire, Firestone if budget
     allows; otherwise re-use the hub OG)

3. **shared/services.ts** — `secondaryImage` field on brake + diagnostics
   service entries:
   - brakes → `/photos/generated/service-brakes-detail.png`
   - diagnostics → `/photos/generated/service-diagnostics-detail.png`

---

## Cost estimate

Gemini 3 Pro Image preview pricing (as of Feb 2026):
- ~$0.04-$0.08 per image at 2K resolution
- 8 prompts × 2-3 generations each (for variant selection) = 16-24 images
- Total: ~$0.64-$1.92 for the full asset pack

Negligible cost. The work is in the prompt-engineering + curation, not
the API spend.

---

## Last updated

2026-05-07 (wave-48). Run when `GEMINI_API_KEY` is configured in env.
