#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift RNDeeplinkly class to the React Native module registry.
//
// The implementation lives in RNDeeplinkly.swift because the underlying
// Deeplinkly pod is Swift; these macros only declare the signatures so the
// bridge (legacy architecture) and the interop layer (new architecture) can find
// them. Every signature must stay in lockstep with the @objc selectors over
// there and with the TurboModule spec in src/NativeDeeplinkly.ts.
//
// RCT_EXTERN_MODULE expands into a category on the Swift class, so nothing may
// be *implemented* in this block — requiresMainQueueSetup and supportedEvents
// are overridden in Swift, not here.

@interface RCT_EXTERN_MODULE (RNDeeplinkly, RCTEventEmitter)

// -- lifecycle ---------------------------------------------------------------

RCT_EXTERN_METHOD(jsReady
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isAvailable
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- identity ----------------------------------------------------------------

RCT_EXTERN_METHOD(getDeeplinklyId
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(resetPrivacyData
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setUserId
                  : (nullable NSString *)userId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getInstallAttribution
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- links -------------------------------------------------------------------

RCT_EXTERN_METHOD(generateLink
                  : (NSDictionary *)content options
                  : (NSDictionary *)options resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- events ------------------------------------------------------------------

RCT_EXTERN_METHOD(logEvent
                  : (NSString *)eventName parameters
                  : (NSDictionary *)parameters resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- privacy -----------------------------------------------------------------

RCT_EXTERN_METHOD(disableTracking
                  : (BOOL)disabled resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setAttributionLevel
                  : (NSString *)level resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAttributionLevel
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- pasteboard --------------------------------------------------------------

RCT_EXTERN_METHOD(setCheckPasteboardOnInstall
                  : (BOOL)enabled checkNow
                  : (BOOL)checkNow resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(willShowPasteboardBanner
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkPasteboardNow
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

// -- diagnostics -------------------------------------------------------------

RCT_EXTERN_METHOD(setDebugMode
                  : (BOOL)enabled resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)

@end
