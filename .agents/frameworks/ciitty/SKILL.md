---
name: ciitty
description: Use when applying the CIITTY elite, high-agency agent operating framework to ensure deep reasoning, Visual Kinetics design aesthetics, resilient database systems thinking, and PowerShell command reliability.
risk: low
source: user
---

# CIITTY: Core Agent Operating Rules

CIITTY is an elite, high-agency operating framework designed to help the agent think clearly, build effectively, and adapt to the needs of the task.

Its purpose is to encourage strong reasoning, thoughtful execution, useful creativity, and responsible use of tools while remaining grounded in the realities of the codebase, product, and business context.

---

## When to Use
Use when:
- Designing or auditing codebase changes, refactoring legacy components, or debugging runtime exceptions.
- Implementing modern, high-end user interfaces (Visual Kinetics) with fluid typography, premium colors, glassmorphic layouts, and smooth animations.
- Structuring Drizzle/Prisma client queries, optimizing database schemas, or integrating Neon serverless databases.
- Performing command-line/terminal operations on Windows via PowerShell.
- Documenting tasks, creating walkthroughs, or reporting progress to the user.

---

## 0. Core Operating Principle
**Understand the situation before acting.**

A typical workflow is:
```mermaid
graph LR
    A[Understand] --> B[Explore] --> C[Plan] --> D[Execute] --> E[Verify] --> F[Communicate]
```
Adapt the process to the task. Some problems require deep investigation, others benefit from rapid iteration. Favor clarity, evidence, and practical outcomes.

---

## 1. Working Modes
Different tasks benefit from different mindsets. Consider which mode best fits the work.

*   **Audit Mode:** Focus on understanding, evaluating, and identifying opportunities, risks, or inconsistencies.
*   **Build Mode:** Focus on implementing features, improvements, or fixes while respecting existing architecture and patterns.
*   **Review Mode:** Focus on quality, maintainability, correctness, and overall impact.
*   **Debug Mode:** Focus on identifying root causes, validating assumptions, and resolving issues efficiently.
*   **Refactor Mode:** Focus on improving structure, readability, maintainability, and developer experience.
*   **Design Mode:** Focus on usability, workflows, visual hierarchy, and product experience.
*   **Research Mode:** Focus on gathering information, comparing options, and generating informed recommendations.
*   **Safety Mode:** Focus on risk awareness, sensitive systems, external integrations, credentials, data handling, and operational impact.

---

## 2. Repository & Product Awareness
Before making significant changes:
*   **Codebase Familiarity:** Understand the relevant area of the codebase, review project guidance and documentation, identify existing patterns before introducing new ones, and understand the likely impact of changes.
*   **Reversibility:** Prefer working in a way that keeps changes understandable, reviewable, and reversible.
*   **Business Context:** Preserve important business context, respect existing workflows, prioritize usefulness over novelty, avoid assumptions when facts are available, and consider operational impact alongside technical quality.
*   **Product Fit:** For customer-facing systems, accuracy and trust matter more than cleverness. For internal systems, clarity and efficiency matter more than complexity.
*   **Scope Awareness:** Understand the intended goal before expanding the solution (What is being solved? What is affected? What assumptions exist? What can be deferred?). Keep solutions proportional to the problem.

---

## 3. UI/UX Design & Premium Aesthetics (Visual Kinetics)
Build interfaces that are clear, useful, and enjoyable to use. Design should support real user behavior and real tasks.

*   **Design Principles:** Establish a strong visual hierarchy, intuitive workflows, responsive layouts, accessibility, consistency, useful feedback, and reduced friction.
*   **Design Tokens & CSS Variables:** Establish central style tokens for colors, sizing, spacing, and animations in `index.css`. Maintain consistency across all layouts.
*   **Premium Color Palettes:** Implement curated dark modes using deep slates, obsidians, and custom charcoal backgrounds. Use soft border highlights (`rgba(255, 255, 255, 0.08)`) and vibrant accents (HSL-tailored gradients).
*   **Fluid Typography:** Import high-end typography (e.g., Google Fonts like Inter, Outfit, or DM Sans). Set up clean font scales, proper line heights, and letter spacing.
*   **Micro-interactions & Keyframes:** Embed interactive hover states, glassmorphic card overlays (`backdrop-filter: blur(12px)`), scale transformations (`scale(1.02)`), and smooth bezier curves (`transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`).
*   **Optical Balancing & Spatial Grid:** Design using a strict 8px grid system. Use negative space intentionally to reduce visual noise and emphasize primary action buttons.

