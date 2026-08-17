package com.deeplinkly.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * STUB — plumbing only.
 *
 * Every method below is wired to the correct bridge signature and resolves the
 * documented failure value, but none of them call into the native SDK yet. Each
 * TODO names the `Deeplinkly` entry point it must delegate to; those entry
 * points already exist in `com.deeplinkly:deeplinkly-android` and are the same
 * ones FlutterDeeplinklyPlugin drives, so filling these in is delegation, not
 * new logic.
 *
 * Deliberately mirrors the Flutter plugin's method-channel names one-for-one.
 */
class DeeplinklyModule(reactContext: ReactApplicationContext) :
  NativeDeeplinklySpec(reactContext) {

  override fun getName() = NAME

  /**
   * Deep links resolved before JS attached a listener are held natively and
   * flushed here — a cold start from a link must not race the JS bundle.
   */
  private var jsIsReady = false

  // -- lifecycle --------------------------------------------------------------

  override fun jsReady(promise: Promise) {
    jsIsReady = true
    // TODO(stub): drain the native pending-link queue through [emitLink].
    promise.resolve(null)
  }

  // -- identity ---------------------------------------------------------------

  override fun getDeeplinklyId(promise: Promise) {
    // TODO(stub): Deeplinkly.getDeeplinklyId()
    promise.resolve("")
  }

  override fun setUserId(userId: String?, promise: Promise) {
    // TODO(stub): Deeplinkly.setCustomUserId(userId)
    promise.resolve(null)
  }

  override fun getInstallAttribution(promise: Promise) {
    // TODO(stub): Deeplinkly.getInstallAttribution() -> WritableMap
    promise.resolve(Arguments.createMap())
  }

  // -- links ------------------------------------------------------------------

  override fun generateLink(content: ReadableMap, options: ReadableMap, promise: Promise) {
    // TODO(stub): Deeplinkly.generateLink(content, options) { result -> ... }
    promise.resolve(
      failure("NOT_IMPLEMENTED", "react-native-deeplinkly Android bridge is a stub")
    )
  }

  // -- events -----------------------------------------------------------------

  override fun logEvent(eventName: String, parameters: ReadableMap, promise: Promise) {
    // TODO(stub): Deeplinkly.logEvent(eventName, parameters.toHashMap())
    // Validation stays native so a native-only integration gets the same answer.
    promise.resolve(false)
  }

  // -- privacy ----------------------------------------------------------------

  override fun disableTracking(disabled: Boolean, promise: Promise) {
    // TODO(stub): Deeplinkly.disableTracking(disabled)
    promise.resolve(false)
  }

  override fun resetPrivacyData(promise: Promise) {
    // TODO(stub): Deeplinkly.resetPrivacyData()
    promise.resolve(false)
  }

  override fun setAttributionLevel(level: String, promise: Promise) {
    // TODO(stub): Deeplinkly.setAttributionLevel(AttributionLevel.fromWireName(level))
    promise.resolve(false)
  }

  override fun getAttributionLevel(promise: Promise) {
    // TODO(stub): Deeplinkly.getAttributionLevel().wireName
    promise.resolve("full")
  }

  // -- pasteboard -------------------------------------------------------------
  //
  // iOS-only. Android recovers pre-install links through the Play Install
  // Referrer and never touches the clipboard, so these are permanently false
  // here rather than unimplemented — matching the Flutter plugin.

  override fun setCheckPasteboardOnInstall(
    enabled: Boolean,
    checkNow: Boolean,
    promise: Promise
  ) = promise.resolve(false)

  override fun willShowPasteboardBanner(promise: Promise) = promise.resolve(false)

  override fun checkPasteboardNow(promise: Promise) = promise.resolve(false)

  // -- diagnostics ------------------------------------------------------------

  override fun setDebugMode(enabled: Boolean, promise: Promise) {
    // TODO(stub): Deeplinkly.setDebugMode(enabled)
    promise.resolve(null)
  }

  // -- emitter ----------------------------------------------------------------

  /** Required by NativeEventEmitter; the native SDK holds the real subscription. */
  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  /** The `{success, error_code, error_message}` shape index.tsx unpacks. */
  private fun failure(code: String, message: String): WritableMap =
    Arguments.createMap().apply {
      putBoolean("success", false)
      putString("error_code", code)
      putString("error_message", message)
    }

  private fun emitLink(link: WritableMap) {
    if (!jsIsReady) return
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(LINK_EVENT, link)
  }

  companion object {
    const val NAME = "RNDeeplinkly"
    private const val LINK_EVENT = "DeeplinklyDidResolveLink"
  }
}
