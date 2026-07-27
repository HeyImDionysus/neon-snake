"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...segments) => fs.readFileSync(path.join(__dirname, ...segments), "utf8");
const pages = ["index.html", "duel.html", "downloads.html", "profile.html"]
  .map((name) => [name, read("public", name)]);
const home = read("public", "index.html");
const profile = read("public", "profile.html");
const downloads = read("public", "downloads.html");
const account = read("public", "account.js");
const styles = read("public", "styles.css");
const profileScript = read("public", "profile.js");

for (const [name, html] of pages) {
  assert.match(html, /class="site-header product-header/);
  assert.match(html, /class="site-nav" aria-label="Primary navigation"/);
  assert.match(html, /href="duel\.html"/);
  assert.match(html, /href="downloads\.html"/);
  assert.match(html, /href="\.\/#leaderboard"|href="#leaderboard"/);
  assert.match(html, /data-account-control/);
  process.stdout.write(`PASS ${name} uses the shared product navigation\n`);
}

assert.doesNotMatch(home, /AI-Built Systems Experiment|THE CODEX EXPERIMENT|Judge the artifact/);
assert.match(home, /href="downloads\.html"/);
assert.doesNotMatch(home, /href="wallpaper\.html"/);
assert.match(home, /id="leaderboard"/);
assert.match(home, /Players, not placeholders/);
process.stdout.write("PASS the homepage reads as a product and routes wallpaper users to downloads\n");

assert.match(downloads, /Download for Windows/);
assert.match(downloads, /Download for Android/);
assert.match(downloads, /class="wallpaper-surface"/);
assert.match(downloads, /actual autonomous game loop/i);
process.stdout.write("PASS downloads provide direct platform actions and a live truthful preview\n");

["callsignInput", "bioInput", "favoriteModeInput", "snakeStyleInput"].forEach((id) => {
  assert.match(profile, new RegExp(`id="${id}"`));
});
assert.equal((profile.match(/name="accent"/g) || []).length, 5);
assert.match(profile, /id="profileWins"/);
assert.match(profile, /id="profileLosses"/);
assert.match(profile, /id="profileDraws"/);
assert.match(profileScript, /method: "PATCH"/);
assert.doesNotMatch(profileScript, /innerHTML|insertAdjacentHTML|document\.write/);
process.stdout.write("PASS profiles have a dedicated safe customization and record surface\n");

assert.match(account, /@\$\{entry\.username/);
assert.match(account, /profile\.html\?user=/);
assert.match(account, /entry\.online/);
assert.match(account, /12_000/);
assert.doesNotMatch(account, /innerHTML|insertAdjacentHTML|document\.write/);
process.stdout.write("PASS the public board exposes usernames, profile links, and current activity\n");

assert.match(styles, /\.product-header \{[^]*?position: sticky/);
assert.match(styles, /\.site-nav/);
assert.match(styles, /overflow-x: auto/);
assert.match(styles, /\.public-board/);
process.stdout.write("PASS the header and leaderboard reflow as product-level responsive surfaces\n");
