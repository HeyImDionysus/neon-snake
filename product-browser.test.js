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
const index = read("public", "index.html");
const duel = read("public", "duel.html");
const styles = read("public", "styles.css");
const duelStyles = read("public", "duel.css");
const activityRedirect = read("public", "activity-redirect.js");
const activityServiceWorkerStub = String.raw`
window.activityUnregisters = 0;
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: {
    controller: null,
    async getRegistrations() {
      return [{
        async unregister() {
          window.activityUnregisters += 1;
          return true;
        },
      }];
    },
  },
});
`;
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

const activityBrowserTest = String.raw`
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  document.querySelector("#activityContext").hidden = false;
  const legal = document.querySelector(".activity-legal");
  const terms = legal.querySelector('a[href="/terms.html"]');
  const privacy = legal.querySelector('a[href="/privacy.html"]');
  const solo = document.querySelector("#activitySoloLink");
  const retry = document.querySelector("#activityContextRetry");
  const soloUrl = new URL(solo.href);
  const resultNode = document.querySelector("#activityResult");
  retry.hidden = false;
  resultNode.dataset.json = encodeURIComponent(JSON.stringify({
    legalVisible: getComputedStyle(legal).display !== "none",
    termsVisible: getComputedStyle(terms).display !== "none",
    privacyVisible: getComputedStyle(privacy).display !== "none",
    termsTarget: terms.target,
    privacyTarget: privacy.target,
    termsHeight: Math.round(terms.getBoundingClientRect().height),
    privacyHeight: Math.round(privacy.getBoundingClientRect().height),
    soloVisible: getComputedStyle(solo).display !== "none",
    soloHeight: Math.round(solo.getBoundingClientRect().height),
    retryVisible: getComputedStyle(retry).display !== "none",
    retryHeight: Math.round(retry.getBoundingClientRect().height),
    soloFrame: soloUrl.searchParams.get("frame_id"),
    soloInstance: soloUrl.searchParams.get("instance_id"),
  }));
  resultNode.textContent = "complete";
})();
`;

