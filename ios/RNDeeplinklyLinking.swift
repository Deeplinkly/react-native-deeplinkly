import Deeplinkly
import Foundation
import UIKit

/**
 Forwarding entry points for the host app's `AppDelegate` / `SceneDelegate`.

 React Native has no equivalent of Flutter's `registrar.addApplicationDelegate`
 — a native module never receives app-delegate callbacks — so unlike the Flutter
 plugin, this bridge cannot register itself for link delivery. The host has to
 forward, and the React Native template's `AppDelegate` ships with no linking
 support at all, so there is nothing to piggyback on either.

 All of these are safe to call before React Native has started: `handleLink`
 buffers until `Deeplinkly.initialize()` runs, `SdkRuntime` buffers again until
 a JS listener attaches, and a duplicate call for the same link is suppressed —
 the resolve is idempotent and attribution is written once. So forward eagerly
 and do not try to be clever about ordering.

 See docs/REACT_NATIVE_SDK.md for the copy-paste host wiring.
 */
@objc(RNDeeplinklyLinking)
public final class RNDeeplinklyLinking: NSObject {

  /// Custom-scheme and `openURL` links. Call from
  /// `application(_:open:options:)`.
  @objc(handleURL:)
  public static func handleURL(_ url: URL) {
    Deeplinkly.handleLink(url)
  }

  /// Universal Links. Call from
  /// `application(_:continue:restorationHandler:)`.
  ///
  /// Ignores activities that are not web browsing, so it is safe to pass every
  /// `NSUserActivity` the app receives.
  @objc(handleUserActivity:)
  public static func handleUserActivity(_ userActivity: NSUserActivity) {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
      let url = userActivity.webpageURL
    else { return }
    Deeplinkly.handleLink(url)
  }

  /**
   Cold launch on the pre-scene path. Call from
   `application(_:didFinishLaunchingWithOptions:)`.

   A Universal Link that *starts* the app does not arrive through
   `continue userActivity` — it is in `launchOptions`. Missing this loses
   exactly the case deferred deep linking exists for.
   */
  @objc(handleLaunchOptions:)
  public static func handleLaunchOptions(
    _ launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) {
    guard let launchOptions else { return }

    if let url = launchOptions[.url] as? URL {
      Deeplinkly.handleLink(url)
    }

    guard
      let activityDictionary =
        launchOptions[.userActivityDictionary] as? [AnyHashable: Any]
    else { return }

    for value in activityDictionary.values {
      if let activity = value as? NSUserActivity {
        handleUserActivity(activity)
      }
    }
  }

  /**
   Cold launch on the scene path. Call from
   `scene(_:willConnectTo:options:)`.

   When the host adopts `UISceneDelegate`, the `UIApplicationDelegate` callbacks
   above never fire — so a scene-based app needs this and the two below instead
   of, not in addition to, the app-delegate wiring.
   */
  @available(iOS 13.0, *)
  @objc(handleSceneConnectionOptions:)
  public static func handleSceneConnectionOptions(
    _ connectionOptions: UIScene.ConnectionOptions
  ) {
    for activity in connectionOptions.userActivities {
      handleUserActivity(activity)
    }
    handleOpenURLContexts(connectionOptions.urlContexts)
  }

  /// Custom-scheme links on the scene path. Call from
  /// `scene(_:openURLContexts:)`.
  @available(iOS 13.0, *)
  @objc(handleOpenURLContexts:)
  public static func handleOpenURLContexts(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      Deeplinkly.handleLink(context.url)
    }
  }
}
