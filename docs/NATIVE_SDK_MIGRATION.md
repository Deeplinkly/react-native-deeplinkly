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

**Android direct links are verified on a device**, against a live backend: cold
and warm links each deliver exactly one envelope, and every method returns a real
value. Getting there found and fixed one silent bug — `onActivityLaunch` was never
being called, which dropped every cold-start link *and* killed deferred deep
linking; see the `autoCaptureLaunchIntents` decision below.

**iOS is verified on the simulator**, and more fully than expected: the module
resolves at runtime — closing the one open risk this document carried — every
method returns a real value, two real links each delivered exactly one envelope
while buffered until JS subscribed, and **deferred deep linking works end to end
via the pasteboard**, attributed `source: clipboard`. Its API key now comes from a
gitignored file too.

**Deferred deep linking on Android is the largest remaining behavioural gap.** The
path is reached but never exercised, because an `adb` install has no Play referrer;
it needs a Play-track install. iOS no longer needs signed hardware for this — the
simulator was enough.

Still outstanding overall: Android deferred, and the iOS items that genuinely need
a signed device — Universal Links and the `UIPasteControl` paste button.

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

**`autoCaptureLaunchIntents` is passed `false` on Android, and the module drives
`onActivityLaunch` itself exactly once.** This reverses an earlier decision that
left it at `true`; the original reasoning and why it was wrong are worth keeping,
because the failure was silent.

The SDK's automatic capture registers `ActivityLifecycleCallbacks` *inside*
`Deeplinkly.init` and reads the launch intent from `onActivityCreated`
(`Deeplinkly.kt:161-189`). A React Native module is constructed while the JS
bundle is being evaluated — long after `MainActivity.onCreate` has returned — so
those callbacks are registered too late to ever see the launch activity, and the
SDK's `onActivityResumed` is a no-op. Nothing else recovers the intent:
`onNewIntent` only fires for warm starts. The measured result was **zero
deliveries from a cold start, with no `handleIntent` reaching the SDK at all** —
i.e. every link tapped while the app was not running was lost, which is the
primary deep-link case.

**The blast radius was wider than the launch intent.** `onActivityLaunch` does
three things — reads the launch intent, calls
`InstallReferrerHandler.checkInstallReferrer`, and drains both retry queues — and
`checkInstallReferrer` has exactly one call site in the whole SDK
(`Deeplinkly.kt:225`). So while `onActivityLaunch` went uncalled, **deferred deep
linking was entirely dead on this bridge too**, along with the queue drain that
recovers links stranded by an earlier failure.

Deferred is the worse of the two to lose. A dropped cold-start link can be
reproduced on demand; the install referrer is readable only once per install, so
the failure is invisible unless you go looking. Nothing about it is
React-Native-specific, which is why it is recorded here rather than left to be
rediscovered.

The original rejection of the `onHostResume` route was that it fires on every
foreground and would re-resolve the launch intent on each one. That is a real
hazard, so the fix is gated on a one-way `launchCaptured` flag held for the life
of the module instance rather than on the SDK's `EXTRA_CONSUMED` guard, which is
set on the `Intent` instance and so does not survive the activity being recreated
across a configuration change. Once-per-instance makes the replay impossible
instead of merely unlikely, and gives React Native the same precision Flutter
gets from `ActivityAware.onAttachedToActivity`.

Ordering against `jsReady` does not matter, and the cold-start trace confirms it:
the link resolves, `Enqueued delivery` holds it in the persistent queue, and
attaching the listener drains it — `Processing 1 pending deliveries` — so the
buffering the design is built around carries the gap by itself.

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

### Android, on a device

Run on a physical Samsung SM-A336E (Galaxy A33 5G), Android 16, arm64-v8a, over
wireless ADB, against a live backend with a valid key. **Android is behaviourally
verified; iOS is still compile-only.**

- `isAvailable() == true`, `getDeeplinklyId()` returns a stable UUID.
- Every method resolves — no not-linked proxy. `logEvent` → `true`, `setUserId`,
  attribution level round-trips `full → reduced → full`, and both pasteboard
  calls answer `false` as Android should.
