# Skeptic record: prompt-gallery

reviewer: a separate general-purpose agent (sonnet), read-only, 2026-10-18; it saw only SKILL.md and baseline.md.

## Findings

- Scope contradiction: the description says code-only work is excluded while the body asks for a gallery line on every turn. Rejected: the description routes the full lookup to prompt-shaped work and says other work gets only the one-line note, which is the operator's own rule (Nour, 2026-10-18); the body now states the same split.
- Prompt injection handled by one bullet only. Fixed: the skill now names claudeai.directory as the only source, allows navigate and read only, and says to stop, quote and report any gallery text that directs an action.
- Search box leaks task text to a third party. Fixed: the skill says to search with generic category words only, never customer, vehicle, price or account details.
- Dates and counts unverified (54 prompts, 7 categories, Deployment Paused on the sibling site). Rejected: the browser pane read both pages on 2026-10-18 UTC, the count came from the page's own "54 listed" line, and the baseline names the evidence; a page snapshot was not committed because the site content is third-party.
- Trigger list omits prompts in code and subagent briefs, and the browser tool may be missing. Fixed: both added, with a WebFetch fallback and a one-line unavailable note.
- Baseline shows only discovery difficulty and gallery terms were not checked. Fixed: the skill now says to check the site's terms before customer-facing use; the invocation proof and 36 labelled trigger queries cover the with-skill run.
