"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("./activity/entry.js"), "utf8")
  .replace(/^import[\s\S]*?from "@discord\/embedded-app-sdk";/, "");

function activityHarness({
  hangOrientation = false,
  hangToken = false,
  failFirstHandshake = false,
  refusePresence = false,
  search = "",
} = {}) {
  const events = [];
  const presenceCalls = [];
  const shareCalls = [];
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
        setActivity: async (args) => {
          presenceCalls.push(JSON.parse(JSON.stringify(args.activity)));
          if (refusePresence) throw new Error("Missing scope rpc.activities.write");
          return args.activity;
        },
        getInstanceConnectedParticipants: async () => ({
          participants: [
            { id: "1", username: "ada", global_name: "Ada", bot: false },
            { id: "2", username: "helper", bot: true },
          ],
        }),
        shareLink: async (args) => {
          shareCalls.push(JSON.parse(JSON.stringify(args)));
          return { success: true, didCopyLink: false, didSendMessage: true };
        },
      };
    }
    ready() {
      return failFirstHandshake && this === instances[0] ? new Promise(() => {}) : handshake;
    }
    async subscribe(event, listener) {
      this.subscriptions = { ...this.subscriptions, [event]: listener };
    }
    close(code, message) { this.closed = { code, message }; }
  }
  const context = {
    DiscordSDK,
    Common: {
      OrientationLockStateTypeObject: { UNLOCKED: 0, LANDSCAPE: 1 },
      LayoutModeTypeObject: { UNHANDLED: -1, FOCUSED: 0, PIP: 1, GRID: 2 },
      ThermalStateTypeObject: { UNHANDLED: -1, NOMINAL: 0, FAIR: 1, SERIOUS: 2, CRITICAL: 3 },
    },
    Events: {
      ACTIVITY_LAYOUT_MODE_UPDATE: "ACTIVITY_LAYOUT_MODE_UPDATE",
      ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE: "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE",
      THERMAL_STATE_UPDATE: "THERMAL_STATE_UPDATE",
    },
    location: new URL(`https://1531235601070686228.discordsays.com/duel?frame_id=frame&instance_id=shared-channel-instance&platform=desktop${search}`),
    document: {
      documentElement: { classList: { add() {} }, dataset: {} },
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
  return {
    activity: context.NeonSnakeActivity,
    context,
    events,
    instances,
    presenceCalls,
    releaseReady,
    shareCalls,
    tokenSignals,
  };
}

(async () => {
  const orientation = activityHarness({ hangOrientation: true });
  orientation.releaseReady();
  const result = await Promise.race([
    orientation.activity.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 100)),
  ]);
  assert.ok(result?.roomCode, "An unsupported orientation command must not block authenticated room readiness forever");

  // Picture-in-picture and grid tiles switch to the board-only layout.
  const layout = activityHarness();
  layout.releaseReady();
  await layout.activity.ready;
  const layoutListener = layout.instances[0].subscriptions?.ACTIVITY_LAYOUT_MODE_UPDATE;
  assert.ok(layoutListener, "The Activity must follow Discord's layout mode");
  layoutListener({ layout_mode: 1 });
  assert.equal(layout.context.document.documentElement.dataset.activityLayout, "pip");
  layoutListener({ layout_mode: 0 });
  assert.equal(layout.context.document.documentElement.dataset.activityLayout, "focused");

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

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

  // Rich presence: only the latest description is sent, repeats are free,
  // and nothing is sent before the player is authenticated.
  const presence = activityHarness();
  presence.activity.setPresence({ details: "Solo · Classic", state: "Score 1" });
  assert.equal(presence.presenceCalls.length, 0, "Presence waits for Discord authentication");
  presence.releaseReady();
  await presence.activity.ready;
  await settle();
  assert.deepEqual(presence.presenceCalls, [{ type: 0, details: "Solo · Classic", state: "Score 1" }],
    "A description set before sign-in is sent once the player is authenticated");
  presence.activity.setPresence({ details: "Solo · Classic", state: "Score 2" });
  presence.activity.setPresence({ details: "Solo · Classic", state: "Score 3", startedAt: 1_700_000_000_000.4 });
  await settle();
  assert.deepEqual(presence.presenceCalls.slice(1), [{
    type: 0,
    details: "Solo · Classic",
    state: "Score 3",
    timestamps: { start: 1_700_000_000_000 },
  }], "Rapid updates collapse into one call carrying the latest text");
  presence.activity.setPresence({ details: "Solo · Classic", state: "Score 3", startedAt: 1_700_000_000_000 });
  await settle();
  assert.equal(presence.presenceCalls.length, 2, "An unchanged description is not re-sent");
  presence.activity.setPresence({ details: "x".repeat(300), state: "" });
  await settle();
  assert.equal(presence.presenceCalls[2].details.length, 128, "Presence text is clipped to Discord's limit");
  assert.equal("state" in presence.presenceCalls[2], false, "Empty fields are omitted");

  const refused = activityHarness({ refusePresence: true });
  refused.releaseReady();
  await refused.activity.ready;
  refused.activity.setPresence({ details: "A", state: "1" });
  await settle();
  refused.activity.setPresence({ details: "B", state: "2" });
  await settle();
  assert.equal(refused.presenceCalls.length, 1, "A refused status permission is not retried on every change");

  // Participants: bots are hidden and names prefer the player's display name.
  const participants = activityHarness();
  participants.releaseReady();
  await participants.activity.ready;
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(participants.activity.participants)), [{ id: "1", name: "Ada" }]);
  participants.instances[0].subscriptions.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE({
    participants: [
      { id: "1", username: "ada", global_name: "Ada", bot: false },
      { id: "3", username: "grace", nickname: "Admiral", bot: false },
    ],
  });
  assert.deepEqual(participants.activity.participants.map((entry) => entry.name), ["Ada", "Admiral"]);
  assert.equal(
    participants.events.filter((event) => event.type === "neon-activity-participants").at(-1).detail.participants.length,
    2,
  );

  // Thermal state: only serious and critical mark the document.
  const thermalListener = participants.instances[0].subscriptions.THERMAL_STATE_UPDATE;
  thermalListener({ thermal_state: 3 });
  assert.equal(participants.context.document.documentElement.dataset.thermal, "critical");
  thermalListener({ thermal_state: 1 });
  assert.equal("thermal" in participants.context.document.documentElement.dataset, false);

  // Share links carry the challenge id that the launch URL hands back.
  const early = activityHarness();
  assert.equal(await early.activity.share({ message: "early" }), null, "Sharing needs a connected session");
  early.releaseReady();
  await early.activity.ready;
  const shared = await participants.activity.share({ message: "Beat Signal ABC234", customId: "ABC234.portal.overdrive" });
  assert.equal(shared.success, true);
  assert.deepEqual(participants.shareCalls, [{ message: "Beat Signal ABC234", custom_id: "ABC234.portal.overdrive" }]);
  process.stdout.write("PASS Activity presence coalesces and respects refusal; participants, thermal state and share links follow Discord\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
