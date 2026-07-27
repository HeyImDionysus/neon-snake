(function initializeProfilePage() {
  "use strict";

  const loading = document.querySelector("#profileLoading");
  const error = document.querySelector("#profileError");
  const card = document.querySelector("#profileCard");
  const editor = document.querySelector("#profileEditor");
  const form = document.querySelector("#profileEditor");
  const logout = document.querySelector("#logoutProfileButton");
  const copy = document.querySelector("#copyProfileButton");
  const saveStatus = document.querySelector("#profileSaveStatus");
  const requestedUser = new URLSearchParams(location.search).get("user") || "";
  let currentProfile = null;

  const fields = {
    avatar: document.querySelector("#profileAvatar"),
    presence: document.querySelector("#profilePresence"),
    callsign: document.querySelector("#profileCallsign"),
    username: document.querySelector("#profileUsername"),
    bio: document.querySelector("#profileBio"),
    wins: document.querySelector("#profileWins"),
    losses: document.querySelector("#profileLosses"),
    draws: document.querySelector("#profileDraws"),
    matches: document.querySelector("#profileMatches"),
    snakeStyle: document.querySelector("#profileSnakeStyle"),
    favoriteMode: document.querySelector("#profileFavoriteMode"),
    accent: document.querySelector("#profileAccent"),
    callsignInput: document.querySelector("#callsignInput"),
    bioInput: document.querySelector("#bioInput"),
    favoriteModeInput: document.querySelector("#favoriteModeInput"),
    snakeStyleInput: document.querySelector("#snakeStyleInput"),
  };

  function setText(node, value) {
    if (node) node.textContent = String(value ?? "");
  }

  function selectedAccent(value) {
    const input = document.querySelector(`input[name="accent"][value="${value}"]`);
    if (input) input.checked = true;
  }

  function render(profile, editable) {
    currentProfile = profile;
    document.body.dataset.profileAccent = profile.accent || "acid";
    document.body.dataset.snakeStyle = profile.snakeStyle || "signal";
    fields.avatar.src = profile.avatarUrl || "/assets/icon-192.png";
    fields.avatar.alt = `${profile.callsign || profile.displayName || "Player"} avatar`;
    setText(fields.presence, profile.online ? "PLAYING NOW" : "OFFLINE");
    fields.presence.classList.toggle("is-online", Boolean(profile.online));
    setText(fields.callsign, profile.callsign || profile.displayName || "Discord Player");
    setText(fields.username, `@${profile.username || "player"}`);
    setText(fields.bio, profile.bio || "No player bio yet.");
    setText(fields.wins, String(profile.stats?.wins || 0).padStart(2, "0"));
    setText(fields.losses, String(profile.stats?.losses || 0).padStart(2, "0"));
    setText(fields.draws, String(profile.stats?.draws || 0).padStart(2, "0"));
    setText(fields.matches, String(profile.stats?.matches || 0).padStart(2, "0"));
    setText(fields.snakeStyle, profile.snakeStyle || "signal");
    setText(fields.favoriteMode, profile.favoriteMode || "classic");
    setText(fields.accent, profile.accent || "acid");
    fields.callsignInput.value = profile.callsign || "";
    fields.bioInput.value = profile.bio || "";
    fields.favoriteModeInput.value = profile.favoriteMode || "classic";
    fields.snakeStyleInput.value = profile.snakeStyle || "signal";
    selectedAccent(profile.accent || "acid");
    editor.hidden = !editable;
    logout.hidden = !editable;
    loading.hidden = true;
    error.hidden = true;
    card.hidden = false;
    document.title = `${profile.callsign || profile.displayName || "Player"} (@${profile.username}) — Neon Snake`;
  }

  async function loadProfile() {
    const endpoint = requestedUser
      ? `/api/profile?user=${encodeURIComponent(requestedUser)}`
      : "/api/profile";
    try {
      const response = await fetch(endpoint, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Profile unavailable");
      const payload = await response.json();
      render(payload.profile, Boolean(payload.editable));
    } catch {
      loading.hidden = true;
      error.hidden = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    saveStatus.textContent = "SAVING…";
    const accent = form.querySelector("input[name=accent]:checked")?.value || "acid";
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callsign: fields.callsignInput.value,
          bio: fields.bioInput.value,
          accent,
          favoriteMode: fields.favoriteModeInput.value,
          snakeStyle: fields.snakeStyleInput.value,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      const payload = await response.json();
      render(payload.profile, true);
      saveStatus.textContent = "PROFILE SAVED";
      void globalThis.NeonSnakeAccount?.refresh();
    } catch {
      saveStatus.textContent = "PROFILE COULD NOT BE SAVED";
    } finally {
      submit.disabled = false;
    }
  });

  copy.addEventListener("click", async () => {
    const url = new URL("/profile.html", location.origin);
    url.searchParams.set("user", currentProfile?.username || requestedUser);
    try {
      await navigator.clipboard.writeText(url.href);
      copy.firstChild.textContent = "Profile link copied ";
    } catch {
      copy.firstChild.textContent = "Copy unavailable ";
    }
  });

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
      location.href = "./";
    } catch {
      logout.disabled = false;
    }
  });

  void loadProfile();
})();
