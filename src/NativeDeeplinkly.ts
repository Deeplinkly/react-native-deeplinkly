import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * Codegen spec for the native module.
 *
 * Method names match the Flutter plugin's method channel exactly, so the two
 * bridges drive the same native entry points and can never drift. Everything
 * below this file — resolution, the install referrer, attribution, queues,
 * retries, device signals, networking — lives in the native SDKs
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
   */
  jsReady(): Promise<void>;

  // -- identity -------------------------------------------------------------

  /** Stable Deeplinkly device id for this install. Empty string on failure. */
  getDeeplinklyId(): Promise<string>;

  /** Sets your app's user id (`custom_user_id`) for enrichment and user linking. */
  setUserId(userId: string | null): Promise<void>;

  /** Install attribution as a flat string map. Empty map on failure. */
  getInstallAttribution(): Promise<UnsafeObject>;

  // -- links ----------------------------------------------------------------

  generateLink(
    content: UnsafeObject,
    options: UnsafeObject
  ): Promise<UnsafeObject>;

  // -- events ---------------------------------------------------------------

  logEvent(eventName: string, parameters: UnsafeObject): Promise<boolean>;

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

export default TurboModuleRegistry.getEnforcing<Spec>('RNDeeplinkly');
