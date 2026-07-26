# Neon Snake Lab

Neon Snake is a dependency-free browser game used to explore how far simple rules can be pushed through game feel, procedural systems, and interface design.

## Run it

Open `public/index.html` in a modern browser. No installation, build step, package manager, server, account, or network connection is required.

To run the deterministic rules and control-flow suites:

```powershell
node game-logic.test.js
node ai-quality.test.js
node control-flow.test.js
node duel-control-flow.test.js
node room-transport.test.js
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

The AI player follows one readable priority stack in every selected protocol:

```text
prove an escape after food → take the shortest safe route
food route is unsafe → follow the moving tail
tail route is unavailable → preserve the Hamiltonian safety arc
cycle order is unavailable → compare space, exits, and six-turn survival
```

It rejects collisions first, tries the shortest visible route to the signal, simulates that whole route, and accepts it only when the resulting head can still reach the tail with enough open space. If the current body blocks that route, a bounded deterministic beam search models the tail moving out of the way. When no food line proves safe, the planner follows the moving tail to reopen the board. A deterministic Hamiltonian cycle is the final safety rail on an ordered even board: shortcuts may advance through free cells but can never overtake the tail. Arbitrary player positions still use the bounded six-turn flood-fill search. The selected continuation is rendered as a subtle Foresight Trail beneath the snake, including correct edge breaks in Portal mode. Decision Insight now says whether the AI is following a proven route, resetting behind its tail, guarding the cycle, or choosing between local survival options.

Decision DNA turns that planner into a mirror instead of an opponent. On every player step, the game records whether the chosen direction matched the planner, how much reachable space the choice preserved, and whether it left one or fewer exits. The run report translates those aggregates into one of four readable styles: Tactician, Explorer, Daredevil, or Hybrid. It never changes movement, score, or difficulty.

The optional live AI Lens uses that identical calculation as a co-pilot. Press `L` or use the single toggle to reveal legal candidate cells, the planner's chosen direction, and the reason it beat the runner-up while retaining full control. Turning it on never steers the snake or modifies scoring.

In the Duel Lab, `Play vs AI` is a true two-snake match rather than an advice mode. The violet rival uses an opponent-aware variant of the planner: your body is occupied space, the shared signal affects route value, and every legal move is tested against every legal reply you could make on the next tick. It cannot see your next input, but it no longer volunteers for an avoidable head-on or head-swap.

Signal Codes make challenge generation equally inspectable. A six-character code is hashed once, then a tiny seeded generator chooses each gameplay-affecting random outcome. The same code, mode, pace, and player moves therefore produce the same pickup and mutation sequence—without a backend or saved server state.

Signal Codes also name duel rooms. The current live-room transport is deliberately labeled `SAME-BROWSER CANARY`: `BroadcastChannel` proves two-tab presence, room capacity, Ready state, countdown cancellation, host snapshots, and disconnect handling without pretending it works across devices. The room cannot enter countdown until two connected players have both marked themselves Ready. Public cross-device play remains gated on an actual Vercel WebSocket runtime canary.

## Current rule set

- **Classic:** walls end the run.
- **Portal:** crossing an edge enters from the opposite edge.
- **Rush:** score as much as possible in 60 seconds.
- **Canvas:** edges wrap, self-crossing is safe, and every move becomes a persistent brush stroke.
- **Fluid presentation:** the board has no visible lattice; the snake, Echo, trails, AI markers, and exported artwork use rounded continuous forms while preserving exact tile rules underneath.
- **Combo:** quick consecutive pickups increase the multiplier up to five.
- **Core:** every fifth pickup creates a timed, high-value target.
- **Mutation:** a Core temporarily bends one run rule—Flow slows time or Amplify doubles points. Mode boundaries never change.
- **AI play:** a deterministic survival planner obeys whichever protocol is selected, identifies itself as `AI CONTROL`, paints its decision on the board, and has an explicit Stop AI control that returns to the Play / Watch AI choice.
- **Live AI Lens:** the player can reveal the same planner as `AI HINT · YOU DRIVE` during a normal run without surrendering control or changing the rules.
- **Decision DNA:** the post-run report compares every player step with the same visible planner and summarizes AI agreement, space preserved, risk turns, and play style without affecting the run.
- **Signal Code:** the same six-character code recreates the same hidden pickup and mutation sequence, and the Share action packages it with the selected mode and pace.
- **Echo:** your previous run in the same mode returns as a harmless ghost moving one step for every step you take.
- **Export:** Canvas sessions can be saved locally as a branded 1440 × 1440 PNG without uploading the artwork.
- **Run integrity:** movement never starts until the owner choice and visible countdown complete; hiding the page suspends a player countdown, and career runs increment only when play actually begins.
- **AI Duel:** two fluid snakes share a compressed 30 × 30 lethal arena; the first crash loses and simultaneous head-on or head-swap collisions draw.
- **Live-room canary:** a six-character room Signal connects exactly two same-browser tabs; both players must be connected and Ready before countdown, and a disconnect cancels or stops play.

## Source map

- `public/index.html` — semantic interface and controls.
- `public/styles.css` — visual system and responsive layout.
- `public/game-logic.js` — small deterministic rules with no browser dependency.
- `public/game.js` — canvas rendering, input, audio, persistence, and orchestration.
- `public/duel.html` — focused AI/live duel interface.
- `public/duel.css` — responsive duel arena and room-state presentation.
- `public/duel.js` — AI duel and room-state orchestration.
- `public/room-transport.js` — the replaceable dependency-free same-browser room adapter.
- `game-logic.test.js` — executable rule regressions using Node's built-in assertions.
- `ai-quality.test.js` — seeded survival, routing-efficiency, safety-cycle, and duel counter-move benchmarks.
- `control-flow.test.js` — executable ownership and explicit-start regressions.
- `duel-control-flow.test.js` — executable expanded-arena and room-gate regressions.
- `room-transport.test.js` — executable transport lifecycle and envelope regressions.

The environment intentionally remains plain HTML, CSS, and JavaScript so every experiment is inspectable and reversible.

## Public deployment on Vercel

The repository is intentionally deployable as a framework-free static site:

1. Import the repository into Vercel.
2. Leave **Root Directory** at the repository root.
3. Set **Framework Preset** to **Other**.
4. Leave the build command blank. `vercel.json` serves only the `public` output directory.

`vercel.json` supplies security headers, service-worker cache behavior, and conservative asset caching. `manifest.webmanifest` and `sw.js` provide an installable, offline-capable shell after the first successful visit.

Keeping the app in this dedicated project root—and serving only `public`—ensures tests, documentation, configuration, and unrelated workspace files cannot become public deployment artifacts.

Before attaching a custom domain, update the metadata in `index.html` with an absolute canonical URL and absolute `og:image` URL for the final domain.

The static deployment includes the complete AI duel and the same-browser live-room canary. Do not relabel the canary as public multiplayer until a cross-device transport has been deployed to Vercel, exercised from two separate devices, and shown to recover from the platform's maximum-duration reconnect.

### Multiplayer transport boundary

Vercel now officially supports bidirectional WebSockets in Functions, but its current upgrade API requires both `@vercel/functions` and `ws`. Each connection is pinned to one Function instance, so Vercel's own [cross-instance example](https://vercel.com/kb/guide/real-time-chat-websockets) adds Redis to relay events when two clients land on different instances. The underlying limits and reconnect requirement are documented in [Vercel Functions WebSockets](https://vercel.com/docs/functions/websockets).

Those packages and that shared service are not hidden inside this dependency-free static build. Until a production transport is deliberately isolated, load-tested, and canaried, the honest public contract remains:

- Solo play and AI duels work entirely in the browser.
- `SAME-BROWSER CANARY` proves the two-player room state machine without claiming internet transport.
- Public multiplayer requires cross-instance delivery, origin and payload validation, reconnect/state recovery, and a two-device Vercel canary.

## Public-data boundary

- Gameplay has no backend and sends no run data anywhere.
- The live-room canary uses same-origin `BroadcastChannel`; it cannot transmit outside the current browser profile.
- Scores, settings, leaderboard entries, and Echo paths stay in `localStorage`.
- The service worker caches only same-origin public game files.
- The page requests no camera, microphone, geolocation, payment, or USB permissions.
