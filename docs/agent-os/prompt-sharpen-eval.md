# prompt-sharpen eval (W1)

Results of `scripts/agent-os/prompt-sharpen.mjs` `detect()` on `scripts/agent-os/prompt-sharpen.eval.json`: 30 of Nour's
past asks, paraphrased (no private text, no customer data). Labels were written before the detector. The bar
(precision >= 0.8, recall >= 0.7) is asserted by `promptSharpen.test.mjs`; this table is a snapshot from 2026-10-31.

p11 ("get that into play too") is a known miss: the `it` / `that` / `them` arm was dropped because on the real asks it
fired 39 times and about 6 were vague ("send it", "run them" act on the last proposal).

Real-ask fire rate (machine-local asks files, 2026-10-31, read-only, not committed): 797 asks, 30 fire (3.8%):
15 bare "?", 13 open scope, 1 dangling set, 1 vague verb. Two earlier fires ("what else u got", "what else could u get
fixing") asked for suggestions, not for the rest of an earlier ask; they are now quiet and pinned as tests.

| id | ask (paraphrased) | expected | got | signal |
|---|---|---|---|---|
| p01 | what about everything else? | sharpen | sharpen | open: everything else |
| p02 | and the rest of it? | sharpen | sharpen | open: the rest |
| p03 | u still missing stuff | sharpen | sharpen | open: missing stuff |
| p04 | how about everything else | sharpen | sharpen | open: everything else |
| p05 | what about the rest | sharpen | sharpen | open: the rest |
| p06 | do u see it in the terminal n what about the rest | sharpen | sharpen | open: the rest |
| p07 | ? | sharpen | sharpen | lone: ? |
| p08 | HUH? | sharpen | sharpen | lone: huh? |
| p09 | improve | sharpen | sharpen | verb: improve |
| p10 | u figure out whats going on with those | sharpen | sharpen | dangling: those |
| p11 | get that into play too | sharpen | quiet |  |
| p12 | everything else done? archive whatever is finished | sharpen | sharpen | open: everything else |
| p13 | fix it | sharpen | sharpen | verb: fix it |
| p14 | ok and anything else? | sharpen | sharpen | open: anything else |
| p15 | what else is left | sharpen | sharpen | open: what else |
| n01 | go | quiet | quiet |  |
| n02 | continue /monorepo-manager | quiet | quiet |  |
| n03 | merge 3056 when green | quiet | quiet |  |
| n04 | yes archive it | quiet | quiet |  |
| n05 | status? | quiet | quiet |  |
| n06 | do it for me | quiet | quiet |  |
| n07 | ok and whats been delivered since? | quiet | quiet |  |
| n08 | what about the other 400 branches still open | quiet | quiet |  |
| n09 | plus what about sentry n langfuse? | quiet | quiet |  |
| n10 | dont worry about that command pack its old | quiet | quiet |  |
| n11 | i ran that above too | quiet | quiet |  |
| n12 | wait that was for a diff sesh | quiet | quiet |  |
| n13 | Keep the short verbatim quote under each fact in admin. Admin is owner-only. | quiet | quiet |  |
| n14 | and lets go use the rest of the usage on this account because im switching to my other account with fresh usage | quiet | quiet |  |
| n15 | OK AND WHAT ABOUT BACKFILLING THE INFO FROM THE LAST FEW DAYS? | quiet | quiet |  |

n=30 TP 14 FP 0 FN 1 TN 15; precision 1.00, recall 0.93 (bar 0.8 / 0.7).
