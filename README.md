# react-native-deeplinkly

React Native SDK for deep linking, deferred deep linking, install referrer
tracking, and attribution.

Full documentation: [**docs/REACT_NATIVE_SDK.md**](docs/REACT_NATIVE_SDK.md).

## What this is

A bridge, not an implementation. Deep link resolution, the install referrer,
attribution, queues, retries, device signals and networking all live in the
native SDKs, shared with every other Deeplinkly integration:

| Layer   | Artifact                                  |
| ------- | ----------------------------------------- |
| Android | `com.deeplinkly:deeplinkly-android:1.1.1` |
| iOS     | pod `Deeplinkly`, `1.0.1`                 |

Native method names match the SDKs' own entry points one-for-one, so no
integration can drift from another. Event and link validation is enforced natively
rather than in JavaScript, so a native-only integration and this package answer
the same for the same input.

Supports both the new and legacy React Native architectures.

## Install

```bash
npm install react-native-deeplinkly
cd ios && pod install
```

Then rebuild — a JS reload will not pick up native code.

Two things the docs cover that are easy to miss:

- **Android** needs Kotlin **2.2.0+** in your app's `android/build.gradle`, and
  the classpath entry must be versioned explicitly. The native SDK's metadata is
  unreadable by the 2.0.21 compiler React Native's template resolves. The build
  fails with instructions if this is wrong.
- **iOS** requires forwarding links from your `AppDelegate`. A React Native native
  module cannot receive app-delegate callbacks, and the template ships no linking
  support, so **without this no deep link reaches the SDK**. See
  [Forward links from your AppDelegate](docs/REACT_NATIVE_SDK.md#forward-links-from-your-appdelegate).

## Quickstart

```ts
import Deeplinkly from 'react-native-deeplinkly';

useEffect(() => {
  // Subscribing is what signals readiness to native. Links that resolved
  // before now — a cold start from a tap, or a deferred link recovered from the
  // pasteboard — are buffered natively and delivered here, so nothing races
  // your bundle.
  const sub = Deeplinkly.addListener(({ click_id, params }) => {
    navigate(params.screen as string);
  });
  return () => sub.remove();
}, []);
```

Every link arrives in the same envelope on both platforms — `click_id` is always
present but may be `null` when the backend did not recognise the click, and
`params` falls back to the URL's own parameters when the resolve could not
complete:

```ts
{ click_id: 'ab12…', params: { screen: 'home' } }
```

### Generate a link

```ts
const result = await Deeplinkly.generateLink(
  { canonicalIdentifier: 'product/sku_42', title: 'Pro Plan', metadata: { plan: 'pro' } },
  { channel: 'email', feature: 'upgrade_campaign', tags: ['spring'] }
);

if (result.success) Share.share({ message: result.url! });
```

### Log an event

```ts
import { DeeplinklyEvent } from 'react-native-deeplinkly';

await Deeplinkly.logEvent(DeeplinklyEvent.purchase, { amount: 49.99, currency: 'INR' });
```

Resolves `false` if the native validator rejects it — name ≤ 64 chars, ≤ 25
parameters, keys ≤ 64 and not prefixed `_dl_`, string values ≤ 256 (arrays and
objects are JSON-encoded first and the limit applies to the encoded form).

### Privacy

```ts
await Deeplinkly.setTrackingEnabled(false);      // consent-flow off switch
await Deeplinkly.setAttributionLevel('reduced'); // middle ground
await Deeplinkly.resetPrivacyData();             // forget this device
```

Deep links keep resolving and keep reaching your listener at every level,
including `'none'` and while tracking is disabled — these gate *reporting*, not
functionality. [docs/SIGNALS.md](docs/SIGNALS.md) is the field-by-field
reference for what each level sends.

This wrapper holds no catalogue of its own — it forwards to the native Android
and iOS SDKs and collects whatever they collect. Use `docs/SIGNALS.md` when you
fill in your Google Play **Data safety** form, your App Store **privacy label**,
or your own privacy notice; those declarations must cover what your app
configures the SDK to send, not only the defaults. Deeplinkly's own handling of
that data is summarised at
[Data & Privacy](https://www.deeplinkly.com/docs/privacy); recipients, legal
bases, and transfers are in the
[Deeplinkly Privacy Policy](https://www.deeplinkly.com/privacy-policy).

### Deferred deep linking on iOS (no banner)

```tsx
import { DeeplinklyPasteButton } from 'react-native-deeplinkly';

<DeeplinklyPasteButton onPasted={(handled) => setShow(!handled)} fallback={null} />;
```

The user's tap is the grant, so iOS shows no "Pasted from…" banner — unlike the
automatic pasteboard read, which is on by default and does. iOS 16+; renders
`fallback` elsewhere, so it is safe to place unconditionally.

## Configuration when the API key is missing

`isAvailable()` returns false and every other method answers with its documented
failure value rather than throwing. Worth asserting once on a debug build:

```ts
if (__DEV__ && !(await Deeplinkly.isAvailable())) {
  console.warn('Deeplinkly: no API key in AndroidManifest.xml / Info.plist');
}
```

## Example app

`example/` is a React Native 0.87 app wired to this repo, with buttons for each
API and a running log of received links.

```bash
npm install
cd example && npm install
cd ios && pod install && cd ..
npm run ios      # or: npm run android
```

The example depends on the library as `file:..` and additionally points Android
autolinking at the repo root through `react-native.config.js`. Both are needed —
iOS codegen finds the package by scanning `node_modules`, Android autolinking by
reading the config — so do not remove either.

Send it a real link. Generate one with `generateLink`, then open it:

```bash
xcrun simctl openurl booted "https://<your-link-domain>/<code>"
adb shell "am start -W -a android.intent.action.VIEW \
  -d 'https://<your-link-domain>/<code>' -p com.deeplinklyexample"
```

A URL with no `click_id` and no Deeplinkly short code is skipped by design, so
`deeplinkly://open?screen=home` will never deliver anything — use a generated
link.

## Layout

```
src/index.tsx               public API, camelCase → snake_case, failure defaults
src/NativeDeeplinkly.ts     codegen TurboModule spec
src/DeeplinklyPasteButton.tsx
android/src/main/…          concrete module (written once)
android/src/{newarch,oldarch}/…  per-architecture superclass
ios/RNDeeplinkly.swift      module
ios/RNDeeplinklyLinking.swift    AppDelegate forwarding entry points
ios/DeeplinklyPasteButton*  UIPasteControl view + manager
docs/                       full reference, signals catalogue
```

## License

MIT © Deeplinkly
