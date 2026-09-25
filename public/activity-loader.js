(function loadDiscordSdkInsideDiscord() {
  "use strict";

  // Only Discord's Activity iframe carries frame_id. The 155 KB Embedded App
  // SDK used to be downloaded and parsed on every visit to the website. It is
  // now written in at this exact position, and only inside Discord, so every
  // script after it still finds globalThis.NeonSnakeActivity defined, exactly
  // as when the SDK tag stood here directly.
  if (!new URLSearchParams(location.search).has("frame_id")) return;
  const stamp = new URL(document.currentScript.src).search;
  document.write(`<script src="/activity-sdk.js${stamp}"><\/script>`);
})();
