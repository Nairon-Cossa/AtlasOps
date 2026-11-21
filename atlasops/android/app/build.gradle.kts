plugins { id("com.android.application") }
android {
 namespace = "mz.atlasops.mobile"
 compileSdk = 37
 defaultConfig { applicationId = "mz.atlasops.mobile"; minSdk = 29; targetSdk = 36; versionCode = 1; versionName = "1.0.0" }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 buildFeatures { buildConfig = true }
}
dependencies {
 implementation("androidx.core:core-ktx:1.19.0")
 implementation("androidx.work:work-runtime-ktx:2.11.0")
}
