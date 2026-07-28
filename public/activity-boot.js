(function initializeActivityBootGuard() {
  "use strict";

  const embedded = new URLSearchParams(location.search).has("frame_id");
  let status = document.querySelector("#activityBootStatus");
  if (!embedded) {
    if (status) status.hidden = true;
    return;
  }

  document.documentElement.classList.add("activity-mode");
  let bootComplete = false;
  let bootFailed = false;
  let failureDetail = "";
  let timer = null;
  let statusObserver = null;
  const openingDetail = document.body?.classList.contains("duel-page")
    ? "Preparing multiplayer inside Discord…"
    : "Preparing the game inside Discord…";
  let latestStatus = {
    state: "loading",
    title: "OPENING NEON SNAKE",
    detail: openingDetail,
  };

  function findStatus() {
    status ||= document.querySelector("#activityBootStatus");
    return status;
  }

  function renderStatus() {
    const node = findStatus();
    if (!node) return false;
    node.hidden = false;
    node.dataset.state = latestStatus.state;
    const heading = node.querySelector("strong");
    const message = node.querySelector("span");
    if (heading) heading.textContent = latestStatus.title;
    if (message) message.textContent = latestStatus.detail;
    return true;
  }

  function show(state, title, detail) {
    latestStatus = { state, title, detail };
    return renderStatus();
  }

  function ready() {
    if (bootFailed || bootComplete) return;
    bootComplete = true;
    clearTimeout(timer);
    statusObserver?.disconnect();
    removeEventListener("error", handleBootError, true);
    removeEventListener("unhandledrejection", handleBootRejection);
    const node = findStatus();
    if (node) node.hidden = true;
  }

  function failed(reason) {
    if (bootFailed || bootComplete) return;
    bootFailed = true;
    clearTimeout(timer);
    failureDetail = (
      reason instanceof Error ? reason.message : String(reason || "")
    ) || "Unknown startup error.";
    if (show(
      "error",
      "ACTIVITY FAILED TO START",
      `${failureDetail} Close and reopen the Activity to retry.`,
    )) {
      statusObserver?.disconnect();
    }
  }

  function belongsToCriticalScript(source) {
    const evidence = String(source || "");
    if (!evidence) return false;
    return [...document.querySelectorAll("script[data-activity-critical]")].some((script) => {
      const url = new URL(script.src, location.href);
      return evidence.includes(url.href) || evidence.includes(url.pathname);
    });
  }

  function handleBootError(event) {
    const tagName = event.target?.tagName?.toLowerCase();
    const requiredStylesheet = (
      tagName === "link"
      && event.target.relList?.contains("stylesheet")
    );
    const requiredScript = (
      tagName === "script"
      && event.target.hasAttribute("data-activity-critical")
    );
    if (requiredScript || requiredStylesheet) {
      const source = event.target.src || event.target.href || "required resource";
      const resource = new URL(source, location.href).pathname.split("/").pop() || "required resource";
      failed(new Error(`A required Activity file could not load (${resource}).`));
      return;
    }
    if (tagName) return;
    const source = event.filename || event.error?.stack;
    if (belongsToCriticalScript(source)) {
      failed(event.error || event.message);
    }
  }

  function handleBootRejection(event) {
    if (belongsToCriticalScript(event.reason?.stack)) {
      failed(event.reason);
    }
  }

  addEventListener("error", handleBootError, true);
  addEventListener("unhandledrejection", handleBootRejection);
  document.querySelectorAll('link[rel~="stylesheet"]').forEach((stylesheet) => {
    if (!stylesheet.sheet) {
      handleBootError({ target: stylesheet });
    }
  });

  statusObserver = new MutationObserver(() => {
    if (renderStatus()) statusObserver.disconnect();
  });
  statusObserver.observe(document.documentElement, { childList: true, subtree: true });
  renderStatus();
  timer = setTimeout(() => {
    if (!bootComplete && !bootFailed) {
      show(
        "slow",
        "STILL CONNECTING",
        "Discord is taking longer than expected. The game will appear as soon as its files finish loading.",
      );
    }
  }, 5000);

  globalThis.NeonSnakeActivityBoot = { embedded, ready, failed };
})();
