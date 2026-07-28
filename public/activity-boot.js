(function initializeActivityBootGuard() {
  "use strict";

  const embedded = new URLSearchParams(location.search).has("frame_id");
  if (!embedded) return;

  document.documentElement.classList.add("activity-mode");
  let bootComplete = false;
  let bootFailed = false;
  let failureDetail = "";
  let status = null;
  let timer = null;

  function findStatus() {
    status ||= document.querySelector("#activityBootStatus");
    return status;
  }

  function show(state, title, detail) {
    const node = findStatus();
    if (!node) return;
    node.hidden = false;
    node.dataset.state = state;
    const heading = node.querySelector("strong");
    const message = node.querySelector("span");
    if (heading) heading.textContent = title;
    if (message) message.textContent = detail;
  }

  function ready() {
    if (bootFailed || bootComplete) return;
    bootComplete = true;
    clearTimeout(timer);
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
    show("error", "ACTIVITY FAILED TO START", `${failureDetail} Close and reopen the Activity to retry.`);
  }

  function handleBootError(event) {
    const tagName = event.target?.tagName?.toLowerCase();
    const requiredStylesheet = (
      tagName === "link"
      && event.target.relList?.contains("stylesheet")
    );
    if (tagName === "script" || requiredStylesheet) {
      const source = event.target.src || event.target.href || "required resource";
      const resource = new URL(source, location.href).pathname.split("/").pop() || "required resource";
      failed(new Error(`A required Activity file could not load (${resource}).`));
      return;
    }
    if (tagName) return;
    failed(event.error || event.message);
  }

  function handleBootRejection(event) {
    failed(event.reason);
  }

  addEventListener("error", handleBootError, true);
  addEventListener("unhandledrejection", handleBootRejection);

  function begin() {
    if (bootFailed) {
      show(
        "error",
        "ACTIVITY FAILED TO START",
        `${failureDetail} Close and reopen the Activity to retry.`,
      );
      return;
    }
    if (bootComplete) return;
    show("loading", "OPENING NEON SNAKE", "Preparing the game inside Discord…");
    timer = setTimeout(() => {
      if (!bootComplete && !bootFailed) {
        show(
          "slow",
          "STILL CONNECTING",
          "Discord is taking longer than expected. The game will appear as soon as its files finish loading.",
        );
      }
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", begin, { once: true });
  } else {
    begin();
  }

  globalThis.NeonSnakeActivityBoot = { embedded, ready, failed };
})();