- `generateLink` returns `{success: true, url: …}` from the backend, and the
  typed TurboModule carries the native map into JS intact. A failure came back as
  a correctly-shaped error object too, so both branches are exercised.
- **Cold start from a real link delivers exactly one envelope.** `generateLink`
  with `metadata: {screen: 'upgrade', plan: 'pro'}`, then a force-stop and a
  launch from the resulting short link, produced one
  `{click_id, params: {plan: "pro", screen: "upgrade"}}` — a genuine
  `generateLink` → `/resolve` round trip with metadata preserved, delivered
  `source=deep_link` rather than from the fallback.
- **Warm start delivers exactly one envelope**, via `onNewIntent`. Two links
  driven over one session produced exactly two deliveries, one each.
- The listener attaches more than once in a session — on resume and again during
  intent delivery — and still yields one delivery per link. The single-slot
  idempotent re-attach holds in practice, so neither zero nor two.
- The `Resolve rejected (terminal), using fallback with preserved data` path was
  also observed (while the old key was still in place) and delivers URI-local
  params rather than dropping the link.
- `AttributionStore` persists across a process restart; `getInstallAttribution`
  returned the stored `{click_id, source}` on a later launch.
- The library still compiles on the legacy architecture after these changes, and
  `tsc --noEmit` is clean.

### iOS, on the simulator

iPhone 17 simulator, iOS 26.5, new architecture. **Every method and both delivery
paths verified, including deferred. Only the things needing signed hardware are
outstanding.**

- `isAvailable: true`, `deeplinklyId` populated, `attributionLevel: full`,
  `installAttribution: {}`. This settles the module-resolution risk; see below.
- **Two real links delivered exactly one envelope each**, with distinct
  `click_id`s and their own `params` (`{plan: pro, screen: ios_1}` and
  `{…, screen: ios_2}`) — no duplicate, no drop.
- Both arrived *after* the mount log, on a fresh launch, which is the case worth
  having: they were resolved before JS subscribed, buffered by `SdkRuntime`, and
  drained when `startObserving()` attached the listener. That is the iOS half of
  the listener-attach discipline this bridge is built around, and it is now
  observed rather than argued for. Two queued links drained in order without
  either being lost or doubled.
- **Every method answers.** `logEvent(purchase) → true`; `generateLink → {success:
  true, url: https://myott.deeplinkly.com/…}` minted from iOS itself; `setUserId`
  leaves `deeplinklyId` unchanged, correctly, since that is a device id;
  `setAttributionLevel` round-trips `full → reduced → full`.
- The pasteboard pair answers `willShowPasteboardBanner → false` and
  `checkPasteboardNow → true`, against Android's `false`/`false`. Note what that
  `true` means: the SDK's `checkPasteboardNow()` returns `Void`, so the bridge
  resolves `true` for "SDK enabled, call dispatched" — **not** "a link was found".
  Reading it as the latter will mislead.

### iOS deferred deep linking — verified

The full deferred flow, on the simulator, with no signed build:

1. Mint a link, put it on the pasteboard and never open it —
   `printf '%s' "<url>" | xcrun simctl pbcopy booted`.
2. Install fresh and launch. `Deeplinkly.swift:135` runs
   `PasteboardHandler.check` automatically at SDK start, so no button press is
   involved; this is the real first-launch path.
3. iOS raises `"DeeplinklyExample" would like to paste from …`. Allow it.

Result: exactly one envelope, `params={screen: deferred_pasteboard, plan: trial}`,
carrying a **new** `click_id` — resolving by short code mints a fresh ClickEvent,
as it should. The app's own prefs record
`initial_attribution = {click_id: …, source: "clipboard"}`, which is the proof it
travelled the deferred channel rather than arriving as a direct link.

**The `deeplinkly_pasteboard_checked` latch will waste your time.**
`PasteboardHandler.check` sets it even when the pasteboard holds *no* URL
(`PasteboardHandler.swift:149`), because deferred linking is a first-launch
concern and re-reading every launch would re-prompt and re-deliver. So a single
`checkPasteboardNow` against an empty clipboard **permanently disables the
deferred path for that install** — every later attempt logs `Pasteboard already
checked; skipping`, shows no banner, and delivers nothing. That is exactly how the
first attempt here failed, and it looks identical to a broken bridge. Seed the
clipboard *before* the first launch, and reach for
`xcrun simctl uninstall` between attempts; clearing app data is not enough on a
device.

