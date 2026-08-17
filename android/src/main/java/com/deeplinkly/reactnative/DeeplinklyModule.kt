package com.deeplinkly.reactnative

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.deeplinkly.android_deeplinkly.Deeplinkly
import com.deeplinkly.android_deeplinkly.DeeplinklyDeepLinkListener
import com.deeplinkly.android_deeplinkly.privacy.AttributionLevel
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native bridge over the Deeplinkly Android SDK.
 *
 * A bridge, not an implementation: resolution, the install referrer,
 * attribution, queues, retries, device signals and networking all live in
 * `com.deeplinkly:deeplinkly-android`, shared with the standalone native SDK and
 * the Flutter plugin. Method names mirror `FlutterDeeplinklyPlugin`'s method
 * channel so the two bridges drive identical entry points.
 *
 * Every SDK callback already arrives on the main thread (`SdkRuntime.postToMain`),
 * so nothing here needs `UiThreadUtil`.
 */
@ReactModule(name = DeeplinklyModule.NAME)
class DeeplinklyModule(reactContext: ReactApplicationContext) :
  DeeplinklyModuleSpec(reactContext), ActivityEventListener, LifecycleEventListener {

  /**
   * Whether JS has registered its handler.
   *
   * Nothing may be delivered before this is true. See [jsReady].
   */
  private var jsIsReady = false

  /**
   * One instance, attached and detached rather than rebuilt, so a re-attach
   * cannot leave two of these delivering the same link.
   *
   * `raw` is forwarded unchanged so the JS envelope stays exactly
   * `{click_id, params}` — the same envelope Dart receives.
   */
  private val deepLinkListener = DeeplinklyDeepLinkListener { link ->
    emitLink(link.raw)
  }

  init {
    // `autoCaptureLaunchIntents` is left at its default `true`, unlike the
    // Flutter plugin which passes `false`.
    //
    // Flutter can afford `false` because `ActivityAware.onAttachedToActivity`
    // is a precise once-per-launch signal it can hang `onActivityLaunch` off.
    // React Native has no equivalent — `onHostResume` fires on *every*
    // foreground, so replaying the launch intent from there would re-resolve
    // the deep link and fire attribution again on every app switch. Letting the
    // SDK's own `ActivityLifecycleCallbacks` capture cold starts via
    // `onActivityCreated` is the correct analogue here.
    //
    // Reads the API key from `com.deeplinkly.sdk.api_key` manifest meta-data.
    // Idempotent; a second call is ignored.
    Deeplinkly.init(reactContext.applicationContext)

    reactContext.addActivityEventListener(this)
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName() = NAME

  // -- lifecycle --------------------------------------------------------------

  /**
   * JS has its handler up. Attaching the listener drains whatever queued while
   * it did not.
   *
   * The listener is deliberately not attached in `init`. The SDK drops a link
   * from its persistent queue as soon as `onDeepLink` returns without throwing,
   * and emitting to `RCTDeviceEventEmitter` with no JS subscriber **succeeds
   * silently** — so attaching before JS is listening would lose the link
   * permanently. This is the same trap the Flutter plugin documents against
   * `invokeMethod` on an unhandled channel.
   */
  @ReactMethod
  override fun jsReady(promise: Promise) {
    jsIsReady = true
    if (Deeplinkly.isEnabled) {
      Deeplinkly.setDeepLinkListener(deepLinkListener)
    }
    promise.resolve(null)
  }

  @ReactMethod
  override fun isAvailable(promise: Promise) {
    promise.resolve(Deeplinkly.isEnabled)
  }

  // -- identity ---------------------------------------------------------------
  //
  // These two answer before the `isEnabled` gate: they are local privacy and
  // identity operations that need no API key, so they stay available on a build
  // whose manifest meta-data is missing.

  @ReactMethod
  override fun getDeeplinklyId(promise: Promise) {
    promise.resolve(Deeplinkly.getDeeplinklyId())
  }

  @ReactMethod
  override fun resetPrivacyData(promise: Promise) {
    promise.resolve(Deeplinkly.resetPrivacyData())
  }

  @ReactMethod
  override fun setUserId(userId: String?, promise: Promise) {
    if (!requireEnabled(promise, null)) return
    Deeplinkly.setUserId(userId)
    promise.resolve(null)
  }

  @ReactMethod
  override fun getInstallAttribution(promise: Promise) {
    if (!requireEnabled(promise, Arguments.createMap())) return
    val out = Arguments.createMap()
    Deeplinkly.getInstallAttribution().forEach { (key, value) -> out.putString(key, value) }
    promise.resolve(out)
  }

  // -- links ------------------------------------------------------------------

  @ReactMethod
  override fun generateLink(content: ReadableMap, options: ReadableMap, promise: Promise) {
    if (!requireEnabled(promise, disabledResult())) return

    // Flat-merged and passed straight through, so whatever the JS models
    // produced reaches the backend unaltered. Options win on key collision,
    // matching the Flutter bridge.
    val payload = HashMap<String, Any?>().apply {
      putAll(content.toHashMap())
      putAll(options.toHashMap())
    }

    Deeplinkly.generateLink(payload) { generated ->
      // Null fields are omitted rather than sent as null, so JS sees the same
      // shape Dart does.
      promise.resolve(
        Arguments.createMap().apply {
          putBoolean("success", generated.success)
          generated.url?.let { putString("url", it) }
          generated.errorCode?.let { putString("error_code", it) }
          generated.errorMessage?.let { putString("error_message", it) }
        }
      )
    }
  }

  // -- events -----------------------------------------------------------------

  /**
   * Parameters are forwarded raw. Validation lives in the SDK's
   * `DeeplinklyEvent.validate` rather than here, so a native-only integration,
   * the Flutter plugin and this bridge all give the same answer for the same
   * event. Pre-checking here is how that guarantee would rot.
   */
  @ReactMethod
  override fun logEvent(eventName: String, parameters: ReadableMap, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    Deeplinkly.logEvent(eventName, parameters.toHashMap()) { ok -> promise.resolve(ok) }
  }

  // -- privacy ----------------------------------------------------------------

  @ReactMethod
  override fun disableTracking(disabled: Boolean, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    Deeplinkly.setTrackingEnabled(!disabled)
    promise.resolve(true)
  }

  @ReactMethod
  override fun setAttributionLevel(level: String, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    val parsed = AttributionLevel.fromWireName(level)
    if (parsed == null) {
      promise.resolve(false)
      return
    }
    promise.resolve(Deeplinkly.setAttributionLevel(parsed))
  }

  @ReactMethod
  override fun getAttributionLevel(promise: Promise) {
    if (!requireEnabled(promise, AttributionLevel.NONE.wireName)) return
    promise.resolve(Deeplinkly.getAttributionLevel().wireName)
  }

  // -- pasteboard -------------------------------------------------------------
  //
  // iOS-only. Android recovers pre-install links through the Play Install
  // Referrer and never touches the clipboard, so these answer honestly —
  // nothing is enabled, so nothing can be read and no banner can be shown —
  // rather than reporting themselves unimplemented.

  @ReactMethod
  override fun setCheckPasteboardOnInstall(
    enabled: Boolean,
    checkNow: Boolean,
    promise: Promise
  ) = promise.resolve(false)

  @ReactMethod
  override fun willShowPasteboardBanner(promise: Promise) = promise.resolve(false)

  @ReactMethod
  override fun checkPasteboardNow(promise: Promise) = promise.resolve(false)

  // -- diagnostics ------------------------------------------------------------

  @ReactMethod
  override fun setDebugMode(enabled: Boolean, promise: Promise) {
    Deeplinkly.setDebugMode(enabled)
    promise.resolve(null)
  }

  // -- ActivityEventListener --------------------------------------------------

  /**
   * A warm-start deep link. The activity is read at call time rather than
   * captured, which would go stale as soon as the activity was recreated.
   */
  override fun onNewIntent(intent: Intent?) {
    val context: Context = currentActivity ?: reactApplicationContext
    Deeplinkly.onNewIntent(context, intent)
  }

  override fun onActivityResult(
    activity: Activity?,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) = Unit

  // -- LifecycleEventListener -------------------------------------------------

  override fun onHostResume() {
    if (!Deeplinkly.isEnabled) return
    // Re-attaching is idempotent — there is one listener slot and setting it
    // overwrites — and it re-drains anything that queued while backgrounded.
    if (jsIsReady) {
      Deeplinkly.setDeepLinkListener(deepLinkListener)
    }
    Deeplinkly.onForeground()
  }

  override fun onHostPause() = Unit

  override fun onHostDestroy() = Unit

  // -- teardown ---------------------------------------------------------------

  /**
   * Detaches, but deliberately does **not** call `Deeplinkly.shutdown()`.
   *
   * `Deeplinkly` is a Kotlin `object` that outlives React Native's Catalyst
   * instance — a dev-mode reload builds a new instance against the same
   * singleton. `shutdown()` cancels the SDK's IO scope, and `init` latches on a
   * one-way `AtomicBoolean`, so shutting down here would leave every subsequent
   * call targeting a cancelled scope with no way to revive it.
   */
  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    reactApplicationContext.removeLifecycleEventListener(this)
    Deeplinkly.setDeepLinkListener(null)
    jsIsReady = false
    super.invalidate()
  }

  // -- emitter ----------------------------------------------------------------

  /** Required by NativeEventEmitter; the SDK owns the real subscription. */
  @ReactMethod
  override fun addListener(eventName: String) = Unit

  @ReactMethod
  override fun removeListeners(count: Double) = Unit

  private fun emitLink(raw: Map<String, Any?>) {
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(LINK_EVENT, Arguments.makeNativeMap(raw))
  }

  // -- helpers ----------------------------------------------------------------

  /**
   * Resolves [disabledValue] and returns false when the SDK has no API key.
   *
   * Each caller passes its own correctly-typed failure value rather than the
   * single `SDK_DISABLED` envelope the Flutter bridge returns from everything.
   * Dart gets away with that because `invokeMethod<bool>` throws on the
   * unexpected map and the Dart wrapper catches it into `false`; a typed
   * TurboModule cannot resolve a map where it declared a boolean.
   * [isAvailable] is how a host distinguishes "no API key" from "call failed".
   */
  private fun requireEnabled(promise: Promise, disabledValue: Any?): Boolean {
    if (Deeplinkly.isEnabled) return true
    promise.resolve(disabledValue)
    return false
  }

  private fun disabledResult(): WritableMap =
    Arguments.createMap().apply {
      putBoolean("success", false)
      putString("error_code", "SDK_DISABLED")
      putString("error_message", "Deeplinkly SDK is disabled (missing API key).")
    }

  companion object {
    const val NAME = "RNDeeplinkly"
    private const val LINK_EVENT = "DeeplinklyDidResolveLink"
  }
}
