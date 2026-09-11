"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const browserCandidates = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  require("playwright").chromium.executablePath(),
];
const chrome = browserCandidates.find((candidate) => candidate && fs.existsSync(candidate));
if (!chrome) throw new Error("Install Chromium with npx playwright install chromium, or set CHROME_BIN.");

const tests = fs.readdirSync(root).filter((file) => file.endsWith(".test.js")).sort();
const failures = [];
for (const file of tests) {
  process.stdout.write(`\nRunning ${file}\n`);
  const result = spawnSync(process.execPath, [path.join(root, file)], {
    cwd: root,
    stdio: "inherit",
    timeout: 300_000,
    env: {
      ...process.env,
      CHROME_BIN: chrome,
      ACTIVITY_BROWSER_REQUIRED: "1",
      CANVAS_BROWSER_REQUIRED: "1",
      PROFILE_BROWSER_REQUIRED: "1",
      PRODUCT_BROWSER_REQUIRED: "1",
      REALTIME_REDIS_REQUIRED: "1",
    },
  });
  if (result.status !== 0 || result.error) {
    failures.push(file);
    process.stderr.write(`${file} failed: ${result.error?.message || `exit ${result.status}`}\n`);
  }
}
process.stdout.write(`\n${tests.length - failures.length}/${tests.length} test files passed.\n`);
if (failures.length) {
  process.stderr.write(`Failed: ${failures.join(", ")}\n`);
  process.exitCode = 1;
}
