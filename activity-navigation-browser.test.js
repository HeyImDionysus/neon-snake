"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch (error) {
  if (process.env.ACTIVITY_BROWSER_REQUIRED === "1") throw error;
  process.stdout.write("SKIP real Activity navigation gate (Playwright unavailable)\n");
  process.exit(0);
}

const shell = fs.readFileSync(path.join(__dirname, "public/activity-redirect.js"), "utf8");
const sdk = fs.readFileSync(path.join(__dirname, "public/activity-sdk.js"), "utf8");
const activityOrigin = "https://1531235601070686228.discordsays.com";
const activityQuery = "frame_id=fixture-frame&instance_id=fixture-instance&platform=desktop";

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://discord.com") {
        await route.fulfill({
          contentType: "text/html",
          body: `<script>
            window.handshakes = [];
            addEventListener("message", (event) => {
              if (event.origin === ${JSON.stringify(activityOrigin)} && event.data?.[0] === 0) {
                window.handshakes.push(event.data[1]);
              }
            });
          </script><iframe src="${activityOrigin}/?${activityQuery}"></iframe>`,
        });
        return;
      }
      if (url.pathname === "/activity-redirect.js" || url.pathname === "/activity-sdk.js") {
        await route.fulfill({ contentType: "text/javascript", body: url.pathname.includes("redirect") ? shell : sdk });
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<a id="solo" href="/" data-activity-route="solo">Solo</a>
          <a id="multiplayer" href="/duel" data-activity-route="multiplayer">Multiplayer</a>
          <script src="/activity-redirect.js"></script><script src="/activity-sdk.js"></script>`,
      });
    });
    await page.goto("https://discord.com/activity-fixture");
    await page.waitForFunction(() => window.handshakes.length === 1);
    const frame = page.frames().find((candidate) => candidate.url().startsWith(activityOrigin));
    assert.ok(frame, "Discord Activity iframe must initialize");
    for (const [link, expectedHandshakes] of [["#multiplayer", 2], ["#solo", 3]]) {
      await frame.locator(link).click();
      await page.waitForFunction((count) => window.handshakes.length === count, expectedHandshakes, { timeout: 2_000 });
      const query = new URL(frame.url()).searchParams;
      assert.equal(query.get("frame_id"), "fixture-frame");
      assert.equal(query.get("instance_id"), "fixture-instance");
      assert.equal(await frame.evaluate(() => document.referrer), "",
        "Internal Activity navigation must not direct SDK RPC at the child origin");
    }
    assert.equal(new URL(frame.url()).searchParams.has("type"), false);
    process.stdout.write("PASS real Discord SDK reaches its cross-origin parent after Solo → Multiplayer → Solo navigation\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
