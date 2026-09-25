plugins {
    id("com.android.application")
}

// The project has one version, in the repository's package.json. The Android
// build derives versionName from it and a versionCode that always increases
// (major * 10000 + minor * 100 + patch), so a release can never ship with a
// stale or reused version.
val projectVersion: MatchResult.Destructured =
    Regex("\"version\"\\s*:\\s*\"(\\d+)\\.(\\d+)\\.(\\d+)\"")
        .find(rootProject.file("../../package.json").readText())
        ?.destructured
        ?: error("package.json must declare a major.minor.patch version")
val (versionMajor, versionMinor, versionPatch) = projectVersion

android {
    namespace = "app.neonsnake.wallpaper"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.neonsnake.wallpaper"
        minSdk = 26
        targetSdk = 36
        versionCode = versionMajor.toInt() * 10000 + versionMinor.toInt() * 100 + versionPatch.toInt()
        versionName = "$versionMajor.$versionMinor.$versionPatch"
    }

    // Android installs only signed APKs. Releases are signed with the build
    // machine's own debug key, so there is no key or secret to manage; the
    // cost is that each release carries a new certificate, and Android makes
    // players uninstall the previous version before installing the next.

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