This is the same shape as Android's `install_referrer_handled`: both channels are
once-per-install by design, and both latch on the empty/failed attempt. Whenever a
deferred test "does nothing", check the latch before suspecting the code.

Two smaller traps: on the consent alert the prominent blue button is **"Don't
Allow Paste"**, so muscle memory taps the wrong one. And `willShowPasteboardBanner`
also consults the latch (`PasteboardHandler.swift:114`), so once it is set the
answer is `false` no matter what is on the clipboard — it is not purely a
"is there a URL here" probe.
- The API key reaches the app through the gitignored-file → xcconfig → Info.plist
  chain: the built `DeeplinklyExample.app/Info.plist` carries the real key and
  `DeeplinklyLinkDomains = [myott.deeplinkly.com]`.
- `generate-url` and `resolve` were driven directly against the backend with the
  same key while preparing test links, so the account and key are good from this
  machine.

Blocked, not failed — these need something outside the code:

- **Nothing on the simulator can be driven unattended.** `xcrun simctl openurl`
  with a custom scheme raises an `Open in "DeeplinklyExample"?` confirmation on
  iOS 26 — from the home screen as well as from a foreground app — so even link
  delivery needs a human tap, and `simctl` has no tap command. `osascript` fails
  with `-1719 not allowed assistive access` unless the shell is granted
  Accessibility, and neither `idb` nor `cliclick` is installed. Every iOS result
  above therefore required someone to tap, where Android needed nobody
  (`adb shell input tap` wants no permission). Anything aiming to put the iOS
  checklist in CI has to solve this first — granting Accessibility to the runner,
  or installing `idb`.
- **Universal Links cannot work in this example at all yet.** An `https` link opens
  Safari, correctly: there is no `com.apple.developer.associated-domains`
  entitlement, no `DEVELOPMENT_TEAM`, and the AASA at the link domain cannot list
  an app ID that was never registered.
- **No device run — deferred by choice, 2026-08-17.** The project has no
  `DEVELOPMENT_TEAM` and `PRODUCT_BUNDLE_IDENTIFIER` is still the template's
  `org.reactjs.native.example.DeeplinklyExample`.

  Signing this for a device is not just a missing setting. Every
  `Apple Development: Sahil Asopa` certificate on this machine belongs to a
  *client company* team — CHILL MOVIES LLP, Voovi Digital, 7MOVIES LLP, RISING
  RAYS DIGITAL, Onetakemedia, Mast Digital Media — with no individual team among
  them. All six already have the test iPhone registered, so any would build, but
  each would also register a throwaway test App ID inside a client's developer
  account. That was judged not worth doing for a smoke test; adding a personal
  Apple ID as a team in Xcode is the clean way in when a device run is wanted.

  Note when reading `security find-identity`: the value in parentheses after the
  name is the certificate's individual ID, **not** the team ID. The team is the
  `OU` field of the certificate. Confusing the two makes six company teams look
  like six personal ones.

### Build-time

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
**Everything iOS below the Android section above is still compile-only.**

- **iOS runtime behaviour of any kind.** It builds, but the app has never been
  launched, no link has been driven through it, and the module's runtime
  resolution remains an open question (see the open risk below). None of the
  Android results transfer: the two platforms attach their listeners by different
  mechanisms and export their modules differently.
- The paste button has not been rendered. `UIPasteControl` needs iOS 16+ and a
  real pasteboard interaction to exercise.
- **Android App Links.** The example's `https` intent-filter still names
  `example.deeplinkly.com`, but the current key issues links on
  `myott.deeplinkly.com`, so a real link does not match the filter. The device
  tests forced delivery with `-n com.deeplinklyexample/.MainActivity`, which
  exercises the SDK path faithfully but bypasses filter matching entirely.
  Verifying App Links for real needs the filter host corrected to the key's link
  domain, plus a dashboard-registered signing fingerprint.
