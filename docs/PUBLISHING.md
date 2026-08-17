# Publishing `react-native-deeplinkly`

Internal runbook. This file is **not** shipped — `docs/` is outside the `files`
allowlist in package.json, and `npm run pack:audit` fails the build if it ever
appears in a tarball.

## Before the first publish

One-time setup, in order:

1. **Own the name.** `react-native-deeplinkly` must be unclaimed or owned by the
   `deeplinkly` npm org. Check with `npm view react-native-deeplinkly`; a 404 means
   it is free.
2. **Publish the native artifacts first.** The npm package is a bridge and does not
   vendor either SDK — it resolves them at build time:
   - `com.deeplinkly:deeplinkly-android:1.1.1` from Maven Central
     (`android/build.gradle`)
   - pod `Deeplinkly` `1.0.1` from CocoaPods trunk
     (`react-native-deeplinkly.podspec`)

   Publishing the JS package while either is unreleased ships something that
   cannot build. Both were confirmed resolvable from their public registries.
3. **Create an npm automation token** with publish rights and store it as the
   `NPM_TOKEN` repository secret. An automation token is the right kind: it
   bypasses 2FA, which a CI job cannot satisfy.
4. **Decide about provenance.** `.github/workflows/release.yml` passes
   `--provenance`, which needs `id-token: write` (already set) and a public
   repository. On a private repo, drop the flag or the publish fails.

## Every release

### 1. Be honest about what is verified

Read the "Not verified" section of [NATIVE_SDK_MIGRATION.md](./NATIVE_SDK_MIGRATION.md)
and decide whether the gaps are acceptable for the version being cut. As of the
last device testing, these are **untested and should be stated in the release
notes rather than implied to work**:

- **Deferred deep linking on Android** — the install-referrer path. Reached, never
  exercised; needs a Play-track install.
- **App Links / Universal Links on either platform.** No `https` link has ever
  reached the app in testing. Android was driven with `-n` to force the component,
  which bypasses intent-filter matching; iOS has no Associated Domains entitlement.
- **The `DeeplinklyPasteButton`** (`UIPasteControl`) has never been rendered.
- **The legacy architecture at runtime.** It compiles and its unit tests pass, but
  no legacy-architecture app has been launched.

For a `0.x` release that is defensible. Do not describe the package as
production-ready for App Links until someone has seen one work.

### 2. Bump the version

```bash
npm version patch   # or minor / major
```

`0.x` while the gaps above stand. The bump commits and creates the `vX.Y.Z` tag;
the release workflow refuses to publish if the tag and package.json disagree.

Keep a `CHANGELOG.md` entry. Two things belong in the notes for any consumer:

- **Kotlin 2.2.0 is a hard floor for host apps.** `android/build.gradle` fails the
  build with instructions if the resolved version is older, because the raw symptom
  is `Internal compiler error` over a wall of FIR frames. Hosts on the React Native
  0.79 template land on 2.0.21 and will hit this.
- **iOS requires host AppDelegate wiring.** Unlike the Flutter plugin, a React
  Native native module cannot receive app-delegate callbacks, so link delivery does
  not work until the host forwards them. See the reference docs.

### 3. Verify locally, then let CI publish

```bash
npm ci
npm run typecheck
npm test
npx bob build
npm run pack:audit          # the "nothing internal ships" gate
```

Then push the tag:

```bash
git push origin main --follow-tags
```

The `Release` workflow re-runs all of the above and publishes. To rehearse without
publishing, run it from the Actions tab with `dry_run` checked.

### 4. Verify what consumers actually get

This step exists because the example app **does not** consume the published
package. `example/package.json` depends on the library as `file:..`, which symlinks
to the repo root — load-bearing for iOS codegen discovery, but it means the packed
tarball has never been installed by anything.

So install the real artifact once, from a scratch app:

```bash
npm pack                                   # produces react-native-deeplinkly-X.Y.Z.tgz
cd /tmp && npx @react-native-community/cli init Consumer --version 0.87.0
cd Consumer
npm install /path/to/react-native-deeplinkly-X.Y.Z.tgz
cd ios && pod install && cd ..
```

Then confirm, in this order:

1. `npx tsc --noEmit` against a file that imports `Deeplinkly` — proves the shipped
   `lib/typescript` types resolve.
2. Android autolinking registers `DeeplinklyPackage` in the generated
   `PackageList.java`.
3. iOS codegen emits `RNDeeplinklySpec`. If it does not, the tarball is missing
   `codegenConfig` or `src/`.
4. The app builds and logs `isAvailable: false` — false is correct here, since the
   scratch app has no API key. Anything else, including a not-linked proxy throw,
   means the package is broken.

Only `isAvailable` returning a boolean at all proves the module linked.

## What ships

`files` in package.json is an allowlist, and `scripts/pack-audit.js` enforces the
gaps an allowlist cannot see — whole-directory entries like `android` and `ios`
quietly accumulate build output. `android/build/` was once **144 of 189 shipped
files**, including compiled classes and a compiled unit test.

The audit fails on: any `deeplinkly.properties` or other key file, `docs/`, this
runbook, Gradle/Xcode build output, `Pods/`, the example app, tests, CI config,
keystores, logs, and a hard ceiling of 60 files. A clean tarball is ~45 files.

Run it after `bob build`, since `lib/` has to exist to be audited.

## Rolling back

You mostly cannot. `npm unpublish` is limited to 72 hours and a version number can
never be reused even after unpublishing. So:

- **Bad release, caught fast:** `npm deprecate react-native-deeplinkly@X.Y.Z "use
  X.Y.Z+1"`, then publish a fix. Deprecation warns on install without breaking
  anyone already pinned.
- **A leaked key:** rotate the key first, in the dashboard. Unpublishing does not
  help — the tarball may already be mirrored and cached. This is the reason keys
  live in gitignored files and the audit checks for them.

## Native SDK version bumps

The bridge pins both native SDKs exactly. When either moves:

1. Bump `android/build.gradle` (`com.deeplinkly:deeplinkly-android`) and
   `react-native-deeplinkly.podspec` (`Deeplinkly`) together. A bridge with
   mismatched halves is worse than one that is behind on both.
2. Re-run the on-device checklist in
   [NATIVE_SDK_MIGRATION.md](./NATIVE_SDK_MIGRATION.md). The unit tests mock the
   SDK, so **they pass regardless of what the real SDK does** — they cannot catch a
   behavioural change on the other side of the boundary. That is the one thing CI
   here does not cover.
3. Bump this package's minor version, since a host cannot pick the native version
   independently.
