import Foundation
import React

/**
 STUB — plumbing only.

 Every method below is wired to the correct bridge signature and resolves the
 documented failure value, but none of them call into the native SDK yet. Each
 TODO names the `Deeplinkly` entry point it must delegate to; those entry points
 already exist in the `Deeplinkly` pod and are the same ones
 FlutterDeeplinklyPlugin drives, so filling these in is delegation, not new
 logic.

 Deliberately mirrors the Flutter plugin's method-channel names one-for-one.
 */
@objc(RNDeeplinkly)
class RNDeeplinkly: RCTEventEmitter {

  private static let linkEvent = "DeeplinklyDidResolveLink"

  /// Deep links resolved before JS attached a listener are held natively and
  /// flushed on `jsReady` — a cold start from a link must not race the bundle.
  private var jsIsReady = false

  override func supportedEvents() -> [String]! { [Self.linkEvent] }

  /// The native SDK can resolve a link during module registration, before any
  /// JS has run, so this module must exist by then to catch it.
  override static func requiresMainQueueSetup() -> Bool { true }

  // MARK: - lifecycle

  @objc(jsReady:reject:)
  func jsReady(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    jsIsReady = true
    // TODO(stub): drain the native pending-link queue through `emitLink`.
    resolve(nil)
  }

  // MARK: - identity

  @objc(getDeeplinklyId:reject:)
  func getDeeplinklyId(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.deeplinklyId
    resolve("")
  }

  @objc(setUserId:resolve:reject:)
  func setUserId(_ userId: String?, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.setCustomUserId(userId)
    resolve(nil)
  }

  @objc(getInstallAttribution:reject:)
  func getInstallAttribution(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.installAttribution
    resolve([String: String]())
  }

  // MARK: - links

  @objc(generateLink:options:resolve:reject:)
  func generateLink(
    _ content: NSDictionary,
    options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    // TODO(stub): Deeplinkly.shared.generateLink(content:options:) { result in ... }
    resolve(Self.failure("NOT_IMPLEMENTED", "react-native-deeplinkly iOS bridge is a stub"))
  }

  // MARK: - events

  @objc(logEvent:parameters:resolve:reject:)
  func logEvent(
    _ eventName: String,
    parameters: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    // TODO(stub): Deeplinkly.shared.logEvent(eventName, parameters:)
    // Validation stays native so a native-only integration gets the same answer.
    resolve(false)
  }

  // MARK: - privacy

  @objc(disableTracking:resolve:reject:)
  func disableTracking(_ disabled: Bool, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.setTrackingDisabled(disabled)
    resolve(false)
  }

  @objc(resetPrivacyData:reject:)
  func resetPrivacyData(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.resetPrivacyData()
    resolve(false)
  }

  @objc(setAttributionLevel:resolve:reject:)
  func setAttributionLevel(_ level: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.attributionLevel = .init(wireName: level)
    resolve(false)
  }

  @objc(getAttributionLevel:reject:)
  func getAttributionLevel(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.attributionLevel.wireName
    resolve("full")
  }

  // MARK: - pasteboard

  @objc(setCheckPasteboardOnInstall:checkNow:resolve:reject:)
  func setCheckPasteboardOnInstall(
    _ enabled: Bool,
    checkNow: Bool,
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    // TODO(stub): Deeplinkly.shared.setCheckPasteboardOnInstall(enabled, checkNow: checkNow)
    resolve(false)
  }

  @objc(willShowPasteboardBanner:reject:)
  func willShowPasteboardBanner(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.willShowPasteboardBanner
    resolve(false)
  }

  @objc(checkPasteboardNow:reject:)
  func checkPasteboardNow(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.checkPasteboardNow()
    resolve(false)
  }

  // MARK: - diagnostics

  @objc(setDebugMode:resolve:reject:)
  func setDebugMode(_ enabled: Bool, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // TODO(stub): Deeplinkly.shared.debugMode = enabled
    resolve(nil)
  }

  // MARK: - emitter

  private func emitLink(_ link: [String: Any]) {
    guard jsIsReady else { return }
    sendEvent(withName: Self.linkEvent, body: link)
  }

  /// The `{success, error_code, error_message}` shape index.tsx unpacks.
  private static func failure(_ code: String, _ message: String) -> [String: Any] {
    ["success": false, "error_code": code, "error_message": message]
  }
}
