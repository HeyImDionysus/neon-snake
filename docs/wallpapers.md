# Installing the Neon Snake wallpapers

Downloads live at <https://neon-snake-green-tau.vercel.app/downloads.html>. Each
file's SHA-256 is printed under its download button; compare it with
`certutil -hashfile <file> SHA256` (Windows) or `sha256sum <file>` (Linux/macOS).

## Windows (Lively Wallpaper)

1. Install the free [Lively Wallpaper](https://www.rocksdanister.com/lively/) app.
2. Download `Neon-Snake-Lively-v1.1.3.zip`.
3. In Lively, choose **Add Wallpaper** and select the ZIP.
4. Pick **Neon Snake — Live Autopilot** and open its settings to change palette,
   speed, glow, frame rate, boundary mode and mark visibility.

The wallpaper runs offline and uses the game's own rules engine. It stops
animating whenever Lively pauses it (for example behind a fullscreen game) and
whenever the page is hidden.

v1.1.3 fixes pausing: earlier builds read Lively's pause message as a number,
got `NaN`, and kept animating through every pause. Replace any earlier build.

## Android (live wallpaper)

1. If an earlier build is installed, uninstall it first. Every build so far was
   signed with a different key, and Android refuses to update an app whose
   signing key changed. Builds from the release workflow will share one key.
2. Download the APK and allow installation from your browser when asked.
3. Open **Neon Snake Wallpaper** and tap **Set wallpaper**.

The Android wallpaper is a lightweight native version: it requests no network
permission, stops drawing while hidden and lowers its frame rate in battery
saver.

## Building from source

```sh
npm ci --ignore-scripts
node scripts/build-wallpapers.mjs      # dist/wallpapers/Neon-Snake-Lively.zip
gradle -p wallpaper/android :app:assembleDebug
```

The Lively archive is reproducible: the same source produces the same bytes.
Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed.
