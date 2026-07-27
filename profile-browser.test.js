"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = __dirname;
const profileHtml = fs.readFileSync(path.join(root, "public", "profile.html"), "utf8");
const profileConfig = fs.readFileSync(path.join(root, "public", "profile-config.js"), "utf8");
const profileScript = fs.readFileSync(path.join(root, "public", "profile.js"), "utf8");

function executable(name) {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], {
    encoding: "utf8",
  });
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
  if (process.env.PROFILE_BROWSER_REQUIRED === "1") {
    throw new Error("A Chromium executable is required for the profile interaction gate.");
  }
  process.stdout.write("SKIP real profile interaction gate (Chromium unavailable)\n");
  process.exit(0);
}

const profile = {
  username: "verified.player",
  displayName: "Verified Player",
  avatarUrl: "",
  callsign: "GRID RUNNER",
  bio: "Original bio",
  accent: "acid",
  favoriteMode: "classic",
  snakeStyle: "signal",
  stats: { wins: 8, losses: 3, draws: 1, matches: 12 },
  online: true,
};

const browserTest = String.raw`
const resultNode = document.querySelector("#result");
const callsign = document.querySelector("#callsignInput");
const bio = document.querySelector("#bioInput");
const editor = document.querySelector("#profileEditor");
const save = editor.querySelector("button[type=submit]");
const reset = editor.querySelector("button[type=reset]");

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Profile page did not settle.");
}

(async () => {
  await waitUntil(() => !document.querySelector("#profileCard").hidden);
  const initial = {
    editorVisible: !editor.hidden,
    saveDisabled: save.disabled,
    preview: document.querySelector("#profilePreviewCallsign").textContent,
  };

  callsign.value = "NIGHT CIRCUIT";
  callsign.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('input[name="accent"][value="magenta"]').click();
  document.querySelector('input[name="favoriteMode"][value="live"]').click();
  document.querySelector('input[name="snakeStyle"][value="glass"]').click();
  const previewed = {
    callsign: document.querySelector("#profilePreviewCallsign").textContent,
    accent: document.body.dataset.profileAccent,
    mode: document.querySelector("#profileFavoriteMode").textContent,
    snake: document.body.dataset.snakeStyle,
    dirty: document.querySelector("#profileDraftState").textContent,
    saveEnabled: !save.disabled,
    resetEnabled: !reset.disabled,
  };

  reset.click();
  const resetState = {
    callsign: callsign.value,
    accent: document.body.dataset.profileAccent,
    mode: document.querySelector("#profileFavoriteMode").textContent,
    snake: document.body.dataset.snakeStyle,
    saveDisabled: save.disabled,
  };

  callsign.value = "PUBLIC SIGNAL";
  callsign.dispatchEvent(new Event("input", { bubbles: true }));
  bio.value = "Saved from the actual browser interaction gate.";
  bio.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('input[name="accent"][value="cyan"]').click();
  document.querySelector('input[name="favoriteMode"][value="portal"]').click();
  document.querySelector('input[name="snakeStyle"][value="spectral"]').click();
  save.click();
  await waitUntil(() => window.__patchPayload);
  await waitUntil(() => document.querySelector("#profileSaveStatus").textContent.includes("PUBLISHED"));

  resultNode.dataset.json = encodeURIComponent(JSON.stringify({
    initial,
    previewed,
    resetState,
    saved: {
      payload: window.__patchPayload,
      status: document.querySelector("#profileSaveStatus").textContent,
      saveDisabled: save.disabled,
      draftState: document.querySelector("#profileDraftState").textContent,
    },
  }));
  resultNode.textContent = "complete";
})().catch((error) => {
  resultNode.dataset.error = error.stack || error.message;
  resultNode.textContent = "failed";
});
`;

const fetchStub = `
window.__patchPayload = null;
window.fetch = async (_url, options = {}) => {
  if (options.method === "PATCH") {
    window.__patchPayload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ profile: { ...${JSON.stringify(profile)}, ...window.__patchPayload } }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ profile: ${JSON.stringify(profile)}, editable: true }),
  };
};
`;

const documentSource = profileHtml
  .replace(/<link\b[^>]*>/g, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
  .replace(
    "</body>",
    `<pre id="result" data-json=""></pre>`
      + `<script>${fetchStub}</script>`
      + `<script>${profileConfig.replace(/<\/script/gi, "<\\/script")}</script>`
      + `<script>${profileScript.replace(/<\/script/gi, "<\\/script")}</script>`
      + `<script>${browserTest.replace(/<\/script/gi, "<\\/script")}</script>`
      + "</body>",
  );

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "neon-profile-"));
const htmlPath = path.join(temporaryDirectory, "profile-browser.html");
fs.writeFileSync(htmlPath, documentSource);

try {
  const browser = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--virtual-time-budget=3000",
    "--dump-dom",
    pathToFileURL(htmlPath).href,
  ], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(
    browser.status,
    0,
    `Chromium failed (${browser.status}): ${browser.stderr.slice(-2000)}`,
  );
  const encoded = browser.stdout.match(/id="result" data-json="([^"]+)"/)?.[1];
  assert.ok(
    encoded,
    `Missing browser profile result: ${browser.stdout.slice(-3000)}`,
  );
  const result = JSON.parse(decodeURIComponent(encoded.replaceAll("&amp;", "&")));
  assert.deepEqual(result.initial, {
    editorVisible: true,
    saveDisabled: true,
    preview: "GRID RUNNER",
  });
  assert.deepEqual(result.previewed, {
    callsign: "NIGHT CIRCUIT",
    accent: "magenta",
    mode: "LIVE",
    snake: "glass",
    dirty: "UNSAVED PREVIEW",
    saveEnabled: true,
    resetEnabled: true,
  });
  assert.deepEqual(result.resetState, {
    callsign: "GRID RUNNER",
    accent: "acid",
    mode: "CLASSIC",
    snake: "signal",
    saveDisabled: true,
  });
  assert.deepEqual(result.saved.payload, {
    callsign: "PUBLIC SIGNAL",
    bio: "Saved from the actual browser interaction gate.",
    accent: "cyan",
    favoriteMode: "portal",
    snakeStyle: "spectral",
  });
  assert.match(result.saved.status, /PUBLISHED/);
  assert.equal(result.saved.saveDisabled, true);
  assert.equal(result.saved.draftState, "SAVED");
  process.stdout.write("PASS profile controls preview, reset, and publish in a real browser\n");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
