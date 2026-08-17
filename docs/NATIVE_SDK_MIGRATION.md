# React Native bridge — status and handoff

## Why this exists

`react-native-deeplinkly` is the fourth surface over the same two native SDKs.
It was written after the Android and iOS SDKs had been extracted and after
`flutter_deeplinkly` had been reduced to a bridge over them, so it started where
the Flutter plugin ended up rather than repeating its history.

This page records what is load-bearing, what is verified, and what is not — the
things a reader cannot recover from the code alone.

## Repos and packages

| Surface | Repo | Package |
| --- | --- | --- |
| Android SDK | `android_deeplinkly` | `com.deeplinkly:deeplinkly-android` 1.1.1 |
| iOS SDK | `ios_deeplinkly` | pod `Deeplinkly` 1.0.1 (also SPM) |
| Flutter | `flutter_deeplinkly` | `flutter_deeplinkly` 1.9.2 |
| React Native | `react_native_deeplinkly` | `react-native-deeplinkly` 0.1.0 |

Public API on Android is `com.deeplinkly.android_deeplinkly.Deeplinkly` — an
`object`. On iOS it is `Deeplinkly`, a **caseless enum**: a static namespace, not
a singleton, so calls are `Deeplinkly.foo()` and never `Deeplinkly.shared.foo()`.

## Current state

Both modules are implemented and delegate fully. The public JS API is complete
and matches the Flutter plugin's surface, plus `isAvailable()`. Both React Native
architectures build.

## Constraints — read before changing anything

**Never attach the deep link listener before JS is listening.** Both SDKs treat
delivery as final: Android drops the link from its persistent queue once
`onDeepLink` returns without throwing, and iOS's `SdkRuntime` buffers only until
a listener attaches. Emitting to `RCTDeviceEventEmitter` with no JS subscriber
**succeeds silently**. So attaching at module construction loses links outright,
with no error anywhere. Android attaches on the explicit `jsReady()` call; iOS
attaches in `startObserving()`, which fires on the first JS `addListener`. These
are the analogue of the Flutter plugin's `flutterReady`.

**Do not pre-validate events or parse link payloads in JavaScript.** Validation
lives in `DeeplinklyEvent` in both SDKs specifically so every host gets the same
answer. `generateLink` flat-merges `content` and `options` and passes the map
through untouched. Adding a JS-side check is how the four surfaces start to
disagree.

**Do not call `Deeplinkly.shutdown()` from `invalidate()` on Android.** The
`Deeplinkly` object outlives React Native's Catalyst instance — a dev-mode reload
builds a new instance against the same singleton — and `init` latches on a
one-way `AtomicBoolean`. Shutting down cancels the IO scope with no way to revive
it, so every later call would target a dead scope. Detach the listener only.

**Kotlin 2.2.0 is a hard floor for host apps.** The native SDK's metadata is
version 2.2.0 and a 2.0.x compiler cannot read it. Gradle loads one Kotlin plugin
per build, so the library cannot fix this for itself. `android/build.gradle`
checks the resolved version and fails with instructions, because the raw symptom
is `Internal compiler error` over a wall of FIR frames.

## Load-bearing decisions

**`autoCaptureLaunchIntents` is left at `true` on Android**, where the Flutter
plugin passes `false`. Flutter can afford `false` because
`ActivityAware.onAttachedToActivity` is a precise once-per-launch signal. React
Native has no equivalent, and `onHostResume` fires on every foreground — hanging
`onActivityLaunch` off it would re-resolve the launch intent and re-fire
attribution on every app switch. Letting the SDK's own
`ActivityLifecycleCallbacks` capture cold starts is the correct analogue.

**Disabled-SDK calls return typed defaults, not one envelope.** The Flutter
plugin answers every method with `{success: false, error_code: "SDK_DISABLED"}`
and relies on Dart's `invokeMethod<bool>` throwing on the unexpected map, which
its wrapper catches into `false`. A typed TurboModule cannot resolve a map where
it declared a boolean, so each method carries its own correctly-typed failure
value and `isAvailable()` covers what the envelope used to signal. This is the
one intentional divergence in observable behaviour between the two bridges.

