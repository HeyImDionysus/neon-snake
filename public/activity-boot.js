(function initializeActivityBootGuard() {
  "use strict";

  const embedded = new URLSearchParams(location.search).has("frame_id");
  if (!embedded) return;

  document.documentElement.classList.add("activity-mode");
  let settled = false;
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
    settled = true;
    clearTimeout(timer);
    const node = findStatus();
    if (node) node.hidden = true;
  }

  function failed(reason) {
    settled = true;
    clearTimeout(timer);
    const detail = reason instanceof Error ? reason.message : String(reason || "Unknown startup error.");
    show("error", "ACTIVITY FAILED TO START", `${detail} Close and reopen the Activity to retry.`);
  }

  addEventListener("error", (event) => {
    failed(event.error || event.message);
  });
  addEventListener("unhandledrejection", (event) => {
    failed(event.reason);
  });

  function begin() {
    show("loading", "OPENING NEON SNAKE", "Preparing the game inside Discord…");
    timer = setTimeout(() => {
      if (!settled) {
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
