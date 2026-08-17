# react-native-deeplinkly

React Native SDK for deep linking, deferred deep linking, install referrer
tracking, and attribution.

> **Status: stub.** The JS surface, the TurboModule spec, and both native module
> shells are in place and typecheck, but no native method delegates to the
> Deeplinkly SDK yet — every call resolves its documented failure value. See
> [Filling in the stub](#filling-in-the-stub).

## Architecture

This package is a bridge, not an implementation. Deep link resolution, the
install referrer, attribution, queues, retries, device signals and networking
all live in the native SDKs, which are shared with the standalone Android/iOS
SDKs and the Flutter plugin:

| Layer   | Artifact                                |
| ------- | --------------------------------------- |
| Android | `com.deeplinkly:deeplinkly-android:1.1.1` |
| iOS     | pod `Deeplinkly`, `1.0.1`               |

Native method names match `flutter_deeplinkly`'s method channel one-for-one, so
the two bridges drive identical entry points and cannot drift. Payloads cross
the boundary as the snake_case maps the native SDKs already accept; the
camelCase-to-snake_case mapping happens in `src/index.tsx` and nowhere else.

```
src/index.tsx          public API, camelCase → snake_case, failure defaults
src/NativeDeeplinkly.ts codegen TurboModule spec
src/types.ts           public types
android/…/DeeplinklyModule.kt   Kotlin module  (stub)
ios/RNDeeplinkly.swift          Swift module   (stub)
ios/RNDeeplinkly.mm             ObjC++ export of the Swift class
```

## Install

```sh
npm install react-native-deeplinkly
cd ios && pod install
```

Android autolinks. No manifest entries are needed — the install-referrer
receiver and permissions arrive transitively from the native SDK.

## Usage

```ts
import Deeplinkly from 'react-native-deeplinkly';

// Links that resolved before this ran are queued natively and delivered on
// subscribe, so a cold start from a link does not race the JS bundle.
const sub = Deeplinkly.addListener((link) => {
  if (link['+clicked_deeplinkly_link']) {
    navigate(link.screen as string);
  }
});

// later
sub.remove();
```

### Generating a link

```ts
const result = await Deeplinkly.generateLink(
  {
    canonicalIdentifier: 'movie/1234',
    title: 'Interstellar',
    imageUrl: 'https://cdn.example.com/interstellar.jpg',
    metadata: { screen: 'movie', id: '1234' },
  },
  { channel: 'whatsapp', feature: 'share', tags: ['q3', 'hero'] }
);

if (result.success) {
  Share.share({ message: result.url! });
}
```

### Events

```ts
await Deeplinkly.logEvent(DeeplinklyEvent.purchase, {
  value: 499,
  currency: 'INR',
});
```

Validation is enforced natively, not here, so a native-only integration gets the
same answer: name ≤ 64 chars, ≤ 25 parameters, keys ≤ 64 chars and not prefixed
`_dl_`, string values ≤ 256 chars (arrays and objects are JSON-encoded first and
the limit applies to the encoded form). A rejected event resolves `false` and
sends nothing.

### Privacy

```ts
await Deeplinkly.setTrackingEnabled(false);   // consent flow off switch
await Deeplinkly.setAttributionLevel('reduced'); // middle ground
await Deeplinkly.resetPrivacyData();          // forget this device
```

Deep links keep resolving and keep reaching your listeners at every level,
including `'none'` and while tracking is disabled — these gate *reporting*, not
functionality.

To start restricted before any JS runs, set it natively instead — enrichment can
be sent during module registration, before a JS call could arrive:

- iOS: `DeeplinklyAttributionLevel` in `Info.plist`
- Android: `com.deeplinkly.sdk.attribution_level` manifest meta-data

### Pasteboard (iOS only)

The SDK reads the pasteboard once on first launch to recover a link tapped
before install, and iOS shows its "Pasted from…" banner for that read. On by
default. To turn it off, use `Info.plist` — a JS call arrives after the read has
already happened:

```xml
<key>DeeplinklyCheckPasteboardOnInstall</key>
<false/>
```

`willShowPasteboardBanner()` costs nothing and shows no banner, so it is safe to
call on a first-run screen to decide whether to explain the prompt first. All
three pasteboard methods resolve `false` on Android, which uses the Play Install
Referrer and never touches the clipboard.

## Filling in the stub

Each native method carries a `TODO(stub)` naming the `Deeplinkly` entry point it
must delegate to. Remaining work, roughly in order:

1. Delegate the Android methods in `DeeplinklyModule.kt`, and wire the SDK's
   deep link listener into `emitLink`, including the pre-`jsReady` queue.
2. Same for `RNDeeplinkly.swift`, plus the pasteboard methods that are real on
   iOS.
3. Add the example app (`example/`) and drive a real link end to end on both
   platforms.
4. Port the Flutter plugin's `PasteControlFactory` as a `<DeeplinklyPasteButton>`
   component — the no-banner alternative to the automatic read.
5. Unit tests, then CI.

To develop against an unreleased native Android SDK: run
`./gradlew publishToMavenLocal` in `android_deeplinkly`, then build with
`-Pdeeplinkly.useMavenLocal=true`.

## License

MIT © Deeplinkly
