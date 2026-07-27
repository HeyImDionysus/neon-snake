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
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
