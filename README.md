# Neon Snake

Neon Snake is a public capability experiment: give Codex one familiar game, then judge how far the AI behind its construction can push the finished artifact through engineering, autonomous control, backend architecture, game feel, visual identity, and verification.

The game itself is not AI. Its Autopilot and duel opponent are deterministic decision systems written specifically for this project. They are part of the evidence—alongside the renderer, realtime room protocol, accessibility, offline shell, and tests—not a claim that ordinary game code is a model.

## Run it

Open `public/index.html` in a modern browser. The browser shell remains dependency-free: solo play, Autopilot runs, Autopilot duels, Canvas export, the live wallpaper preview, and offline installation require no package manager or account. Public Live Rooms use a native same-origin Vercel WebSocket with the project’s existing Redis resource for cross-instance relay. Discord profiles and the verified leaderboard stay inside isolated Vercel Functions plus Redis.

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
node realtime-worker.test.js
node platform-security.test.js
node activity-system.test.js
node profile-system.test.js
node profile-interaction.test.js
node profile-browser.test.js
node product-browser.test.js
node product-experience.test.js
node touch-controls.test.js
node wallpaper-system.test.js
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

Signal Codes also name duel rooms. `PUBLIC LIVE ROOM` reserves exactly two server-assigned player slots in one Vercel WebSocket room, while additional visitors become read-only spectators. Both players publish bounded direction inputs over WebSocket; the browser never publishes authoritative state. The Player 1 Vercel Function owns the 138 ms simulation, applies both players' inputs in sequence, resolves both snakes once, and broadcasts one verified snapshot through the existing Redis event relay to every Function instance and screen. Countdown requires a healthy room link plus two server-roster-confirmed Ready players. A disconnect, missed heartbeat, replaced connection, or revoked Ready state cancels the round immediately.

Discord sign-in is optional for play and required only for a verified profile or leaderboard result. The authorization-code flow requests the `identify` scope, validates a one-time state record, exchanges the code only on the server, and retains no Discord access or refresh token. Session cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, and `__Host-` scoped. The same-origin WebSocket reads that protected session server-side; no identity token or shared realtime secret enters browser code. The authoritative room writes a completed two-account result directly through the private account module, and Redis atomically deduplicates it before changing the leaderboard. Two clients signed into the same Discord account can play, but cannot record a result.

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
- **Discord Activity:** the official Embedded App SDK authenticates each participant, converts one Discord Activity instance into one shared live-room Signal, opens Discord's native invite dialog, respects mobile safe areas, and keeps Activity sessions in a partitioned HttpOnly cookie.
- **Verified profiles:** optional Discord identity anchors a dedicated public profile with a visible username, custom callsign, bio, color, favorite mode, snake style, avatar, verified record, and live-room presence. OAuth tokens never enter game code, and the flow requests no email, guild, or social permissions.
- **Online leaderboard:** public rows link to profiles, show callsigns plus verified Discord usernames and current live-room activity, and can change only through outcomes written privately by the server-authoritative live simulation.
- **Autonomous wallpapers:** the real eat, grow, score, Core, and pickup-feedback loop runs without controls as a configurable Lively wallpaper on Windows and as a battery-aware native `WallpaperService` on Android.

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
- `public/room-transport.js` — same-origin Vercel WebSocket transport with bounded reconnect/heartbeat handling plus the legacy HTTP fallback.
- `activity/entry.js`, `public/activity-sdk.js` — official Discord Embedded App SDK source and its pinned, reproducible browser bundle.
- `api/activity/token.mjs` — origin-bound Activity code exchange and partitioned session entry point.
- `public/account.js` — safe Discord profile and verified-leaderboard rendering.
- `public/profile.html`, `public/profile.js`, `public/profile.css` — dedicated public-player surface and authenticated profile customization.
- `public/downloads.html`, `public/downloads.css` — direct Windows/Android downloads plus the live wallpaper preview.
- `public/wallpaper.html`, `public/wallpaper.js`, `public/wallpaper.css` — the control-free autonomous wallpaper surface.
- `public/wallpaper-engine.js` — deterministic eat-and-grow wallpaper state shared by the browser and Windows package.
- `api/realtime.mjs` — native Vercel WebSocket entry point with strict origin and payload boundaries.
- `server/realtime-core.cjs` — authoritative duel simulation, atomic Redis presence, and cross-instance event relay.
- `api/auth/discord/*`, `api/me.mjs`, `api/profile.mjs`, `api/logout.mjs` — Discord authorization, public profile, customization, and session endpoints.
- `api/leaderboard.mjs` — public read-only verified leaderboard endpoint.
- `server/account-core.cjs` — OAuth, cookie, HMAC, profile, and atomic leaderboard logic.
- `api/room.mjs` — the isolated Vercel Function entry point.
- `server/room-core.cjs` — request validation, Redis REST client, and atomic two-slot room protocol.
- `wallpaper/windows` — Lively metadata and user-configurable properties.
- `wallpaper/android` — native, offline Android live-wallpaper project with no network permission.
- `scripts/build-wallpapers.mjs` — reproducible Windows Lively archive builder.
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
- `realtime-worker.test.js` — executable Vercel connection, Redis relay, input authority, and verified-result regressions.
- `platform-security.test.js` — executable Discord data-minimization, state, cookie, HMAC, and leaderboard-write regressions.
- `profile-system.test.js` — executable profile customization, public identity, live activity, and origin-bound write regressions.
- `activity-system.test.js` — executable Discord iframe, SDK, instance-room, origin, token, and partitioned-cookie regressions.
- `product-experience.test.js` — executable navigation, download routing, copy, responsive-header, profile, and leaderboard regressions.
- `wallpaper-system.test.js` — executable eat/grow behavior plus Windows/Android packaging, pause, frame-budget, visual, and permission regressions.

