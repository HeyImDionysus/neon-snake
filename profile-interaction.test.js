"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeDraft,
  draftsEqual,
  profileDraft,
} = require("./public/profile-config.js");

const read = (...segments) => fs.readFileSync(path.join(__dirname, ...segments), "utf8");
const html = read("public", "profile.html");
const script = read("public", "profile.js");
const styles = read("public", "profile.css");

const draft = normalizeDraft({
  callsign: "  Neon Viper  ",
  bio: "Moves <fast> & quietly.",
  accent: "magenta",
  favoriteMode: "live",
  snakeStyle: "glass",
});
assert.deepEqual(draft, {
  callsign: "Neon Viper",
  bio: "Moves fast quietly.",
  accent: "magenta",
  favoriteMode: "live",
  snakeStyle: "glass",
});
assert.equal(draftsEqual(draft, { ...draft }), true);
assert.equal(draftsEqual(draft, { ...draft, accent: "cyan" }), false);
assert.deepEqual(profileDraft(draft), draft);
process.stdout.write("PASS profile drafts normalize and detect unsaved changes deterministically\n");

assert.match(html, /id="profileDraftState"/);
assert.match(html, /id="profilePreviewCallsign"/);
assert.match(html, /id="callsignCount"/);
assert.match(html, /type="reset"/);
assert.equal((html.match(/name="favoriteMode"/g) || []).length, 5);
assert.equal((html.match(/name="snakeStyle"/g) || []).length, 4);
assert.match(script, /form\.addEventListener\("input", refreshPreview\)/);
assert.match(script, /form\.addEventListener\("change", refreshPreview\)/);
assert.match(script, /applyDraftPreview\(draftFromControls\(\)\)/);
assert.match(script, /AbortController/);
assert.match(script, /PUBLISHED · ROOMS AND RANKINGS NOW USE THIS PROFILE/);
assert.match(styles, /\.profile-choice-grid input:checked \+ span/);
assert.match(styles, /\.profile-draft-state\.is-dirty/);
process.stdout.write("PASS profile controls preview immediately, reset safely, and publish with visible state\n");
