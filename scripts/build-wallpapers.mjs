import { chmod, cp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `--out <dir>` builds elsewhere, which is how the tests rebuild the archive
// to prove the one on the downloads page matches the source.
const outFlag = process.argv.indexOf("--out");
const outputRoot = outFlag > 0 ? path.resolve(process.argv[outFlag + 1]) : path.join(root, "dist", "wallpapers");
const windowsRoot = path.join(outputRoot, "neon-snake-lively");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(windowsRoot, { recursive: true });

await Promise.all([
  cp(path.join(root, "wallpaper", "windows", "LivelyInfo.json"), path.join(windowsRoot, "LivelyInfo.json")),
  cp(path.join(root, "wallpaper", "windows", "LivelyProperties.json"), path.join(windowsRoot, "LivelyProperties.json")),
  cp(path.join(root, "public", "game-logic.js"), path.join(windowsRoot, "game-logic.js")),
  cp(path.join(root, "public", "wallpaper-engine.js"), path.join(windowsRoot, "wallpaper-engine.js")),
  cp(path.join(root, "public", "wallpaper.js"), path.join(windowsRoot, "wallpaper.js")),
  cp(path.join(root, "public", "wallpaper.css"), path.join(windowsRoot, "wallpaper.css")),
  cp(path.join(root, "wallpaper", "windows", "thumbnail.png"), path.join(windowsRoot, "thumbnail.png")),
]);

const sourceHtml = await readFile(path.join(root, "public", "wallpaper.html"), "utf8");
const packagedHtml = sourceHtml
  .replace("<title>Neon Snake — Autonomous Wallpaper</title>", "<title>Neon Snake — Lively Wallpaper</title>");
await writeFile(path.join(windowsRoot, "index.html"), packagedHtml);

const packageFiles = (await readdir(windowsRoot)).sort();
const reproducibleTimestamp = new Date("2026-01-01T00:00:00.000Z");
// zip records permission bits, so a group-writable checkout used to produce a
// different archive from the same source. Fixed modes and times make it byte
// for byte reproducible.
await Promise.all(packageFiles.map(async (file) => {
  await chmod(path.join(windowsRoot, file), 0o644);
  await utimes(path.join(windowsRoot, file), reproducibleTimestamp, reproducibleTimestamp);
}));

const archive = path.join(outputRoot, "Neon-Snake-Lively.zip");
const zip = spawnSync("zip", ["-q", "-X", archive, ...packageFiles], {
  cwd: windowsRoot,
  encoding: "utf8",
  env: { ...process.env, TZ: "UTC" },
});
if (zip.status !== 0) {
  throw new Error(`Could not build the Lively archive: ${zip.stderr || "zip failed"}`);
}

process.stdout.write(`${archive}\n`);
