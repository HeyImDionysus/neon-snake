// Fast static checks a contributor (or CI) runs before the test suite:
//   - every JavaScript file in the repository parses;
//   - the asset stamp matches the content it protects;
//   - the committed Discord SDK bundle matches its source (skipped with
//     --skip-bundle, e.g. when esbuild is not installed).
//
// Files are discovered rather than listed: the hand-maintained list in CI had
// drifted and silently skipped three browser scripts.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "wallpaper"]);
let failed = false;

function javascriptFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) found.push(...javascriptFiles(path.join(directory, entry.name)));
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      found.push(path.join(directory, entry.name));
    }
  }
  return found;
}

const files = javascriptFiles(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax error in ${path.relative(root, file)}:\n${result.stderr}\n`);
  }
}
process.stdout.write(`Parsed ${files.length} JavaScript files.\n`);

const stamp = spawnSync(process.execPath, [path.join(root, "scripts", "stamp-assets.mjs"), "--check"], { stdio: "inherit" });
if (stamp.status !== 0) failed = true;

if (!process.argv.includes("--skip-bundle")) {
  const bundlePath = path.join(root, "public", "activity-sdk.js");
  const committed = readFileSync(bundlePath);
  const committedTime = statSync(bundlePath).mtime;
  const build = spawnSync(process.execPath, [path.join(root, "scripts", "build-activity.mjs")], { stdio: "inherit" });
  if (build.status !== 0) {
    failed = true;
  } else if (!readFileSync(bundlePath).equals(committed)) {
    failed = true;
    process.stderr.write("public/activity-sdk.js is stale: run npm run build:activity and commit the result.\n");
  } else {
    process.stdout.write(`Discord SDK bundle matches activity/entry.js (committed ${committedTime.toISOString().slice(0, 10)}).\n`);
  }
}

if (failed) process.exitCode = 1;
