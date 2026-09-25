# Working on Neon Snake

Notes for anyone, human or agent, changing this repository.

## Before you push

```sh
npm run check   # every JavaScript file parses; asset stamp and Discord SDK bundle are current
npm test        # all *.test.js files (Chromium, plus Redis on 127.0.0.1:16379)
```

`npm run test:unit` runs everything that needs neither Chromium nor Redis.

- Changed anything under `public/`? Run `npm run stamp` and commit the result.
- Changed `activity/entry.js`? Run `npm run build:activity` and commit `public/activity-sdk.js`.
- Added a test? Name it `something.test.js` in the repository root; the runner and CI find it.

## Test policy

- Test behavior, not source text. Run the code (in Node, a worker thread, or
  real Chromium) and assert on what it does. A regex over a source file breaks
  on harmless refactors and passes on real regressions; add one only when the
  property genuinely cannot be observed, and say why in the test.
- Do not pin dependency versions, README wording, or workflow step lists in
  tests. `package-lock.json`, Dependabot and review own those.
- Performance gates (`*-performance.test.js`) run alone after everything else.
  Keep new heavy suites fast by splitting work across worker threads.

## Truthfulness

The README, the downloads page, and the privacy policy describe what the
product actually does. When behavior changes, change them in the same commit.
Do not claim a download, signature, or guarantee that the repository cannot
back up.

## Boundaries

- `public/game-logic.js` is the single rule set shared by the browser, the
  Web Worker, the wallpaper, and the authoritative server. Rule changes land
  there and nowhere else.
- The server (`server/`) is the authority for live rooms: round ids, seeds,
  results and ratings are issued there, never trusted from a client.
- Secrets (`STORAGE_KV_REST_API_TOKEN`, `DISCORD_CLIENT_SECRET`, Android
  signing keys) live in the hosting platform or GitHub environments, never in
  the repository.
