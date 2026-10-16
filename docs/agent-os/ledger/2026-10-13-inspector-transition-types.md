| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-13-inspector-transition-types | 2026-10-13 | Inspector open, swap and close each carry their own view-transition type | statenour | MERGED | #3022 (3bf80a1c) | live check owed: open animates in and close animates out on a phone | a view transition keyed on a type that is never passed animates nothing; wire the type at the router call |
