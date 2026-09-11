// Derives the cache-busting asset stamp from the content of the files it
// protects, then writes it into every place that references it.
//
// Why this exists: Discord's Activity proxy serves our JavaScript and CSS with
// `Cache-Control: public, max-age=14400` regardless of what the origin sends, so
// a client can pair new HTML with four-hour-old scripts. The only defence is
// that the `?v=` stamp changes whenever a script changes. Maintaining that by
// hand already failed once - five commits changed scripts while the stamp stood
// still - so the stamp is computed instead of remembered.
//
//   node scripts/stamp-assets.mjs           rewrite the stamp in place
//   node scripts/stamp-assets.mjs --check   exit non-zero when it is stale

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

// Files whose content the stamp must track. HTML is deliberately excluded: it is
// served no-store on both surfaces, so changing copy must not invalidate every
// cached script.
const HASHED_EXTENSIONS = new Set([".js", ".css", ".webmanifest"]);

// The stamp appears inside the hashed files themselves, so it is normalised away
// before hashing to keep the computation a fixed point.
const STAMP_REFERENCE = /\?v=[0-9a-z]+/g;
const CACHE_NAME_REFERENCE = /neon-snake-shell-[0-9a-z]+/g;

const REWRITTEN_FILES = [
  "public/index.html",
  "public/duel.html",
  "public/sw.js",
];

function listHashedFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listHashedFiles(absolute));
    else if (HASHED_EXTENSIONS.has(path.extname(entry.name))) found.push(absolute);
  }
  return found;
}

function normalize(text) {
  return text.replace(STAMP_REFERENCE, "?v=*").replace(CACHE_NAME_REFERENCE, "neon-snake-shell-*");
}

// Exported separately from computeStamp so a test can prove the stamp tracks
// content without writing to the working tree.
export function computeStampFrom(files) {
  const manifest = files
    .map(([name, content]) => [
      name,
      createHash("sha256").update(normalize(content)).digest("hex"),
    ])
    .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
    .map(([name, digest]) => `${name}:${digest}`)
    .join("\n");
  return createHash("sha256").update(manifest).digest("hex").slice(0, 10);
}

export function hashedFiles() {
  return listHashedFiles(publicDir).map((absolute) => [
    path.relative(publicDir, absolute).split(path.sep).join("/"),
    readFileSync(absolute, "utf8"),
  ]);
}

export function computeStamp() {
  return computeStampFrom(hashedFiles());
}

export function readStamp() {
  const shell = readFileSync(path.join(root, "public", "sw.js"), "utf8");
  const match = shell.match(/const CACHE_NAME = "neon-snake-shell-([0-9a-z]+)";/);
  if (!match) throw new Error("public/sw.js does not declare a stamped CACHE_NAME.");
  return match[1];
}

export function applyStamp(stamp) {
  const changed = [];
  for (const relative of REWRITTEN_FILES) {
    const absolute = path.join(root, relative);
    const before = readFileSync(absolute, "utf8");
    const after = before
      .replace(STAMP_REFERENCE, `?v=${stamp}`)
      .replace(CACHE_NAME_REFERENCE, `neon-snake-shell-${stamp}`);
    if (after !== before) {
      writeFileSync(absolute, after);
      changed.push(relative);
    }
  }
  return changed;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const expected = computeStamp();
  const current = readStamp();
  if (process.argv.includes("--check")) {
    if (current !== expected) {
      process.stderr.write(
        `Asset stamp is stale: files reference v=${current} but their content hashes to v=${expected}.\n`
        + "Run: npm run stamp\n",
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`Asset stamp v=${current} matches the content it protects.\n`);
    }
  } else {
    const changed = applyStamp(expected);
    process.stdout.write(
      changed.length
        ? `Asset stamp updated to v=${expected}:\n${changed.map((name) => `  ${name}\n`).join("")}`
        : `Asset stamp v=${expected} already current.\n`,
    );
  }
}
