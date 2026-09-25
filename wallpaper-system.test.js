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
// The files players actually download are whatever the downloads page links to.
function linkedDownload(platform) {
  const href = downloadsHtml.match(new RegExp(`href="(/downloads/[^"]+)" data-wallpaper-download="${platform}"`))?.[1];
  assert.ok(href, `The downloads page must link a ${platform} build`);
  return ["public", ...href.split("/").filter(Boolean)];
}
function publishedHash(platform) {
  const article = downloadsHtml.split('<article class="download-platform')
    .find((section) => section.includes(`data-wallpaper-download="${platform}"`));
  return article?.match(/SHA-256 <code>([a-f0-9]{64})<\/code>/)?.[1];
}
const shippedWindowsPath = linkedDownload("Windows");
const shippedAndroidPath = linkedDownload("Android");
const permanentWindows = readBytes(...shippedWindowsPath);
const permanentAndroid = readBytes(...shippedAndroidPath);
const shippedLivelyProperties = JSON.parse(readArchiveText(shippedWindowsPath, "LivelyProperties.json"));
const shippedWallpaperScript = readArchiveText(shippedWindowsPath, "wallpaper.js");

assert.match(wallpaperHtml, /wallpaperCanvas/);
assert.match(homeHtml, /href="downloads\.html"/);
assert.doesNotMatch(homeHtml, /href="wallpaper\.html"/);
assert.match(homeHtml, /WINDOWS LIVELY · ANDROID LIVE WALLPAPER/);
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
// Lively's WebView2 player JSON-serialises every argument, so the wallpaper is
// handed the string '{"IsPaused":true}'. Coercing that with Number() yielded
// NaN, NaN !== 0 was true, and the wallpaper animated through every pause while
// the downloads page promised it stopped. A name match could not see that, so
// the reader is executed against the exact payloads Lively sends.
assert.match(wallpaperScript, /livelyWallpaperPlaybackChanged/);
{
  const start = wallpaperScript.indexOf("function playbackIsPlaying");
  assert.ok(start >= 0, "Expected a playback reader that can be exercised directly");
  const end = wallpaperScript.indexOf("root.NeonSnakeWallpaperPreview", start);
  const playbackIsPlaying = new Function(
    `${wallpaperScript.slice(start, end)}; return playbackIsPlaying;`,
  )();
  assert.equal(playbackIsPlaying('{"IsPaused": true}'), false, "Lively's pause payload must pause the wallpaper");
  assert.equal(playbackIsPlaying('{"IsPaused": false}'), true, "Lively's resume payload must resume the wallpaper");
  assert.equal(playbackIsPlaying({ IsPaused: true }), false);
  assert.equal(playbackIsPlaying("0"), false, "An older player's numeric state still pauses");
  assert.equal(playbackIsPlaying("1"), true);
  assert.equal(playbackIsPlaying("nonsense"), null, "An unreadable payload must not change playback");
  assert.match(
    wallpaperScript,
    /livelyWallpaperPlaybackChanged = \(data\) => \{\s*const playing = playbackIsPlaying\(data\);/,
    "The Lively callback must route through the reader these cases cover",
  );
}
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
assert.equal(publishedHash("Windows"), sha256(permanentWindows), "The page must print the Windows file's real SHA-256");
assert.equal(publishedHash("Android"), sha256(permanentAndroid), "The page must print the Android file's real SHA-256");
// The shipped Windows build must actually pause. The source was fixed while the
// archive on the downloads page kept the NaN bug, and a test that only read the
// source could not see it, so the shipped reader is executed here.
{
  const start = shippedWallpaperScript.indexOf("function playbackIsPlaying");
  assert.ok(start >= 0, "The shipped wallpaper must contain the Lively playback reader");
  const end = shippedWallpaperScript.indexOf("root.NeonSnakeWallpaperPreview", start);
  const shippedPlayback = new Function(`${shippedWallpaperScript.slice(start, end)}; return playbackIsPlaying;`)();
  assert.equal(shippedPlayback('{"IsPaused":true}'), false, "The downloadable wallpaper must pause when Lively pauses it");
  assert.equal(shippedPlayback('{"IsPaused":false}'), true);
}
assert.equal(permanentWindows.subarray(0, 2).toString("ascii"), "PK");
assert.equal(permanentAndroid.subarray(0, 2).toString("ascii"), "PK");
assert.ok(permanentWindows.length > 25_000);
assert.ok(permanentAndroid.length > 20_000);

process.stdout.write("PASS Windows and Android packages match the game, visibly eat and grow, and stay offline/battery-aware\n");
