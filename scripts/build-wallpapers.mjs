import { cp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "dist", "wallpapers");
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
  cp(path.join(root, "public", "assets", "icon-512.png"), path.join(windowsRoot, "thumbnail.png")),
]);

const sourceHtml = await readFile(path.join(root, "public", "wallpaper.html"), "utf8");
const packagedHtml = sourceHtml
  .replace("<title>Neon Snake — Autonomous Wallpaper</title>", "<title>Neon Snake — Lively Wallpaper</title>");
await writeFile(path.join(windowsRoot, "index.html"), packagedHtml);

const packageFiles = (await readdir(windowsRoot)).sort();
const reproducibleTimestamp = new Date("2026-01-01T00:00:00.000Z");
await Promise.all(packageFiles.map((file) => (
  utimes(path.join(windowsRoot, file), reproducibleTimestamp, reproducibleTimestamp)
)));

const archive = path.join(outputRoot, "Neon-Snake-Lively.zip");
const zip = spawnSync("zip", ["-q", "-X", archive, ...packageFiles], {
  cwd: windowsRoot,
  encoding: "utf8",
});
if (zip.status !== 0) {
  throw new Error(`Could not build the Lively archive: ${zip.stderr || "zip failed"}`);
}

process.stdout.write(`${archive}\n`);
