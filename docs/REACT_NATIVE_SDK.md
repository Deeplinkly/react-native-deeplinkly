# React Native SDK Documentation

This page documents Deeplinkly's React Native SDK integration flow and runtime
API.

The package is a bridge. Deep link resolution, the install referrer,
attribution, queues, retries, device signals and networking all live in the
native SDKs — `com.deeplinkly:deeplinkly-android` and the `Deeplinkly` pod —
shared with every other Deeplinkly integration. Native method names match the
SDKs' own entry points one-for-one, so no integration can drift from another, and
validation is enforced natively rather than in JavaScript so every host gets the
same answer for the same input.

## Install

```bash
npm install react-native-deeplinkly
cd ios && pod install
```

Rebuild the app afterwards. A JS reload does not pick up native code.

Android autolinks and needs no manifest entries of its own — the install
referrer receiver and the `INTERNET` permission arrive transitively from the
native SDK.

### Android build requirement

The native Android SDK is compiled with **Kotlin 2.2.0**, and a 2.0.x compiler
cannot read its metadata. Gradle loads one Kotlin plugin for the whole build, so
this is set by your app, not by the library:

```groovy
// android/build.gradle
buildscript {
    ext {
        kotlinVersion = "2.2.0"
    }
    dependencies {
        // Version it explicitly. Left bare — as the React Native template has
        // it — the version arrives transitively from react-native-gradle-plugin
        // and ext.kotlinVersion is silently ignored.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}
```

React Native 0.87's template already sets `kotlinVersion = "2.2.0"` but still
leaves the classpath entry unversioned. The library checks the resolved version
at configuration time and fails with this instruction rather than letting the
compiler emit an internal error that names nothing.

## Configure Android

In `android/app/src/main/AndroidManifest.xml`:

```xml
<activity android:name=".MainActivity" android:launchMode="singleTask">
  <!-- App Links. This is the one that matters: it lets a tap on
       https://links.yourapp.com/abc123 open the app directly. Without it
       every link detours through the browser, and in-app browsers that
       block intent:// URLs (Instagram, Facebook, TikTok) never reach your
       app at all — even when it is installed.
       autoVerify only does anything on http/https. -->
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="links.yourapp.com" />
  </intent-filter>

  <!-- Custom scheme. The browser fallback path uses this, so keep it —
       but it is a fallback, not a substitute for the filter above. -->
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="yourapp" />
  </intent-filter>
</activity>

<application ...>
  <meta-data
      android:name="com.deeplinkly.sdk.api_key"
      android:value="your_api_key_here" />

  <!-- Optional, but set it if the app App Links any host besides its
       Deeplinkly link domain. Comma separated. See below. -->
  <meta-data
      android:name="com.deeplinkly.sdk.link_domains"
      android:value="links.yourapp.com" />
</application>
```

Replace `links.yourapp.com` with your Deeplinkly link domain and `yourapp` with
the URI scheme set in the dashboard.

React Native's template already sets `launchMode="singleTask"`, which delivers a
warm deep link through `onNewIntent` — that is what the SDK needs. Do not change
it to `standard`, which would start a second activity instance per link instead.

### Which links the SDK claims

