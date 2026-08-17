import React
import UIKit

/// View manager for `<DeeplinklyPasteButton>`. Props and the `onPasteResult`
/// event are exported in DeeplinklyPasteButtonManager.mm.
@objc(DeeplinklyPasteButtonManager)
final class DeeplinklyPasteButtonManager: RCTViewManager {

  override func view() -> UIView! {
    DeeplinklyPasteButtonView()
  }

  /// The paste control is built on the main thread and reads UIKit state.
  override static func requiresMainQueueSetup() -> Bool { true }
}
