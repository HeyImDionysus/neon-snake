plugins {
    id("com.android.application")
}

android {
    namespace = "app.neonsnake.wallpaper"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.neonsnake.wallpaper"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.1.1"
    }

    // Android refuses to update a package signed by a different certificate.
    // Every CI run used to generate a fresh debug keystore, so each published
    // build carried a different certificate and players had to uninstall the
    // previous version before they could install the next one. A release build
    // signs with one stable keystore supplied by the environment; without it the
    // release build is left unsigned rather than silently signed with a throwaway
    // key.
    val releaseKeystore = System.getenv("ANDROID_KEYSTORE_PATH")
    signingConfigs {
        if (!releaseKeystore.isNullOrBlank()) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (!releaseKeystore.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
