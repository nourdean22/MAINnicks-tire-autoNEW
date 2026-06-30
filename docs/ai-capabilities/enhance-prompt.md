# AI Capability: Enhance Prompt for Stitch

This capability transforms vague user UI/design requests into polished, Stitch-optimized prompt structures. It adds specific UI/UX keywords, enforces design systems, injects hex codes, and enforces strict layout constraints.

## Triggers

The capability is detected dynamically when a message triggers any of the following intents:
- `Stitch` or `Stitch prompt`
- `enhance prompt` / `improve UI prompt`
- `polish this UI idea`
- `landing page prompt` / `dashboard prompt` / `mobile screen` / `web app design`
- `turn this into a Stitch prompt`
- `make this better for UI generation`
- `Figma-like UI generation`
- `component layout prompt`

## When NOT to Trigger

This capability does not load for:
- Standard copy writing/marketing generation
- SMS copywriting/rewrites
- Core business planning
- TypeScript/JavaScript code edits or debugging
- General writing tasks

## Output Format

The output schema is structured as a typed JSON format or clean Markdown output:
- **oneLinePurpose:** Concise description of the layout purpose.
- **designSystem:** Structural details including platform, background, and accent hex colors.
- **pageStructure:** Numbered components (e.g. Navigation, Hero Section, cards, inputs).
- **interactionNotes:** Cues on active/focus state and transitions.
- **constraints:** Structural boundaries.
- **finalPromptMarkdown:** Copy-ready prompt text optimized for Stitch.

## Design Context Resolution

Visual styles are resolved in the following priority order:
1. Local `DESIGN.md` in the current project context path.
2. Local App brand overrides.
3. **Nick's Tire Blueprint:** Charcoals (#121212), yellow/gold highlights (#e5a93b), bold headers, real auto-shop grit, with explicit bans on corporate stock illustrations.
4. **Fallback Design System:** Minimal white (#ffffff), slate (#0f172a), and indigo (#4f46e5).

## Quality Gate Checklist

The validation gate evaluates:
- Presence of target platform.
- Colors carrying valid #hex values.
- Concrete visual layout structure (avoiding vague keywords in isolation).
- Targeted edits containing preservation clauses.
- Nick's Tire specifications matching Cleveland brand context rules.