**Lifecycle is observed natively, not pushed from JS.** Android uses
`LifecycleEventListener`, iOS `UIApplication.didBecomeActiveNotification`. The
Flutter plugin forwards `onLifecycleChange` from Dart; mirroring that through
`AppState` would miss every transition occurring before the bundle is running.

**iOS link delivery requires host AppDelegate wiring, and cannot be avoided.**
The Flutter plugin calls `registrar.addApplicationDelegate(self)` and a dynamic
`addSceneDelegate:`. React Native gives a native module no access to
app-delegate callbacks, and its template `AppDelegate` contains no linking
support to piggyback on. `RNDeeplinklyLinking` exists to make the host's side as
small as possible; it cannot remove it. This is the single biggest integration
difference from Flutter and the most likely thing for an integrator to miss —
hence its own section in the reference docs.

**iOS is exported with `RCT_EXTERN_MODULE` rather than a hand-written ObjC++
TurboModule.** This serves the legacy architecture directly and the new one
through React Native's interop layer. The consequence is that on iOS the codegen
spec is a type contract only, not a call path. A real ObjC++ shim conforming to
`NativeDeeplinklySpec` and forwarding into Swift would be substantially more
fragile for no runtime gain at this module's call volume. Android does use the
codegen'd spec, via `src/newarch`.

**The paste button is a legacy view manager.** `RCTViewManager` +
`RCT_EXTERN_MODULE`, for the same reason. It also rebuilds its `UIPasteControl`
coalesced on the next runloop turn rather than per prop `didSet`, since props
arrive one at a time and each would otherwise construct and discard a control.

## Verified

- The library compiles on both architectures (`newArchEnabled` true and false);
  the legacy build produces no codegen output and compiles the hand-written spec,
  confirming the source-set switch actually switches.
- `:app:assembleDebug` succeeds and autolinking registers `DeeplinklyPackage`.
- TypeScript typechecks and `bob build` emits commonjs, module and typescript
  outputs.
- Both native artifacts resolve from their public registries (Maven Central,
  CocoaPods trunk).

## Not verified

Anything marked here was not observed passing and should not be assumed.

- Runtime behaviour on device or simulator: no link has been driven end to end
  through this bridge yet.
- The paste button has not been rendered. `UIPasteControl` needs iOS 16+ and a
  real pasteboard interaction to exercise.
- The legacy architecture has been compiled but not run. React Native 0.87 may
  not support it at runtime at all; the source set exists for hosts on older
  React Native.
- Universal Links and App Links verification, which needs a signed build and a
  dashboard-registered fingerprint.
- Objective-C AppDelegate integration. The `__has_include` pair for framework vs
  static-library linkage is written from the documented behaviour, not tested.

## Environment notes

The example app was regenerated on React Native **0.87.0** after 0.79.0 failed
to build under Xcode 26: RN 0.79's bundled `fmt` does not compile with that
Clang's stricter `consteval` handling. That is a React Native / toolchain
incompatibility, nothing to do with this library, but it is why the example
targets 0.87 and why the library's devDependencies were bumped to match.

Two React Native 0.80-era API moves were absorbed while doing so:
`UnsafeObject` now comes from the `CodegenTypes` namespace exported at the
`react-native` root rather than `react-native/Libraries/Types/CodegenTypes`, and
`NativeEventEmitter` types its payload as `Object`, so the envelope's shape is
asserted once in `addListener`.

The example reuses the API key and link domain (`example.deeplinkly.com`) from
`flutter_deeplinkly/example`, so it inherits a domain-verified setup. That
example's `Info.plist` still carries a `YOUR_API_KEY_HERE` placeholder — the real
key was only ever in its Android manifest.

## Open items

1. Run the example on simulator and emulator; drive a link end to end.
2. Render and tap the paste button on an iOS 16+ device.
3. Unit tests. Android has a Robolectric suite in `flutter_deeplinkly` worth
   mirroring for the gate and the listener-attach discipline.
4. CI.
5. Decide whether to publish. `package.json` still says `0.1.0` and the version
   is not yet tagged anywhere.
