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

**Android emits through `reactApplicationContext.emitDeviceEvent`**, not
`getJSModule(RCTDeviceEventEmitter)`. The latter is the bridge-era call; bridgeless
has been the default since React Native 0.74. `emitDeviceEvent` is supported in
both modes and null-checks the emitter rather than throwing when JS is not up.

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

Against React Native 0.87.0, Xcode 26.6, JDK 17, Kotlin 2.2.0.

- **Android**: `:app:assembleDebug` → `BUILD SUCCESSFUL`, and autolinking
  registers `DeeplinklyPackage` in the generated `PackageList.java`.
- **Android, both architectures**: the library compiles with `newArchEnabled`
  true and false. The legacy build emits no codegen output and compiles the
  hand-written spec, so the source-set switch demonstrably switches.
- **iOS**: `pod install` resolves 88 pods including `Deeplinkly (1.0.1)`, codegen
  emits `RNDeeplinklySpec` / `RNDeeplinklySpecJSI.h`, and `xcodebuild` for the
  iPhone 17 simulator → `** BUILD SUCCEEDED **`. That covers the Swift module,
  `RNDeeplinklyLinking`, the paste-button view and manager, and the host
  AppDelegate forwarding.
- TypeScript typechecks; `bob build` emits commonjs, module and typescript
  outputs; the example app typechecks against the library.
- Both native artifacts resolve from their public registries (Maven Central,
  CocoaPods trunk).

## Not verified

Anything marked here was not observed passing and should not be assumed.
**Nothing has been run yet** — every claim above is a compile-time result.

- **Runtime behaviour of any kind.** Both platforms build, but neither app has
  been launched. No link has been driven end to end, no method has been observed
  returning a real value, and the iOS module's runtime resolution is an open
  question (see the open risk below).
- The paste button has not been rendered. `UIPasteControl` needs iOS 16+ and a
  real pasteboard interaction to exercise.
- The legacy architecture has been compiled but not run. React Native 0.87 may
  not support it at runtime at all; the source set exists for hosts on older
  React Native.
- Universal Links and App Links verification, which needs a signed build and a
  dashboard-registered fingerprint.
- Objective-C AppDelegate integration. The `__has_include` pair for framework vs
  static-library linkage is written from the documented behaviour, not tested.

## Open risk — iOS module resolution at runtime

**Still unresolved. It compiles; whether it resolves has not been observed.**

`useTurboModuleInterop()` returns `false` by default in React Native 0.87
(`ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h`). The iOS
module is a Swift `RCTEventEmitter` exported with `RCT_EXTERN_MODULE`, i.e. a
legacy native module, so the new architecture does not bridge it into the
TurboModule registry via that flag.

Two observations, neither conclusive:

- Codegen **does** generate `RNDeeplinklySpec` and the JSI header, so the spec
  side is wired.
- `RNDeeplinkly` does **not** appear in
  `build/generated/ios/ReactCodegen/RCTModuleProviders.mm` — but that file's
  `moduleMapping` is empty for *every* module in this app, so it is not the
  resolution path here and proves nothing either way.

The definitive check is runtime: launch the example and confirm
`Deeplinkly.isAvailable()` resolves rather than the not-linked proxy throwing.
The example logs it on mount, so it is the first line on screen.

If it does not resolve, the fix is an ObjC++ shim conforming to the generated
`NativeDeeplinklySpec` protocol (`build/generated/ios/ReactCodegen/RNDeeplinklySpec/RNDeeplinklySpec.h`,
declared as `@protocol NativeDeeplinklySpec <RCTBridgeModule, RCTTurboModule>`)
forwarding into the Swift implementation — *not* asking host apps to flip a
feature flag, which a library has no business requiring. That would reverse the
"RCT_EXTERN_MODULE is enough" decision recorded above, so update that section too.

Android is unaffected: it uses the codegen'd spec directly via `src/newarch`.

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

## Resume here

Picking this up cold, in order:

Everything below the "already green" line has been observed passing, so start at
step 1 only if something looks broken. **The real remaining work is step 2.**

```bash
cd ~/StudioProjects/react_native_deeplinkly

# 1. Already green — re-run only to confirm nothing rotted.
npx tsc --noEmit && npx bob build
cd example/android
./gradlew :app:assembleDebug
./gradlew :react-native-deeplinkly:assembleDebug -PnewArchEnabled=false
cd ../ios && pod install && xcodebuild -workspace DeeplinklyExample.xcworkspace \
  -scheme DeeplinklyExample -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' build

# 2. NOT YET DONE — run it. Metro must be up first.
cd .. && npx react-native start          # leave running
npm run ios                              # and, separately: npm run android
```

