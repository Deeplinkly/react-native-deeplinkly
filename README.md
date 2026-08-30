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
| Android | `com.deeplinkly:deeplinkly-android:1.3.0` |
| iOS     | pod `Deeplinkly`, `1.2.1`                 |

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
present but may be `null` when the service did not recognise the click, and
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

### Identify the person

```ts
const stored = await Deeplinkly.setUserData({
  userId: 'user_123',
  email: 'ada@example.com',
  phoneNumber: '+441234567890',
  firstName: 'Ada',
  lastName: 'Lovelace',
  city: 'London',
  country: 'GB',
});
```

The fields a conversion is matched on once it reaches Meta's Conversions API or
Google's enhanced conversions. Every field is optional and calls **merge**, so
you can supply an email at sign-up and an address at checkout. Resolves `false`
if any field was malformed, in which case nothing was stored — all or nothing,
so a rejected call never leaves you guessing which values took. Validation is
native, so a native-only integration gets the same answer.

`customData` carries ids Deeplinkly does not name — a Mixpanel distinct id, a
CleverTap id — so attaching one does not have to wait for an app release. Up to
10 entries, 64-character keys, 256-character values.

```ts
await Deeplinkly.setUserData({
  userId: 'user_123',
  customData: { mixpanel_distinct_id: 'd-8837', clevertap_id: 'ct-4412' },
});

Deeplinkly.clearUserData(); // on sign-out, or when consent is withdrawn
```

`clearUserData()` is not merely "stop sending": the next enrichment carries each
previously-set field as an empty value, which the service reads as "null this
column". It is re-sent until delivered.

### Report a purchase

```ts
await Deeplinkly.logPurchase({
  value: 49.99,
  currency: 'USD',
  orderId: 'ord_42',
  quantity: 1,
  productId: 'sku_9',
});
```

A typed wrapper over `logEvent`, not a separate pipeline. It exists because
`value` and `currency` have to be spelled the same way by every caller: Meta's
Conversions API wants `custom_data.value` and `currency`, Google wants a
conversion value and currency, and this is the one spelling both are built from.
Pass `orderId` where you have one — it is Google's deduplication key. Rejected,
sending nothing, if the value is negative or not finite (a refund is a different
event), the currency is not three letters, or `parameters` holds a key this
method sets.

### Privacy

```ts
await Deeplinkly.setTrackingEnabled(false);      // consent-flow off switch
await Deeplinkly.setAttributionLevel('reduced'); // middle ground
await Deeplinkly.resetPrivacyData();             // forget this device
```

```ts
await Deeplinkly.setPIIHashingEnabled(true);  // SHA-256 on device before sending
await Deeplinkly.isPIIHashingEnabled();       // off unless you turned it on
```

With hashing on, the email, phone and names given to `setUserData` are SHA-256
hashed on the device, so the plaintext never leaves it. Only those four: gender,
country and date of birth have value ranges small enough that a digest is
reversed by enumeration, so hashing them would be protection in appearance only.
It costs match quality — a digest is computed once under one normalisation while
destinations disagree about phone formatting — so turn it on when a compliance
requirement says plaintext must not leave the device, not by default.

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
