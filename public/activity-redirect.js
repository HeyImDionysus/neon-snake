(function initializeDiscordActivityShell() {
  "use strict";

  const query = new URLSearchParams(location.search);
  const embedded = query.has("frame_id");
  const publicSiteOrigin = "https://neon-snake-green-tau.vercel.app";
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

  function setExternalError(event) {
    latestStage = {
      ...latestStage,
      title: "ACTIVITY STAYED OPEN",
      detail: `${event.detail?.message || "Discord could not open that page."} Try the link again after Discord finishes connecting.`,
    };
    renderStage();
  }

  globalThis.addEventListener("neon-activity-stage", setStage);
  globalThis.addEventListener("neon-activity-ready", setReady);
  globalThis.addEventListener("neon-activity-error", setError);
  globalThis.addEventListener("neon-activity-external-error", setExternalError);

  function markPublicSiteLink(link) {
    const rawHref = link.getAttribute("href");
    if (!rawHref) return;
    link.classList.add("activity-external-link");
    link.href = new URL(rawHref, publicSiteOrigin).href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  function classifyActivityLink(link) {
    const rawHref = link.getAttribute("href") || "";
    const target = new URL(rawHref, location.href);
    const normalizedPath = target.pathname.replace(/\/index\.html$/, "/");

    if (
      link.dataset.activityRoute === "multiplayer"
      || /(?:^|\/)duel(?:\.html)?$/.test(normalizedPath)
    ) {
      link.href = preserveActivityQuery("/duel", { type: "live" });
      return;
    }

    if (
      link.dataset.activityRoute === "solo"
      || link.classList.contains("brand")
      || rawHref === "./"
      || rawHref === "/"
      || rawHref === "/index.html"
    ) {
      link.href = preserveActivityQuery("/", { type: null, room: null });
      return;
    }

    const publicSiteOnly = (
      normalizedPath.endsWith("/downloads.html")
      || normalizedPath.endsWith("/profile.html")
      || normalizedPath.endsWith("/terms.html")
      || normalizedPath.endsWith("/privacy.html")
      || normalizedPath.startsWith("/api/auth/discord/")
      || target.hash === "#leaderboard"
    );
    if (publicSiteOnly || link.classList.contains("activity-external-link")) {
      markPublicSiteLink(link);
    }
  }

  function classifyActivityLinks() {
    document.querySelectorAll("a[href]").forEach(classifyActivityLink);
  }

  function reportExternalFailure(link, error) {
    const message = error instanceof Error
      ? error.message
      : `Discord could not open ${link.textContent.trim() || "that page"}.`;
    globalThis.dispatchEvent(new CustomEvent("neon-activity-external-error", {
      detail: { message, url: link.href },
    }));
  }

  function bindShell() {
    document.body.classList.add("activity-mode");

    classifyActivityLinks();

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
    document.addEventListener("click", async (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      classifyActivityLink(link);
      if (!link.classList.contains("activity-external-link")) return;
      event.preventDefault();
      try {
        if (await globalThis.NeonSnakeActivity?.openExternal(link.href)) return;
        reportExternalFailure(link);
      } catch (error) {
        reportExternalFailure(link, error);
      }
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