Then, with the app on screen:

```bash
xcrun simctl openurl booted "deeplinkly://open?screen=home"
adb shell am start -W -a android.intent.action.VIEW -d "deeplinkly://open?screen=home"
```

The example logs every call and every received link on screen, so this is the
whole runtime check. In order, confirm:

1. `isAvailable: true` — anything else means the API key is not being read, or on
   iOS that the module did not resolve at all (the open risk above).
2. `deeplinklyId` is non-empty.
3. Each button resolves without the not-linked proxy throwing.
4. Sending a link produces exactly **one** `{click_id, params}` envelope — not
   zero (listener attached too late) and not two (listener attached twice).

Point 4 is the one that exercises the design decision this bridge is built
around, so it matters more than the rest.

### Never alias a namespace-qualified codegen type

In `src/NativeDeeplinkly.ts`, write `CodegenTypes.UnsafeObject` at every use
site. **Do not** shorten it:

```ts
type UnsafeObject = CodegenTypes.UnsafeObject;   // sends codegen into an infinite loop
```

`@react-native/codegen`'s TypeScript parser never terminates on that alias. It
does not error — it **spins at 100% CPU forever**, so the symptom is never a
failure message. What you see instead is a Gradle build parked at
`generateCodegenSchemaFromJavaScript`, or a `pod install` that never returns
while itself using almost no CPU, because both are blocked on a codegen child
that will never finish.

Four such processes accumulated in one session, 60–90 CPU-minutes each, pushing
load average past 50 and making every unrelated build on the machine look
mysteriously slow. That is the tell: *everything* is slow, not just this project.

Bisected with three minimal specs — the alias spins; an inline
`CodegenTypes.UnsafeObject` and a spec with no `UnsafeObject` at all both parse
in about a second. The alias entered the repo while adapting to React Native
0.80's move of `UnsafeObject` to the root `CodegenTypes` namespace, so it never
worked at any point.

If a build looks hung, check this before anything else:

```bash
ps -eo pid,etime,time,%cpu,command | grep -E "[g]enerate-codegen-artifacts|[@]react-native/codegen"
```

Growing CPU time at ~100% is this bug, not slow progress. Those processes never
terminate on their own; kill them.

### The example *must* be installed into `example/node_modules`

`example/package.json` depends on the library as `file:..`, which symlinks
`example/node_modules/react-native-deeplinkly` to the repo root. Keep it.

This does create a cycle — the repo root contains `example/`, so
`example/node_modules/react-native-deeplinkly/example/node_modules/…` resolves
forever — and removing the dependency was tried as a fix for the spin above. It
is not the cause, and removing it **breaks iOS**: Android autolinking reads
`react-native.config.js`, but iOS codegen discovers packages by scanning
`node_modules` for `codegenConfig`. Without the symlink, `pod install` completes
happily and silently generates no spec at all — no
`build/generated/ios/ReactCodegen/RNDeeplinklySpec/`.

Both mechanisms are therefore load-bearing and neither is redundant:

- `example/react-native.config.js` — points Android autolinking at the repo root
  so Gradle compiles the sources being edited.
- `example/metro.config.js` — `watchFolders` plus a `blockList` for the root's own
  `react` / `react-native` copies, so the bundle never gets two React instances.

### One `pod install` at a time

CocoaPods takes no lock, so concurrent runs against the same project interfere.
Beware also that `pgrep -f "pod install"` **matches the command line of the shell
running the pgrep**, so a naive `until ! pgrep -f …` waiter never exits and a
process count includes the watcher itself — that misreading cost time here.
Match the interpreter instead (`ps -eo command | grep "[r]uby.*bin/pod"`) or wait
on a captured PID.

The Android emulator is `Pixel_10_Pro`; iOS simulators include `iPhone 17`.
`example/android/local.properties` is gitignored and must be recreated with
`sdk.dir=$HOME/Library/Android/sdk`.

## Open items

1. Settle the iOS new-architecture resolution question above, then build and run
   the example on simulator and emulator and drive a link end to end.
2. Render and tap the paste button on an iOS 16+ device.
3. Unit tests. Android has a Robolectric suite in `flutter_deeplinkly` worth
   mirroring for the gate and the listener-attach discipline.
4. CI.
5. Decide whether to publish. `package.json` still says `0.1.0` and the version
   is not yet tagged anywhere.
