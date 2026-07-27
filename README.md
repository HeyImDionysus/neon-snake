# Neon Snake

Neon Snake is a public capability experiment: give Codex one familiar game, then judge how far the AI behind its construction can push the finished artifact through engineering, autonomous control, backend architecture, game feel, visual identity, and verification.

The game itself is not AI. Its Autopilot and duel opponent are deterministic decision systems written specifically for this project. They are part of the evidence—alongside the renderer, realtime room protocol, accessibility, offline shell, and tests—not a claim that ordinary game code is a model.

## Run it

Open `public/index.html` in a modern browser. Solo play, Autopilot runs, Autopilot duels, Canvas export, and offline installation require no installation, build step, package manager, server, account, or network connection. Public Live Rooms use the deployed Vercel room function and Redis resource.

To run the deterministic rules and control-flow suites:

```powershell
node game-logic.test.js
node ai-quality.test.js
node canvas-performance.test.js
node canvas-browser-performance.test.js
node control-flow.test.js
node duel-control-flow.test.js
node duel-quality.test.js
node room-transport.test.js
node room-api.test.js
node identity-system.test.js
node accessibility.test.js
node service-worker.test.js
node deployment-contract.test.js
```

## The methodology

The project grows in four understandable layers:

1. **Rule** — one sentence the player can understand.
2. **Feedback** — the board visibly and audibly communicates the rule.
3. **Combination** — simple rules interact to create surprising situations.
4. **Proof** — deterministic rules are tested separately from animation and browser input.

A feature is kept only when it passes three questions:

- Can it be explained in one sentence?
- Can the player see what happened without reading documentation?
- Does it create new decisions instead of extra menu work?

The implementation grid is deliberately invisible. Solo movement and collision remain a readable 20 × 20 rule model, while the renderer converts those positions into a continuous curved body over a layered atmospheric field. Portal jumps break the visual path at the edge instead of drawing a line across the board.

The separate Duel Lab uses the same canvas footprint with a 30 × 30 logical arena. That makes each snake one-third smaller while increasing playable cells from 400 to 900—125% more room without consuming more page space. Both snakes advance in one deterministic transaction, so wall, self, rival-body, head-on, and head-swap collisions cannot depend on browser callback order.

The Autopilot follows one readable priority stack in every selected protocol:

```text
prove an escape after food → take the shortest safe route
food route is unsafe → follow the moving tail
tail route is unavailable → preserve the Hamiltonian safety arc
cycle order is unavailable → compare space, exits, and six-turn survival
```

It rejects collisions first, tries the shortest visible route to the signal, simulates that whole route, and accepts it only when the resulting head can still reach the tail with enough open space. If the current body blocks that route, a bounded deterministic beam search models the tail moving out of the way. When no food line proves safe, the planner follows the moving tail to reopen the board. A deterministic Hamiltonian cycle is the final safety rail on an ordered even board: shortcuts may advance through free cells but can never overtake the tail. Arbitrary player positions still use the bounded six-turn flood-fill search. The selected continuation is rendered as a subtle Foresight Trail beneath the snake, including correct edge breaks in Portal mode. Decision Insight says whether the engine is following a verified route, resetting behind its tail, guarding the cycle, or choosing between local survival options.

Decision DNA turns that planner into a mirror instead of an opponent. On every player step, the game records whether the chosen direction matched the planner, how much reachable space the choice preserved, and whether it left one or fewer exits. The run report translates those aggregates into one of four readable styles: Tactician, Explorer, Daredevil, or Hybrid. It never changes movement, score, or difficulty.

The optional live Decision Lens uses that identical calculation as a co-pilot. Press `L` or use the single toggle to reveal legal candidate cells, the planner's chosen direction, and the reason it beat the runner-up while retaining full control. Turning it on never steers the snake or modifies scoring.

In the Duel Lab, `Play vs Autopilot` is a true two-snake match rather than an advice mode. The violet rival treats your body as occupied space and performs a deterministic two-ply simultaneous-move search: every candidate move is tested against your worst legal reply, then against the next exchange. Terminal wins and losses dominate the score; surviving lines compare future territory, exits, food-race pressure, score, and body length. Recent head history penalizes repeated circuits, while a small Signal-derived tie break varies equivalent safe lines without overriding tactics. It cannot see your next input and does not claim to solve the full game.

The executable quality suite proves more than isolated fixtures. Classic Autopilot fills all 400 cells—397 collected growth pickups after the opening length—on three distinct public Signal Codes while preserving the cycle invariant. Timed Cores can expire and reseed, so the completion gate bounds every active objective to one board traversal and reports actual capture droughts separately instead of claiming every transient Core is collected. Eight-seed matrices require purposeful, distinct routes across solo modes; timed Rush and Canvas runs exercise Steady, Arcade, and Overdrive with the live Core, mutation, brush-length, composition, and strict 60-second Rush rules. Duel simulations run the controller from both spawn roles against food-racing, pursuit, and evasion policies, carry the live score into future-state values, require seeded route variation, reject avoidable next-tick losses, retain the food target across the full search horizon, and detect regressions into short pursuit loops. A separate symmetry gate swaps player order across 1,200 simultaneous states and requires identical outcomes.

