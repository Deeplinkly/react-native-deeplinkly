# Changelog

All notable changes to `react-native-deeplinkly`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-08-27

### Added

- `setUserData()` records the email, phone, name and address a conversion is
  matched on at Meta's Conversions API and Google's enhanced conversions. Every
  field is optional and each call merges, so you can supply an email at sign-up
  and an address at checkout. Values are sent as supplied and hashed only when a
  conversion is forwarded — the digest of a normalised email is exactly the
  value Meta matches on, so hashing on device would look safer and buy nothing.
- `clearUserData()` erases those fields on the device *and* on the server: each
  previously-set field is reported empty until the erasure is delivered, so a
  clear on an offline device still takes effect.
- `logPurchase({ value, currency, ... })`, a typed wrapper over `logEvent` that
  sends the `purchase` event with the one spelling of `value`/`currency` both
  destinations can be built from.
- Every event now carries a client-generated event id, which makes a replay off
  the retry queue idempotent rather than a double count.

### Changed

- Bundles `deeplinkly-android` 1.3.0 (was 1.2.0) and `Deeplinkly` iOS 1.2.0
  (was 1.1.0), which is where all of the above is implemented — this package is
  the bridge. Signal catalogue version 9.

## [1.1.0] — 2026-08-27

### Added

- The Google Ads `gbraid` and `wbraid` click identifiers are collected and
  reported by the underlying native SDKs. Signal catalogue version 8; both are
  classified `reduced`, so they ship at every attribution level except `none`.
  On iOS this is the material change — Google App campaigns deliver `gbraid`
  because there is no IDFA to match on, and it was previously discarded.

### Changed

- Bundles `deeplinkly-android` 1.2.0 (was 1.1.1) and `Deeplinkly` iOS 1.1.0
  (was 1.0.1). No JavaScript API change.

## [1.0.0] — 2026-08-17

Same code as 0.1.0, with the reference docs corrected. The version number is a
stability commitment to the **API surface** — the exported methods, their
argument shapes, and their documented failure values are now covered by semver
and will not change without a major bump.

It is not a statement that every code path has been exercised on a device. See
**Unverified** below and read it before shipping this in an app.

### Fixed

- **Reference docs described `generateLink`'s result with the wrong key names.**
  `docs/REACT_NATIVE_SDK.md` documented `{ success, url?, error_code?,
  error_message? }`, but the package resolves camelCase `errorCode` /
  `errorMessage` — `src/index.tsx` maps the native response before it reaches
  JS. Anyone following the docs read `undefined` on every failure. The docs now
  match the code, list the two bridge-local codes (`NULL_NATIVE_RESPONSE`,
  `NATIVE_EXCEPTION`), and explain why this one result is mapped while the deep
  link envelope's `click_id` / `params` are forwarded unchanged.

### Unverified

Not observed working, and not to be assumed. Nothing here is known broken — it
is untested, which is a different claim:

- **iOS runtime behaviour of any kind.** It compiles and its unit tests pass,
  but the app has never been launched and no link has ever been driven through
  it.
- **App Links and Universal Links, on both platforms.** No `https` link has
  reached the app in testing. Android was driven with `-n` to force the
  component, which exercises the SDK path faithfully but bypasses intent-filter
  matching entirely.
- **Deferred deep linking on Android.** The install-referrer path is reached but
  never exercised; it needs an install from a Play internal-test track.
- **`<DeeplinklyPasteButton>`.** `UIPasteControl` has never been rendered.
- **The legacy architecture at runtime.** Compiled, unit-tested, never launched.
  All device runs were `newArchEnabled=true`.
- **The Objective-C AppDelegate integration.** The `__has_include` pair for
  framework vs static-library linkage is written from documented behaviour.

### Two things that will bite a host app

- **Kotlin 2.2.0 is a hard floor.** The native Android SDK's metadata is
  unreadable by a 2.0.x compiler, and hosts on the React Native 0.79 template
  land on 2.0.21. `android/build.gradle` fails the build with instructions
  rather than letting the compiler emit an `Internal compiler error` over a wall
  of FIR frames. The classpath entry must be versioned explicitly — left bare,
  `ext.kotlinVersion` is silently ignored.
- **iOS requires host AppDelegate wiring.** Unlike the Flutter plugin, a React
  Native native module cannot receive app-delegate callbacks, so **no deep link
  reaches the SDK** until the host forwards them. Apps adopting `UISceneDelegate`
  need the three scene callbacks instead. See
  [Forward links from your AppDelegate](docs/REACT_NATIVE_SDK.md#forward-links-from-your-appdelegate).

### Native SDKs

Pinned exactly; a host cannot pick these independently.

| Layer   | Artifact                                  |
| ------- | ----------------------------------------- |
| Android | `com.deeplinkly:deeplinkly-android:1.1.1` |
| iOS     | pod `Deeplinkly`, `1.0.1`                 |

## [0.1.0] — 2026-08-17

First publish. The bridge over the native Deeplinkly SDKs: deep links, deferred
deep linking, install referrer tracking, and attribution, on both the new and
legacy React Native architectures.

- Deep link delivery through `addListener`, with native buffering so a cold
  start does not race the JS bundle.
- Identity (`getDeeplinklyId`, `setUserId`), install attribution, custom events,
  and link generation.
- Privacy controls: `setTrackingEnabled`, `resetPrivacyData`, and the four
  attribution levels.
- iOS deferred deep linking by pasteboard, with `<DeeplinklyPasteButton>` as the
  banner-free path.
- Validation enforced natively rather than in JavaScript, so a native-only
  integration and this package answer the same for the same input.

[1.1.0]: https://github.com/Deeplinkly/react-native-deeplinkly/releases/tag/v1.1.0
[1.0.0]: https://github.com/Deeplinkly/react-native-deeplinkly/releases/tag/v1.0.0
[0.1.0]: https://github.com/Deeplinkly/react-native-deeplinkly/releases/tag/v0.1.0
