(function initializeNeonAccount(root) {
  "use strict";

  const controls = [...document.querySelectorAll("[data-account-control]")];
  const leaderboard = document.querySelector("#onlineLeaderboard");
  const status = document.querySelector("#onlineLeaderboardStatus");

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
      identity.append(element("strong", "", profile.displayName || "Discord Player"));
      const logout = element("button", "account-logout", "Sign out");
      logout.type = "button";
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try {
          const response = await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (!response.ok) throw new Error("Logout failed");
          renderSignedOut();
        } catch {
          logout.disabled = false;
        }
      });
      control.append(identity, logout);
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
      const rank = element("span", "run-position", String(entry.rank).padStart(2, "0"));
      const player = element("span", "online-player");
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
      player.append(element("strong", "", entry.displayName || "Discord Player"));
      const wins = element("strong", "online-wins", String(entry.wins || 0).padStart(2, "0"));
      item.append(rank, player, wins);
      leaderboard.append(item);
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
      renderLeaderboard(Array.isArray(payload.entries) ? payload.entries : []);
      if (status) status.textContent = "SERVER-VERIFIED LIVE WINS";
    } catch {
      renderLeaderboard([]);
      if (status) status.textContent = "LEADERBOARD OFFLINE";
    }
  }

  root.NeonSnakeAccount = {
    profile: null,
    refresh: () => Promise.all([loadAccount(), loadLeaderboard()]),
  };
  void root.NeonSnakeAccount.refresh();
})(globalThis);
