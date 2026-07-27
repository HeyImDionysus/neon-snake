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
const siteShell = read("public", "site-shell.js");
const profileScript = read("public", "profile.js");
const wallpaperScript = read("public", "wallpaper.js");
const wallpaperStyles = read("public", "wallpaper.css");
const wallpaperPage = read("public", "wallpaper.html");
const vercel = read("vercel.json");

for (const [name, html] of pages) {
  assert.match(html, /class="site-header product-header/);
  assert.match(html, /class="site-nav" id="primaryNavigation" aria-label="Primary navigation"/);
  assert.match(html, /class="site-menu-toggle"/);
  assert.match(html, /src="site-shell\.js"/);
  assert.match(html, /href="duel\.html"/);
  assert.match(html, /href="downloads\.html"/);
  assert.match(html, /href="\.\/#leaderboard"|href="#leaderboard"/);
  assert.match(html, /href="profile\.html"/);
  assert.match(html, /data-account-control/);
  process.stdout.write(`PASS ${name} uses the shared product navigation\n`);
}

assert.doesNotMatch(home, /AI-Built Systems Experiment|THE CODEX EXPERIMENT|Judge the artifact/);
assert.match(home, /href="downloads\.html"/);
assert.doesNotMatch(home, /href="wallpaper\.html"/);
assert.match(home, /id="leaderboard"/);
assert.match(home, /id="livePlayers"/);
assert.match(home, /Live players and rankings/);
assert.match(home, /class="next-moves"/);
assert.doesNotMatch(home, /signal-atlas|atlas-route|Choose how you play/);
process.stdout.write("PASS the homepage reads as a product and routes wallpaper users to downloads\n");

assert.match(downloads, /Download for Windows/);
assert.match(downloads, /Download for Android/);
assert.match(downloads, /class="wallpaper-surface"/);
assert.match(downloads, /same autonomous snake from the game/i);
assert.match(downloads, /data-wallpaper-palette="acid"/);
assert.match(downloads, /id="wallpaperPace"/);
assert.match(wallpaperScript, /NeonSnakeWallpaperPreview/);
assert.match(downloads, /href="\/downloads\/v1\.1\.1\/Neon-Snake-Lively-v1\.1\.1\.zip"/);
assert.match(downloads, /href="\/downloads\/v1\.1\.0\/Neon-Snake-Android-v1\.1\.0\.apk"/);
assert.doesNotMatch(downloads, /github\.com\/HeyImDionysus\/neon-snake\/raw/);
assert.equal(fs.existsSync(path.join(__dirname, "public", "downloads", "v1.1.1", "Neon-Snake-Lively-v1.1.1.zip")), true);
assert.equal(fs.existsSync(path.join(__dirname, "public", "downloads", "v1.1.0", "Neon-Snake-Android-v1.1.0.apk")), true);
assert.match(vercel, /Content-Disposition/);
process.stdout.write("PASS downloads provide direct platform actions and a live truthful preview\n");

["callsignInput", "bioInput", "profileDraftState", "profilePreviewCallsign"].forEach((id) => {
  assert.match(profile, new RegExp(`id="${id}"`));
});
assert.equal((profile.match(/name="accent"/g) || []).length, 5);
assert.equal((profile.match(/name="favoriteMode"/g) || []).length, 5);
assert.equal((profile.match(/name="snakeStyle"/g) || []).length, 4);
assert.match(profile, /id="profileWins"/);
assert.match(profile, /id="profileLosses"/);
assert.match(profile, /id="profileDraws"/);
assert.match(profileScript, /method: "PATCH"/);
assert.doesNotMatch(profileScript, /innerHTML|insertAdjacentHTML|document\.write/);
process.stdout.write("PASS profiles have a dedicated safe customization and record surface\n");

assert.match(account, /@\$\{entry\.username/);
assert.match(account, /profile\.html\?user=/);
assert.match(account, /entry\.online/);
assert.match(account, /renderLivePlayers/);
assert.match(account, /playerSignature/);
assert.match(account, /entry\.snakeStyle/);
assert.match(account, /entry\.favoriteMode/);
assert.match(account, /12_000/);
assert.doesNotMatch(account, /innerHTML|insertAdjacentHTML|document\.write/);
process.stdout.write("PASS the public board exposes usernames, profile links, and current activity\n");

assert.match(styles, /\.product-header \{[^]*?position: sticky/);
assert.match(styles, /\.site-nav/);
assert.match(styles, /overflow-x: auto/);
assert.match(styles, /\.site-menu-open \.product-header \.site-nav/);
assert.match(siteShell, /aria-expanded/);
assert.match(siteShell, /navigation\.inert/);
assert.match(styles, /\.public-board/);
process.stdout.write("PASS the mobile header, player identity, and leaderboard reflow as product surfaces\n");

assert.match(wallpaperPage, /<html[^>]*class="wallpaper-runtime"/);
assert.match(wallpaperStyles, /html\.wallpaper-runtime,\s*body\.wallpaper-runtime/);
assert.doesNotMatch(wallpaperStyles, /html,\s*body\.wallpaper-runtime/);
assert.match(styles, /overflow-y: scroll/);
process.stdout.write("PASS normal product pages retain document scrolling while the wallpaper runtime stays fullscreen\n");
