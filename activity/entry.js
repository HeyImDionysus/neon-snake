import {
  Common,
  DiscordSDK,
  Events,
} from "@discord/embedded-app-sdk";

const CLIENT_ID = "1531235601070686228";
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const READY_TIMEOUT = 8_000;
const COMMAND_TIMEOUT = 15_000;
const TOKEN_TIMEOUT = 16_000;
const EXTERNAL_LINK_TIMEOUT = 2_500;
const ORIENTATION_TIMEOUT = 2_500;
function instanceSignal(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  let result = "";
  for (let index = 0; index < 6; index += 1) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    result += SIGNAL_ALPHABET[state % SIGNAL_ALPHABET.length];
  }
  return result;
}

const query = new URLSearchParams(location.search);
const embedded = query.has("frame_id");
// Everyone launched into the same Activity instance receives the same
// instance_id in their URL, and the SDK derives sdk.instanceId from exactly
// that parameter. The shared room therefore does not depend on the RPC
// handshake completing: it is known the moment the page loads. Discord's
// handshake is still needed for a verified identity and the invite dialog, but
// it must never stand between two people in a channel and a shared board.
const launchInstanceId = query.get("instance_id") || "";
const launchRoomCode = embedded && launchInstanceId ? instanceSignal(launchInstanceId) : "";
let sdk = null;
let readyPromise = null;
let connected = false;
let sdkReady = false;
let initializing = false;


const LAYOUT_NAMES = new Map([
  [Common.LayoutModeTypeObject.FOCUSED, "focused"],
  [Common.LayoutModeTypeObject.PIP, "pip"],
  [Common.LayoutModeTypeObject.GRID, "grid"],
]);

// Picture-in-picture and grid tiles get a board-only layout (see styles.css).
// The layout event needs only the handshake, not the player's authorization,
// so it is subscribed as soon as Discord answers.
function applyLayoutMode(mode) {
  const layout = LAYOUT_NAMES.get(mode) || "focused";
  document.documentElement.dataset.activityLayout = layout;
  dispatch("neon-activity-layout", { layout });
}

async function subscribeLayoutMode(instance) {
  try {
    await withTimeout(
      instance.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, ({ layout_mode: mode }) => applyLayoutMode(mode)),
      COMMAND_TIMEOUT,
      "Discord layout updates did not answer in time.",
    );
  } catch {
    // Older clients never send layout changes; a viewport-height query in the
    // stylesheet covers them.
  }
}

function dispatch(name, detail) {
  globalThis.dispatchEvent(new CustomEvent(name, { detail }));
}

function stage(state, title, detail) {
  dispatch("neon-activity-stage", { state, title, detail });
}

function withTimeout(promise, timeout, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function initialize() {
  if (!embedded) return null;
  connected = false;
  sdkReady = false;
  document.documentElement.classList.add("activity-mode");
  document.body?.classList.add("activity-mode");
  stage(
    "connecting",
    "SOLO READY · CONNECTING DISCORD",
    "Single-player is available while the shared channel session connects.",
  );
  // A retry needs a fresh instance: the SDK only posts HANDSHAKE from its
  // constructor, so reusing an instance whose handshake was never answered can
  // never recover. The obsolete instance is abandoned rather than closed -
  // close() posts an RPC CLOSE opcode, which ends the Activity.
  sdk = new DiscordSDK(CLIENT_ID, { disableConsoleLogOverride: true });
  await withTimeout(
    sdk.ready(),
    READY_TIMEOUT,
    "Discord did not finish the Activity handshake.",
  );
  sdkReady = true;
  void subscribeLayoutMode(sdk);
  stage(
    "authorizing",
    "SOLO READY · IDENTIFYING PLAYER",
    "Discord is securely connecting this player to the shared instance.",
  );
  const authorization = await withTimeout(
    sdk.commands.authorize({
      client_id: CLIENT_ID,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "applications.commands"],
    }),
    COMMAND_TIMEOUT,
    "Discord authorization timed out.",
  );
  if (!authorization?.code) throw new Error("Discord did not return an authorization code.");
  stage(
    "authenticating",
    "SOLO READY · OPENING INSTANCE",
    "The server is creating a private Activity session.",
  );
  const tokenController = new AbortController();
  let token;
  try {
    token = await withTimeout((async () => {
      const tokenResponse = await fetch("/api/activity/token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authorization.code }),
        signal: tokenController.signal,
      });
      if (!tokenResponse.ok) {
        const payload = await tokenResponse.json().catch(() => null);
        const reason = payload?.error ? ` (${payload.error})` : "";
        throw new Error(`Activity sign-in failed${reason}.`);
      }
      return tokenResponse.json();
    })(), TOKEN_TIMEOUT, "The Activity server did not answer in time.");
  } finally {
    tokenController.abort();
  }
  if (!token?.access_token) throw new Error("Activity token missing.");
  const auth = await withTimeout(
    sdk.commands.authenticate({
      access_token: token.access_token,
    }),
    COMMAND_TIMEOUT,
    "Discord player authentication timed out.",
  );
  if (!auth?.user?.id) throw new Error("Discord did not authenticate this player.");

  try {
    await withTimeout(sdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    }), ORIENTATION_TIMEOUT, "Discord orientation controls did not answer in time.");
  } catch {
    // Older Discord clients may not expose orientation controls.
  }

  const roomCode = instanceSignal(sdk.instanceId);
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set("type", "live");
  nextUrl.searchParams.set("room", roomCode);
  history.replaceState(null, "", nextUrl);
  const context = {
    channelId: sdk.channelId,
    guildId: sdk.guildId,
    instanceId: sdk.instanceId,
    roomCode,
    user: auth.user,
  };
  connected = true;
  stage(
    "connected",
    "CHANNEL INSTANCE CONNECTED",
    `Shared room ${roomCode} · authenticated as @${auth.user.username}`,
  );
  dispatch("neon-activity-ready", context);
  return context;
}

async function invite() {
  if (!sdk || !connected) return false;
  await withTimeout(sdk.commands.openInviteDialog(), COMMAND_TIMEOUT, "Discord did not open the invite dialog in time.");
  return true;
}

async function openExternal(url) {
  if (!sdk || !sdkReady) return false;
  const result = await withTimeout(
    sdk.commands.openExternalLink({ url }),
    EXTERNAL_LINK_TIMEOUT,
    "Discord did not open the external link in time.",
  );
  return result?.opened === true;
}

function begin({ force = false } = {}) {
  if (!embedded) return Promise.resolve(null);
  if (readyPromise && (!force || initializing)) return readyPromise;
  initializing = true;
  const attempt = Promise.resolve().then(initialize).catch((error) => {
    connected = false;
    const message = error instanceof Error ? error.message : "Activity startup failed.";
    stage(
      "error",
      "SOLO READY · DISCORD LINK OFFLINE",
      `${message} Single-player remains available.`,
    );
    dispatch("neon-activity-error", { message });
    throw error;
  }).finally(() => { initializing = false; });
  attempt.catch(() => {});
  readyPromise = attempt;
  return attempt;
}

function retry() {
  if (initializing) return readyPromise;
  connected = false;
  sdkReady = false;
  return begin({ force: true });
}

begin();

globalThis.NeonSnakeActivity = {
  CLIENT_ID,
  embedded,
  instanceSignal,
  launchRoomCode,
  invite,
  openExternal,
  retry,
  get ready() {
    return readyPromise;
  },
};