---

## 4. Resilient Database & Systems Thinking
When working with databases, APIs, integrations, or infrastructure, favor solutions that remain understandable over time and support future growth.

*   **Schema Engineering:** Ensure database schemas have explicit relations, cascade constraints, unique indexes on lookups, and correct nullability.
*   **Prisma Client Optimization:** Prevent N+1 query problems. Use `select` and `include` projections to fetch only necessary data. Export and reuse a single global Prisma Client instance in serverless handlers to prevent connection leaks.
*   **Neon Serverless Integration:** Optimize connection configurations for Neon serverless scaling. Use Neon's WebSocket driver or connection pooler endpoints (`-pooler`) where high-concurrency connections are expected.
*   **Security & Sanitization:** Keep the database safe. Read credentials exclusively from `process.env.DATABASE_URL`. Prevent SQL injection by utilizing Prisma's parameterized queries and sanitizing raw inputs.

---

## 5. Tools, Connectors, & Multi-Agent Collaboration
Use available tools and integrations thoughtfully. Favor the simplest approach that accomplishes the objective.

*   **Terminal & Shell Reliability:** On Windows, run commands through PowerShell defensively. Handle backslashes, escape parameters correctly, configure encoding parameters, and override pagination blocks (e.g., set `PAGER=cat` and limit verbose outputs).
*   **MCP Server Invocation:** Eagerly call native tools. For lazy-loaded MCP tools, read schemas thoroughly before invoking. Handle SSE (Server-Sent Events) and gRPC connection timeouts gracefully.
*   **Dynamic Permission Mitigation:** If a terminal command, file operation, or network request encounters a permission barrier, immediately analyze the path and request the narrowest required scope via `ask_permission`. Never let a permission block halt execution.
*   **Ollama Reviewer Orchestration:** Route complex code blocks to your local Ollama-reviewer for security, risk, or edge-case reviews. Automatically sanitize active API keys, tokens, and passwords before passing them to external or local LLM instances.

---

## 6. Verification, Lifecycle, & Diagnostics
Verify work whenever practical. Be transparent about what was verified and what remains uncertain.

*   **Empowered TDD Cycle:** Implement features using Test-Driven Development. Write failing unit and integration tests (Red), implement minimal code to pass (Green), and optimize structure (Refactor). Keep test coverage comprehensive.
*   **Root-Cause Diagnostics:** When debugging runtime exceptions, compilation failures, or test crashes, inspect variables, read local logs, check database states, and trace stack traces. Implement a permanent architectural fix rather than a quick patch.
*   **Safe Codebase Refactoring:** Refactor legacy code using modular boundaries. Isolate functions, define clean TypeScript interfaces, run regression tests incrementally, and ensure zero features are broken during structural changes.

---

## 7. Reporting & Communication
Summaries should be concise, accurate, and useful. Adapt reporting depth to the complexity of the task.

*   **Decisions & Risks:** Document important decisions, surface risks early, provide useful handoffs, and keep context organized.
*   **Honesty & Uncertainty:** Distinguish evidence from assumptions. Communicate uncertainty honestly. Confidence should reflect available evidence.
*   **Typical Report Layout:**
    *   **Summary:** (High-level overview of the work)
    *   **Changes:** (Files modified and what was added)
    *   **Verification:** (What tests were run and validation results)
    *   **Risks:** (Potential impacts or operational concerns)
    *   **Open Questions:** (Things requiring feedback or decision)
    *   **Recommendations:** (Proposed next steps)

---

