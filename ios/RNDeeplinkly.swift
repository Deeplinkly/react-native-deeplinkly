import Deeplinkly
import Foundation
import React

/**
 React Native bridge over the Deeplinkly iOS SDK.

 A bridge, not an implementation: resolution, attribution, the pasteboard path,
 queues, retries, device signals and networking all live in the `Deeplinkly` pod,
 shared with every other Deeplinkly integration. Method names mirror the SDK's own
 entry points so all of them drive identical code.

 `Deeplinkly` is a caseless enum — a static namespace, not a singleton — so
 every call below is `Deeplinkly.foo()` rather than `Deeplinkly.shared.foo()`.

 Every SDK completion already hops to the main thread (`Deeplinkly.answer`), so
 nothing here re-dispatches before resolving a promise.
 */
@objc(RNDeeplinkly)
final class RNDeeplinkly: RCTEventEmitter, DeeplinklyDeepLinkListener {

  private static let linkEvent = "DeeplinklyDidResolveLink"

  private var isObserving = false

  override init() {
    super.init()

    // Reads `DeeplinklyApiKey` from Info.plist. Idempotent, and flushes any link
    // that reached `Deeplinkly.handleLink` — via RNDeeplinklyLinking, from the
    // host's AppDelegate — before now.
    Deeplinkly.initialize()

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override func supportedEvents() -> [String]! { [Self.linkEvent] }

  /// The SDK can resolve a link during module construction — the pasteboard read
  /// happens in `initialize()` — so this must not be built on a background queue.
  override static func requiresMainQueueSetup() -> Bool { true }

  // MARK: - listener attachment

  /**
   The point at which JS is known to be listening.

   `startObserving` fires on the first `addListener` from JS, which is the
   earliest moment a delivered link can actually be received. Attaching sooner
   would lose it: `SdkRuntime` buffers payloads only until a listener attaches,
   and `sendEvent` with no JS subscriber succeeds silently — so the SDK would
   consider a link delivered that nothing ever saw.

   `setDeepLinkListener` is itself the flush trigger, so attaching here drains
   whatever buffered while JS was starting up.
   */
  override func startObserving() {
    isObserving = true
    attachListener()
  }

  override func stopObserving() {
    isObserving = false
    Deeplinkly.setDeepLinkListener(nil)
  }

  private func attachListener() {
    guard isObserving else { return }
    // `SdkRuntime` retains the listener strongly for the process lifetime, so
    // there is nothing to hold here. Re-attaching is idempotent — there is one
    // slot — and re-drains anything buffered meanwhile.
    if Thread.isMainThread {
      Deeplinkly.setDeepLinkListener(self)
    } else {
      DispatchQueue.main.async { Deeplinkly.setDeepLinkListener(self) }
    }
  }

  @objc private func applicationDidBecomeActive() {
    guard Deeplinkly.isEnabled else { return }
    attachListener()
    Deeplinkly.onForeground()
  }

  // MARK: - DeeplinklyDeepLinkListener

  /// Forwarded unchanged, so the JS envelope stays exactly `{click_id, params}`,
  /// identical on both platforms. `click_id` may be `NSNull`, which bridges to
  /// `null` in JS.
  func onDeepLink(_ payload: [String: Any]) {
    // Already on the main thread; SdkRuntime guarantees it.
    sendEvent(withName: Self.linkEvent, body: payload)
  }

  // MARK: - lifecycle

  @objc(jsReady:reject:)
  func jsReady(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // `startObserving` has already attached by the time JS can call this — it
    // fires on the same `addListener`. Kept as a belt-and-braces re-attach so
    // the contract holds even if a host calls it directly.
    attachListener()
    resolve(nil)
  }

  @objc(isAvailable:reject:)
  func isAvailable(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(Deeplinkly.isEnabled)
  }

  // MARK: - identity
  //
  // These two answer before the `isEnabled` gate: local privacy and identity
  // operations that need no API key, so they stay available on a build whose
  // Info.plist entry is missing.

  @objc(getDeeplinklyId:reject:)
  func getDeeplinklyId(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(Deeplinkly.getDeeplinklyId())
  }

  @objc(resetPrivacyData:reject:)
  func resetPrivacyData(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(Deeplinkly.resetPrivacyData())
  }

  @objc(setUserId:resolve:reject:)
  func setUserId(
    _ userId: String?,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(nil) }
    Deeplinkly.setUserId(userId)
    resolve(nil)
  }

