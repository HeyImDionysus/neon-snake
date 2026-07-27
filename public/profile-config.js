(function exposeProfileConfig(root) {
  "use strict";

  const ACCENTS = new Set(["acid", "cyan", "violet", "magenta", "ember"]);
  const MODES = new Set(["classic", "portal", "rush", "canvas", "live"]);
  const SNAKES = new Set(["signal", "spectral", "glass", "ember"]);

  function cleanText(value, maximum) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[<>&]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, maximum)
      .trim();
  }

  function normalizeDraft(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const accent = String(source.accent || "").toLowerCase();
    const favoriteMode = String(source.favoriteMode || "").toLowerCase();
    const snakeStyle = String(source.snakeStyle || "").toLowerCase();
    return {
      callsign: cleanText(source.callsign, 24),
      bio: cleanText(source.bio, 120),
      accent: ACCENTS.has(accent) ? accent : "acid",
      favoriteMode: MODES.has(favoriteMode) ? favoriteMode : "classic",
      snakeStyle: SNAKES.has(snakeStyle) ? snakeStyle : "signal",
    };
  }

  function draftsEqual(first, second) {
    const left = normalizeDraft(first);
    const right = normalizeDraft(second);
    return Object.keys(left).every((key) => left[key] === right[key]);
  }

  function profileDraft(profile = {}) {
    return normalizeDraft({
      callsign: profile.callsign,
      bio: profile.bio,
      accent: profile.accent,
      favoriteMode: profile.favoriteMode,
      snakeStyle: profile.snakeStyle,
    });
  }

  const api = { normalizeDraft, draftsEqual, profileDraft };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NeonSnakeProfileConfig = api;
})(typeof globalThis === "object" ? globalThis : this);