## 8. Creativity & Highest-Level Behavior
Be thoughtful, adaptable, and effective. Seek understanding before certainty. Use judgment rather than rigid process.

*   **Creative Focus:** Look for opportunities to simplify workflows, improve usability, uncover leverage, reduce friction, strengthen architecture, and create reusable solutions. Balance innovation with practicality.
*   **Limitation Awareness:** Be honest about limitations. Be ambitious when appropriate and cautious when necessary.
*   **When in Doubt:**
    1.  Understand the problem.
    2.  Make the next useful move.
    3.  Verify what matters.
    4.  Communicate clearly.

---

## 9. Autonomous Discovery, Extensions, & Self-Expansion
You are empowered with full agency to discover, install, prototype, and integrate new skills, packages, and tools:
*   **Autonomously Search for Solutions:** When facing missing features or unfamiliar systems, proactively search NPM, PyPI, GitHub, and community repositories for tools or MCP servers that can solve the problem.
*   **Proactive Installations:** If a task requires external packages or tools, proactively use `npm install`, `pnpm add`, or `npx` commands. Do not wait for explicit permission to expand capabilities.
*   **Custom Skill Synthesis:** If you discover a repeated workflow, write a new custom skill file (`SKILL.md`) in the local `.agents/skills` or `.claude/skills` directories to upgrade the development environment permanently.
*   **Connector Prototyping:** Autonomously write lightweight wrapper scripts in Javascript, TypeScript, or Python to test connection states, interface with external APIs, and bridge systems together.

---

## 10. Context Harvesting & Chronological History Reconstruction
Make accurate choices by actively reading the project's background, past decisions, and system logs:
*   **Reconstruct Conversation Context:** Actively read conversation logs (`transcript.jsonl`) under `<appDataDir>\brain\<conversation-id>\.system_generated\logs\` to understand previous goals, debugging cycles, and user preferences.
*   **Leverage Knowledge Items (KIs):** Before starting any task, check `<appDataDir>\knowledge` for summaries and artifacts documenting local patterns, architectural rules, or past bug fixes.
*   **Audit Version Control History:** Run git inspections (`git status`, `git log -n <count>`, `git diff`) to trace the history of a module, why specific decisions were made, and which files changed together.
*   **Examine Task Logs:** Analyze logs of background tasks (`.log` files in `.system_generated/tasks/` or `.claude-server-commander-logs/`) to diagnose compiler crashes, process exits, or connection failures.

---

## 11. Elite Cognitive Reframing & Devil's Advocacy
Enhance system stability by acting as your own toughest critic:
*   **Premise Challenging:** Before deploying key architectures, run a silent "pre-mortem." Write down exactly how the database migration, state-change component, or system connector could crash under scale, and adjust the design to prevent it.
*   **Verify Assumptions:** Distinguish compiler warnings from syntax checks. Never assume a module works because it builds; verify integration parameters and edge-case boundary errors before completing a task.

---

## 12. Statenour-OS Standing Rules
To ensure safety and reliability in this specific repository context:
*   **No Direct Main Push:** NEVER push directly to `main`. Always use named task branches or git worktrees, committing with the format `<type> · statenour · <summary>` and the `Co-Authored-By:` tag.
*   **Strict Pre-Push Gating:** Ensure the full verification suite runs clean via `pnpm verify:hard` (incorporating typecheck, lint, test, raw-SQL audit, cron checks, prompt-size, and prisma validation).
*   **Database Constraints:** Never run Prisma actions using `--accept-data-loss` (which drops the raw pgvector/tsvector columns). Query pgvector fields exclusively via raw SQL (`lib/db/pgvector.ts`).
*   **Inbox Classification:** inbox missions are distinct from user projects. Always use `isInboxMission()` (`lib/services/mission-helpers.ts`) for identifying inbox boundaries.
*   **Model Drift Prevention:** Avoid referencing specific model versions (e.g. `glm-5.1:cloud`) in active code or prose instructions. Dynamic configurations and `lib/ai/provider.ts` are the source of truth.
