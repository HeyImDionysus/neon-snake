"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const readBytes = (...segments) => fs.readFileSync(path.join(root, ...segments));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const wallpaperHtml = read("public", "wallpaper.html");
const wallpaperScript = read("public", "wallpaper.js");
const wallpaperEngine = read("public", "wallpaper-engine.js");
const wallpaperBuilder = read("scripts", "build-wallpapers.mjs");
const homeHtml = read("public", "index.html");
const downloadsHtml = read("public", "downloads.html");
const livelyInfo = JSON.parse(read("wallpaper", "windows", "LivelyInfo.json"));
const livelyProperties = JSON.parse(read("wallpaper", "windows", "LivelyProperties.json"));
const androidManifest = read("wallpaper", "android", "app", "src", "main", "AndroidManifest.xml");
const androidService = read(
  "wallpaper",
  "android",
  "app",
  "src",
  "main",
  "java",
  "app",
  "neonsnake",
  "wallpaper",
  "NeonWallpaperService.java",
);
const permanentReadme = read("downloads", "v1.0.0", "README.md");
const permanentWindows = readBytes(
  "downloads",
  "v1.0.0",
  "Neon-Snake-Lively-v1.0.0.zip",
);
const permanentAndroid = readBytes(
  "downloads",
  "v1.0.0",
  "Neon-Snake-Android-v1.0.0.apk",
);

assert.match(wallpaperHtml, /wallpaperCanvas/);
assert.match(homeHtml, /href="downloads\.html"/);
assert.doesNotMatch(homeHtml, /href="wallpaper\.html"/);
assert.match(homeHtml, /WINDOWS LIVELY · ANDROID LIVE WALLPAPER/);
assert.match(downloadsHtml, /Neon-Snake-Android-v1\.0\.0\.apk/);
assert.match(downloadsHtml, /Neon-Snake-Lively-v1\.0\.0\.zip/);
assert.match(downloadsHtml, /Download for Android/);
assert.match(downloadsHtml, /Download for Windows/);
assert.match(wallpaperHtml, /game-logic\.js/);
assert.match(wallpaperHtml, /wallpaper-engine\.js/);
assert.match(wallpaperHtml, /wallpaper\.js/);
assert.doesNotMatch(wallpaperHtml, /button|input|select/);
assert.match(wallpaperScript, /requestAnimationFrame\(render\)/);
assert.match(wallpaperScript, /visibilitychange/);
assert.match(wallpaperScript, /livelyPropertyListener/);
assert.match(wallpaperScript, /livelyWallpaperPlaybackChanged/);
assert.match(wallpaperScript, /Math\.min\(2, Math\.max\(1, devicePixelRatio/);
assert.match(wallpaperScript, /fps: clampNumber\(query\.get\("fps"\), 8, 30, 24\)/);
assert.match(wallpaperScript, /drawSnakeHead/);
assert.match(wallpaperScript, /drawPickupEffects/);
assert.match(wallpaperScript, /wallpaperScore/);
assert.match(wallpaperEngine, /createWallpaperEngine/);
assert.match(wallpaperEngine, /type: "eat"/);
assert.match(wallpaperBuilder, /readdir\(windowsRoot\)\)\.sort\(\)/);
assert.match(wallpaperBuilder, /reproducibleTimestamp/);
assert.match(wallpaperBuilder, /\["-q", "-X", archive, \.\.\.packageFiles\]/);

const sandbox = {
  globalThis: {},
  module: { exports: {} },
};
require("node:vm").runInNewContext(wallpaperEngine, sandbox, {
  filename: "public/wallpaper-engine.js",
});
const createWallpaperEngine = sandbox.module.exports.createWallpaperEngine;
assert.equal(typeof createWallpaperEngine, "function");
const engine = createWallpaperEngine({
  rules: require("./public/game-logic.js"),
  signal: "NEON42",
  mode: "classic",
});
let eats = 0;
let worstDrought = 0;
let drought = 0;
for (let step = 0; step < 1_600; step += 1) {
  const event = engine.step();
  drought += 1;
  if (event?.type === "eat") {
    eats += 1;
    worstDrought = Math.max(worstDrought, drought);
    drought = 0;
  }
}
assert.ok(eats >= 18, `Expected visible repeated food collection, received ${eats}`);
assert.ok(worstDrought <= 110, `Wallpaper food drought was ${worstDrought} steps`);
assert.ok(engine.snapshot().snake.length >= 3 + eats);

assert.equal(livelyInfo.Type, 1);
assert.equal(livelyInfo.FileName, "index.html");
assert.match(livelyInfo.Arguments, /--pause-event true/);
assert.equal(livelyProperties.fps.max, 30);
assert.equal(livelyProperties.fps.min, 8);
assert.deepEqual(livelyProperties.mode.items, ["classic", "portal"]);

assert.match(androidManifest, /android\.software\.live_wallpaper/);
assert.match(androidManifest, /android\.permission\.BIND_WALLPAPER/);
assert.doesNotMatch(androidManifest, /android\.permission\.INTERNET/);
assert.match(androidService, /extends WallpaperService/);
assert.match(androidService, /onVisibilityChanged/);
assert.match(androidService, /handler\.removeCallbacks\(frame\)/);
assert.match(androidService, /isPowerSaveMode/);
assert.match(androidService, /setOffsetNotificationsEnabled\(false\)/);
assert.match(androidService, /postDelayed\(frame, powerSave \? 67L : 42L\)/);
assert.match(androidService, /drawSnakeHead/);
assert.match(androidService, /drawPickupEffects/);
assert.match(androidService, /snake\.foodsEaten\(\)/);
assert.match(read("wallpaper", "android", "app", "src", "main", "java", "app", "neonsnake", "wallpaper", "AutonomousSnake.java"), /shortestFoodMove/);
assert.match(permanentReadme, new RegExp(sha256(permanentWindows)));
assert.match(permanentReadme, new RegExp(sha256(permanentAndroid)));
assert.equal(permanentWindows.subarray(0, 2).toString("ascii"), "PK");
assert.equal(permanentAndroid.subarray(0, 2).toString("ascii"), "PK");
assert.ok(permanentWindows.length > 25_000);
assert.ok(permanentAndroid.length > 20_000);

process.stdout.write("PASS Windows and Android packages match the game, visibly eat and grow, and stay offline/battery-aware\n");
