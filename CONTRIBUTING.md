# Contributing

Thanks for helping. This is a small, opinionated codebase — contributions that keep it lean are the most welcome.

## Setup

```bash
npm install
npm test              # unit tests (fast, no server needed)
npm run test:coverage # unit tests + coverage report
npm run web           # web UI + API on :3000
```

Integration tests (`npm run test:integration`) run against a live server (`HUB=http://localhost:3000`) and touch a real DB, so they're not run in CI.

## House style

- **Vanilla by choice.** No framework, no build step, no transpiler — plain Node (ESM) + SQLite on the backend, plain hash-routed JS on the frontend. Please keep it that way.
- **Small, surgical diffs.** Change the minimum needed. Don't reformat unrelated code.
- **Comments explain _why_, not _what_.** Match the density of the surrounding code. If a line is self-explanatory, don't narrate it.
- **Match what's there.** Naming, structure and idioms should read like the file you're editing.
- **Fail closed on privacy.** Anything touching user data must default to local/no-cloud unless the user opted in. Don't add a code path that can leak private content to a third party by default.

## Pull requests

1. Branch from `main`.
2. Keep the PR focused on one thing.
3. `npm test` must pass. Add a test for new pure logic where practical.
4. Describe the change and why. Screenshots for UI.

## Reporting bugs

Open an issue with steps to reproduce, expected vs actual, and your Node version. For anything security-sensitive, see [SECURITY.md](SECURITY.md) — don't open a public issue.
