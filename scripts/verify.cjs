"use strict";

// Runs every *.test.js file with Node's built-in test runner. Files run in
// parallel, one process each. The performance gates run afterwards on their
// own, so parallel load can never push them over their frame budgets.
//
//   npm test              every test; Chromium and a Redis on 127.0.0.1:16379 required
//   npm run test:unit     only tests that need neither
//   node scripts/verify.cjs ai-quality    run the files whose names contain a filter

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const unitOnly = process.argv.includes("--unit");
const filters = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));

// Needs Chromium or a Redis server rather than only Node.
const EXTERNAL = /-browser(-performance)?\.test\.js$|^realtime-integration\.test\.js$/;
const SERIAL = new Set(["canvas-browser-performance.test.js", "canvas-performance.test.js"]);

let tests = fs.readdirSync(root).filter((file) => file.endsWith(".test.js")).sort();
if (unitOnly) tests = tests.filter((file) => !EXTERNAL.test(file));
if (filters.length) tests = tests.filter((file) => filters.some((filter) => file.includes(filter)));
if (!tests.length) {
  process.stderr.write("No test files matched.\n");
  process.exit(1);
}

const env = { ...process.env };
if (!unitOnly) {
  const browserCandidates = [
    process.env.CHROME_BIN,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    (() => {
      try {
        return require("playwright").chromium.executablePath();
      } catch {
        return "";
      }
    })(),
  ];
  const chrome = browserCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!chrome && tests.some((file) => EXTERNAL.test(file))) {
    throw new Error("Install Chromium with npx playwright install chromium, or set CHROME_BIN (or run npm run test:unit).");
  }
  Object.assign(env, {
    CHROME_BIN: chrome || "",
    ACTIVITY_BROWSER_REQUIRED: "1",
    CANVAS_BROWSER_REQUIRED: "1",
    PROFILE_BROWSER_REQUIRED: "1",
    PRODUCT_BROWSER_REQUIRED: "1",
    REALTIME_REDIS_REQUIRED: "1",
  });
}

// CI also writes a JUnit report so failures are annotated per test file.
const reporters = ["--test-reporter=spec", "--test-reporter-destination=stdout"];
if (process.env.TEST_JUNIT_PATH) {
  reporters.push("--test-reporter=junit", `--test-reporter-destination=${process.env.TEST_JUNIT_PATH}`);
}

function run(files, concurrency) {
  if (!files.length) return 0;
  const result = spawnSync(process.execPath, [
    "--test",
    `--test-concurrency=${concurrency}`,
    ...reporters,
    ...files,
  ], { cwd: root, stdio: "inherit", env });
  return result.status ?? 1;
}

const parallel = tests.filter((file) => !SERIAL.has(file));
const serial = tests.filter((file) => SERIAL.has(file));
const started = Date.now();
const failed = [run(parallel, Math.max(2, os.availableParallelism?.() ?? os.cpus().length)), run(serial, 1)]
  .some((status) => status !== 0);
process.stdout.write(`\n${tests.length} test files in ${((Date.now() - started) / 1000).toFixed(1)} s.\n`);
if (failed) process.exitCode = 1;
