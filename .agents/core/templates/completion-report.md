# Completion report (sections from NOUR-COMMAND.md > Completion report; drop empty ones)

Label every fact FACT (you ran it or read it; receipt attached), INFERRED (follows from facts; name them) or
NOT CHECKED (say why). An unlabelled line counts as NOT CHECKED. Meaning of each label for external facts:
`.claude/skills/monorepo-manager/references/verify.md`.

```
<one line: what now works, at which evidence rung>

VERIFIED COMPLETE   <outcome> - <receipt> [FACT]
FOUND               <discovery that changed the picture> [label]
CHANGED             <branch> | <SHA> | <files>
PROOF               <command -> summary line, exit code> | <PR link> | <live check> [label each]
RUNG                highest reached: <claim | artifact | execution receipt | external effect | outcome>; first NOT reached: <rung, and what would reach it>
MANAGER PROBES      <N run against the real binary, M bypasses found, by class> (drop when the job enforces nothing)
SIMPLIFIED          <what was deleted or merged>
REMAINING           <real work left>
BLOCKED             <exact blocker, who clears it, the one-liner to run>
NEXT                <one action Nour can take in under two minutes, or nothing>
```
