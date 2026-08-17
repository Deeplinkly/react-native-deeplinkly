import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import react_native_deeplinkly

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "DeeplinklyExample",
      in: window,
      launchOptions: launchOptions
    )

    // Cold launch. A Universal Link that *starts* the app is in launchOptions,
    // not in continue(userActivity:) — this is the case deferred deep linking
    // exists for. Safe before React Native is up: the SDK buffers the link
    // until a JS listener attaches.
    RNDeeplinklyLinking.handleLaunchOptions(launchOptions)

    return true
  }

  // Universal Links while the app is running.
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    RNDeeplinklyLinking.handleUserActivity(userActivity)
    // Non-exclusive: RCTLinkingManager should still see it so JS `Linking`
    // keeps working.
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }

  // Custom-scheme links.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RNDeeplinklyLinking.handleURL(url)
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
