# Code Style

Prettier is the source of truth. Never hand-format against it.

## Prettier config (exact)

```json
{ "semi": true, "singleQuote": false, "trailingComma": "es5",
  "printWidth": 80, "tabWidth": 2, "arrowParens": "avoid",
  "endOfLine": "lf", "bracketSpacing": true, "quoteProps": "as-needed" }
```

- **Double quotes**, not single. Semicolons required.
- `printWidth: 80` — wrap at 80, not 100/120.
- `arrowParens: "avoid"` — `x => x`, not `(x) => x`.
- `trailingComma: "es5"` — no trailing comma in function args.
- `endOfLine: "lf"` — LF even on Windows.

## TypeScript

- Strict. No implicit `any`; prefer `unknown` + narrowing.
- Discriminated unions over boolean flags for state.
- No `!` non-null assertions unless provably safe, with a comment.
- Named exports by default; default-export only framework entrypoints.

## Naming

- `camelCase` values · `PascalCase` types/components · `SCREAMING_SNAKE` env keys
- `kebab-case` filenames, except React components (`PascalCase`)
- Booleans read as assertions: `isReady`, `hasAccess`, `canRetry`
- Names describe intent, not type: `retryCount`, not `num`

## Errors & async

- Always `await` or explicitly `void` a promise. No floating promises.
- Throw `Error` with a message saying what failed and why.
- Wrap network/DB/fs calls with error context at the boundary.
- Never swallow an error to make a check pass.