  @objc(getInstallAttribution:reject:)
  func getInstallAttribution(
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve([String: Any]()) }
    resolve(Deeplinkly.getInstallAttribution())
  }

  // MARK: - links

  @objc(generateLink:options:resolve:reject:)
  func generateLink(
    _ content: NSDictionary,
    options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(Self.disabledResult) }

    // Flat-merged and passed straight through, so whatever the JS models
    // produced reaches the backend unaltered. Options win on key collision.
    var payload = (content as? [String: Any]) ?? [:]
    for (key, value) in (options as? [String: Any]) ?? [:] {
      payload[key] = value
    }

    // The SDK's response is already the `{success, url, error_code,
    // error_message}` shape JS unpacks, nulls omitted.
    Deeplinkly.generateLink(payload: payload) { response in resolve(response) }
  }

  // MARK: - events

  /**
   Parameters are forwarded raw. Validation lives in the SDK's `DeeplinklyEvent`
   rather than here, so a native-only integration and this bridge give the same
   answer for the same event. Pre-checking here is how that guarantee would rot.
   */
  @objc(logEvent:parameters:resolve:reject:)
  func logEvent(
    _ eventName: String,
    parameters: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    Deeplinkly.logEvent(
      eventName,
      parameters: (parameters as? [String: Any]) ?? [:]
    ) { ok in resolve(ok) }
  }

  // MARK: - privacy

  @objc(disableTracking:resolve:reject:)
  func disableTracking(
    _ disabled: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    Deeplinkly.setTrackingEnabled(!disabled)
    resolve(true)
  }

  @objc(setAttributionLevel:resolve:reject:)
  func setAttributionLevel(
    _ level: String,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    guard let parsed = AttributionLevel(rawValue: level.lowercased()) else {
      return resolve(false)
    }
    resolve(Deeplinkly.setAttributionLevel(parsed))
  }

  @objc(getAttributionLevel:reject:)
  func getAttributionLevel(
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else {
      return resolve(AttributionLevel.none.rawValue)
    }
    resolve(Deeplinkly.getAttributionLevel().rawValue)
  }

  // MARK: - pasteboard
  //
  // Real here, unlike Android, which recovers pre-install links through the Play
  // Install Referrer and never touches the clipboard.

  @objc(setCheckPasteboardOnInstall:checkNow:resolve:reject:)
  func setCheckPasteboardOnInstall(
    _ enabled: Bool,
    checkNow: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    Deeplinkly.setCheckPasteboardOnInstall(enabled, checkNow: checkNow)
    resolve(true)
  }

  @objc(willShowPasteboardBanner:reject:)
  func willShowPasteboardBanner(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    Deeplinkly.willShowPasteboardBanner { willShow in resolve(willShow) }
  }

  /// Fire-and-forget. `true` means the read was started, not that anything was
  /// found — a recovered link arrives later as a normal deep link event.
  @objc(checkPasteboardNow:reject:)
  func checkPasteboardNow(
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    guard Deeplinkly.isEnabled else { return resolve(false) }
    Deeplinkly.checkPasteboardNow()
    resolve(true)
  }

  // MARK: - diagnostics

  @objc(setDebugMode:resolve:reject:)
  func setDebugMode(
    _ enabled: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    Deeplinkly.setDebugMode(enabled)
    resolve(nil)
  }

  // MARK: - helpers

  /**
   The disabled-SDK value for `generateLink`.

   Each method resolves its own correctly-typed failure value rather than one
   shared `SDK_DISABLED` envelope: a typed TurboModule cannot resolve a map where
   it declared a boolean, so the envelope would break the contract for every
   method that does not return an object. `isAvailable` is how a host
   distinguishes "no API key" from "call failed".
   */
  private static let disabledResult: [String: Any] = [
    "success": false,
    "error_code": "SDK_DISABLED",
    "error_message": "Deeplinkly SDK is disabled (missing API key).",
  ]
}
