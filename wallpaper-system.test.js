"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = __dirname;
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const readBytes = (...segments) => fs.readFileSync(path.join(root, ...segments));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function readArchiveText(archive, requestedFile) {
  const bytes = readBytes(...archive);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  assert.notEqual(endRecord, -1, "ZIP end record missing");

  const entries = bytes.readUInt16LE(endRecord + 10);
  let centralOffset = bytes.readUInt32LE(endRecord + 16);
  for (let index = 0; index < entries; index += 1) {
    assert.equal(bytes.readUInt32LE(centralOffset), 0x02014b50, "ZIP central record missing");
    const method = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    const name = bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    if (name === requestedFile) {
      assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, "ZIP local record missing");
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      if (method === 0) return compressed.toString("utf8");
      if (method === 8) return zlib.inflateRawSync(compressed).toString("utf8");
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`Archive entry ${requestedFile} missing`);
}

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
const permanentWindowsReadme = read("downloads", "v1.1.2", "README.md");
const permanentAndroidReadme = read("downloads", "v1.1.1", "README.md");
const permanentWindows = readBytes(
  "downloads",
  "v1.1.2",
  "Neon-Snake-Lively-v1.1.2.zip",
);
const permanentAndroid = readBytes(
  "downloads",
  "v1.1.1",
  "Neon-Snake-Android-v1.1.1.apk",
);
const shippedLivelyProperties = JSON.parse(readArchiveText(
  ["downloads", "v1.1.2", "Neon-Snake-Lively-v1.1.2.zip"],
  "LivelyProperties.json",
));
const shippedWallpaperScript = readArchiveText(
  ["downloads", "v1.1.2", "Neon-Snake-Lively-v1.1.2.zip"],
  "wallpaper.js",
);

assert.match(wallpaperHtml, /wallpaperCanvas/);
assert.match(homeHtml, /href="downloads\.html"/);
assert.doesNotMatch(homeHtml, /href="wallpaper\.html"/);
assert.match(homeHtml, /WINDOWS LIVELY · ANDROID LIVE WALLPAPER/);
assert.match(downloadsHtml, /Neon-Snake-Android-v1\.1\.1\.apk/);
assert.match(downloadsHtml, /Neon-Snake-Lively-v1\.1\.2\.zip/);
assert.equal((downloadsHtml.match(/<a class="download-button"[^>]*\bdownload="/g) || []).length, 2);
assert.match(downloadsHtml, /Download for Android/);
assert.match(downloadsHtml, /Download for Windows/);
assert.match(wallpaperHtml, /game-logic\.js/);
assert.match(wallpaperHtml, /wallpaper-engine\.js/);
assert.match(wallpaperHtml, /wallpaper\.js/);
assert.doesNotMatch(wallpaperHtml, /button|input|select/);
assert.match(wallpaperScript, /requestAnimationFrame\(render\)/);
assert.match(wallpaperScript, /visibilitychange/);
assert.match(wallpaperScript, /livelyPropertyListener/);
assert.match(wallpaperScript, /resolveLivelyChoice\(value, PALETTE_CHOICES\)/);
assert.match(wallpaperScript, /resolveLivelyChoice\(value, MODE_CHOICES\)/);
assert.match(wallpaperScript, /livelyWallpaperPlaybackChanged/);
assert.match(wallpaperScript, /Math\.min\(2, Math\.max\(1, devicePixelRatio/);
assert.match(wallpaperScript, /fps: clampNumber\(query\.get\("fps"\), 8, 30, 24\)/);
assert.match(wallpaperScript, /drawSnakeHead/);
assert.match(wallpaperScript, /drawPickupEffects/);
assert.match(wallpaperScript, /quadraticCurveTo/);
assert.match(wallpaperScript, /wallpaperScore/);
assert.match(wallpaperEngine, /createWallpaperEngine/);
assert.match(wallpaperEngine, /type: "eat"/);
assert.match(wallpaperBuilder, /readdir\(windowsRoot\)\)\.sort\(\)/);
assert.match(wallpaperBuilder, /reproducibleTimestamp/);
assert.match(wallpaperBuilder, /\["-q", "-X", archive, \.\.\.packageFiles\]/);
assert.match(wallpaperBuilder, /TZ: "UTC"/);

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
let loops = 0;
let maximumLength = 0;
let worstDrought = 0;
let drought = 0;
for (let step = 0; step < 12_000; step += 1) {
  const event = engine.step();
  maximumLength = Math.max(maximumLength, engine.snapshot().snake.length);
  drought += 1;
  if (event?.type === "eat" || event?.type === "complete") {
    eats += 1;
    if (event.type === "complete") loops += 1;
    worstDrought = Math.max(worstDrought, drought);
    drought = 0;
  }
}
assert.ok(eats >= 100, `Expected visible repeated food collection, received ${eats}`);
assert.ok(worstDrought <= 110, `Wallpaper food drought was ${worstDrought} steps`);
assert.ok(loops >= 2, `Expected the wallpaper route to refresh, received ${loops} loops`);
assert.ok(maximumLength <= 42, `Wallpaper grew into a ${maximumLength}-segment screen-filling slab`);
assert.equal(engine.snapshot().displayLengthLimit, 42);

assert.equal(livelyInfo.Type, 1);
assert.equal(livelyInfo.FileName, "index.html");
assert.match(livelyInfo.Arguments, /--pause-event true/);
assert.equal(livelyProperties.fps.max, 30);
assert.equal(livelyProperties.fps.min, 8);
assert.deepEqual(livelyProperties.mode.items, ["classic", "portal"]);
for (const [name, property] of Object.entries(livelyProperties)) {
  if (property.type !== "dropdown") continue;
  assert.ok(Number.isInteger(property.value), `${name} dropdown default must be an integer`);
  assert.ok(property.value >= 0 && property.value < property.items.length);
  assert.deepEqual(shippedLivelyProperties[name], property);
}
assert.match(shippedWallpaperScript, /resolveLivelyChoice\(value, PALETTE_CHOICES\)/);
assert.match(shippedWallpaperScript, /resolveLivelyChoice\(value, MODE_CHOICES\)/);

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
assert.match(androidService, /quadTo/);
assert.match(androidService, /snake\.foodsEaten\(\)/);
const androidSnake = read("wallpaper", "android", "app", "src", "main", "java", "app", "neonsnake", "wallpaper", "AutonomousSnake.java");
assert.match(androidSnake, /shortestFoodMove/);
assert.match(androidSnake, /DISPLAY_LENGTH_LIMIT = 42/);
assert.match(androidService, /snake\.lastPickup\(\)/);
assert.match(permanentWindowsReadme, new RegExp(sha256(permanentWindows)));
assert.match(permanentAndroidReadme, new RegExp(sha256(permanentAndroid)));
assert.equal(permanentWindows.subarray(0, 2).toString("ascii"), "PK");
assert.equal(permanentAndroid.subarray(0, 2).toString("ascii"), "PK");
assert.ok(permanentWindows.length > 25_000);
assert.ok(permanentAndroid.length > 20_000);

process.stdout.write("PASS Windows and Android packages match the game, visibly eat and grow, and stay offline/battery-aware\n");
