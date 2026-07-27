(function initializeProfilePage() {
  "use strict";

  const Config = globalThis.NeonSnakeProfileConfig;
  const loading = document.querySelector("#profileLoading");
  const error = document.querySelector("#profileError");
  const card = document.querySelector("#profileCard");
  const form = document.querySelector("#profileEditor");
  const logout = document.querySelector("#logoutProfileButton");
  const copy = document.querySelector("#copyProfileButton");
  const save = form.querySelector("button[type=submit]");
  const reset = form.querySelector("button[type=reset]");
  const saveStatus = document.querySelector("#profileSaveStatus");
  const draftState = document.querySelector("#profileDraftState");
  const requestedUser = new URLSearchParams(location.search).get("user") || "";
  let currentProfile = null;
  let persistedDraft = Config.normalizeDraft();
  let saving = false;

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
    previewCallsign: document.querySelector("#profilePreviewCallsign"),
    previewUsername: document.querySelector("#profilePreviewUsername"),
    previewBio: document.querySelector("#profilePreviewBio"),
    callsignInput: document.querySelector("#callsignInput"),
    bioInput: document.querySelector("#bioInput"),
    callsignCount: document.querySelector("#callsignCount"),
    bioCount: document.querySelector("#bioCount"),
  };

  function setText(node, value) {
    if (node) node.textContent = String(value ?? "");
  }

  function selectedValue(name, fallback) {
    return form.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function selectValue(name, value) {
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  function draftFromControls() {
    return Config.normalizeDraft({
      callsign: fields.callsignInput.value,
      bio: fields.bioInput.value,
      accent: selectedValue("accent", "acid"),
      favoriteMode: selectedValue("favoriteMode", "classic"),
      snakeStyle: selectedValue("snakeStyle", "signal"),
    });
  }

  function writeControls(draft) {
    fields.callsignInput.value = draft.callsign;
    fields.bioInput.value = draft.bio;
    selectValue("accent", draft.accent);
    selectValue("favoriteMode", draft.favoriteMode);
    selectValue("snakeStyle", draft.snakeStyle);
  }

  function updateCounts() {
    setText(fields.callsignCount, `${fields.callsignInput.value.length} / 24`);
    setText(fields.bioCount, `${fields.bioInput.value.length} / 120`);
  }

  function applyDraftPreview(draft, {
    updateState = true,
  } = {}) {
    const displayCallsign = draft.callsign || currentProfile?.displayName || "Discord Player";
    const displayBio = draft.bio || "No player bio yet.";
    document.body.dataset.profileAccent = draft.accent;
    document.body.dataset.snakeStyle = draft.snakeStyle;
    setText(fields.callsign, displayCallsign);
    setText(fields.bio, displayBio);
    setText(fields.previewCallsign, displayCallsign);
    setText(fields.previewUsername, `@${currentProfile?.username || "player"}`);
    setText(fields.previewBio, displayBio);
    setText(fields.snakeStyle, draft.snakeStyle.toUpperCase());
    setText(fields.favoriteMode, draft.favoriteMode.toUpperCase());
    setText(fields.accent, draft.accent.toUpperCase());
    updateCounts();

    if (!updateState) return;
    const dirty = !Config.draftsEqual(draft, persistedDraft);
    save.disabled = saving || !dirty;
    reset.disabled = saving || !dirty;
    draftState.classList.toggle("is-dirty", dirty);
    setText(draftState, dirty ? "UNSAVED PREVIEW" : "SAVED");
    if (!saving) {
      setText(saveStatus, dirty
        ? "PREVIEWING CHANGES · SAVE TO PUBLISH"
        : "YOUR PROFILE IS UP TO DATE");
    }
  }

  function render(profile, editable) {
    currentProfile = profile;
    persistedDraft = Config.profileDraft(profile);
    fields.avatar.src = profile.avatarUrl || "/assets/icon-192.png";
    fields.avatar.alt = `${profile.callsign || profile.displayName || "Player"} avatar`;
    setText(fields.presence, profile.online ? "PLAYING NOW" : "OFFLINE");
    fields.presence.classList.toggle("is-online", Boolean(profile.online));
    setText(fields.username, `@${profile.username || "player"}`);
    setText(fields.wins, String(profile.stats?.wins || 0).padStart(2, "0"));
    setText(fields.losses, String(profile.stats?.losses || 0).padStart(2, "0"));
    setText(fields.draws, String(profile.stats?.draws || 0).padStart(2, "0"));
    setText(fields.matches, String(profile.stats?.matches || 0).padStart(2, "0"));
    writeControls(persistedDraft);
    applyDraftPreview(persistedDraft);
    form.hidden = !editable;
    logout.hidden = !editable;
    card.classList.toggle("is-editable", editable);
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
      if (!payload?.profile) throw new Error("Profile payload missing");
      render(payload.profile, Boolean(payload.editable));
    } catch {
      loading.hidden = true;
      error.hidden = false;
    }
  }

  function refreshPreview() {
    applyDraftPreview(draftFromControls());
  }

  form.addEventListener("input", refreshPreview);
  form.addEventListener("change", refreshPreview);

  form.addEventListener("reset", (event) => {
    event.preventDefault();
    if (saving) return;
    writeControls(persistedDraft);
    applyDraftPreview(persistedDraft);
    fields.callsignInput.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = draftFromControls();
    if (saving || Config.draftsEqual(draft, persistedDraft)) return;
    saving = true;
    save.disabled = true;
    reset.disabled = true;
    form.setAttribute("aria-busy", "true");
    draftState.classList.remove("is-dirty");
    setText(draftState, "PUBLISHING");
    setText(saveStatus, "PUBLISHING YOUR PLAYER SIGNAL…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const reason = response.status === 401
          ? "YOUR SESSION EXPIRED · SIGN IN AGAIN"
          : "PROFILE SAVE FAILED · TRY AGAIN";
        throw new Error(reason);
      }
      const payload = await response.json();
      if (!payload?.profile) throw new Error("PROFILE SAVE RETURNED NO PLAYER");
      render(payload.profile, true);
      setText(saveStatus, "PUBLISHED · ROOMS AND RANKINGS NOW USE THIS PROFILE");
      void globalThis.NeonSnakeAccount?.refresh();
    } catch (saveError) {
      applyDraftPreview(draft, { updateState: false });
      draftState.classList.add("is-dirty");
      setText(draftState, "NOT SAVED");
      setText(saveStatus, saveError?.name === "AbortError"
        ? "SAVE TIMED OUT · YOUR PREVIEW IS STILL HERE"
        : saveError?.message || "PROFILE COULD NOT BE SAVED");
    } finally {
      clearTimeout(timeout);
      saving = false;
      form.removeAttribute("aria-busy");
      const dirty = !Config.draftsEqual(draftFromControls(), persistedDraft);
      save.disabled = !dirty;
      reset.disabled = !dirty;
    }
  });

  copy.addEventListener("click", async () => {
    const url = new URL("/profile", location.origin);
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