Signal Codes make challenge generation equally inspectable. A six-character code is hashed once, then a tiny seeded generator chooses each gameplay-affecting random outcome. The same code, mode, pace, and player moves therefore produce the same pickup and mutation sequence—without a backend or saved server state.

That code also drives the site's Signal Cartography identity. A separate deterministic renderer turns the current Signal and protocol into flowing currents, contour fields, and orbiting nodes behind the interface. It is capped at 24 frames per second, pauses drawing in hidden tabs, becomes static when reduced motion is requested, and never participates in game state. The custom signal-serpent mark, protocol glyphs, and curved run trace carry the same visual grammar through solo and Duel surfaces without adding a framework or image payload.

Signal Codes also name duel rooms. `PUBLIC LIVE ROOM` reserves exactly two server-assigned player slots in Redis, while additional visitors become read-only spectators. These are casual, host-authoritative matches: Player 1's browser owns the deterministic simulation and publishes schema-validated snapshots; Player 2 publishes an ordered, acknowledged direction queue. The Vercel Function validates message shape and player-slot permissions, but it does not verify legal moves, scores, or outcomes. Anyone with the Signal Code can enter the room. Countdown requires a healthy room link plus two server-roster-confirmed Ready players, and idle data expires automatically.

## Current rule set

- **Classic:** walls end the run.
- **Portal:** crossing an edge enters from the opposite edge.
- **Rush:** score as much as possible in 60 seconds.
- **Canvas:** edges wrap, self-crossing is safe, and every move becomes a persistent brush stroke.
- **Fluid presentation:** the board has no visible lattice; the snake, Echo, decision markers, and exported artwork use rounded continuous forms while preserving exact tile rules underneath.
- **Responsive controls:** keyboard, swipe, touch buttons, and gamepad input share a bounded two-turn buffer, so a rapid corner sequence is consumed one turn per logic step without allowing reversals.
- **Combo:** quick consecutive pickups increase the multiplier up to five.
- **Core:** every fifth pickup creates a timed, high-value target.
- **Mutation:** a Core temporarily bends one run rule—Flow slows time or Amplify doubles points. Mode boundaries never change.
- **Autopilot:** a deterministic survival planner obeys whichever protocol is selected, identifies itself clearly, paints its decision on the board, and has an explicit stop control that returns to the player/Autopilot choice.
- **Decision Lens:** the player can reveal the same planner as `DECISION LENS · YOU DRIVE` during a normal run without surrendering control or changing the rules.
- **Decision DNA:** the post-run report compares every player step with the same visible planner and summarizes engine agreement, space preserved, risk turns, and play style without affecting the run.
- **Signal Code:** the same six-character code recreates the same hidden pickup and mutation sequence, and the Share action packages it with the selected mode and pace.
- **Echo:** your previous run in the same mode returns as a harmless ghost moving one step for every step you take.
- **Export:** Canvas sessions can be saved locally as a branded 1440 × 1440 PNG without uploading the artwork.
- **Run integrity:** movement never starts until the owner choice and visible countdown complete; hiding the page suspends a player countdown, and career runs increment only when play actually begins.
- **Autopilot Duel:** two fluid snakes share a compressed 30 × 30 lethal arena; the first crash loses and simultaneous head-on or head-swap collisions draw.
- **Public Live Room:** a six-character room Signal connects exactly two players across different devices; both must be connected and Ready before countdown, and a disconnect cancels or stops play.

## Source map

