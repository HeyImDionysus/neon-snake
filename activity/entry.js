import {
  Common,
  DiscordSDK,
} from "@discord/embedded-app-sdk";

const CLIENT_ID = "1531235601070686228";
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const READY_TIMEOUT = 8_000;
const COMMAND_TIMEOUT = 15_000;
const TOKEN_TIMEOUT = 16_000;
const EXTERNAL_LINK_TIMEOUT = 2_500;
const query = new URLSearchParams(location.search);
const embedded = query.has("frame_id");
let sdk = null;
let readyPromise = null;
let connected = false;

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
  document.documentElement.classList.add("activity-mode");
  document.body?.classList.add("activity-mode");
  stage(
    "connecting",
    "SOLO READY · CONNECTING DISCORD",
    "Single-player is available while the shared channel session connects.",
  );
  sdk = new DiscordSDK(CLIENT_ID);
  await withTimeout(
    sdk.ready(),
    READY_TIMEOUT,
    "Discord did not finish the Activity handshake.",
  );
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
  const tokenResponse = await withTimeout(
    fetch("/api/activity/token", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: authorization.code }),
    }),
    TOKEN_TIMEOUT,
    "The Activity server did not answer in time.",
  );
  if (!tokenResponse.ok) {
    const payload = await tokenResponse.json().catch(() => null);
    const reason = payload?.error ? ` (${payload.error})` : "";
    throw new Error(`Activity sign-in failed${reason}.`);
  }
  const token = await tokenResponse.json();
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
    await sdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    });
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
  if (!sdk) return false;
  await sdk.commands.openInviteDialog();
  return true;
}

async function openExternal(url) {
  if (!sdk || !connected) return false;
  const result = await withTimeout(
    sdk.commands.openExternalLink({ url }),
    EXTERNAL_LINK_TIMEOUT,
    "Discord did not open the external link in time.",
  );
  return result?.opened === true;
}

function begin({ force = false } = {}) {
  if (!embedded) return Promise.resolve(null);
  if (readyPromise && !force) return readyPromise;
  const attempt = initialize().catch((error) => {
    connected = false;
    const message = error instanceof Error ? error.message : "Activity startup failed.";
    stage(
      "error",
      "SOLO READY · DISCORD LINK OFFLINE",
      `${message} Single-player remains available.`,
    );
    dispatch("neon-activity-error", { message });
    throw error;
  });
  attempt.catch(() => {});
  readyPromise = attempt;
  return attempt;
}

function retry() {
  connected = false;
  sdk = null;
  return begin({ force: true });
}

begin();

globalThis.NeonSnakeActivity = {
  CLIENT_ID,
  embedded,
  instanceSignal,
  invite,
  openExternal,
  retry,
  get ready() {
    return readyPromise;
  },
};