- The legacy architecture has been compiled but not run. React Native 0.87 may
  not support it at runtime at all; the source set exists for hosts on older
  React Native. The device runs above were all `newArchEnabled=true`.
- iOS Universal Links, which needs a signed build and a dashboard-registered
  fingerprint.
- Objective-C AppDelegate integration. The `__has_include` pair for framework vs
  static-library linkage is written from the documented behaviour, not tested.
- **Deferred deep linking on Android.** Verified on iOS (see above); still open
  here. It is not a variation on the cold-start test — it is a separate mechanism
  (`InstallReferrerHandler`) that the cold-start pass says nothing about.

  The path is now *reached* — the cold-start delivery proves
  `onActivityLaunch` runs, and `checkInstallReferrer` is two lines below
  `handleIntent` in the same function — but it has never been *exercised*. The
  example was installed with `adb`, so Play has no referrer to hand back:
  `InstallReferrerClient` returns either `OK` with an empty referrer, which leaves
  `clickId` null so nothing resolves and nothing is delivered, or
  `FEATURE_NOT_SUPPORTED`.

  A real test needs `generateLink`, then the link opened on a device *without* the
  app, then an install from a Play internal-test track so the referrer carries the
  `click_id`. First launch should produce exactly one envelope with
  `source=install_referrer`.

  **Uninstall between attempts.** `install_referrer_handled` is a persistent pref,
  and `InstallReferrerHandler` sets it on a stale click *and* on a terminal HTTP
  failure (lines 154 and 199) — deliberately, so a revoked key cannot re-send the
  same doomed resolve on every cold start forever. One bad attempt therefore marks
  that install permanently handled, and a force-stop or clear-data will not reset
  it. Note the early device runs here happened against the dead key, which is
  precisely a terminal-HTTP outcome.

## Resolved — iOS module resolution at runtime

**Settled: it resolves.** Run on the iPhone 17 simulator (iOS 26.5, new
architecture, `RCTNewArchEnabled=true`), the example logged `isAvailable: true`
plus a populated `deeplinklyId` and `attributionLevel: full` on mount — three
async TurboModule calls returning real values, not a not-linked proxy throwing.

So **the "RCT_EXTERN_MODULE is enough" decision stands** and needs no ObjC++ shim.
A Swift `RCTEventEmitter` exported with `RCT_EXTERN_MODULE` is reached through
React Native's interop layer even with `useTurboModuleInterop()` false, and no
host app has to flip a feature flag. The analysis below is kept because it is the
reasoning that made the risk worth tracking, and because the conclusion is
load-bearing for anyone tempted to "fix" the export.

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

The check that settled it: launch the example and confirm
`Deeplinkly.isAvailable()` resolves rather than the not-linked proxy throwing.
The example logs it on mount, so it is the first line on screen.

Android passes the same check via a different path entirely — the codegen'd spec
in `src/newarch` — so neither result would have implied the other.

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

### The API key lives in a gitignored file, never in the manifest

`example/android/deeplinkly.properties` holds `DEEPLINKLY_API_KEY=…` and is
gitignored (`**/deeplinkly.properties`). `app/build.gradle` reads it and injects
it as the `deeplinklyApiKey` manifest placeholder, which
`AndroidManifest.xml` substitutes into the `com.deeplinkly.sdk.api_key`
meta-data. **Do not write a key into the manifest** — that file is committed, and
a committed key is a published one.

Two details worth keeping:

- The injection uses `manifestPlaceholders.put(…)`, not
  `manifestPlaceholders = [...]`. The React Native gradle plugin puts
  `usesCleartextTraffic` into the same map per variant, and assigning a fresh map
  silently drops it — the manifest then fails to merge on an unresolved
  `${usesCleartextTraffic}`.
- With the file absent the build still succeeds and warns, and the SDK reports
  `isAvailable() == false` — the same signal a real host gets from a missing
  manifest entry, which is what you want a fresh clone to see.

