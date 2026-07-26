"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const publicRoot = path.join(root, "public");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, "manifest.webmanifest"), "utf8"));
const serviceWorker = fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "verify.yml"), "utf8");

function publicPath(urlPath) {
  if (urlPath === "/") return path.join(publicRoot, "index.html");
  return path.join(publicRoot, urlPath.replace(/^\/+/, ""));
}

function localReferences(htmlFile) {
  const html = fs.readFileSync(htmlFile, "utf8");
  return [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("#") && !reference.includes("://"));
}

function pngDimensions(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `Invalid PNG: ${file}`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const tests = [
  ["Vercel publishes only the dependency-free public directory", () => {
    assert.equal(vercel.outputDirectory, "public");
    assert.equal(vercel.cleanUrls, true);
    assert.equal(fs.existsSync(path.join(root, "package.json")), false);
    assert.equal(fs.existsSync(path.join(publicRoot, "README.md")), false);
    assert.equal(fs.existsSync(path.join(publicRoot, "game-logic.test.js")), false);
  }],
  ["every cached app-shell URL resolves to a public file", () => {
    const shell = serviceWorker.match(/const APP_SHELL = \[([^]*?)\];/);
    assert.ok(shell, "Expected an APP_SHELL declaration");
    const urls = [...shell[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.equal(urls.length, new Set(urls).size);
    assert.ok(urls.includes("/room-transport.js"));
    assert.ok(urls.includes("/duel.html"));
    assert.ok(urls.includes("/assets/icon-180.png"));
    assert.ok(urls.includes("/assets/icon-192.png"));
    assert.ok(urls.includes("/assets/icon-512.png"));
    urls.forEach((urlPath) => {
      assert.equal(fs.existsSync(publicPath(urlPath)), true, `Missing app-shell file: ${urlPath}`);
    });
    ["index.html", "duel.html"].forEach((name) => {
      const htmlFile = path.join(publicRoot, name);
      localReferences(htmlFile).forEach((reference) => {
        const urlPath = new URL(reference, `https://neon-snake.invalid/${name}`).pathname;
        assert.ok(urls.includes(urlPath), `Offline shell omits ${reference} from ${name}`);
      });
    });
  }],
  ["the install manifest includes browser-compatible raster icons", () => {
    const icons = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
    assert.equal(icons.get("192x192")?.src, "/assets/icon-192.png");
    assert.equal(icons.get("192x192")?.type, "image/png");
    assert.equal(icons.get("512x512")?.src, "/assets/icon-512.png");
    assert.equal(icons.get("512x512")?.type, "image/png");
    assert.deepEqual(pngDimensions(publicPath("/assets/icon-180.png")), { width: 180, height: 180 });
    assert.deepEqual(pngDimensions(publicPath("/assets/icon-192.png")), { width: 192, height: 192 });
    assert.deepEqual(pngDimensions(publicPath("/assets/icon-512.png")), { width: 512, height: 512 });
    manifest.icons.forEach((icon) => {
      assert.equal(fs.existsSync(publicPath(icon.src)), true, `Missing manifest icon: ${icon.src}`);
    });
    ["index.html", "duel.html"].forEach((name) => {
      const html = fs.readFileSync(path.join(publicRoot, name), "utf8");
      assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
      assert.match(html, /rel="apple-touch-icon" href="\/assets\/icon-180\.png"/);
    });
  }],
  ["service-worker upgrades replace stale caches and preserve both offline routes", () => {
    assert.match(serviceWorker, /self\.skipWaiting\(\)/);
    assert.match(serviceWorker, /self\.clients\.claim\(\)/);
    assert.match(serviceWorker, /keys\.filter\(\(key\) => key !== CACHE_NAME\)/);
    assert.match(serviceWorker, /await cache\.put\(event\.request, response\.clone\(\)\)/);
    assert.match(serviceWorker, /quota or unsupported-response failure/i);
    assert.match(serviceWorker, /requestUrl\.pathname\.startsWith\("\/duel"\) \? "\/duel\.html" : "\/index\.html"/);
  }],
  ["every local HTML asset and navigation target stays inside public", () => {
    ["index.html", "duel.html"].forEach((name) => {
      const htmlFile = path.join(publicRoot, name);
      localReferences(htmlFile).forEach((reference) => {
        const pathname = reference.split(/[?#]/, 1)[0];
        const target = pathname === "./"
          ? path.join(publicRoot, "index.html")
          : pathname.startsWith("/")
            ? publicPath(pathname)
            : path.resolve(path.dirname(htmlFile), pathname);
        const relative = path.relative(publicRoot, target);
        assert.ok(
          target === publicRoot
          || relative && !relative.startsWith("..") && !path.isAbsolute(relative),
          `Reference escapes public in ${name}: ${reference}`,
        );
        assert.equal(fs.existsSync(target), true, `Broken local reference in ${name}: ${reference}`);
      });
    });
  }],
  ["the public response contract keeps restrictive browser boundaries", () => {
    const globalRule = vercel.headers.find((rule) => rule.source === "/(.*)");
    assert.ok(globalRule, "Expected a global security-header rule");
    const headers = Object.fromEntries(globalRule.headers.map(({ key, value }) => [key, value]));
    assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
    assert.match(headers["Content-Security-Policy"], /connect-src 'self'/);
    assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-inline|unsafe-eval/);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.match(headers["Permissions-Policy"], /camera=\(\)/);
    assert.match(headers["Permissions-Policy"], /microphone=\(\)/);
  }],
  ["deployment docs preserve the multiplayer truth boundary", () => {
    assert.match(readme, /SAME-BROWSER CANARY/);
    assert.match(readme, /@vercel\/functions/);
    assert.match(readme, /Redis/);
    assert.match(readme, /cross-instance/i);
    assert.match(readme, /dependency-free/i);
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
  }],
  ["hosted verification includes the deterministic AI quality benchmark", () => {
    assert.match(workflow, /node ai-quality\.test\.js/);
    assert.match(workflow, /node service-worker\.test\.js/);
    assert.match(readme, /ai-quality\.test\.js/);
    assert.match(readme, /service-worker\.test\.js/);
    assert.match(readme, /Hamiltonian safety arc/);
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic deployment-contract tests passed.\n`);
