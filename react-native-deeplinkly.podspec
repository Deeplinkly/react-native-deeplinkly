require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-deeplinkly"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://deeplinkly.com"
  s.license      = { :file => "LICENSE" }
  s.authors      = { "Deeplinkly" => "hello@deeplinkly.com" }
  s.source       = { :git => "https://github.com/deeplinkly/react-native-deeplinkly.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.0"

  # Stays at 13.0 — React Native 0.79's own floor. ATTrackingManager and
  # ASIdentifierManager are iOS 14 at *runtime*, not at deployment target: the
  # native SDK weak-links them behind `if #available`, so this number is set by
  # React Native, not by attribution.
  s.platform = :ios, "13.0"

  # The SDK itself. Everything below the bridge — resolution, attribution, the
  # pasteboard path, queues, retries, device signals, networking — lives here and
  # is shared with the native iOS SDK and the Flutter plugin, so the three can
  # never drift.
  s.dependency "Deeplinkly", "1.0.1"

  # Pulls in React-Core plus, on the new architecture, the codegen'd spec and
  # the TurboModule/Fabric headers this module compiles against.
  install_modules_dependencies(s)
end
