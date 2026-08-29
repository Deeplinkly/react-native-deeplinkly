package com.deeplinkly.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableMap

/**
 * Legacy-architecture superclass.
 *
 * Hand-written counterpart to the codegen'd `NativeDeeplinklySpec` the
 * `src/newarch` twin extends. The signatures must match what codegen produces
 * from `src/NativeDeeplinkly.ts` exactly — same names, same order, same types —
 * because `DeeplinklyModule` overrides both with one implementation.
 *
 * The type mapping codegen applies, for anyone editing this: `boolean` →
 * `Boolean`, `string` → `String`, `string | null` → `String?`, `number` →
 * `Double`, `UnsafeObject` → `ReadableMap`, and every `Promise<T>` becomes a
 * trailing `Promise` parameter with a `Unit` return.
 *
 * `@ReactMethod` deliberately does not appear here. The legacy bridge scans
 * `getDeclaredMethods()` on the concrete class, so an annotation on an abstract
 * declaration is never seen — it has to sit on the override in
 * `DeeplinklyModule`.
 */
abstract class DeeplinklyModuleSpec(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  abstract fun jsReady(promise: Promise)

  abstract fun isAvailable(promise: Promise)

  abstract fun getDeeplinklyId(promise: Promise)

  abstract fun setUserId(userId: String?, promise: Promise)

  abstract fun setUserData(fields: ReadableMap, promise: Promise)

  abstract fun clearUserData(promise: Promise)

  abstract fun setConsent(fields: ReadableMap, promise: Promise)

  abstract fun setPushToken(fields: ReadableMap, promise: Promise)

  abstract fun setPIIHashingEnabled(enabled: Boolean, promise: Promise)

  abstract fun isPIIHashingEnabled(promise: Promise)

  abstract fun getInstallAttribution(promise: Promise)

  abstract fun generateLink(content: ReadableMap, options: ReadableMap, promise: Promise)

  abstract fun logEvent(eventName: String, parameters: ReadableMap, promise: Promise)

  abstract fun logPurchase(fields: ReadableMap, promise: Promise)

  abstract fun disableTracking(disabled: Boolean, promise: Promise)

  abstract fun resetPrivacyData(promise: Promise)

  abstract fun setAttributionLevel(level: String, promise: Promise)

  abstract fun getAttributionLevel(promise: Promise)

  abstract fun setCheckPasteboardOnInstall(
    enabled: Boolean,
    checkNow: Boolean,
    promise: Promise
  )

  abstract fun willShowPasteboardBanner(promise: Promise)

  abstract fun checkPasteboardNow(promise: Promise)

  abstract fun setDebugMode(enabled: Boolean, promise: Promise)

  abstract fun addListener(eventName: String)

  abstract fun removeListeners(count: Double)
}
