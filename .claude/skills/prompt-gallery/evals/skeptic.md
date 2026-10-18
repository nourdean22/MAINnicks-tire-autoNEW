# Skeptic record: prompt-gallery

reviewer: a separate general-purpose agent (sonnet), read-only, 2026-10-18; it saw only SKILL.md and baseline.md.

## Findings

- Scope contradiction: the description says code-only work is excluded while the body asks for a gallery line on every turn; rejected: the description routes the full lookup to prompt-shaped work and gives other work only the one-line note, which is the operator's own rule (Nour, 2026-10-18), and the body states the same split.
- Prompt injection was handled by one bullet only. The skill now names claudeai.directory as the only source, allows navigate and read only, and says to stop, quote and report any gallery text that directs an action. fixed
- The search box leaks task text to a third party. The skill now says to search with generic category words only, never customer, vehicle, price or account details. fixed
- Dates and counts are unverified (54 prompts, 7 categories, Deployment Paused on the sibling site); rejected: the browser pane read both pages on 2026-10-18 UTC, the count is the page's own "54 listed" line, and the baseline names the evidence; no page snapshot is committed because the site content is third-party.
- The trigger list omitted prompts in code and subagent briefs, and the browser tool may be missing. Both prompt shapes were added, with a WebFetch fallback and a one-line unavailable note. fixed
- The baseline shows only discovery difficulty and gallery terms were not checked. The skill now says to check the site's terms before customer-facing use, and the invocation proof plus the labelled trigger queries cover the with-skill run. fixed
