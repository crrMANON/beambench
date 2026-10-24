# Cold-install verification (BB-AC10 evidence)

**Date**: 2026-10-17T18:58 (+08:00)
**Host**: macOS 27.0 / arm64 (Apple M1), Node v24.18.0, npm bundled with Node
**Method**: copied the workspace to a fresh temporary directory, excluding
`node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `coverage/`;
ran the locked install and gates there; the temporary directory was removed
after the run.

## Commands and results

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Types | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0; `dist/beambench.html` + hashed asset |
| Unit tests | `npm run test:unit:run` | exit 0; 14 files / 166 tests |
| Remote refs | `grep -c "https\?://" dist/beambench.html` | 0 matches |
| Preview | `npm run preview -- --port 4173 --strictPort` | HTTP 200 for `/beambench.html` |

## Notes

- The Playwright browser binary is cached per user (not part of the repo), so
  cold E2E was not repeated in the temporary directory. E2E was verified in the
  working tree: `npx playwright test` → 4 passed.
- `src/upstream/LICENSE` and the root `LICENSE` are present; attribution and
  upstream SHA are recorded in `NOTICE` and `README.md`.
- No remote CDN imports remain in source or build output. `beambench.html` no
  longer contains an import map.

## Remaining AC10 gaps

- A packaged release archive and a final evidence index are not produced yet.
- Person-led visual acceptance (BB-AC01/BB-AC03) is still outstanding.
