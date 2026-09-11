"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("./activity/entry.js"), "utf8")
  .replace(/^import[\s\S]*?from "@discord\/embedded-app-sdk";/, "");

function activityHarness({ hangOrientation = false, hangToken = false, failFirstHandshake = false } = {}) {
  const events = [];
  const instances = [];
  const tokenSignals = [];
  let releaseReady;
  const handshake = new Promise((resolve) => { releaseReady = resolve; });
  class DiscordSDK {
    constructor(_clientId, configuration) {
      instances.push(this);
      this.configuration = configuration;
      this.instanceId = "shared-channel-instance";
      this.channelId = "fixture-channel";
      this.commands = {
        authorize: async () => ({ code: "fixture-authorization" }),
        authenticate: async () => ({ user: { id: "fixture-player", username: "fixture" } }),
        setOrientationLockState: () => hangOrientation ? new Promise(() => {}) : Promise.resolve(),
      };
    }
    ready() {
      return failFirstHandshake && this === instances[0] ? new Promise(() => {}) : handshake;
    }
    close(code, message) { this.closed = { code, message }; }
  }
  const context = {
    DiscordSDK,
    Common: { OrientationLockStateTypeObject: { UNLOCKED: 0, LANDSCAPE: 1 } },
    location: new URL("https://1531235601070686228.discordsays.com/duel?frame_id=frame&instance_id=shared-channel-instance&platform=desktop"),
    document: {
      documentElement: { classList: { add() {} } },
      body: { classList: { add() {} } },
    },
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    Promise,
    Error,
    AbortController,
    fetch: async (_url, options) => {
      tokenSignals.push(options.signal);
      if (hangToken) return new Promise(() => {});
      return { ok: true, json: async () => ({ access_token: "fixture" }) };
    },
    setTimeout: (callback, duration) => setTimeout(callback, Math.min(duration, 15)),
    clearTimeout,
    CustomEvent: class {
      constructor(type, { detail }) { this.type = type; this.detail = detail; }
    },
    dispatchEvent: (event) => events.push(event),
  };
  vm.runInNewContext(source, context, { filename: "activity/entry.js" });
  return { activity: context.NeonSnakeActivity, events, instances, tokenSignals, releaseReady };
}

(async () => {
  const orientation = activityHarness({ hangOrientation: true });
  orientation.releaseReady();
  const result = await Promise.race([
    orientation.activity.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 100)),
  ]);
  assert.ok(result?.roomCode, "An unsupported orientation command must not block authenticated room readiness forever");

  const retry = activityHarness();
  const first = retry.activity.ready;
  const second = retry.activity.retry();
  retry.releaseReady();
  await Promise.all([first, second]);
  assert.equal(retry.instances.length, 1, "A retry while a handshake is still in flight must not register another RPC listener");
  assert.equal(retry.instances[0].configuration?.disableConsoleLogOverride, true,
    "The SDK must not wrap console, which can loop log messages back through the RPC bridge");
  assert.equal(retry.events.filter((event) => event.type === "neon-activity-ready").length, 1,
    "A retry during authentication must not start duplicate sign-in or room-ready flows");

  const token = activityHarness({ hangToken: true });
  token.releaseReady();
  await assert.rejects(token.activity.ready, /server did not answer/);
  assert.equal(token.tokenSignals[0]?.aborted, true,
    "A timed-out token request must be aborted before a retry can update the session");

  const handshake = activityHarness({ failFirstHandshake: true });
  handshake.releaseReady();
  await assert.rejects(handshake.activity.ready, /handshake/);
  const recovered = await handshake.activity.retry();
  assert.ok(recovered.roomCode, "Retry must create a fresh handshake after the original RPC connection timed out");
  assert.equal(handshake.instances.length, 2,
    "Retry must construct a new SDK: the handshake is only posted from the constructor");
  assert.ok(
    handshake.instances.every((instance) => !instance.closed),
    "Retry must never call sdk.close(): the RPC CLOSE opcode ends the Activity instead of retrying it",
  );
  process.stdout.write("PASS Activity authentication survives orientation hangs, deduplicates retries, and aborts expired token requests\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
