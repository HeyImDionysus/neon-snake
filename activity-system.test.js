"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createAccountHandler,
  createSessionReader,
} = require("./server/account-core.cjs");
const { requestIsAllowedOrigin } = require("./server/realtime-core.cjs");

const root = __dirname;
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const entry = read("activity", "entry.js");
const activityTokenApi = read("api", "activity", "token.mjs");
const redirect = read("public", "activity-redirect.js");
const activityBoot = read("public", "activity-boot.js");
const activityBootCss = read("public", "activity-boot.css");
const indexHtml = read("public", "index.html");
const game = read("public", "game.js");
const account = read("public", "account.js");
const signalField = read("public", "signal-field.js");
const styles = read("public", "styles.css");
const duel = read("public", "duel.js");
const duelHtml = read("public", "duel.html");
const duelCss = read("public", "duel.css");
const vercel = JSON.parse(read("vercel.json"));
const manifest = JSON.parse(read("package.json"));

function responseHarness() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    },
  };
}

function request(url, {
  method = "GET",
  origin = "https://1531235601070686228.discordsays.com",
  body,
  cookie = "",
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: "neon-snake-green-tau.vercel.app",
      origin,
      cookie,
      "x-forwarded-proto": "https",
    },
  };
}

(async () => {
  assert.equal(manifest.devDependencies["@discord/embedded-app-sdk"], "2.5.0");
  assert.equal(manifest.devDependencies.esbuild, "0.25.12");
  assert.match(entry, /new DiscordSDK\(CLIENT_ID\)/);
  assert.match(entry, /withTimeout/);
  assert.match(entry, /neon-activity-stage/);
  assert.match(entry, /retry/);
  assert.match(entry, /TOKEN_TIMEOUT = 16_000/);
  assert.match(entry, /EXTERNAL_LINK_TIMEOUT = 2_500/);
  assert.match(activityTokenApi, /from "\.\.\/\.\.\/server\/account-core\.cjs"/);
  assert.match(activityTokenApi, /request\.url = "\/api\/activity\/token"/);
  assert.equal(fs.existsSync(path.join(root, "api", "activity-token.mjs")), false);
  assert.match(entry, /scope: \["identify", "applications\.commands"\]/);
  assert.match(entry, /commands\.authenticate/);
  assert.match(entry, /commands\.openInviteDialog/);
  assert.match(entry, /commands\.openExternalLink\(\{ url \}\)/);
  assert.match(entry, /if \(!sdk \|\| !connected\) return false/);
  assert.match(entry, /EXTERNAL_LINK_TIMEOUT,\s*"Discord did not open the external link in time\."/);
  assert.match(entry, /setOrientationLockState/);
  [entry, redirect, game, account, signalField, duel].forEach((source) => {
    assert.match(source, /\.has\("frame_id"\)/);
    assert.doesNotMatch(source, /\.has\("instance_id"\)/);
  });
  assert.doesNotMatch(redirect, /location\.replace\(destination\)/);
  assert.doesNotMatch(redirect, /location\.reload\(\)/);
  assert.match(redirect, /preserveActivityQuery/);
  assert.match(redirect, /neon-activity-ready/);
  assert.match(redirect, /neon-activity-error/);
  assert.match(redirect, /getRegistrations/);
  assert.match(redirect, /registration\.unregister\(\)/);
  assert.match(redirect, /NeonSnakeActivityBoot\?\.ready\(\)/);
  assert.match(activityBoot, /ACTIVITY FAILED TO START/);
  assert.match(activityBoot, /addEventListener\("unhandledrejection"/);
  assert.match(activityBoot, /addEventListener\("error", handleBootError, true\)/);
  assert.match(activityBoot, /let bootFailed = false/);
  assert.match(activityBoot, /removeEventListener\("error", handleBootError, true\)/);
  assert.match(activityBoot, /hasAttribute\("data-activity-critical"\)/);
  assert.match(activityBoot, /new MutationObserver/);
  assert.doesNotMatch(activityBoot, /DOMContentLoaded/);
  assert.match(activityBootCss, /\.activity-boot-status\[hidden\]/);
  assert.match(indexHtml, /id="activityBootStatus"/);
  assert.match(indexHtml, /href="activity-boot\.css\?v=81"/);
  assert.match(indexHtml, /src="activity-boot\.js\?v=81"/);
  [indexHtml, duelHtml].forEach((html) => {
    assert.ok(
      html.indexOf('src="activity-boot.js?v=81"') < html.indexOf('rel="stylesheet"'),
      "Activity boot guard must install before required stylesheets",
    );
    assert.ok(
      html.indexOf('id="activityBootStatus"') < html.indexOf('src="activity-redirect.js?v=81"'),
      "Activity fallback markup must parse before the shell script",
    );
    assert.ok(
      html.indexOf('src="activity-redirect.js?v=81"') < html.indexOf('src="activity-sdk.js?v=81"'),
      "Activity shell listeners must install before SDK startup",
    );
    assert.match(
      html,
      /src="activity-redirect\.js\?v=81" data-activity-critical/,
      "Activity shell load failures must remain boot-fatal",
    );
    assert.doesNotMatch(
      html,
      /src="signal-field\.js\?v=81" data-activity-critical/,
      "Decorative signal-field failures must not cover a playable Activity",
    );
  });
  const criticalScripts = (html) => [...html.matchAll(
    /<script src="([^"]+)" data-activity-critical><\/script>/g,
  )].map((match) => match[1]);
  assert.deepEqual(criticalScripts(indexHtml), [
    "activity-redirect.js?v=81",
    "game-logic.js?v=81",
    "touch-controls.js?v=81",
    "game.js?v=81",
  ]);
  assert.deepEqual(criticalScripts(duelHtml), [
    "activity-redirect.js?v=81",
    "game-logic.js?v=81",
    "room-transport.js?v=81",
    "touch-controls.js?v=81",
    "duel.js?v=81",
  ]);
  assert.match(indexHtml, /id="activityDock"/);
  assert.match(indexHtml, /id="activityDockInvite"/);
  assert.match(indexHtml, /id="activityDockRetry"/);
  assert.match(indexHtml, /id="activityWebsiteLink"/);
  assert.match(indexHtml, /id="activityWallpapersLink"/);
  assert.match(indexHtml, /https:\/\/neon-snake-green-tau\.vercel\.app\/downloads\.html/);
  assert.match(indexHtml, /src="activity-sdk\.js\?v=81"/);
  ["classic", "portal", "rush", "canvas"].forEach((mode) => {
    assert.match(indexHtml, new RegExp(`name="mode" value="${mode}"`));
  });
  assert.match(styles, /body\.activity-mode \.activity-dock/);
  assert.match(styles, /body\.activity-mode \.public-board/);
  assert.match(game, /ACTIVITY_PIXEL_RATIO_CAP/);
  assert.match(game, /activityEmbedded/);
  assert.match(game, /url\.search = activityEmbedded \? activityQuery\.toString\(\) : ""/);
  assert.match(game, /if \(activityEmbedded\) return;/);
  assert.match(duel, /if \(activityEmbedded\) return;/);
  assert.match(account, /embeddedActivity/);
  assert.match(signalField, /activityMode/);
  assert.match(duelHtml, /id="activityContext"/);
  assert.match(duelHtml, /id="activitySoloLink"/);
  assert.match(duelHtml, /id="activityContextRetry"/);
  assert.match(duelHtml, /src="activity-redirect\.js\?v=81"/);
  assert.match(duelHtml, /class="activity-legal" aria-label="Activity policies"/);
  assert.match(duelHtml, /href="\/terms\.html" target="_blank"/);
  assert.match(duelHtml, /href="\/privacy\.html" target="_blank"/);
  assert.match(duelHtml, /src="activity-sdk\.js\?v=81"/);
  assert.match(duel, /NeonSnakeActivity\.ready/);
  assert.match(duel, /NeonSnakeActivity\?\.retry\(\)/);
  assert.match(duel, /catch \(error\) \{\s*renderActivityFailure\(error\)/);
  assert.match(duel, /url\.search = activityEmbedded \? activityQuery\.toString\(\) : ""/);
  assert.match(duel, /await globalThis\.NeonSnakeActivity\.invite\(\)/);
  assert.match(duel, /NeonSnakeActivity\.openExternal\(url\)/);
  assert.match(duel, /location\.assign\(url\)/);
  assert.match(duelCss, /--discord-safe-area-inset-top/);
  assert.match(duelCss, /body\.activity-mode \.activity-legal\s*\{[^}]*display:\s*flex/);

  const globalHeaders = Object.fromEntries(
    vercel.headers
      .find((rule) => rule.source === "/(.*)")
      .headers
      .map(({ key, value }) => [key, value]),
  );
  assert.match(
    globalHeaders["Content-Security-Policy"],
    /frame-ancestors https:\/\/discord\.com https:\/\/\*\.discord\.com/,
  );
  assert.match(
    globalHeaders["Content-Security-Policy"],
    /connect-src[^;]*wss:\/\/\*\.discordsays\.com/,
  );
  assert.equal("X-Frame-Options" in globalHeaders, false);
  assert.equal(requestIsAllowedOrigin(request("/api/realtime"), {
    DISCORD_CLIENT_ID: "1531235601070686228",
  }), true);
  assert.equal(requestIsAllowedOrigin(request("/api/realtime", {
    origin: "https://attacker.example",
  }), {
    DISCORD_CLIENT_ID: "1531235601070686228",
  }), false);

  const values = new Map();
  const commands = [];
  const discordRequests = [];
  const environment = {
    DISCORD_CLIENT_ID: "1531235601070686228",
    DISCORD_CLIENT_SECRET: "server-only-secret",
    DISCORD_REDIRECT_URI: "https://neon-snake-green-tau.vercel.app/api/auth/discord/callback",
  };
  const redisCommand = async (command) => {
    commands.push(command);
    if (command[0] === "GET") return values.get(command[1]) ?? null;
    if (command[0] === "SET") {
      values.set(command[1], command[2]);
      return "OK";
    }
    throw new Error(`Unsupported command ${command[0]}`);
  };
  const fetchImpl = async (url, options = {}) => {
    discordRequests.push({ url, options });
    if (url.endsWith("/oauth2/token")) {
      return {
        ok: true,
        json: async () => ({
          access_token: "activity-access-token",
          refresh_token: "must-never-reach-the-client",
          token_type: "Bearer",
        }),
      };
    }
    if (url.endsWith("/users/@me")) {
      return {
        ok: true,
        json: async () => ({
          id: "123456789012345678",
          username: "activity_player",
          global_name: "Activity Player",
          avatar: null,
        }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const handler = createAccountHandler({
    environment,
    fetchImpl,
    now: () => 1_785_184_000_000,
    random: () => "activity_session_token_32_characters",
    redisCommand,
  });

  const forbidden = responseHarness();
  await handler(request("/api/activity/token", {
    method: "POST",
    origin: "https://attacker.example",
    body: { code: "valid_activity_code" },
  }), forbidden);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(discordRequests.length, 0);

  const response = responseHarness();
  await handler(request("/api/activity/token", {
    method: "POST",
    body: { code: "valid_activity_code" },
  }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { access_token: "activity-access-token" });
  assert.doesNotMatch(response.body, /refresh|secret/);
  assert.match(response.headers["set-cookie"], /__Secure-neon_activity=/);
  assert.match(response.headers["set-cookie"], /Domain=1531235601070686228\.discordsays\.com/);
  assert.match(response.headers["set-cookie"], /SameSite=None/);
  assert.match(response.headers["set-cookie"], /Partitioned/);
  assert.match(response.headers["set-cookie"], /HttpOnly/);
  const tokenRequest = discordRequests.find(({ url }) => url.endsWith("/oauth2/token"));
  assert.ok(tokenRequest);
  assert.equal(tokenRequest.options.body.get("redirect_uri"), null);
  assert.match(tokenRequest.options.headers.Authorization, /^Basic /);
  assert.ok(commands.some((command) => command[1] === "neon-snake:profile:123456789012345678"));

  const sessionKey = [...values.keys()].find((key) => key.startsWith("neon-snake:session:"));
  assert.ok(sessionKey);
  const sessionReader = createSessionReader({ redisCommand });
  const current = await sessionReader(request("/api/me", {
    cookie: "__Secure-neon_activity=activity_session_token_32_characters",
  }));
  assert.equal(current.profile.username, "activity_player");
  process.stdout.write("PASS Discord Activity uses official SDK auth, partitioned sessions, and instance rooms\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
