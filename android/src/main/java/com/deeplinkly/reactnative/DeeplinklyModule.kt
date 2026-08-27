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

/**
 * React Native bridge over the Deeplinkly Android SDK.
 *
 * A bridge, not an implementation: resolution, the install referrer,
 * attribution, queues, retries, device signals and networking all live in
 * `com.deeplinkly:deeplinkly-android`, shared with every other Deeplinkly
 * integration. Method names mirror the SDK's own entry points so all of them
 * drive identical code.
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
   * Whether the cold-start launch intent has been handed to the SDK. One-way,
   * for the life of this module instance. See [onHostResume].
   */
  private var launchCaptured = false

  /**
   * One instance, attached and detached rather than rebuilt, so a re-attach
   * cannot leave two of these delivering the same link.
   *
   * `raw` is forwarded unchanged so the JS envelope stays exactly
   * `{click_id, params}`, identical on both platforms.
   */
  private val deepLinkListener = DeeplinklyDeepLinkListener { link ->
    emitLink(link.raw)
  }

  init {
    // `autoCaptureLaunchIntents = false`, because the SDK's automatic capture
    // cannot work from a React Native module.
    //
    // It registers `ActivityLifecycleCallbacks` inside `init` and reads the
    // launch intent from `onActivityCreated`. This module is constructed while
    // React Native evaluates the JS bundle — long after `MainActivity.onCreate`
    // has returned — so those callbacks are registered too late to ever see the
    // launch activity, and `onActivityResumed` does nothing. Leaving capture on
    // therefore drops every cold-start link, with no error anywhere.
    //
    // [onHostResume] drives `onActivityLaunch` once instead. See it for why
    // once-per-instance is what makes this safe.
    //
    // Reads the API key from `com.deeplinkly.sdk.api_key` manifest meta-data.
    // Idempotent; a second call is ignored.
    Deeplinkly.init(reactContext.applicationContext, autoCaptureLaunchIntents = false)

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
   * permanently, with no error on either side.
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

  /**
   * Every field arrives in one map, and every one of them is optional.
   *
   * Read with `getString`, which answers null for a key that is absent and for
   * one explicitly set to null alike — which is what the SDK wants, since both
   * mean "leave this field as it is". Validation lives in the SDK's
   * `DeeplinklyUserData` rather than here, for the same reason `logEvent`
   * forwards raw: a native-only integration and this bridge have to give the
   * same answer for the same input.
   */
  @ReactMethod
  override fun setUserData(fields: ReadableMap, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    promise.resolve(
      Deeplinkly.setUserData(
        userId = fields.getStringOrNull("user_id"),
        email = fields.getStringOrNull("email"),
        phoneNumber = fields.getStringOrNull("phone_number"),
        firstName = fields.getStringOrNull("first_name"),
        lastName = fields.getStringOrNull("last_name"),
        dateOfBirth = fields.getStringOrNull("date_of_birth"),
        gender = fields.getStringOrNull("gender"),
        street = fields.getStringOrNull("street"),
        city = fields.getStringOrNull("city"),
        state = fields.getStringOrNull("state"),
        zip = fields.getStringOrNull("zip"),
        country = fields.getStringOrNull("country"),
      )
    )
  }

  @ReactMethod
  override fun clearUserData(promise: Promise) {
    if (!requireEnabled(promise, false)) return
    Deeplinkly.clearUserData()
    promise.resolve(true)
  }

  /** Null for an absent key as well as an explicitly null one. */
  private fun ReadableMap.getStringOrNull(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

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
    // produced reaches the backend unaltered. Options win on key collision.
    val payload = HashMap<String, Any?>().apply {
      putAll(content.toHashMap())
      putAll(options.toHashMap())
    }

    Deeplinkly.generateLink(payload) { generated ->
      // Null fields are omitted rather than sent as null, so JS sees the same
      // shape every other Deeplinkly integration does.
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
   * `DeeplinklyEvent.validate` rather than here, so a native-only integration and
   * this bridge give the same answer for the same event. Pre-checking here is how
   * that guarantee would rot.
   */
  @ReactMethod
  override fun logEvent(eventName: String, parameters: ReadableMap, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    Deeplinkly.logEvent(eventName, parameters.toHashMap()) { ok -> promise.resolve(ok) }
  }

  /**
   * The value is read as a Double via `getDouble`, which is the only numeric
   * type the bridge carries — JavaScript has no integers, so a purchase costing
   * exactly 50 arrives here as 50.0 either way.
   */
  @ReactMethod
  override fun logPurchase(fields: ReadableMap, promise: Promise) {
    if (!requireEnabled(promise, false)) return
    if (!fields.hasKey("value") || fields.isNull("value")) {
      promise.resolve(false)
      return
    }
    val currency = fields.getStringOrNull("currency")
    if (currency == null) {
      promise.resolve(false)
      return
    }
    Deeplinkly.logPurchase(
      value = fields.getDouble("value"),
      currency = currency,
      orderId = fields.getStringOrNull("order_id"),
      quantity = if (fields.hasKey("quantity") && !fields.isNull("quantity")) {
        fields.getInt("quantity")
      } else {
        null
      },
      productId = fields.getStringOrNull("product_id"),
      parameters = if (fields.hasKey("parameters") && !fields.isNull("parameters")) {
        fields.getMap("parameters")?.toHashMap() ?: emptyMap()
      } else {
        emptyMap()
      },
    ) { ok -> promise.resolve(ok) }
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
   *
   * `reactApplicationContext.currentActivity` rather than the inherited
   * `getCurrentActivity()`, which React Native deprecated in 0.80.
   *
   * Parameters are declared non-null because React Native 0.87 rewrote
   * `ActivityEventListener` in Kotlin with non-null types. Older React Native
   * declares them in Java, where they arrive as platform types and accept a
   * non-null override just as well — so this signature satisfies both.
   */
  override fun onNewIntent(intent: Intent) {
    val context: Context = reactApplicationContext.currentActivity ?: reactApplicationContext
    Deeplinkly.onNewIntent(context, intent)
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) = Unit

  // -- LifecycleEventListener -------------------------------------------------

  /**
   * Also the cold-start hook, exactly once.
   *
   * `onActivityLaunch` reads the activity's launch intent, checks the Play
   * install referrer and drains the retry queues — the work the SDK would have
   * done from `onActivityCreated` had this module existed by then. Nothing else
   * recovers a cold-start link: [onNewIntent] only fires for warm starts, so
   * without this a link tapped while the app was not running is lost.
   *
   * Once per module instance, not once per resume. `onHostResume` fires on every
   * foreground, and re-running this on each one would re-resolve the launch
   * intent and re-report attribution on every app switch. The SDK's own
   * `EXTRA_CONSUMED` guard stops most of that, but it is set on the `Intent`
   * instance, so it does not survive the activity being recreated across a
   * configuration change. The flag makes the replay impossible rather than merely
   * unlikely.
   *
   * Ordering against [jsReady] does not matter: a link resolved before JS
   * subscribes is held in the SDK's persistent queue, and the
   * `setDeepLinkListener` above drains it on attach.
   */
  override fun onHostResume() {
    if (!Deeplinkly.isEnabled) return
    // Re-attaching is idempotent — there is one listener slot and setting it
    // overwrites — and it re-drains anything that queued while backgrounded.
    if (jsIsReady) {
      Deeplinkly.setDeepLinkListener(deepLinkListener)
    }
    if (!launchCaptured) {
      launchCaptured = true
      reactApplicationContext.currentActivity?.let { Deeplinkly.onActivityLaunch(it) }
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

  /**
   * `emitDeviceEvent` rather than `getJSModule(RCTDeviceEventEmitter)`: it is the
   * supported entry point in both bridge and bridgeless modes — bridgeless is the
   * default from React Native 0.74 — and it null-checks the emitter instead of
   * throwing when the JS side is not up.
   */
  private fun emitLink(raw: Map<String, Any?>) {
    reactApplicationContext.emitDeviceEvent(LINK_EVENT, Arguments.makeNativeMap(raw))
  }

  // -- helpers ----------------------------------------------------------------

  /**
   * Resolves [disabledValue] and returns false when the SDK has no API key.
   *
   * Each caller passes its own correctly-typed failure value rather than one
   * shared `SDK_DISABLED` envelope: a typed TurboModule cannot resolve a map
   * where it declared a boolean, so the envelope would break the contract for
   * every method that does not return an object. [isAvailable] is how a host
   * distinguishes "no API key" from "call failed".
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
