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
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic deployment-contract tests passed.\n`);
