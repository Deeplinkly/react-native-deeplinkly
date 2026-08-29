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

  # Deliberately below React Native's current floor (15.1 as of 0.87) rather
  # than matched to it. CocoaPods takes the higher of the pod's and the app's
  # deployment target, so a low number here costs a modern host nothing while
  # keeping the library installable on an older one.
  #
  # Nothing in this bridge needs more: ATTrackingManager and the paste control
  # are iOS 14 and 16 at *runtime*, not at deployment target — both are
  # weak-linked behind `if #available`.
  s.platform = :ios, "13.0"

  # The SDK itself. Everything below the bridge — resolution, attribution, the
  # pasteboard path, queues, retries, device signals, networking — lives here and
  # is shared with every other Deeplinkly integration, so none of them can drift.
  s.dependency "Deeplinkly", "1.2.1"

  # Pulls in React-Core plus, on the new architecture, the codegen'd spec and
  # the TurboModule/Fabric headers this module compiles against.
  install_modules_dependencies(s)
end