The environment intentionally remains plain HTML, CSS, and JavaScript so every experiment is inspectable and reversible.

## Autonomous wallpaper packages

The wallpaper is not a browser tab left open in the background. Both packages start directly in autonomous mode and expose no steering controls.

### Windows

`node scripts/build-wallpapers.mjs` creates `dist/wallpapers/Neon-Snake-Lively.zip`. Import that archive with Lively Wallpaper's `Add Wallpaper` flow. The package is fully offline, visibly eats nearby Signals and Cores, grows, scores, and exposes frame rate, snake pace, glow, palette, Classic/Portal boundary, and mark visibility through Lively's wallpaper settings. Lively's pause event and document visibility both stop animation work.

### Android

`wallpaper/android` is a native Android live wallpaper for Android 8.0 and newer. Its offline autonomous engine uses the same guaranteed eat/grow rhythm and renders the same layered snake, face, Signals, Cores, pickup burst, and score HUD as the browser surface. Opening the installed app launches the system live-wallpaper chooser. The service has no `INTERNET` permission, stops its frame callbacks whenever the wallpaper is hidden, and lowers rendering from roughly 24 fps to 15 fps in system power-save mode. CI builds an installable debug-signed APK artifact that can be downloaded and installed directly.

## Production deployment

The browser app and account endpoints deploy on Vercel:

1. Import the repository into Vercel.
2. Leave **Root Directory** at the repository root.
3. Set **Framework Preset** to **Other**.
4. Leave the build command blank. `vercel.json` serves static files only from `public`; Vercel deploys the files under `api/` separately.
5. Connect an Upstash Redis resource to the project so Vercel provides `STORAGE_KV_REST_API_URL` and `STORAGE_KV_REST_API_TOKEN`.
6. Create a Discord application with the exact production callback URL and set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI`.

### Discord Activity portal setup

The Activity reuses the same Vercel deployment and Discord application; it does not need a bot or another hosting provider.

1. In **Activities → URL Mappings**, map prefix `/` to `neon-snake-green-tau.vercel.app` (no protocol).
2. In **Activities → Settings**, enable Activities and enable Web, iOS, and Android support.
3. Keep the default `Launch` Entry Point command. Set phone/tablet orientation to unlocked; the app requests landscape only for picture-in-picture and grid tiles.
4. In **OAuth2**, retain the existing production callback. Activity authorization requests only `identify`; the existing client secret stays in Vercel and never enters the browser bundle.
5. Install the application to the intended server and leave Discovery disabled if the Activity should not be publicly listed.

Discord currently limits unverified Activities to servers with fewer than 25 members. A 40-member server therefore requires Discord app verification even when Discovery remains disabled. Until verification is approved, the same build can be tested in a smaller private server by the owner or invited App Testers.

`vercel.json` supplies security headers, service-worker cache behavior, and conservative asset caching. `manifest.webmanifest` and `sw.js` provide an installable, offline-capable shell after the first successful visit.

Keeping the static app in `public` ensures tests, documentation, configuration, server code, and unrelated workspace files cannot become downloadable static artifacts. Database credentials are read only inside the server function and are never included in browser JavaScript.

`api/realtime.mjs` deploys with the rest of the project and serves `/api/realtime` on the same Vercel domain. It uses the Redis resource already attached to the project for atomic room presence and low-latency cross-instance publish/subscribe. No second hosting provider, Worker deployment, shared realtime secret, or runtime URL configuration is required.

Before attaching a custom domain, update the metadata in `index.html` and register the new Discord callback URL. Production acceptance requires exercising one room from two different networks after every network-layer change.

### Multiplayer transport boundary

The production live-room adapter opens one secure same-origin WebSocket to Vercel. Direction inputs are sent immediately instead of waiting for a browser → HTTP polling → browser cycle. Local delivery is immediate; the existing Redis resource relays events only when the two players land on different Vercel Function instances. One server-side simulation broadcasts a single authoritative snapshot after every 138 ms tick. The adapter sends active heartbeats every five seconds, closes stale links, times out a silent connection after eight seconds, and reconnects with exponential backoff capped at four seconds. A legacy HTTP transport remains only as a local recovery path; it is not the production latency path.

The server boundary enforces:

- an exact same-host HTTPS browser Origin, exact six-character room codes, and bounded client identifiers;
- a 32 KiB message ceiling and per-connection rate limit;
- exactly two live player slots, with later visitors restricted to spectator reads;
- Player 1-only countdowns, player-only direction inputs, and rejection of every browser state snapshot;
- server-owned movement, collision, food, scores, and result signatures;
- server-side session-cookie profile lookup without a browser-readable identity ticket;
- private, direct verified-result writes and generic failures that never expose credentials.

Solo play and Autopilot duels still work entirely in the browser. Live-room state is ephemeral and disappears after the room goes idle.

## Public-data boundary

- Solo gameplay sends no run data anywhere.
- Anonymous Public Live Rooms send only temporary presence, readiness, direction, countdown, and server snapshots to the Vercel WebSocket endpoint and existing Redis relay.
- Signed-in profiles store only Discord id, username, display name, avatar hash, constrained public customization, current-room activity with a short expiry, and aggregate duel results. Discord tokens, email, guilds, and friend data are not stored.
- Room state is ephemeral; it is not a chat log or analytics stream.
- Solo scores, settings, local leaderboard entries, and Echo paths stay in `localStorage`.
- The service worker caches only same-origin public game files.
- The Android wallpaper requests no network permission.
- The page requests no camera, microphone, geolocation, payment, or USB permissions.
