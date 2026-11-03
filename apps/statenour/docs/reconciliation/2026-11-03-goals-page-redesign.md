> ## 2026-11-03 · Goals tab redesign: hero, milestone ladder, maxim at a goal moment (job 2026-11-02-nour-os-interconnect W5) · 1 ship
>
> Nour (2026-11-02): the Goals tab "looks old and stingy" and should use the wisdom maxims "whenever necessary", with the code underneath upgraded too. PRs 3520-3524 made the data right; this wave is the page.
>
> - **Hero** (`components/goals/goals-hero.tsx`): the one goal (due soonest by `goalDue`, else furthest behind pace, else the first), why it was picked, its next move as the page's only gold primary, "moved Nd ago" from the since-list (`task.goalSinceCheckIn`, the cache the card's check-in panel already uses), and one pulse line ("3 goals · 1 behind · 2 need a check-in"). The spec's stats band folds into that line on a phone.
> - **Milestone ladder** on each card: the newest linked mission's `planData.phases`, done = has tasks and none open (the same rule `maybeSpawnNextPhase` uses), current = first not done. Server field `missions[].phases` in `getGoals`; no new read. A goal with no mission keeps "Plan it".
> - **Maxim at a goal moment**: W6's contract (`lib/brain/goal-maxim.ts`, so the card and Nick's recall pick the same line): achieved → learning, off track → decisions, behind pace → timing, at risk and check-in due → focus; nothing on a goal that is fine or unknown. Until W6 merges, `lib/stats/goals-page.ts` carries a copy of that file at e6bbf5d0e8; the swap is an import change. No new tag.
> - **Nick knows the open goal**: the open card (else the hero goal) rides to `NickSidePane` as the focus line with its id; "Ask Nick about this goal" prefills the pane. The pane now keeps a prefilled question that arrived while it was closed (it used to open empty: the chat was not mounted to hear the event; the missions "hand to Nick" door had the same gap).
> - **Under the hood**: the coachLog panel ("Show legacy details", 0 goals used it in prod) and the board's `ai.coachGoal` call are removed; the execution coach sandbox moves behind "Focus session" instead of filling every expanded card, and loses its coachLog fallback. Quick-add and AI suggest move below the list.
>
> **Flagged · NOT fixed**
> - `trpc.ai.coachGoal`, `/api/ai/coach-goal` and `lib/services/ai-coach-goal.ts` have no UI caller now; deleting them touches `lib/trpc` and the API surface, left to a follow-up.
> - Not checked on a real phone; the six-feet score of /stats is not measured.
