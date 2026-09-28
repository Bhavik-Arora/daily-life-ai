# Building Daily Life APK

Since GitHub Actions CI is complex, here's how to build the APK locally on your Windows machine:

## Prerequisites
1. **Download Android Studio** from https://developer.android.com/studio
2. **Install it** (includes Android SDK)
3. **Install Java 17** (if not already installed)

## Build Steps

### Option 1: Using Android Studio (Easiest)
1. Open Android Studio
2. Click **File** → **Open**
3. Select the `android` folder in this project
4. Wait for Gradle to sync
5. Click **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
6. APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Option 2: Using Command Line
```bash
cd android
./gradlew assembleDebug
```

The APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

## Installing on Your Phone

1. Connect your Android phone via USB
2. Enable "Developer Mode" (tap Build Number 7 times in Settings)
3. Enable "USB Debugging" in Developer Options
4. Run: `adb install android/app/build/outputs/apk/debug/app-debug.apk`

Or simply transfer the APK file and tap it on your phone to install.

## Troubleshooting

- **Gradle not found**: Make sure Java 17 is installed and in your PATH
- **Android SDK not found**: Set `ANDROID_HOME` environment variable to your Android Studio SDK location
- **Gradlew permission denied**: Run `chmod +x android/gradlew` first

## What's Inside the APK

- Your web app (HTML, CSS, JS from `public/` folder)
- Capacitor runtime for native Android features
- Google Sign-in support
- Voice input/output capabilities
