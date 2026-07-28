"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const soloHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const duelHtml = fs.readFileSync(path.join(root, "public", "duel.html"), "utf8");
const soloScript = fs.readFileSync(path.join(root, "public", "game.js"), "utf8");
const duelScript = fs.readFileSync(path.join(root, "public", "duel.js"), "utf8");
const soloStyles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const duelStyles = fs.readFileSync(path.join(root, "public", "duel.css"), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected function ${name}`);
  const parameters = source.indexOf("(", start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameters; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const brace = source.indexOf("{", parameterEnd);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, index);
  }
  throw new Error(`Unclosed function ${name}`);
}

function assertAriaReferencesResolve(html, page) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/\baria-(?:controls|describedby|labelledby)="([^"]+)"/g)) {
    match[1].split(/\s+/).forEach((id) => {
      assert.ok(ids.has(id), `${page} references missing ARIA target #${id}`);
    });
  }
}

const tests = [
  ["both pages expose one clear document title, main landmark, and top-level heading", () => {
    [soloHtml, duelHtml].forEach((html) => {
      assert.equal((html.match(/<title>/g) || []).length, 1);
      assert.equal((html.match(/<main\b/g) || []).length, 1);
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
    });
  }],
  ["every ARIA relationship resolves to an element on its page", () => {
    assertAriaReferencesResolve(soloHtml, "Solo");
    assertAriaReferencesResolve(duelHtml, "Duel");
  }],
  ["canvas boards are keyboard-focusable and retain a text fallback", () => {
    assert.match(soloHtml, /<canvas[^]*?id="gameCanvas"[^]*?tabindex="0"[^]*?>[^<]*canvas support[^<]*<\/canvas>/);
    assert.match(duelHtml, /<canvas[^]*?id="duelCanvas"[^]*?tabindex="0"[^]*?>[^<]*canvas support[^<]*<\/canvas>/);
    assert.match(soloHtml, /aria-describedby="gameInstructions"/);
    assert.match(duelHtml, /aria-describedby="duelInstructions"/);
  }],
  ["score changes expose contextual polite status updates", () => {
    assert.match(soloHtml, /class="hud-primary" role="status" aria-atomic="true"/);
    assert.equal((duelHtml.match(/role="status" aria-atomic="true"/g) || []).length, 2);
  }],
  ["rapid AI telemetry remains inspectable without becoming a live announcement stream", () => {
    assert.match(soloHtml, /class="ai-lens" id="aiLens" role="region" aria-labelledby="aiLensLabel"/);
    assert.doesNotMatch(soloHtml, /id="aiLens"[^>]*(?:role="status"|aria-live)/);
    assert.match(duelHtml, /<dl class="trace-readout">/);
    assert.doesNotMatch(duelHtml, /class="trace-readout"[^>]*aria-live/);
    assert.match(soloHtml, /id="gameAnnouncement" aria-live="assertive"/);
    assert.match(duelHtml, /id="duelAnnouncement" aria-live="assertive"/);
  }],
  ["touch controls and room participants use named semantic groups", () => {
    assert.match(soloHtml, /class="mobile-controls" role="group" aria-label="Touch movement controls"/);
    assert.match(duelHtml, /class="duel-mobile-controls" role="group" aria-label="Touch duel controls"/);
    assert.match(duelHtml, /class="room-roster" role="list" aria-label="Room players"/);
    assert.equal((duelHtml.match(/role="listitem"/g) || []).length, 2);
  }],
  ["native controls carry explicit types and form labels", () => {
    [...soloHtml.matchAll(/<button\b([^>]*)>/g), ...duelHtml.matchAll(/<button\b([^>]*)>/g)]
      .forEach((match) => assert.match(match[1], /\btype="button"/));
    assert.match(soloHtml, /<legend class="sr-only">Game mode<\/legend>/);
    assert.match(soloHtml, /<label for="difficulty">STARTING PACE<\/label>/);
    assert.match(duelHtml, /<label class="room-code-label" for="roomCodeInput">ROOM SIGNAL<\/label>/);
    assert.match(duelHtml, /<input id="roomCodeInput" type="text"/);
  }],
  ["keyboard focus remains visible on controls, room input, and canvas", () => {
    assert.match(soloStyles, /input:focus-visible, canvas:focus-visible/);
    assert.match(soloStyles, /\.board-wrap canvas:focus-visible/);
    assert.match(duelStyles, /\.room-code-row input:focus-visible/);
    assert.match(duelStyles, /\.activity-legal a:focus-visible/);
  }],
  ["Discord Activity users can reach both policy documents", () => {
    assert.match(duelHtml, /<nav class="activity-legal" aria-label="Activity policies">/);
    assert.match(duelHtml, /<a href="\/terms\.html" target="_blank" rel="noopener noreferrer">TERMS<\/a>/);
    assert.match(duelHtml, /<a href="\/privacy\.html" target="_blank" rel="noopener noreferrer">PRIVACY<\/a>/);
    assert.match(duelStyles, /body\.activity-mode \.activity-legal\s*\{[^}]*display:\s*flex/);
  }],
  ["mobile actions preserve the 44-pixel minimum target", () => {
    assert.match(soloStyles, /\.start-actions \.demo-button \{ min-height: 44px; \}/);
    assert.match(soloStyles, /body\[data-game-state="over"\][^]*?\.start-actions \.demo-button \{\s*min-height: 44px;/);
    assert.match(soloStyles, /\.direction-button \{[^]*?width: 62px;[^]*?height: 58px;/);
    assert.match(duelStyles, /\.duel-control-row button \{[^]*?min-height: 44px;/);
    assert.match(duelStyles, /\.duel-mobile-controls button \{[^]*?width: 62px;[^]*?height: 54px;/);
  }],
  ["run ownership transitions move focus to the board or next action", () => {
    assert.match(functionBody(soloScript, "prepareRun"), /focusWithoutScroll\(canvas\)/);
    assert.match(functionBody(soloScript, "startRun"), /focusWithoutScroll\(canvas\)/);
    assert.match(functionBody(soloScript, "endGame"), /focusWithoutScroll\(startButton\)/);
    assert.match(functionBody(soloScript, "stopDemo"), /focusWithoutScroll\(startButton\)/);
    assert.match(functionBody(duelScript, "prepareAiDuel"), /focusWithoutScroll\(canvas\)/);
    assert.match(functionBody(duelScript, "endDuel"), /focusWithoutScroll\(aiStartButton\)/);
    assert.match(functionBody(duelScript, "togglePause"), /focusWithoutScroll\(aiStartButton\)/);
    assert.match(functionBody(duelScript, "togglePause"), /focusWithoutScroll\(canvas\)/);
  }],
  ["reduced-motion preferences suppress decorative animation and transition loops", () => {
    assert.match(soloStyles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(soloStyles, /animation-duration: \.01ms !important/);
    assert.match(soloStyles, /animation-iteration-count: 1 !important/);
    assert.match(soloStyles, /transition-duration: \.01ms !important/);
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic accessibility tests passed.\n`);
