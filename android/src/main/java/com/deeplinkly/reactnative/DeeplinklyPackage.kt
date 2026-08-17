package com.deeplinkly.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class DeeplinklyPackage : BaseReactPackage() {

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext
  ): NativeModule? =
    if (name == DeeplinklyModule.NAME) DeeplinklyModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      DeeplinklyModule.NAME to ReactModuleInfo(
        DeeplinklyModule.NAME,
        DeeplinklyModule.NAME,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        // Must track the source set that actually compiled, not a constant.
        // Claiming TurboModule on a legacy build makes the registry look for a
        // JSI binding that was never generated.
        BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      )
    )
  }
}
