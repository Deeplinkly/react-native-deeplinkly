import Deeplinkly
import React
import UIKit

/**
 A system paste button that recovers a deferred deep link with no "Pasted
 from…" banner.

 Because the user taps the control themselves, iOS treats the tap as the grant
 and shows no banner at all — unlike the automatic pasteboard read, which does.
 This is the recommended deferred-deep-linking path on iOS; see
 docs/REACT_NATIVE_SDK.md.

 A recovered link arrives on the normal deep link listener like any other.
 `onPasteResult` only reports whether the pasted content was one of your links,
 so the button can be hidden or the miss explained.

 iOS 16+. Below that the view stays empty and JS renders its `fallback`.

 Ported from the Flutter plugin's `PasteControlFactory`, and uses only public
 SDK API (`Deeplinkly.handlePaste`).
 */
final class DeeplinklyPasteButtonView: UIView {

  /// Fires with `{ handled: Bool }` after a tap is processed.
  @objc var onPasteResult: RCTBubblingEventBlock?

  /// `"iconOnly"` | `"labelOnly"` | `"iconAndLabel"` (default).
  @objc var displayMode: NSString = "iconAndLabel" {
    didSet { setNeedsControlRebuild() }
  }

  /// `"small"` | `"medium"` | `"large"` | `"capsule"` (default).
  @objc var cornerStyle: NSString = "capsule" {
    didSet { setNeedsControlRebuild() }
  }

  /// Packed ARGB, as produced by React Native's `processColor`.
  @objc var pasteBackgroundColor: NSNumber? {
    didSet { setNeedsControlRebuild() }
  }

  /// Packed ARGB, as produced by React Native's `processColor`.
  @objc var pasteForegroundColor: NSNumber? {
    didSet { setNeedsControlRebuild() }
  }

  private var control: UIView?
  private var rebuildScheduled = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    setNeedsControlRebuild()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used by React Native")
  }

  /**
   Props arrive one at a time, each firing its own `didSet`. Rebuilding
   synchronously would construct and throw away a control per prop; coalescing
   to the end of the runloop turn builds one.
   */
  private func setNeedsControlRebuild() {
    guard !rebuildScheduled else { return }
    rebuildScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.rebuildScheduled = false
      self.rebuildControl()
    }
  }

  private func rebuildControl() {
    control?.removeFromSuperview()
    control = nil

    guard #available(iOS 16.0, *) else { return }

    let config = UIPasteControl.Configuration()

    switch displayMode as String {
    case "iconOnly": config.displayMode = .iconOnly
    case "labelOnly": config.displayMode = .labelOnly
    default: config.displayMode = .iconAndLabel
    }

    switch cornerStyle as String {
    case "small": config.cornerStyle = .small
    case "medium": config.cornerStyle = .medium
    case "large": config.cornerStyle = .large
    default: config.cornerStyle = .capsule
    }

    // Deliberately no label or icon override, and colors only when asked for.
    // Dressing a paste button up as something else is what gets it rejected as
    // misleading — the default is the system affordance for a reason.
    if let background = pasteBackgroundColor {
      config.baseBackgroundColor = UIColor(argb: background.intValue)
    }
    if let foreground = pasteForegroundColor {
      config.baseForegroundColor = UIColor(argb: foreground.intValue)
    }

    let pasteControl = UIPasteControl(configuration: config)
    // UIPasteControl delivers through the responder chain, so its target must
    // be the responder that overrides canPaste/paste — this view.
    pasteControl.target = self
    pasteControl.translatesAutoresizingMaskIntoConstraints = false
    addSubview(pasteControl)
    NSLayoutConstraint.activate([
      pasteControl.centerXAnchor.constraint(equalTo: centerXAnchor),
      pasteControl.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
    control = pasteControl
  }

  // MARK: - responder

  /**
   Drives the control's enabled state.

   Accepting plain text as well as URLs is load-bearing: the Deeplinkly
   interstitial falls back to `writeText`/`execCommand` when it cannot write a
   `text/uri-list` item, and a URL-only check would leave the button greyed out
   for exactly those users.
   */
  override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
    itemProviders.contains {
      $0.hasItemConformingToTypeIdentifier("public.url")
        || $0.hasItemConformingToTypeIdentifier("public.plain-text")
    }
  }

  override func paste(itemProviders: [NSItemProvider]) {
    Deeplinkly.handlePaste(itemProviders: itemProviders) { [weak self] handled in
      self?.onPasteResult?(["handled": handled])
    }
  }
}

private extension UIColor {
  /// Unpacks React Native's `processColor` output — alpha in the top byte.
  convenience init(argb: Int) {
    self.init(
      red: CGFloat((argb >> 16) & 0xFF) / 255.0,
      green: CGFloat((argb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(argb & 0xFF) / 255.0,
      alpha: CGFloat((argb >> 24) & 0xFF) / 255.0
    )
  }
}
