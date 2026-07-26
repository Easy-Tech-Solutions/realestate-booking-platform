# Homekonet Mobile

Flutter mobile app for iOS and Android — an exact mobile clone of the Homekonet web UI, sharing the same Django backend.

## Stack

| Layer | Package |
|-------|---------|
| State management | `flutter_riverpod` |
| Navigation | `go_router` |
| HTTP | `dio` + `dio_cookie_manager` + `cookie_jar` |
| Secure storage | `flutter_secure_storage` |
| Images | `cached_network_image` |
| Payments | `flutter_stripe` |

## Auth flow

- Access token stored in `flutter_secure_storage`
- Refresh token lives in an httpOnly cookie handled transparently by `dio_cookie_manager` (same as browser behaviour — no backend changes needed)
- `_AuthInterceptor` in `lib/services/api_client.dart` silently refreshes on 401

## Getting started

```bash
cd mobile
flutter pub get
flutter run              # connects to Android emulator (10.0.2.2:8000)
flutter run --release    # production build → homekonet.com
```

## Environment

API URL is set at compile time in `lib/core/constants.dart`:

```dart
const kApiBaseUrl = kDebugMode
    ? 'http://10.0.2.2:8000'   // Android emulator → host machine
    : 'https://homekonet.com';
```

Change `homekonet.com` to your production domain before building.

## Building for release

### Android

```bash
flutter build apk --release
# or
flutter build appbundle --release
```

Sign the app with a keystore — see `android/app/build.gradle`.

### iOS

```bash
flutter build ios --release
```

Open `ios/Runner.xcworkspace` in Xcode, set the Team, then archive.

## Project structure

```
lib/
  main.dart          entry point
  app.dart           MaterialApp.router
  core/
    constants.dart   API URLs, categories, amenities
    theme.dart       Material 3 theme matching web CSS
    router.dart      GoRouter with ShellRoute (bottom nav)
    utils.dart       date/currency formatting helpers
  models/            Plain Dart data classes with fromJson
  services/          Dio-based API wrappers (one per resource)
  providers/         Riverpod StateNotifier / FutureProvider
  screens/           One folder per feature
  widgets/           Shared reusable widgets
```