The same rule on both platforms. The iOS key is `DeeplinklyLinkDomains` in
`Info.plist`; see [Configure iOS](#configure-ios).

A link that came through the redirect carries a `click_id`, and the SDK acts on
that whatever the scheme. The ambiguous case is the App Link / Universal Link
bypass, where the OS routes `https://links.yourapp.com/<code>` straight to the
app and the first path segment is the only thing there is to resolve on.

So the rule is:

- **Custom-scheme URLs without a `click_id` are ignored.** Your own routes
  (`yourapp://settings/notifications`) are yours; the SDK will not resolve them.
- **http(s) URLs** are resolved by code. If the link-domains list is set, only
  those hosts are; without it every https link the app handles is, which is fine
  for an app whose only App Link filter is its link domain.

Set the link domains if you App Link anything else — a marketing site, say — or
`https://www.yourapp.com/pricing` will be resolved as code `pricing`.

### Verifying App Links

Android checks `https://<your-link-domain>/.well-known/assetlinks.json` on
install. Deeplinkly serves that file for you, but only once the dashboard has
both your **package name** and your **SHA-256 signing certificate fingerprint**
— with either missing the endpoint returns 404 and verification silently fails.

Get the fingerprint from your release keystore:

```bash
keytool -list -v -keystore <your-keystore> -alias <your-alias> | grep SHA256
```

If you use Play App Signing, take the fingerprint from **Play Console → Test and
release → Setup → App signing**, not from your upload keystore — Google re-signs
the APK, so the upload fingerprint will not match what ships.

Confirm the file is live and verification passed:

```bash
curl https://links.yourapp.com/.well-known/assetlinks.json
adb shell pm get-app-links <your.package.name>
```

The second command should report `verified` for your domain. `none` or
`legacy_failure` means the fingerprint does not match or the file is not
reachable.

## Configure iOS

In `ios/<YourApp>/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>yourapp</string>
    </array>
  </dict>
</array>

<key>DeeplinklyApiKey</key>
<string>your_api_key_here</string>

<!-- Your Deeplinkly link domains. Subdomains count. Two jobs: the hosts a
     deferred link may be read from, and the hosts whose first path segment
     may be read as a link code — see "Which links the SDK claims" above.
     Set it if the app Universal Links any host besides its link domain. -->
<key>DeeplinklyLinkDomains</key>
<array>
  <string>yourbrand.deeplinkly.com</string>
</array>
```

Then add an **Associated Domains** capability with
`applinks:yourbrand.deeplinkly.com` for each link domain.

### Forward links from your AppDelegate

**This step is required on iOS and has no equivalent on Android.**

A React Native native module never receives app-delegate callbacks, so the SDK
cannot register itself for the `UIApplicationDelegate` and `UIScene` link
callbacks the way a native integration does. React Native's own template also
ships an `AppDelegate` with no linking support at all, so there is nothing to
piggyback on. Without the wiring below, **no deep link reaches the SDK.**

In `ios/<YourApp>/AppDelegate.swift`:

```swift
import react_native_deeplinkly

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // ... existing React Native setup ...

    // Cold launch. A Universal Link that *starts* the app is in launchOptions,
    // not in continue(userActivity:) — missing this loses exactly the case
    // deferred deep linking exists for.
    RNDeeplinklyLinking.handleLaunchOptions(launchOptions)
    return true
  }

  // Universal Links while running.
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    RNDeeplinklyLinking.handleUserActivity(userActivity)
    return RCTLinkingManager.application(
      application, continue: userActivity, restorationHandler: restorationHandler)
  }

  // Custom-scheme links.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RNDeeplinklyLinking.handleURL(url)
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}
```

Calling `RCTLinkingManager` as well keeps JS `Linking` working — the Deeplinkly
call is non-exclusive.

Forward eagerly and do not try to order these carefully. `handleLink` buffers
until the SDK initialises, buffers again until a JS listener attaches, and
suppresses a duplicate for the same link, because the resolve is idempotent and
attribution is written once.

#### If your app uses a SceneDelegate

When the host adopts `UISceneDelegate`, the `UIApplicationDelegate` callbacks
above **never fire**. Use these three instead:

```swift
func scene(
  _ scene: UIScene,
  willConnectTo session: UISceneSession,
  options connectionOptions: UIScene.ConnectionOptions
) {
  // Cold launch on the scene path.
  RNDeeplinklyLinking.handleSceneConnectionOptions(connectionOptions)
}

func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
  RNDeeplinklyLinking.handleUserActivity(userActivity)
}

func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
  RNDeeplinklyLinking.handleOpenURLContexts(URLContexts)
}
```

#### From an Objective-C AppDelegate

Import the generated Swift header instead:

```objc
#if __has_include(<react_native_deeplinkly/react_native_deeplinkly-Swift.h>)
#import <react_native_deeplinkly/react_native_deeplinkly-Swift.h>
#else
#import "react_native_deeplinkly-Swift.h"
#endif

[RNDeeplinklyLinking handleURL:url];
```

The two forms cover framework and static-library linkage respectively.

### Deferred deep linking on iOS

iOS has no install-referrer API, so the link survives an App Store install via
the pasteboard: the Deeplinkly interstitial copies the link when the visitor taps
through to the store, and the SDK reads it back on first launch.

There are two ways to read it back. **Pick one.**

#### Option A — `<DeeplinklyPasteButton>` (recommended, no banner)

A system paste button rendered in your component tree. Because the user taps it
themselves, iOS treats the tap as the grant and shows **no "Pasted from…" banner
at all**.

```tsx
import { DeeplinklyPasteButton } from 'react-native-deeplinkly';

<DeeplinklyPasteButton
  onPasted={(handled) => setShowPasteButton(!handled)}
  fallback={null}
/>;
```

Put it on a first-run screen next to something like *"Tapped a link to get here?
Restore where you left off."* The recovered link arrives on your normal listener
exactly like any other; `onPasted` only tells you whether the pasted content was
one of your links, so you can hide the button or explain that it was not.

Requires iOS 16+. Renders `fallback` on Android and older iOS, so it is safe to
place unconditionally. `isPasteButtonSupported` is exported for hosts that want
to change surrounding copy rather than just the button.

The control has an intrinsic size that React Native's layout does not read, so
it defaults to 140×40; override with `style`.

Props: `displayMode` (`iconOnly` | `labelOnly` | `iconAndLabel`), `cornerStyle`
(`small` | `medium` | `large` | `capsule`), `backgroundColor`, `foregroundColor`.
Leave the colors unset unless you have a reason — styling a paste button to look
like something else is what gets it rejected as misleading.

#### Option B — automatic read (on by default, shows the banner)

**On by default.** You do not need to enable it.

To turn it off:

```xml
<key>DeeplinklyCheckPasteboardOnInstall</key>
<false/>
```

Do that in `Info.plist`, not from JavaScript — the read happens during native
module construction, before your JS runs, so
`setCheckPasteboardOnInstall(false)` arrives too late to prevent the first one.

Turning it on from JS at runtime reads immediately rather than waiting for a next
launch the pasteboard may not survive to.

To explain the prompt before it appears, turn the automatic read off in
`Info.plist` and drive it yourself:

```ts
if (await Deeplinkly.willShowPasteboardBanner()) {
  await showMyPrimingDialog(); // "we can restore where you left off"
  await Deeplinkly.checkPasteboardNow();
}
```

`willShowPasteboardBanner` reads no content and shows no banner itself.

#### Either way

- The visitor must **tap through** the interstitial — there is no auto-redirect
  on iOS. Safari does not allow a clipboard write without a user gesture, so a
  timed redirect could never carry one.
- The automatic read happens once per install, guarded by a persisted flag, and
  probes the pasteboard's *types* first with `hasURLs`, which is banner-free. The
  banner appears only when a URL is actually there. On iOS 16+ a second
  banner-free probe, `detectPatterns(.probableWebURL)`, catches links that
  arrived as plain text from the interstitial's fallbacks.
- The banner is **not** limited to your own links. Any URL on the clipboard
  triggers the read; the SDK then discards anything whose host is not in
  `DeeplinklyLinkDomains`, but the banner has already shown. A user who copied a
  news article before opening your app gets a prompt for nothing. A user with no
  URL copied sees nothing.
- Both paths are skipped entirely when tracking is disabled via
  `setTrackingEnabled(false)`.
- The automatic read clears your own link from the pasteboard once the resolve is
  durably queued; the paste button leaves the pasteboard alone, since the user
  pasted deliberately.
- The resolved click is stamped `attribution_source = "clipboard"`, not
  `install_referrer` — that API does not exist on iOS.
- If the first launch is offline the pending resolve is persisted and retried on
  the next launch, so an offline install is not lost.

## Handle deep links

There is no `init()` to call. Both native modules initialise themselves and read
their API key from the manifest / `Info.plist`.

**Subscribing is what tells native you are ready.** Links that resolved before
then — a cold start from a tap, or a deferred link recovered from the pasteboard
— are buffered natively and delivered on subscribe, so nothing races your bundle.

```ts
import Deeplinkly from 'react-native-deeplinkly';

useEffect(() => {
  const sub = Deeplinkly.addListener(({ click_id, params }) => {
    navigate(params.screen as string);
  });
  return () => sub.remove();
}, []);
```

Every deep link arrives in the same envelope on both platforms:

```ts
{
  click_id: 'ab12…',          // null if the backend did not recognise the click
  params: { screen: 'home' }, // the link's own parameters
}
```

`click_id` is always present; only its value may be null. `params` carries the
link's parameters whether they came back from the backend or, when it could not
be reached, from the URL itself — so a single read path covers both.

Do not attach a listener and immediately unsubscribe on a screen that unmounts.
Delivery is at-least-once against an *attached* listener; the SDK holds a link
while nothing is listening, so an unmounted listener does not lose it, but a
listener that unsubscribes mid-delivery may see the link redelivered later.

## Identity and attribution

```ts
const attribution = await Deeplinkly.getInstallAttribution();
const deeplinklyId = await Deeplinkly.getDeeplinklyId();
Deeplinkly.setUserId('user_123');
```

`getDeeplinklyId` is the stable per-install id, the same value the API sees as
`deeplinkly_device_id` / `X-Deeplinkly-User-Id`. `setUserId` sets
`custom_user_id` for enrichment and backend user linking; pass `null` to clear.

## Log events

```ts
import Deeplinkly, { DeeplinklyEvent } from 'react-native-deeplinkly';

const ok = await Deeplinkly.logEvent(DeeplinklyEvent.purchase, {
  order_id: 'ord_42',
  amount: 49.99,
  currency: 'INR',
});
```

`DeeplinklyEvent` holds the well-known names the backend reports on without extra
configuration; any string is accepted.

Validation constraints:

- event name: non-empty after trimming, at most 64 characters
- at most 25 custom parameters (the SDK's own `_dl_*` keys do not count towards
  this, and passing a key with that prefix is rejected)
- parameter key: at most 64 characters
- string value: at most 256 characters
- array and object values are stored as compact JSON, and the 256 limit applies
  to that encoded form
- `null` values are rejected, not dropped

Numbers and booleans keep their JSON types end to end — `49.99` is stored as a
number, not `"49.99"`.

These rules are enforced in the native SDKs, not in JavaScript, so a native-only
integration and this package give the same answer. A rejected event resolves
`false` and sends nothing.

## Generate Deeplinkly links

```ts
const result = await Deeplinkly.generateLink(
  {
    canonicalIdentifier: 'product/sku_42',
    title: 'Pro Plan',
    metadata: { plan: 'pro' },
  },
  {
    channel: 'email',
    feature: 'upgrade_campaign',
    tags: ['spring', 'sale'],
  }
);

if (result.success) {
  Share.share({ message: result.url! });
} else {
  console.warn(result.errorCode, result.errorMessage);
}
```

`tags` is a list, not an object — the API only accepts a list (or a
comma-separated string) and silently discards anything else.

The result is `{ success, url?, errorCode?, errorMessage? }`. It resolves rather
than rejecting on failure. Observed `errorCode` values: `SDK_DISABLED`,
`INVALID`, `NO_URL`, `LINK_ERROR`, `HTTP_<status>`, `NULL_NATIVE_RESPONSE`,
`NATIVE_EXCEPTION`, or a backend code passed through.

The keys are camelCase here and snake_case on the wire. Everything else crossing
the bridge keeps the native SDKs' own shapes — the deep link envelope's
`click_id` and `params` reach you unchanged — but `generateLink` is mapped in
`src/index.tsx` before it resolves, because `DeeplinklyResult` is a type this
package declares rather than a map it forwards. Reading `result.error_code` gets
`undefined`.

## Privacy

```ts
await Deeplinkly.setTrackingEnabled(false); // the consent-flow off switch
await Deeplinkly.setAttributionLevel('reduced'); // a middle ground
await Deeplinkly.resetPrivacyData(); // forget this device
```

`setTrackingEnabled(false)` sends no enrichment, no events and no error reports,
skips the iOS pasteboard read, and deletes pending reporting retries. Deep links
still resolve and are still delivered — the link a user tapped keeps working —
but functional requests omit the stable Deeplinkly ID and custom user ID.
Persists across launches.

`resetPrivacyData()` removes the stable Deeplinkly ID, custom user ID,
attribution, cached device profile, session and event state, pasteboard state and
pending queues. Tracking stays disabled afterwards; call
`setTrackingEnabled(true)` only once the user opts back in.

### Attribution levels

For consent flows that need a middle ground between "track" and "don't":

| Level | What is sent |
| --- | --- |
| `full` | Everything. The default |
| `reduced` | Drops every high-entropy hardware signal: screen geometry, model, CPU, the local IP, the WebView user agent, the advertising ID / Android ID / IDFA / IDFV. Keeps the coarse context campaign reporting reads — locale, timezone, OS and app version |
| `minimal` | Only the install id, app build, and the link being reported on. Nothing describing the device |
| `none` | No enrichment at all. Links still resolve and still deliver |

Each level is a strict subset of the one above. Deep link delivery works at every
level, including `none` — this restricts reporting, not functionality. Resolving
a link never sends anything describing the device, at any level.

[**docs/SIGNALS.md**](SIGNALS.md) is the field-by-field reference: every signal
the SDK can send, its level, and which platforms report it. It is generated from
the same catalogue the SDKs compile against, so it cannot drift from what is
actually sent.

`setTrackingEnabled(false)` wins over the level: while disabled,
`getAttributionLevel()` reports `none` whatever was set.

To start restricted before any JavaScript runs, set it natively — enrichment can
be sent during native module construction, before a JS call could arrive:

- iOS: `DeeplinklyAttributionLevel` in `Info.plist`
- Android: `com.deeplinkly.sdk.attribution_level` manifest meta-data

## API reference

| Method | Returns | Notes |
| --- | --- | --- |
| `addListener(handler)` | `Subscription` | Signals readiness; flushes buffered links |
| `isAvailable()` | `Promise<boolean>` | False when the API key is missing |
| `getDeeplinklyId()` | `Promise<string>` | Works even with no API key |
| `setUserId(id \| null)` | `void` | Fire-and-forget |
| `getInstallAttribution()` | `Promise<Record<string, string>>` | `{}` on failure |
| `generateLink(content, options)` | `Promise<DeeplinklyResult>` | Resolves on failure, never rejects |
| `logEvent(name, params?)` | `Promise<boolean>` | False if rejected natively |
| `setTrackingEnabled(bool)` | `Promise<boolean>` | Persists across launches |
| `resetPrivacyData()` | `Promise<boolean>` | Leaves tracking disabled |
| `setAttributionLevel(level)` | `Promise<boolean>` | False on an unknown level |
| `getAttributionLevel()` | `Promise<AttributionLevel>` | `none` while tracking is off |
| `setCheckPasteboardOnInstall(on, checkNow?)` | `Promise<boolean>` | iOS only; false on Android |
| `willShowPasteboardBanner()` | `Promise<boolean>` | Costs nothing, shows nothing |
| `checkPasteboardNow()` | `Promise<boolean>` | Starts the read; not a result |
| `setDebugMode(bool)` | `void` | Verbose native logging |

### Behaviour when the API key is missing

`isAvailable()` returns false and every other method answers with its documented
failure value rather than throwing — `logEvent` resolves `false`,
`getAttributionLevel` resolves `none`, `generateLink` resolves
`{ success: false, errorCode: 'SDK_DISABLED' }`. `getDeeplinklyId` and
`resetPrivacyData` keep working, since they are local operations that need no
key.

Each method carries its own correctly-typed default rather than sharing one
`SDK_DISABLED` envelope: a typed native module cannot resolve a map where it
declared a boolean, so an envelope would break the contract for every method that
does not return an object. `isAvailable()` is what tells you the key is missing.

Assert it once on a debug build; a missing key is a configuration bug, not a
runtime condition:

```ts
if (__DEV__ && !(await Deeplinkly.isAvailable())) {
  console.warn('Deeplinkly: no API key in AndroidManifest.xml / Info.plist');
}
```
