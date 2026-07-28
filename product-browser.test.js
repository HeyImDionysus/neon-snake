"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = __dirname;

function executable(name) {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : "";
}

function chromeExecutable() {
  const configured = process.env.CHROME_BIN;
  if (configured && fs.existsSync(configured)) return configured;
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map(executable)
    .find(Boolean);
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.PRODUCT_BROWSER_REQUIRED === "1") {
    throw new Error("A Chromium executable is required for the product interaction gate.");
  }
  process.stdout.write("SKIP real product interaction gate (Chromium unavailable)\n");
  process.exit(0);
}

const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const escapeScript = (source) => source.replace(/<\/script/gi, "<\\/script");
const downloads = read("public", "downloads.html");
const styles = read("public", "styles.css");
const scripts = [
  read("public", "site-shell.js"),
  read("public", "game-logic.js"),
  read("public", "wallpaper-engine.js"),
  read("public", "wallpaper.js"),
  read("public", "downloads.js"),
];

const browserTest = String.raw`
(async () => {
  const resultNode = document.querySelector("#result");
  await new Promise((resolve) => setTimeout(resolve, 80));

  const menu = document.querySelector(".site-menu-toggle");
  const navigation = document.querySelector("#primaryNavigation");
  menu.click();
  const menuOpen = {
    expanded: menu.getAttribute("aria-expanded"),
    bodyClass: document.body.classList.contains("site-menu-open"),
    navigationHidden: navigation.getAttribute("aria-hidden"),
    navigationInert: navigation.inert,
  };
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const menuClosed = {
    expanded: menu.getAttribute("aria-expanded"),
    bodyClass: document.body.classList.contains("site-menu-open"),
    navigationHidden: navigation.getAttribute("aria-hidden"),
    navigationInert: navigation.inert,
  };

  document.querySelector('[data-wallpaper-palette="ultraviolet"]').click();
  document.querySelector('[data-wallpaper-mode="portal"]').click();
  const pace = document.querySelector("#wallpaperPace");
  const glow = document.querySelector("#wallpaperGlow");
  pace.value = "200";
  pace.dispatchEvent(new Event("input", { bubbles: true }));
  glow.value = "35";
  glow.dispatchEvent(new Event("input", { bubbles: true }));
  const windowsDownload = document.querySelector('[data-wallpaper-download="Windows"]');
  windowsDownload.addEventListener("click", (event) => event.preventDefault(), { once: true });
  windowsDownload.click();

  resultNode.dataset.json = encodeURIComponent(JSON.stringify({
    menuOpen,
    menuClosed,
    preview: {
      settings: window.NeonSnakeWallpaperPreview.settings(),
      palettePressed: document.querySelector('[data-wallpaper-palette="ultraviolet"]').getAttribute("aria-pressed"),
      modePressed: document.querySelector('[data-wallpaper-mode="portal"]').getAttribute("aria-pressed"),
      paceOutput: document.querySelector("#wallpaperPaceOutput").textContent,
      glowOutput: document.querySelector("#wallpaperGlowOutput").textContent,
      status: document.querySelector("#wallpaperPreviewStatus").textContent,
    },
    download: {
      status: document.querySelector("#windowsDownloadStatus").textContent,
      started: windowsDownload.closest(".download-platform").classList.contains("download-started"),
    },
    legalFooter: {
      containerVisible: getComputedStyle(document.querySelector(".site-footer span:last-child")).display !== "none",
      termsVisible: getComputedStyle(document.querySelector('.site-footer a[href="terms.html"]')).display !== "none",
      privacyVisible: getComputedStyle(document.querySelector('.site-footer a[href="privacy.html"]')).display !== "none",
    },
  }));
  resultNode.textContent = "complete";
})().catch((error) => {
  const resultNode = document.querySelector("#result");
  resultNode.dataset.error = error.stack || error.message;
  resultNode.textContent = "failed";
});
`;

const documentSource = downloads
  .replace(/<link\b[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
  .replace("</head>", `<style>${styles}</style></head>`)
  .replace(
    "</body>",
    `<pre id="result" data-json=""></pre>`
      + scripts.map((source) => `<script>${escapeScript(source)}</script>`).join("")
      + `<script>${escapeScript(browserTest)}</script>`
      + "</body>",
  );

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "neon-product-"));
const htmlPath = path.join(temporaryDirectory, "product-browser.html");
fs.writeFileSync(htmlPath, documentSource);

try {
  const browser = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=390,844",
    "--virtual-time-budget=3000",
    "--dump-dom",
    pathToFileURL(htmlPath).href,
  ], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(browser.status, 0, `Chromium failed (${browser.status}): ${browser.stderr.slice(-2000)}`);
  const encoded = browser.stdout.match(/id="result" data-json="([^"]+)"/)?.[1];
  assert.ok(encoded, `Missing product browser result: ${browser.stdout.slice(-3000)}`);
  const result = JSON.parse(decodeURIComponent(encoded.replaceAll("&amp;", "&")));
  assert.deepEqual(result.menuOpen, {
    expanded: "true",
    bodyClass: true,
    navigationHidden: "false",
    navigationInert: false,
  });
  assert.deepEqual(result.menuClosed, {
    expanded: "false",
    bodyClass: false,
    navigationHidden: "true",
    navigationInert: true,
  });
  assert.deepEqual(result.preview.settings, {
    fps: 24,
    pace: 200,
    mode: "portal",
    palette: "ultraviolet",
    glow: 0.35,
    mark: true,
  });
  assert.equal(result.preview.palettePressed, "true");
  assert.equal(result.preview.modePressed, "true");
  assert.equal(result.preview.paceOutput, "CALM");
  assert.equal(result.preview.glowOutput, "35%");
  assert.equal(result.preview.status, "ULTRAVIOLET · WRAP · CALM");
  assert.equal(result.download.status, "WINDOWS DOWNLOAD STARTED · CHECK YOUR BROWSER DOWNLOADS");
  assert.equal(result.download.started, true);
  assert.deepEqual(result.legalFooter, {
    containerVisible: true,
    termsVisible: true,
    privacyVisible: true,
  });
  process.stdout.write("PASS mobile navigation, wallpaper controls, legal links, and download feedback work in a real browser\n");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
