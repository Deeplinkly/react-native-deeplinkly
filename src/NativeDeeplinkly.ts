import type { CodegenTypes, TurboModule } from 'react-native';
import { NativeModules, TurboModuleRegistry } from 'react-native';

// `CodegenTypes.UnsafeObject` is written out at every use site below, and must
// stay that way. Aliasing it locally — `type UnsafeObject =
// CodegenTypes.UnsafeObject` — sends codegen's TypeScript parser into an
// infinite loop: it spins at 100% CPU forever instead of failing, which
// surfaces as a Gradle build that hangs at
// `generateCodegenSchemaFromJavaScript` and a `pod install` that never returns.
// Inline namespace-qualified references parse fine; only the alias breaks.

/**
 * Codegen spec for the native module.
 *
 * Method names match the native SDKs' entry points exactly, so every Deeplinkly
 * integration drives the same code and none of them can drift. Everything below
 * this file — resolution, the install referrer, attribution, queues, retries,
 * device signals, networking — lives in the native SDKs
 * (`com.deeplinkly:deeplinkly-android`, pod `Deeplinkly`).
 *
 * Object payloads are `UnsafeObject` because the link metadata and event
 * parameters are user-defined maps that codegen cannot type. They cross the
 * bridge as the same snake_case shapes the native SDKs already accept.
 */
export interface Spec extends TurboModule {
  // -- lifecycle ------------------------------------------------------------

  /**
   * Tell native the JS layer is listening. Deep links that arrived before
   * this are queued natively and flushed on this call.
   *
   * This is load-bearing, not a formality. The native SDKs drop a link from
   * their queue once delivery returns without throwing, and emitting an event
   * that no JS listener has subscribed to succeeds *silently* — so attaching
   * the native listener any earlier than this would lose the link for good.
   */
  jsReady(): Promise<void>;

  /**
   * Whether the SDK found an API key and initialised.
   *
   * False means the key is missing from the Android manifest or `Info.plist`.
   * Every other method still answers while disabled — with its documented
   * failure value — so this is how an app tells "misconfigured" apart from
   * "configured, and the call failed".
   */
  isAvailable(): Promise<boolean>;

  // -- identity -------------------------------------------------------------

  /** Stable Deeplinkly device id for this install. Empty string on failure. */
  getDeeplinklyId(): Promise<string>;

  /** Sets your app's user id (`custom_user_id`) for enrichment and user linking. */
  setUserId(userId: string | null): Promise<void>;

  /** Install attribution as a flat string map. Empty map on failure. */
  getInstallAttribution(): Promise<CodegenTypes.UnsafeObject>;

  // -- links ----------------------------------------------------------------

  generateLink(
    content: CodegenTypes.UnsafeObject,
    options: CodegenTypes.UnsafeObject
  ): Promise<CodegenTypes.UnsafeObject>;

  // -- events ---------------------------------------------------------------

  logEvent(eventName: string, parameters: CodegenTypes.UnsafeObject): Promise<boolean>;

  // -- privacy --------------------------------------------------------------

  /** Inverted at the boundary to match the native `disableTracking` entry point. */
  disableTracking(disabled: boolean): Promise<boolean>;

  resetPrivacyData(): Promise<boolean>;

  setAttributionLevel(level: string): Promise<boolean>;

  getAttributionLevel(): Promise<string>;

  // -- pasteboard (iOS only; the Android side returns false) ----------------

  setCheckPasteboardOnInstall(
    enabled: boolean,
    checkNow: boolean
  ): Promise<boolean>;

  willShowPasteboardBanner(): Promise<boolean>;

  checkPasteboardNow(): Promise<boolean>;

  // -- diagnostics ----------------------------------------------------------

  setDebugMode(enabled: boolean): Promise<void>;

  // -- NativeEventEmitter plumbing -----------------------------------------

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const MISSING =
  "react-native-deeplinkly: the native module is not linked. Rebuild the app after installing — a JS reload will not pick up native code. On iOS, run `pod install` first.";

// `get`, not `getEnforcing`. On the old architecture TurboModuleRegistry has
// nothing to hand back, so `getEnforcing` throws; falling back to NativeModules
// keeps one import path working under both architectures.
//
// When neither resolves, the failure is deferred to first *use* rather than
// raised at import. Throwing here would take down the bundle on import alone,
// which is a miserable way to learn that a pod install was missed — and it
// would fire before an app could call `isAvailable()` to check.
const resolved =
  TurboModuleRegistry.get<Spec>('RNDeeplinkly') ??
  (NativeModules.RNDeeplinkly as Spec | undefined);

const NativeDeeplinkly: Spec =
  resolved ??
  (new Proxy({} as Spec, {
    get() {
      throw new Error(MISSING);
    },
  }) as Spec);

export default NativeDeeplinkly;
