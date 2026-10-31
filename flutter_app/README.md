# EURO CARS — Flutter Android

Native Flutter Android client for the existing EURO CARS platform. It calls the current Next.js API and uses Android secure storage for the signed mobile session; it does not connect directly to Supabase with privileged credentials.

## API endpoint
Default: `https://al-euro-cdzo.onrender.com`

Override for a build with:

```sh
flutter build apk --release --dart-define=EURO_API_URL=https://your-api.example.com --target-platform android-arm,android-arm64
```

## Local build
With Flutter stable installed:

```sh
flutter create --platforms=android --org com.eurocars .
flutter pub get
flutter analyze
flutter test
flutter build apk --release --target-platform android-arm,android-arm64
```

The GitHub Actions workflow runs analysis and tests, builds the APK for ARM32 and ARM64, verifies the archive and Android signature, and uploads the APK only if the checks pass.
