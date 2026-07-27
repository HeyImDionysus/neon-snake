import {
  Common,
  DiscordSDK,
} from "@discord/embedded-app-sdk";

const CLIENT_ID = "1531235601070686228";
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const query = new URLSearchParams(location.search);
const embedded = query.has("frame_id") && query.has("instance_id");
let sdk = null;

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

async function initialize() {
  if (!embedded) return null;
  document.documentElement.classList.add("activity-mode");
  document.body?.classList.add("activity-mode");
  sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();
  const authorization = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  const tokenResponse = await fetch("/api/activity/token", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: authorization.code }),
  });
  if (!tokenResponse.ok) throw new Error("Activity sign-in failed.");
  const token = await tokenResponse.json();
  if (!token?.access_token) throw new Error("Activity token missing.");
  const auth = await sdk.commands.authenticate({
    access_token: token.access_token,
  });
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
  dispatch("neon-activity-ready", context);
  return context;
}

async function invite() {
  if (!sdk) return false;
  await sdk.commands.openInviteDialog();
  return true;
}

const ready = initialize().catch((error) => {
  dispatch("neon-activity-error", {
    message: error instanceof Error ? error.message : "Activity startup failed.",
  });
  throw error;
});

globalThis.NeonSnakeActivity = {
  CLIENT_ID,
  embedded,
  instanceSignal,
  invite,
  ready,
};
