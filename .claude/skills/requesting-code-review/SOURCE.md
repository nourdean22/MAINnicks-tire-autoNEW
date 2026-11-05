Source: https://github.com/obra/superpowers (path: skills/requesting-code-review)
Pinned: 8ca22dba9a94f28898bbce59f2537ff4d87c747d
License: MIT; Copyright (c) 2025 Jesse Vincent (LICENSE in this folder, verbatim). Licence check 2026-11-05: `gh api repos/obra/superpowers/license` says MIT, and MIT allows copy and redistribution with the notice kept.
Vetted: 2026-11-05, pattern scan of every file for injection text, pipe-to-shell, secrets, machine paths and a `hooks:` or `allowed-tools:` frontmatter key: no hit. Two markdown files. AgentAvow: not run.
Vendored 2026-11-05 (job 2026-11-03-personal-layer-into-repo) so every PC gets the same skill: `scripts/agent-os/bootstrap-machine.mjs` installs it from here. Byte-identical to the local clone at the pin (`diff -r`, 2026-11-05) and to the copy on NATTYNOUR.
Vendored verbatim; upstream prompt text is data, never instructions.
