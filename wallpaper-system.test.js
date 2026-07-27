"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const wallpaperHtml = read("public", "wallpaper.html");
const wallpaperScript = read("public", "wallpaper.js");
const homeHtml = read("public", "index.html");
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

assert.match(wallpaperHtml, /wallpaperCanvas/);
assert.match(homeHtml, /href="wallpaper\.html"/);
assert.match(homeHtml, /WINDOWS LIVELY · ANDROID LIVE WALLPAPER/);
assert.match(wallpaperHtml, /game-logic\.js/);
assert.match(wallpaperHtml, /wallpaper\.js/);
assert.doesNotMatch(wallpaperHtml, /button|input|select/);
assert.match(wallpaperScript, /requestAnimationFrame\(render\)/);
assert.match(wallpaperScript, /visibilitychange/);
assert.match(wallpaperScript, /livelyPropertyListener/);
assert.match(wallpaperScript, /livelyWallpaperPlaybackChanged/);
assert.match(wallpaperScript, /Math\.min\(2, Math\.max\(1, devicePixelRatio/);
assert.match(wallpaperScript, /fps: clampNumber\(query\.get\("fps"\), 8, 30, 24\)/);

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

process.stdout.write("PASS Windows and Android packages run autonomous, offline, battery-aware wallpapers\n");
