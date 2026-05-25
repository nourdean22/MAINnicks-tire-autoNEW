# Viral Content Engine

**Skill port:** B6 · viral-generator-builder + content-marketer + social-content
**Applies to:** social-post generator + SEO blog cluster (per memory #314 content cluster port) + Reels/short-form content + customer-shareable assets.
**Authored:** 2026-05-26.

## Why this doc exists

Local-shop content marketing usually has TWO failure modes · either too generic ("10 brake tips!") OR too internal ("our shop philosophy"). Neither earns shares. Viral content has a measurable shape · this doc codifies it for Nick's Tire.

## The 4-element viral shape

Every shareable asset needs ALL FOUR. Missing one and it dies in the feed.

### 1 · The HOOK (first 3 seconds OR first sentence)

A specific, concrete, surprising claim. NOT a question. NOT a teaser.

**Bad:** "Do you know how often you should rotate your tires?"
**Good:** "Most Cleveland drivers waste $400/year on tires they didn't need to replace."

The hook makes the brain DEMAND the rest. It's a pattern interrupt, not an invitation.

### 2 · The PROOF (60-90% of the body)

Specific, named, sourced. Numbers · timestamps · receipts · before/after photos.

**Bad:** "We see lots of customers with this problem."
**Good:** "Last Tuesday a 2017 Camry came in with brake-pad screech. Owner thought it was rotors. Free check showed the pad-wear indicator was just barely touching. $89 vs the $450 dealer quote."

The proof is what makes the hook believable. Without it the hook is marketing slop.

### 3 · The TURN (1 sentence, near end)

A counterintuitive insight or pattern reveal that re-contextualizes the proof.

**Bad:** "So always get a second opinion."
**Good:** "The dealer quote was right · for THEIR margin structure. Same parts, same labor, our overhead is half theirs."

The turn is what makes someone SHARE it · they want to be the person who explains the turn at dinner.

### 4 · The TAKE-AWAY (1 line, last)

A specific action with explicit friction-removal.

**Bad:** "Get your brakes checked!"
**Good:** "Walk in Saturday · free check · written quote · you don't pay until you say yes."

The take-away converts the share into action.

## Channel-specific shape

### SMS-shareable (asset · 1-2 SMS messages, customer texts to friend)

- HOOK · 1 sentence, 80 chars max
- PROOF · 1 specific number + 1 specific story, ~120 chars
- TURN + TAKE-AWAY · 1 sentence, 60 chars

Total ~280 chars · fits in 2 SMS · the customer texts "thought of you" + forwards. This is the highest-ROI viral surface for local-shop · low effort, high trust.

### Reels / TikTok / Shorts (asset · 15-30 second video)

- HOOK · 0-3s · text-on-screen + voice
- PROOF · 3-20s · b-roll of the actual job (real shop · real cars · NO stock)
- TURN · 20-25s · voiceover punchline
- TAKE-AWAY · 25-30s · graphic with phone number + walk-in promise

Filming discipline · the operator films real jobs in the bay · 1 take · imperfection IS the content. Polish kills the format.

### SEO blog (asset · 800-1500 word post)

- HOOK · H1 + first paragraph · 50 words
- PROOF · 4-6 H2 sections · 600-1000 words total · each with concrete sub-proof
- TURN · "Why most articles get this wrong" section near end · 100-200 words
- TAKE-AWAY · final paragraph · single CTA · 50 words

Pair with FAQPageSchema (Wave S) · 4-6 Q&A questions inline · captures the AI-citation surface.

### Email (asset · 250-400 word body)

- HOOK · subject line + preview text · 60 chars combined
- PROOF · 2-3 short paragraphs · 200 words
- TURN · sentence break · italicized
- TAKE-AWAY · single button · "Walk in this Saturday"

Per Wave P · CAN-SPAM compliance footer is appended automatically · the body stays focused.

## Topic generation framework

What viral content do we MAKE? Pick from 4 buckets:

### Bucket 1 · "What the dealer doesn't tell you"

Loss-aversion · expert-positioning. Examples:
- "The brake-pad replacement that doesn't need rotor replacement"
- "What 'engine light' actually means · 80% of the time"
- "How to tell if your tires can be patched vs need replacement"

### Bucket 2 · "Stories from the shop"

Specific customer story (anonymized). Examples:
- "Yesterday a customer brought in a 2018 Civic with what they thought was a transmission problem. It was a $40 motor mount."
- "We had a customer who'd been quoted $2,000 for a brake job at the dealer. We did it for $389."

### Bucket 3 · "The Cleveland-specific angle"

Local relevance · weather · roads · the specific shape of Cleveland customer life.

Examples:
- "Why Cleveland tires last 30% less than national average (and it's not the pothole jokes)"
- "What I-90 lane-marker reflectors do to your tires"
- "Why your January brake noise is different from your July brake noise"

### Bucket 4 · "Process transparency"

Showing the workflow · trust-building. Examples:
- "What the free brake check actually looks like (15-second walkthrough)"
- "How we write the estimate before you decide"
- "Walk-in vs drop-off · what changes about your day"

## Anti-patterns

### "Generic tips listicle"

"10 things every driver should know about brakes!" · zero shares. Listicles work for content farms · not for local shops with a personality.

### "We're family-owned" repetition

Every local shop says this. It's the floor, not the ceiling. Use NAMED proof points (Moe's been here since 2019) instead.

### "Stock photo PROOF"

If the proof is a stock photo of generic brakes, the share-rate drops 90%. Real shop · real cars · ALWAYS.

### "Buy now" take-away on info content"

Info content earns trust. Trust converts on its own timeline. Don't try to capture the conversion at the same moment · damage the trust without earning the conversion. The TAKE-AWAY is friction-removal, not pressure.

## Skill-port lineage

B6 from the audit's Round 2 deep-pass. Pairs with:
- Wave Q · brand-archetype linter (catches HERO/SAGE invasion in content)
- Wave T · unslop linter (catches LLM-output tells)
- Wave S · FAQPageSchema (SEO + AEO citation surface for blog content)
- Memory #314 content cluster port plan (pillar + cluster architecture)

Future · integrate with `apps/nickstire/server/services/contentDrafts.ts` (per memory's content draft system) · generates drafts that match this shape · operator approves before publishing.
