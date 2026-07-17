# Creative OS scorecard

One ledger for the multi-format creative system. **Every merged creative PR updates this table** — do not restate the roadmap elsewhere; change the rows.

Verification tiers are deliberately separate: `Built` (code merged) ≠ `Live verified` (executed against prod services/data) ≠ `Visually verified` (a human or frame-forensics pass inspected the actual rendered asset). A "Yes" in one column claims nothing about the next.

_Last updated: 2026-07-17 (Reel Director hardening PR)._

| Capability | Built | Live verified | Visually verified | Remaining |
|---|---|---|---|---|
| Reel generation (brief) | Yes | Yes | n/a (text) | performance-informed generation |
| Reel assembly + render integrity | Yes | Yes | Yes (frame forensics, 2 published reels) | edit profiles per archetype, SFX, animated CTA |
| Reel visual continuity | Prompt-level only | Yes | Partial | reference-frame conditioning, Visual World Bible, rendered creative QA |
| Campaign Genome + claim safety | Yes | Yes | n/a | performance feedback into genome generation |
| Concept tournament (independent judge) | Yes | Yes | n/a | semantic repetition detection beyond fingerprints |
| Creative memory (fingerprints) | Yes | Yes (0085 applied 2026-07-17) | n/a | recall surfaced in Studio UI |
| Evidence resolution (typed, verified) | Yes | Yes (rejects unresolvable; public families pass) | n/a | **prod evidence tables are EMPTY** — reviews starved by Places REQUEST_DENIED (operator GCP fix), zero work orders entered |
| Reel Director (genome → brief → enqueue) | Yes | Yes (2 live drafts) | n/a | rendered-output creative QA, beat-level repair |
| Carousel typography renderer (13 territories) | Yes | Yes | Yes (7 slides inspected) | AI plates behind typography, deck-level visual bible |
| Carousel Director (genome → Draft Board) | Yes | Yes (75/75 live draft) | Deck render pending post-merge | slide variants, deck judge, per-slide regeneration |
| Photo Director | No | No | No | entire path (3 art directions → judge → refine → brand finish) |
| Story Director | No | No | No | entire path |
| Ad Director | No | No | No | entire path |
| Rendered creative QA (contact sheet → critic → beat replacement) | No | No | No | entire path — the largest quality gap |
| Campaign lineage (genomeId on jobs) | Yes | Endpoint-level | n/a | surface lineage in Queue/analytics |

## Priority order (visible gain ÷ effort)

1. Reel visual reference control (Visual World Bible + conditioned generation)
2. Rendered creative QA + selective beat replacement
3. Carousel AI-plate compositing behind the deterministic typography
4. Photo Director with candidate comparison
5. Reel edit profiles + sound design
6. Story Director · Ad Director

## Definition of done for creative features

Connected to the live operator path · produces a final asset · the asset was visually inspected · native format dimensions · typography correct · automotive content credible · deliberate brand treatment · failure recovery exists · selective repair possible · tests + CI pass · no orphan code · no claim exceeds the evidence.
