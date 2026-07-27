(function initializeNeonAccount(root) {
  "use strict";

  const controls = [...document.querySelectorAll("[data-account-control]")];
  const leaderboard = document.querySelector("#onlineLeaderboard");
  const status = document.querySelector("#onlineLeaderboardStatus");
  const livePlayers = document.querySelector("#livePlayers");
  const livePlayerCount = document.querySelector("#livePlayerCount");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderSignedOut() {
    if (root.NeonSnakeAccount) root.NeonSnakeAccount.profile = null;
    controls.forEach((control) => {
      control.replaceChildren();
      const link = element("a", "discord-login", "Sign in with Discord");
      link.href = "/api/auth/discord/start";
      link.setAttribute("aria-label", "Sign in securely with Discord");
      control.append(link);
    });
  }

  function renderUnavailable() {
    if (root.NeonSnakeAccount) root.NeonSnakeAccount.profile = null;
    controls.forEach((control) => {
      control.replaceChildren();
      control.append(element("span", "account-unavailable", "Discord profiles offline"));
    });
  }

  function renderSignedIn(profile) {
    if (root.NeonSnakeAccount) root.NeonSnakeAccount.profile = profile;
    controls.forEach((control) => {
      control.replaceChildren();
      const profileLink = element("a", "account-profile-link");
      profileLink.href = `/profile.html?user=${encodeURIComponent(profile.username || "")}`;
      profileLink.setAttribute("aria-label", `Open profile for ${profile.callsign || profile.displayName || "Discord Player"}`);
      const identity = element("span", "account-identity");
      if (profile.avatarUrl) {
        const avatar = document.createElement("img");
        avatar.src = profile.avatarUrl;
        avatar.alt = "";
        avatar.width = 28;
        avatar.height = 28;
        avatar.referrerPolicy = "no-referrer";
        identity.append(avatar);
      }
      const copy = element("span", "account-identity-copy");
      copy.append(
        element("strong", "", profile.callsign || profile.displayName || "Discord Player"),
        element("small", "", `@${profile.username || "player"}`),
      );
      identity.append(copy);
      profileLink.append(identity, element("span", "account-profile-arrow", "↗"));
      control.append(profileLink);
    });
  }

  function renderLeaderboard(entries) {
    if (!leaderboard) return;
    leaderboard.replaceChildren();
    if (!entries.length) {
      leaderboard.append(element("li", "empty-run", "No verified live wins yet."));
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = `online-entry accent-${entry.accent || "acid"}`;
      const rank = element(
        "span",
        `run-position${entry.rank ? "" : " live-unranked"}`,
        entry.rank ? String(entry.rank).padStart(2, "0") : "—",
      );
      const player = element("a", "online-player");
      player.href = `/profile.html?user=${encodeURIComponent(entry.username || "")}`;
      player.setAttribute("aria-label", `View profile for ${entry.callsign || entry.displayName || "Discord Player"}`);
      if (entry.avatarUrl) {
        const avatar = document.createElement("img");
        avatar.src = entry.avatarUrl;
        avatar.alt = "";
        avatar.width = 26;
        avatar.height = 26;
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        player.append(avatar);
      }
      const playerCopy = element("span", "online-player-copy");
      playerCopy.append(
        element("strong", "", entry.callsign || entry.displayName || "Discord Player"),
        element("small", "", `@${entry.username || "player"}`),
      );
      player.append(playerCopy);
      if (entry.online) player.append(element("i", "online-now", "LIVE"));
      const record = entry.record || { wins: entry.wins || 0, losses: 0, draws: 0 };
      const result = element("span", "online-record");
      result.append(
        element("strong", "", `${String(record.wins || 0).padStart(2, "0")}W`),
        element("small", "", `${record.losses || 0}L · ${record.draws || 0}D`),
      );
      item.append(rank, player, result);
      leaderboard.append(item);
    });
  }

  function renderLivePlayers(entries) {
    if (!livePlayers) return;
    const active = entries.filter((entry) => entry.online);
    livePlayers.replaceChildren();
    if (livePlayerCount) {
      livePlayerCount.textContent = `${active.length} ${active.length === 1 ? "PLAYER" : "PLAYERS"} ONLINE`;
    }
    if (!active.length) {
      livePlayers.append(element("li", "empty-run", "No signed-in players are in a room."));
      return;
    }
    active.forEach((entry) => {
      const item = document.createElement("li");
      item.className = `live-player accent-${entry.accent || "acid"}`;
      const link = element("a");
      link.href = `/profile.html?user=${encodeURIComponent(entry.username || "")}`;
      if (entry.avatarUrl) {
        const avatar = document.createElement("img");
        avatar.src = entry.avatarUrl;
        avatar.alt = "";
        avatar.width = 30;
        avatar.height = 30;
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        link.append(avatar);
      }
      const identity = element("span");
      identity.append(
        element("strong", "", entry.callsign || entry.displayName || "Discord Player"),
        element("small", "", `@${entry.username || "player"}`),
      );
      link.append(identity, element("i", "", "PLAYING"));
      item.append(link);
      livePlayers.append(item);
    });
  }

  async function loadAccount() {
    if (!controls.length) return;
    try {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Account service unavailable");
      const payload = await response.json();
      if (payload.authenticated && payload.profile) renderSignedIn(payload.profile);
      else if (payload.available === false) renderUnavailable();
      else renderSignedOut();
    } catch {
      renderUnavailable();
    }
  }

  async function loadLeaderboard() {
    if (!leaderboard) return;
    try {
      const response = await fetch("/api/leaderboard", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Leaderboard unavailable");
      const payload = await response.json();
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      renderLeaderboard(entries);
      renderLivePlayers(entries);
      if (status) status.textContent = "SERVER-VERIFIED LIVE WINS";
    } catch {
      renderLeaderboard([]);
      renderLivePlayers([]);
      if (status) status.textContent = "LEADERBOARD OFFLINE";
    }
  }

  root.NeonSnakeAccount = {
    profile: null,
    refresh: () => Promise.all([loadAccount(), loadLeaderboard()]),
  };
  root.addEventListener("neon-activity-ready", () => {
    void root.NeonSnakeAccount.refresh();
  });
  if (root.NeonSnakeActivity?.embedded) {
    void root.NeonSnakeActivity.ready
      .then(() => root.NeonSnakeAccount.refresh())
      .catch(() => {});
  }
  void root.NeonSnakeAccount.refresh();
  if (leaderboard) {
    setInterval(() => {
      if (!document.hidden) void loadLeaderboard();
    }, 12_000);
  }
})(globalThis);