const activityIndexBrowserTest = String.raw`
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  const dock = document.querySelector("#activityDock");
  const multiplayer = document.querySelector('[data-activity-route="multiplayer"]');
  const multiplayerUrl = new URL(multiplayer.href);
  const initial = {
    inviteDisabled: document.querySelector("#activityDockInvite").disabled,
    retryHidden: document.querySelector("#activityDockRetry").hidden,
  };
  let retried = 0;
  let invited = 0;
  window.NeonSnakeActivity = {
    retry() { retried += 1; },
    async invite() { invited += 1; },
    async openExternal() { return true; },
  };
  dispatchEvent(new CustomEvent("neon-activity-error", {
    detail: { message: "Synthetic timeout." },
  }));
  const error = {
    state: dock.dataset.state,
    retryHidden: document.querySelector("#activityDockRetry").hidden,
    title: document.querySelector("#activityDockTitle").textContent,
  };
  document.querySelector("#activityDockRetry").click();
  dispatchEvent(new CustomEvent("neon-activity-ready", {
    detail: { roomCode: "ABC234" },
  }));
  document.querySelector("#activityDockInvite").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const resultNode = document.querySelector("#activityIndexResult");
  resultNode.dataset.json = encodeURIComponent(JSON.stringify({
    dockVisible: getComputedStyle(dock).display !== "none",
    gameVisible: getComputedStyle(document.querySelector(".game-column")).display !== "none",
    controlsVisible: getComputedStyle(document.querySelector(".control-deck")).display !== "none",
    leaderboardHidden: getComputedStyle(document.querySelector(".public-board")).display === "none",
    nextMovesHidden: getComputedStyle(document.querySelector(".next-moves")).display === "none",
    modes: [...document.querySelectorAll('input[name="mode"]')].map((input) => input.value),
    initial,
    error,
    connectedState: dock.dataset.state,
    inviteDisabled: document.querySelector("#activityDockInvite").disabled,
    retried,
    invited,
    routeFrame: multiplayerUrl.searchParams.get("frame_id"),
    routeInstance: multiplayerUrl.searchParams.get("instance_id"),
    routeType: multiplayerUrl.searchParams.get("type"),
    websiteVisible: getComputedStyle(document.querySelector("#activityWebsiteLink")).display !== "none",
    wallpapersVisible: getComputedStyle(document.querySelector("#activityWallpapersLink")).display !== "none",
    websiteHost: new URL(document.querySelector("#activityWebsiteLink").href).host,
    activityUnregisters: window.activityUnregisters,
  }));
  resultNode.textContent = "complete";
})();
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

const activityDocumentSource = duel
  .replace(/<link\b[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
  .replace("</head>", `<style>${styles}\n${duelStyles}</style></head>`)
  .replace(
    "</body>",
    `<pre id="activityResult" data-json=""></pre>`
      + `<script>${escapeScript(activityRedirect)}</script>`
      + `<script>${escapeScript(activityBrowserTest)}</script>`
      + "</body>",
  );

const activityIndexDocumentSource = index
  .replace(/<link\b[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
  .replace("</head>", `<style>${styles}</style></head>`)
  .replace(
    "</body>",
    `<pre id="activityIndexResult" data-json=""></pre>`
      + `<script>${escapeScript(activityServiceWorkerStub)}</script>`
      + `<script>${escapeScript(activityRedirect)}</script>`
      + `<script>${escapeScript(activityIndexBrowserTest)}</script>`
      + "</body>",
  );

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "neon-product-"));
const htmlPath = path.join(temporaryDirectory, "product-browser.html");
const activityHtmlPath = path.join(temporaryDirectory, "activity-browser.html");
const activityIndexHtmlPath = path.join(temporaryDirectory, "activity-index-browser.html");
fs.writeFileSync(htmlPath, documentSource);
fs.writeFileSync(activityHtmlPath, activityDocumentSource);
fs.writeFileSync(activityIndexHtmlPath, activityIndexDocumentSource);

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

  const activityBrowser = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=390,844",
    "--virtual-time-budget=1000",
    "--dump-dom",
    `${pathToFileURL(activityHtmlPath).href}?frame_id=duel-frame&instance_id=duel-instance&type=live`,
  ], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(
    activityBrowser.status,
    0,
    `Activity Chromium failed (${activityBrowser.status}): ${activityBrowser.stderr.slice(-2000)}`,
  );
  const activityEncoded = activityBrowser.stdout.match(/id="activityResult" data-json="([^"]+)"/)?.[1];
  assert.ok(activityEncoded, `Missing Activity browser result: ${activityBrowser.stdout.slice(-3000)}`);
  const activityResult = JSON.parse(decodeURIComponent(activityEncoded.replaceAll("&amp;", "&")));
  assert.deepEqual(activityResult, {
    legalVisible: true,
    termsVisible: true,
    privacyVisible: true,
    termsTarget: "_blank",
    privacyTarget: "_blank",
    termsHeight: 44,
    privacyHeight: 44,
    soloVisible: true,
    soloHeight: 44,
    retryVisible: true,
    retryHeight: 44,
    soloFrame: "duel-frame",
    soloInstance: "duel-instance",
  });

  const activityIndexBrowser = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,800",
    "--virtual-time-budget=1000",
    "--dump-dom",
    `${pathToFileURL(activityIndexHtmlPath).href}?frame_id=test-frame&instance_id=test-instance`,
  ], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(
    activityIndexBrowser.status,
    0,
    `Activity index Chromium failed (${activityIndexBrowser.status}): ${activityIndexBrowser.stderr.slice(-2000)}`,
  );
  const activityIndexEncoded = activityIndexBrowser.stdout
    .match(/id="activityIndexResult" data-json="([^"]+)"/)?.[1];
  assert.ok(
    activityIndexEncoded,
    `Missing Activity index browser result: ${activityIndexBrowser.stdout.slice(-3000)}`,
  );
  const activityIndexResult = JSON.parse(
    decodeURIComponent(activityIndexEncoded.replaceAll("&amp;", "&")),
  );
  assert.deepEqual(activityIndexResult, {
    dockVisible: true,
    gameVisible: true,
    controlsVisible: true,
    leaderboardHidden: true,
    nextMovesHidden: true,
    modes: ["classic", "portal", "rush", "canvas"],
    initial: {
      inviteDisabled: true,
      retryHidden: true,
    },
    error: {
      state: "error",
      retryHidden: false,
      title: "SOLO READY · DISCORD LINK OFFLINE",
    },
    connectedState: "connected",
    inviteDisabled: false,
    retried: 1,
    invited: 1,
    routeFrame: "test-frame",
    routeInstance: "test-instance",
    routeType: "live",
    websiteVisible: true,
    wallpapersVisible: true,
    websiteHost: "neon-snake-green-tau.vercel.app",
    activityUnregisters: 1,
  });
  process.stdout.write("PASS mobile site and embedded Activity controls, policy links, and download feedback work in real browsers\n");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