The key previously here was reused from `flutter_deeplinkly/example`. It is
**dead** — the backend answers `ER_002 Invalid API Key` (403) to every call made
with it, so `generateLink` failed and enrichment was rejected. Anything in an
older revision of this doc claiming the example "inherits a domain-verified
setup" is wrong on both counts: the key is invalid, and the current key's link
domain is not `example.deeplinkly.com`.

### iOS does the same thing through an xcconfig

`example/ios/deeplinkly.properties` (gitignored) holds the key; the `Podfile`'s
`post_install` calls `inject_deeplinkly_api_key!`, which appends
`DEEPLINKLY_API_KEY = …` to the generated
`Pods/Target Support Files/Pods-DeeplinklyExample/*.xcconfig`; `Info.plist` carries
only `$(DEEPLINKLY_API_KEY)`. Verified end to end — the built app's `Info.plist`
has the real value.

Why the xcconfig and not the target's build settings: CocoaPods already installs
those xcconfigs as the app target's base configuration, and `Pods/` is gitignored
and regenerated on every `pod install`, so the key stays on this machine. Writing
it into the target instead would land it in
`DeeplinklyExample.xcodeproj/project.pbxproj`, which **is** committed — the same
mistake as putting it in `Info.plist`, one level down. The cost is that changing
the key needs a `pod install`.

Two traps:

- The append must come last. In an xcconfig the final assignment of a key wins, and
  CocoaPods' own "Integrating client project" step runs after the hook without
  disturbing it.
- Match the assignment line anchored (`/\A\s*DEEPLINKLY_API_KEY\s*=/`). The
  properties file's own comments mention the variable name, so an unanchored grep
  picks up comment text and yields a multi-line value — which fails as an opaque
  `curl: (43) bad argument` or a silently wrong build setting.

## Resume here

**Android is done and passing. The remaining work is iOS.**

```bash
cd ~/StudioProjects/react_native_deeplinkly

# Already green — re-run only to confirm nothing rotted.
npx tsc --noEmit && npx bob build
cd example/android
./gradlew :app:assembleDebug
./gradlew :react-native-deeplinkly:assembleDebug -PnewArchEnabled=false

# iOS: builds, has never been run. This is the open work.
cd ../ios && pod install && xcodebuild -workspace DeeplinklyExample.xcworkspace \
  -scheme DeeplinklyExample -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' build

cd .. && npx react-native start          # leave Metro running
npm run ios
```

First thing to settle on iOS is the open risk above — whether the module resolves
at all. `isAvailable: true` is the first line the example logs on mount, so it
answers itself. iOS also still needs its key moved out of the committed
`Info.plist`; see the environment notes.

### Driving a link, and the checklist

The example logs every call and every received link on screen, so this is the
whole runtime check. Confirm, in order:

1. `isAvailable: true` — anything else means the key is not being read, or on iOS
   that the module did not resolve at all.
2. `deeplinklyId` is non-empty.
3. Each button resolves without the not-linked proxy throwing.
4. Sending a link produces exactly **one** `{click_id, params}` envelope — not
   zero (listener attached too late) and not two (listener attached twice).
   Test it **cold** as well as warm; the cold path is the one that was broken, and
   a warm-only test passes while cold-start links are being dropped.

Point 4 is the one that exercises the design decision this bridge is built
around, so it matters more than the rest.

**Use a real link, generated by the app.** Tap `generateLink`, read the URL off
the screen, force-stop, and launch from that URL. The obvious-looking
`deeplinkly://open?screen=home` can *never* deliver: `DeepLinkHandler` requires a
`click_id` or a short code and logs `No click_id or Deeplinkly code in intent,
skipping` for anything else (`DeepLinkHandler.kt:134`). A hand-made
`?click_id=anything` is not much better — with a valid key the backend answers
`stale: true` for an unknown id and delivery is deliberately suppressed.

```bash
# Android. Two non-obvious details, both of which cost time here.
adb shell "am start -W -a android.intent.action.VIEW \
  -d 'https://<link-domain>/<code>' -n com.deeplinklyexample/.MainActivity"

# iOS
xcrun simctl openurl booted "https://<link-domain>/<code>"
```

