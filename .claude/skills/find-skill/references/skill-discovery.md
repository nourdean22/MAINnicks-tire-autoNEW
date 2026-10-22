# Skill discovery policy (full text)

Moved here verbatim from CLAUDE-OPERATING-PROFILE.md on 2026-10-22 so the always-loaded profile carries only the rules
(every "never" and "always" line stayed there). This file keeps the numbers, the history and the rationale. Read it when choosing skills for an unfamiliar task or auditing the skill library.

---

SKILL DISCOVERY
━━━━━━━━━━━━━━━━━━━━━━━

A large skill library is installed (the fire
audit's universe was 1,307 names) and almost none of it ever fires. The numbers live in ONE
place — `.claude/skills/skill-fire-audit/SKILL.md`, re-run via its `fire_audit.py` for current
values; its 2026-08-03 baseline: 46 of 1,307 names ever fired = 3.5%, project cohort 64%. (This
paragraph used to carry its own copies — "~930", "62%" — which had already drifted from the source.
A count in prose is a cache with no invalidation.) The lesson stands: narrow expertise beats
generic instinct — never reach for "general-purpose" thinking when a domain-specific skill applies,
and prefer a project skill (`.claude/skills/`), the cohort that actually fires, because each names
one concrete repo action. If no skill fits, say so and proceed — do not invoke a loosely-related
skill to satisfy this section.

Before every non-trivial task:
1. Name the task in one sentence.
2. Identify which skills apply — by reasoning and by the skill-recall hook (UserPromptSubmit, #3074), which prints `[skill-recall] invoke: <name> (<matched words>)` lines.
3. State out loud which skills you're applying and why — e.g. "Applying ux-audit + mobile-design per skill recall." Don't leave it implicit.
4. If a less-common skill would meaningfully change the approach, invoke it explicitly.

Always-on meta-stances — invoke with the Skill tool by EXACT name below. A stance you did not
invoke did not apply: naming it in prose is not invocation. If you claim a stance shaped your
work, the Skill call must be in the transcript.
- `i-have-adhd` + `antislop` — always on (operator, 2026-10-10): every reply shaped for an ADHD reader (answer first, numbered
  steps, one next action); UI, copy or mobile work reads `.claude/skills/antislop/SKILL.md` then the task skill, mode per its Two Usage Modes.
- `karpathy-guidelines` — every code task · simplest thing · surgical edits. `verification-before-completion`: no done without a fresh check. A reply that did work ends `Skills: <names>` or `Skills: none, because <reason>` (2026-10-15; `skills-check.mjs` blocks a no-Skill working turn once).
- `using-superpowers` then `ponytail` — every task, invoked FIRST (operator, 2026-10-10; always on here and globally): if a skill might
  apply, invoke it (process skills in `.claude/skills/` before implementation); then the smallest complete change. Compaction re-arm is machine-local (NattyNour ~/.claude hook); a fresh clone has none.
- `brainstorming` — before building anything new · vague ideas -> validated design.
- `find-skill` — every turn as a gate: one line on whether outside discovery would change the answer; searches only then.
- `kaizen` - NOT INSTALLED (same check): for refactor / cleanup work apply `karpathy-guidelines` (surgical edits, YAGNI, standardize).

Reasoning lenses — invoke the one whose trigger matches:
- `database-architect` - NOT INSTALLED (same check). Trigger unchanged: ANY schema, migration, query or data-layer decision;
  doctrine inline: access patterns first, backups + rollback before destructive moves. Schema / migration edits route to
  `statenour-migration` (Prisma) or `nickstire-tidb-ddl` (TiDB), DB-touching scripts to `prod-db-guard`; query and ORM changes follow the doctrine.
- `frontend-design:frontend-design` - NOT INSTALLED (neither the stale local copy nor the plugin copy; checked 2026-10-08).
  Trigger unchanged: ANY new UI or visual reshaping. Invoke `antislop-ui` + `antislop-layoutmobile` instead (and
  `nickstire-ios-pwa-primitives` for any confirm/alert/prompt); keep the doctrine: reject AI-slop (Inter, purple gradients,
  symmetric layouts), one dominant aesthetic direction, DFII >= 8 (aesthetic + fit + feasibility + performance - risk).
- FIRST-PRINCIPLES — inline doctrine, NO skill backs this · question -> delete -> simplify -> accelerate -> automate · 10x not 10% · apply when scoping or when a plan reads as additive.
  There is no skill to invoke for this. The `elon-musk` skill was a Portuguese-language
  persona simulator ("fale como Elon"), not a reasoning lens — archived 2026-08-03 with the rest of the persona panel. The doctrine above is the whole asset.
  The `frontend-design` lens is namespaced deliberately: bare `frontend-design` resolves to a stale
  local copy (520w); the plugin copy (1,297w) is its maintained successor. Do not "simplify" the name.

The full curated skill reference lives at `~/.claude/session-skills.md` — consult it when choosing
skills. **Machine-local, not in the repo** (on NattyNour, 2026-10-16: 32 entries, 4.6 KB, last touched 2026-10-08): it is a convenience
index, not a source of truth. If it is missing or stale, fall back to the skill list this session
was given and to `.claude/skills/` in this repo.

Every non-trivial request: check skills → state assumptions → plan the smallest change with verify-checks → apply the right lens → implement surgically, matching existing patterns → verify before declaring done.

Red flags that mean STOP and re-check: "I'll refactor it later" · "we might need this" · "this is just simple" · "I need more context first" · "users should just be careful" · "I prefer to do it my way".
