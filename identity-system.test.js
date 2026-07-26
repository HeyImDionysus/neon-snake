"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const duelHtml = fs.readFileSync(path.join(root, "public", "duel.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");
const fieldSource = fs.readFileSync(path.join(root, "public", "signal-field.js"), "utf8");
const field = require("./public/signal-field.js");

const tests = [
  ["both game surfaces share the Signal Cartography layer", () => {
    [indexHtml, duelHtml].forEach((html) => {
      assert.match(html, /id="signalField"/);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /src="signal-field\.js"/);
      assert.match(html, /assets\/signal-mark\.svg/);
    });
    assert.match(serviceWorker, /"\/signal-field\.js"/);
    assert.match(serviceWorker, /"\/assets\/signal-mark\.svg"/);
  }],
  ["the field seed is deterministic and mode-sensitive", () => {
    assert.equal(field.hashSignal("ABC234"), field.hashSignal("ABC234"));
    assert.notEqual(field.hashSignal("ABC234"), field.hashSignal("ABC235"));
    const first = field.createFieldSpec("ABC234", "classic", 1280, 720);
    const second = field.createFieldSpec("ABC234", "classic", 1280, 720);
    const portal = field.createFieldSpec("ABC234", "portal", 1280, 720);
    assert.deepEqual(first, second);
    assert.notDeepEqual(first, portal);
    assert.equal(first.attractors.length, 3);
    assert.ok(first.currents >= 7 && first.currents <= 12);
    first.attractors.forEach((point) => {
      assert.ok(point.x >= 0 && point.x <= 1280);
      assert.ok(point.y >= 0 && point.y <= 720);
    });
  }],
  ["protocols have a bespoke visual mark instead of generic radio-only rows", () => {
    assert.equal((indexHtml.match(/class="protocol-glyph/g) || []).length, 4);
    ["classic", "portal", "rush", "canvas"].forEach((mode) => {
      assert.match(indexHtml, new RegExp(`data-glyph="${mode}"`));
    });
    assert.match(styles, /\.protocol-glyph\[data-glyph="classic"\]/);
    assert.match(styles, /\.protocol-glyph\[data-glyph="portal"\]/);
    assert.match(styles, /\.protocol-glyph\[data-glyph="rush"\]/);
    assert.match(styles, /\.protocol-glyph\[data-glyph="canvas"\]/);
  }],
  ["the methodology is presented as a run trace rather than a four-card template", () => {
    assert.match(indexHtml, /class="signal-atlas"/);
    assert.match(indexHtml, /class="atlas-route"/);
    assert.equal((indexHtml.match(/class="atlas-entry"/g) || []).length, 4);
    assert.doesNotMatch(indexHtml, /class="showcase-grid"/);
    assert.match(styles, /@keyframes atlas-draw/);
  }],
  ["motion is bounded and reduced-motion aware", () => {
    assert.match(fieldSource, /prefers-reduced-motion: reduce/);
    assert.match(fieldSource, /24/);
    assert.match(fieldSource, /document\.hidden/);
    assert.match(fieldSource, /motionQuery\?\.addEventListener\("change", handleMotionPreference\)/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
    assert.match(styles, /\.atlas-route__flow/);
  }],
  ["the atlas changes layout before intermediate-width cards can collide", () => {
    assert.match(styles, /@media \(max-width: 1280px\)[^]*?\.signal-atlas/);
  }],
  ["public multiplayer copy no longer calls the finished feature a canary", () => {
    assert.doesNotMatch(indexHtml, /LIVE ROOM CANARY/);
    assert.match(indexHtml, /PUBLIC LIVE ROOM/);
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic identity-system tests passed.\n`);