- **Quote the URL for the *device* shell.** `adb shell` concatenates its
  arguments and re-parses them remotely, so an unquoted `&` in a query string
  splits the remote command — later flags like `-p` are silently dropped and the
  intent goes somewhere else entirely. Wrap the whole `am start` in double quotes
  and the URL in single quotes.
- **Name the target.** Any device with the other Deeplinkly samples installed
  (`com.deeplinkly.android`, `com.deeplinkly.sample`) has several apps claiming
  the `deeplinkly` scheme, so a bare `am start` opens a chooser and never reaches
  the app. `-p com.deeplinklyexample` scopes it while still matching intent
  filters; `-n com.deeplinklyexample/.MainActivity` forces the component and is
  what you need when the link's host is not in the manifest filter.

To test the iOS deferred path, seed the pasteboard *before* first launch:

```bash
xcrun simctl uninstall booted org.reactjs.native.example.DeeplinklyExample
printf '%s' "https://<link-domain>/<code>" | xcrun simctl pbcopy booted
xcrun simctl install booted <path>/DeeplinklyExample.app
xcrun simctl launch booted org.reactjs.native.example.DeeplinklyExample
# then allow the paste prompt — the *non*-prominent button
```

The uninstall is mandatory, not hygiene; see the latch note above. Inspect what the
SDK recorded afterwards without a debugger:

```bash
C=$(xcrun simctl get_app_container booted org.reactjs.native.example.DeeplinklyExample data)
plutil -p "$C/Library/Preferences/org.reactjs.native.example.DeeplinklyExample.plist"
```

That shows `initial_attribution` (with its `source`), the
`deeplinkly_pasteboard_checked` latch and the device id — which is how the
`source: clipboard` claim above was confirmed rather than inferred from the
envelope alone.

Read the native side on Android with `adb logcat`, filtered to the SDK's tag — the
example's on-screen log is JS-side only and shows nothing about resolution:

```bash
adb logcat -v time | grep -E "/Deeplinkly"
```

Note that `handleIntent` may not appear for a cold start even when everything
works. `setDebugMode(true)` is called from JS on mount, so the launch intent is
often processed before logging is on; `Processing N pending deliveries` followed
by `Delivered deep link to listener` is the sequence that matters.

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

The Android emulator is `Pixel_10_Pro`; iOS simulators include `iPhone 17`. The
Android device runs used a physical SM-A336E on Android 16 over wireless ADB —
`adb reverse tcp:8081 tcp:8081` works over a TCP transport, so Metro needs no
special handling.

Two gitignored files must be recreated on a fresh clone:
`example/android/local.properties` with `sdk.dir=$HOME/Library/Android/sdk`, and
`example/android/deeplinkly.properties` with `DEEPLINKLY_API_KEY=…`.

## Open items

1. **A device run on iOS**, whenever a team is available — ideally a personal Apple
   ID rather than a client's. It is the only way to reach Universal Links, the
   paste button on real hardware, and pasteboard-based deferred deep linking.
2. Render and tap the `DeeplinklyPasteButton` on an iOS 16+ device. Note this is
   *not* covered by the deferred verification above: that exercised the automatic
   `PasteboardHandler.check` path, which prompts. The paste button is the
   banner-free `UIPasteControl` alternative, and it has still never been rendered.
3. Point the example's `https` intent-filter at the current key's link domain
   (`myott.deeplinkly.com`, not `example.deeplinkly.com`) and consider setting the
   `com.deeplinkly.sdk.link_domains` meta-data, which is what makes the SDK's
   short-code detection exact rather than permissive. Then App Links can be
   verified for real instead of forced with `-n`.
4. **Deferred deep linking on Android** — a Play internal-test-track install, so
   the referrer actually carries a `click_id`. Verified on iOS already. See the
   "Not verified" entry for the procedure and the uninstall-between-attempts trap.
5. Unit tests. Android has a Robolectric suite in `flutter_deeplinkly` worth
   mirroring for the gate and the listener-attach discipline — and now
   specifically for the fact that `onActivityLaunch` gets called at all, which had
   no test and no compile error, only a silent behavioural hole that took out two
   separate features at once.
6. CI.
7. Decide whether to publish. `package.json` still says `0.1.0` and the version
   is not yet tagged anywhere.
