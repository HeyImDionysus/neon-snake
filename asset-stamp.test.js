"use strict";

// The Discord Activity proxy serves our scripts and stylesheets with a four-hour
// cache regardless of what the origin sends, so the only thing standing between
// a player and a mismatched build is the `?v=` stamp. These checks make a stale
// stamp a build failure instead of a black screen.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

(async () => {
  const stamper = await import("./scripts/stamp-assets.mjs");
  const { computeStamp, computeStampFrom, hashedFiles, readStamp } = stamper;

  const committed = readStamp();
  assert.equal(
    committed,
    computeStamp(),
    "The committed asset stamp no longer matches the content it protects. Run: npm run stamp",
  );
  process.stdout.write(`PASS the committed asset stamp matches its content (v=${committed})\n`);

  // A stamp that does not move when a script moves is the defect this guards
  // against, so prove the computation is content-sensitive rather than trusting it.
  const files = hashedFiles();
  assert.ok(files.length >= 10, "Expected the public asset set to be discovered");
  const mutated = files.map(([name, content], index) => (
    index === 0 ? [name, `${content}\n// content drift\n`] : [name, content]
  ));
  assert.notEqual(
    computeStampFrom(files),
    computeStampFrom(mutated),
    "Changing an asset must change the stamp",
  );
  const renamed = files.map(([name, content], index) => (
    index === 0 ? [`renamed-${name}`, content] : [name, content]
  ));
  assert.notEqual(
    computeStampFrom(files),
    computeStampFrom(renamed),
    "Renaming an asset must change the stamp",
  );
  assert.equal(
    computeStampFrom(files),
    computeStampFrom([...files].reverse()),
    "The stamp must not depend on directory iteration order",
  );
  process.stdout.write("PASS the stamp tracks asset content, names, and nothing else\n");

  // Every reference must agree: one stale entry in the shell list is enough to
  // pin a client to an old script.
  const indexHtml = read("public", "index.html");
  const duelHtml = read("public", "duel.html");
  const serviceWorker = read("public", "sw.js");
  for (const [name, source] of [["index.html", indexHtml], ["duel.html", duelHtml], ["sw.js", serviceWorker]]) {
    const stamps = new Set([...source.matchAll(/\?v=([0-9a-z]+)/g)].map((match) => match[1]));
    assert.ok(stamps.size > 0, `${name} must reference stamped assets`);
    assert.deepEqual([...stamps], [committed], `${name} references a stale asset stamp`);
  }
  assert.match(serviceWorker, new RegExp(`const CACHE_NAME = "neon-snake-shell-${committed}";`));

  // Everything the HTML loads with a stamp must also be in the shell cache under
  // the same stamp, or the offline shell and the proxy disagree.
  const shell = serviceWorker.match(/const APP_SHELL = \[([^]*?)\];/);
  assert.ok(shell, "Expected an APP_SHELL declaration");
  const cached = new Set([...shell[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  for (const [name, source] of [["index.html", indexHtml], ["duel.html", duelHtml]]) {
    for (const [, reference] of source.matchAll(/(?:src|href)="([^"]+\?v=[0-9a-z]+)"/g)) {
      assert.ok(
        cached.has(`/${reference}`),
        `${name} loads ${reference}, which the offline shell does not cache`,
      );
    }
  }
  process.stdout.write("PASS every stamped reference agrees with the offline shell\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
