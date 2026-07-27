(function redirectDiscordActivity() {
  "use strict";

  const query = new URLSearchParams(location.search);
  if (!query.has("frame_id") || !query.has("instance_id")) return;
  const destination = new URL("/duel", location.origin);
  query.forEach((value, key) => destination.searchParams.set(key, value));
  destination.searchParams.set("type", "live");
  location.replace(destination);
})();
