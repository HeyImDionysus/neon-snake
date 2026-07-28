(function initializeDiscordActivityShell() {
  "use strict";

  const query = new URLSearchParams(location.search);
  const embedded = query.has("frame_id");
  if (!embedded) return;

  let latestStage = {
    state: "connecting",
    title: "SOLO READY · CONNECTING DISCORD",
    detail: "Single-player is available while the shared channel session connects.",
  };

  document.documentElement.classList.add("activity-mode");

  async function retireServiceWorkers() {
    if (!navigator.serviceWorker?.getRegistrations) return false;
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) return false;
    const results = await Promise.all(registrations.map((registration) => registration.unregister()));
    return results.some(Boolean);
  }

  void retireServiceWorkers().catch(() => {});

  function preserveActivityQuery(target, overrides = {}) {
    const destination = new URL(target, location.href);
    query.forEach((value, key) => destination.searchParams.set(key, value));
    Object.entries(overrides).forEach(([key, value]) => {
      if (value == null) destination.searchParams.delete(key);
      else destination.searchParams.set(key, value);
    });
    return `${destination.pathname}${destination.search}${destination.hash}`;
  }

  function renderStage() {
    const dock = document.querySelector("#activityDock");
    if (!dock) return;
    dock.hidden = false;
    dock.dataset.state = latestStage.state;
    const title = document.querySelector("#activityDockTitle");
    const detail = document.querySelector("#activityDockDetail");
    const invite = document.querySelector("#activityDockInvite");
    const retry = document.querySelector("#activityDockRetry");
    if (title) title.textContent = latestStage.title;
    if (detail) detail.textContent = latestStage.detail;
    if (invite) invite.disabled = latestStage.state !== "connected";
    if (retry) retry.hidden = latestStage.state !== "error";
  }

  function setStage(event) {
    latestStage = { ...latestStage, ...(event.detail || {}) };
    renderStage();
  }

  function setReady(event) {
    const roomCode = event.detail?.roomCode;
    latestStage = {
      state: "connected",
      title: "CHANNEL INSTANCE CONNECTED",
      detail: roomCode
        ? `Shared room ${roomCode} is ready. Solo play stays local until you choose multiplayer.`
        : "Discord is connected. Solo play stays local until you choose multiplayer.",
    };
    renderStage();
  }

  function setError(event) {
    latestStage = {
      state: "error",
      title: "SOLO READY · DISCORD LINK OFFLINE",
      detail: `${event.detail?.message || "Discord connection failed."} Single-player remains available.`,
    };
    renderStage();
  }

  globalThis.addEventListener("neon-activity-stage", setStage);
  globalThis.addEventListener("neon-activity-ready", setReady);
  globalThis.addEventListener("neon-activity-error", setError);

  function bindShell() {
    document.body.classList.add("activity-mode");

    document.querySelectorAll('a[href^="duel"], a[data-activity-route="multiplayer"]')
      .forEach((link) => {
        link.href = preserveActivityQuery("/duel", { type: "live" });
      });
    document.querySelectorAll('a[href="./"], a[href="/"], a[data-activity-route="solo"]')
      .forEach((link) => {
        link.href = preserveActivityQuery("/", { type: null, room: null });
      });

    const invite = document.querySelector("#activityDockInvite");
    const retry = document.querySelector("#activityDockRetry");
    invite?.addEventListener("click", async () => {
      invite.disabled = true;
      try {
        await globalThis.NeonSnakeActivity?.invite();
      } finally {
        invite.disabled = latestStage.state !== "connected";
      }
    });
    retry?.addEventListener("click", () => {
      retry.hidden = true;
      globalThis.NeonSnakeActivity?.retry();
    });
    document.querySelectorAll(".activity-external-link").forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          if (await globalThis.NeonSnakeActivity?.openExternal(link.href)) return;
        } catch {
          // Keep required policies reachable when the Discord client cannot open them.
        }
        location.assign(link.href);
      });
    });
    renderStage();
    globalThis.NeonSnakeActivityBoot?.ready();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindShell, { once: true });
  } else {
    bindShell();
  }

  globalThis.NeonSnakeActivityShell = {
    embedded,
    preserveActivityQuery,
    retireServiceWorkers,
  };
})();