- `public/index.html` — semantic interface and controls.
- `public/styles.css` — visual system and responsive layout.
- `public/signal-field.js` — deterministic, mode-aware Signal Cartography background renderer.
- `public/assets/signal-mark.svg` — the custom signal-serpent identity mark.
- `public/game-logic.js` — small deterministic rules with no browser dependency.
- `public/game.js` — canvas rendering, input, audio, persistence, and orchestration.
- `public/duel.html` — focused Autopilot/live duel interface.
- `public/duel.css` — responsive duel arena and room-state presentation.
- `public/duel.js` — autonomous duel and room-state orchestration.
- `public/room-transport.js` — dependency-free BroadcastChannel and Vercel/Redis room adapters.
- `api/room.mjs` — the isolated Vercel Function entry point.
- `server/room-core.cjs` — request validation, Redis REST client, and atomic two-slot room protocol.
- `game-logic.test.js` — executable rule regressions using Node's built-in assertions.
- `ai-quality.test.js` — three-seed full-board completion plus eight-seed, all-pace timing, routing-efficiency, safety-cycle, adversarial duel, route-diversity, and loop-recovery benchmarks.
- `canvas-performance.test.js` — executable late-run gate for accumulated raster strokes, 2× compositing, effect retirement, and worst-shaped Autopilot planning.
- `canvas-browser-performance.test.js` — real Chromium late-run gate that combines 1,400 rasterized glow strokes, 2× compositing, peak overlapping effects, and a worst-shaped planner decision inside the 44 ms Overdrive movement budget.
- `control-flow.test.js` — executable ownership and explicit-start regressions.
- `duel-control-flow.test.js` — executable expanded-arena and room-gate regressions.
- `duel-quality.test.js` — executable 1,200-state simultaneous-resolution symmetry gate plus a 36-run, both-spawn adversarial planner matrix.
- `room-transport.test.js` — executable transport lifecycle and envelope regressions.
- `room-api.test.js` — executable origin, validation, role, rate, expiry, and configuration regressions.
- `identity-system.test.js` — executable identity, deterministic field, protocol-glyph, cache, and motion-budget regressions.
- `accessibility.test.js` — executable semantics, focus, touch-target, canvas-fallback, and reduced-motion regressions.
- `service-worker.test.js` — executable install, upgrade, runtime-cache, and route-aware offline regressions.
- `deployment-contract.test.js` — executable public-boundary, manifest, cache-shell, and hosted-verification regressions.

The environment intentionally remains plain HTML, CSS, and JavaScript so every experiment is inspectable and reversible.

## Public deployment on Vercel

The repository is intentionally deployable as a framework-free site with one isolated room function:

1. Import the repository into Vercel.
2. Leave **Root Directory** at the repository root.
3. Set **Framework Preset** to **Other**.
4. Leave the build command blank. `vercel.json` serves static files only from `public`; Vercel deploys `api/room.mjs` separately at `/api/room`.
5. Connect an Upstash Redis resource to the project so Vercel provides `STORAGE_KV_REST_API_URL` and `STORAGE_KV_REST_API_TOKEN`.

`vercel.json` supplies security headers, service-worker cache behavior, and conservative asset caching. `manifest.webmanifest` and `sw.js` provide an installable, offline-capable shell after the first successful visit.

Keeping the static app in `public` ensures tests, documentation, configuration, server code, and unrelated workspace files cannot become downloadable static artifacts. Database credentials are read only inside the server function and are never included in browser JavaScript.

Before attaching a custom domain, update the metadata in `index.html` with an absolute canonical URL and absolute `og:image` URL for the final domain.

The deployment includes the complete Autopilot duel and a Redis-backed Public Live Room. Production acceptance still requires exercising one room from two different devices after every network-layer change.

### Multiplayer transport boundary

The live-room adapter uses adaptive same-origin short polling against `/api/room`. One transport-owned clock starts quickly while a room is changing, backs a one-player wait from 700 ms to a 2 second presence refresh, accelerates when the second player arrives, and polls both active roles below one 138 ms game tick. Host snapshots, guest turns, Ready changes, and countdown messages interrupt that clock and send immediately. The page does not run a second presence heartbeat.

Each request executes one atomic Redis Lua command that cleans stale slots, refreshes presence, applies the sender's allowed update, and returns the latest room state. Normal polling deadlines are anchored to the preceding request's start, so a slow response consumes the idle delay instead of extending it. With the 3 second browser timeout, opposing successful network legs can account for at most 6 seconds between server observations, preserving a nominal one-second margin inside the server's 7 second player lease. This keeps the dependency-free Vercel/Redis boundary while reducing settled idle-room traffic by up to 70%. Active traffic intentionally favors control latency: the host polls at 70 ms so guest turns can arrive before the next simulation step. Retry and rate-limit backoff always outrank the normal game cadence.

The server boundary enforces:

- exact six-character room codes and bounded client/session identifiers;
- same-origin POST requests, a 64 KiB body ceiling, and a room-level request rate;
- exactly two expiring player slots, with later visitors restricted to spectator reads;
- host-only countdown/state writes and guest-only direction writes;
- rebuilt envelopes so clients cannot spoof another sender, room, or timestamp;
- no-store responses and generic failures that never expose credentials.

Solo play and Autopilot duels still work entirely in the browser. Live-room state is ephemeral and disappears after the room goes idle.

## Public-data boundary

- Solo gameplay sends no run data anywhere.
- Public Live Rooms send only temporary presence, readiness, direction, countdown, and board-state messages to the same-origin room API.
- Room records expire automatically; they are not a leaderboard, account, chat log, or analytics store.
- Scores, settings, leaderboard entries, and Echo paths stay in `localStorage`.
- The service worker caches only same-origin public game files.
- The page requests no camera, microphone, geolocation, payment, or USB permissions.
