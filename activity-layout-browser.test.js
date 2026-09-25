"use strict";

// The game has to fit whatever viewport it is given. Discord sizes the
// Activity iframe, and a layout fix that was only checked by hand at a few
// sizes regressed until the Play button sat below the panel at 1100x620.
// This gate loads the real pages at the sizes Discord and laptops actually
// use and checks the board and its primary action are on screen.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch (error) {
  if (process.env.ACTIVITY_BROWSER_REQUIRED === "1") throw error;
  process.stdout.write("SKIP Activity layout gate (Playwright unavailable)\n");
  process.exit(0);
}

const root = path.join(__dirname, "public");
const origin = "https://neon.layout.test";
const activityQuery = "frame_id=layout-frame&instance_id=layout-instance&platform=desktop";
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

async function serve(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!path.extname(file)) file += ".html";
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full)) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.fulfill({ contentType: types[path.extname(full)] || "application/octet-stream", body: fs.readFileSync(full) });
  });
}

function measure(page, { board, action, title }) {
  return page.evaluate(({ board, action, title }) => {
    const inside = (rect, bounds) => rect.width > 0 && rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5
      && rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5;
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const boardRect = document.querySelector(board).getBoundingClientRect();
    const button = action ? document.querySelector(action) : null;
    let actionReachable = null;
    if (button && !button.hidden && button.getBoundingClientRect().width) {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      actionReachable = inside(rect, viewport) && Boolean(hit) && button.contains(hit);
    }
    const heading = title ? document.querySelector(title) : null;
    return {
      size: Math.round(boardRect.width),
      square: Math.abs(boardRect.width - boardRect.height) < 1.5,
      boardVisible: inside(boardRect, viewport),
      actionReachable,
      titleInsideBoard: heading ? inside(heading.getBoundingClientRect(), boardRect) : null,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
    };
  }, { board, action, title });
}

const solo = { path: "/", board: "#boardWrap", action: "#startButton", title: "#overlayTitle" };
const duel = { path: "/duel", board: "#duelBoard", action: null, title: "#duelOverlayTitle" };

// [width, height, minimum board size]
const activitySizes = [
  [1280, 720, 480],
  [1100, 620, 400],
  [1000, 560, 340],
  [800, 600, 340],
  [700, 400, 160],
  [390, 700, 340],
  [480, 270, 200],
  [320, 180, 120],
];

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    headless: true,
  });
  try {
    for (const surface of [solo, duel]) {
      for (const [width, height, minimum] of activitySizes) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        await serve(page);
        await page.goto(`${origin}${surface.path}?${activityQuery}`, { waitUntil: "load" });
        await page.waitForTimeout(400);
        const label = `${surface.path} Activity at ${width}x${height}`;
        const result = await measure(page, surface);
        assert.ok(result.square, `${label}: the board must stay square`);
        assert.ok(result.boardVisible, `${label}: the whole board must be on screen (${JSON.stringify(result)})`);
        assert.ok(result.size >= minimum, `${label}: board ${result.size}px is smaller than ${minimum}px`);
        if (result.actionReachable !== null) {
          assert.ok(result.actionReachable, `${label}: the start action must be on screen and clickable`);
        }
        assert.notEqual(result.titleInsideBoard, false, `${label}: the overlay headline must not overflow the board`);
        if (width > 620) assert.equal(result.pageScrolls, false, `${label}: a landscape panel must not scroll`);
        await context.close();
      }
    }
    process.stdout.write("PASS Activity boards, headlines and start actions fit every Discord panel size\n");

    // Discord's layout-mode event puts picture-in-picture and grid tiles into a
    // board-only view even when the panel is not short.
    {
      const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
      const page = await context.newPage();
      await serve(page);
      await page.goto(`${origin}/?${activityQuery}`, { waitUntil: "load" });
      await page.evaluate(() => { document.documentElement.dataset.activityLayout = "pip"; });
      await page.waitForTimeout(100);
      const dockHidden = await page.evaluate(() => getComputedStyle(document.querySelector("#activityDock")).display === "none");
      const result = await measure(page, solo);
      assert.ok(dockHidden, "Picture-in-picture hides the Activity dock");
      assert.ok(result.boardVisible && result.size >= 300, `Picture-in-picture shows the board large (${result.size}px)`);
      await context.close();
    }
    process.stdout.write("PASS Discord's picture-in-picture layout shows only the board\n");

    // On the website the solo console fits below the header on laptop screens,
    // and both consoles are brought fully on screen when play starts.
    for (const [width, height] of [[1366, 768], [1440, 900]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await serve(page);
      await page.goto(`${origin}/`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const fits = await page.evaluate(() => {
        const rect = document.querySelector(".game-console").getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight + 1;
      });
      assert.ok(fits, `The solo console must fit a ${width}x${height} screen`);
      await page.goto(`${origin}/duel`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      await page.click("#aiStartButton");
      await page.waitForTimeout(900);
      const revealed = await page.evaluate(() => {
        const rect = document.querySelector(".duel-console").getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight + 1;
      });
      assert.ok(revealed, `Starting a duel at ${width}x${height} brings the whole arena on screen`);
      await context.close();
    }
    process.stdout.write("PASS website boards fit laptop screens and come into view when play starts\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
