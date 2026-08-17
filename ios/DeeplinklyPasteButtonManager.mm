#import <React/RCTBridgeModule.h>
#import <React/RCTViewManager.h>

// Exposes the Swift DeeplinklyPasteButtonManager and its view props.
//
// `backgroundColor` and `foregroundColor` map to differently-named Swift
// properties: `backgroundColor` is already a UIView property, so a prop of that
// name would set the container's own background instead of the paste control's
// tint. RCT_REMAP_VIEW_PROPERTY keeps the JS prop name while pointing at the
// unambiguous Swift one.

@interface RCT_EXTERN_MODULE (DeeplinklyPasteButtonManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(displayMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(cornerStyle, NSString)
RCT_REMAP_VIEW_PROPERTY(backgroundColor, pasteBackgroundColor, NSNumber)
RCT_REMAP_VIEW_PROPERTY(foregroundColor, pasteForegroundColor, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(onPasteResult, RCTBubblingEventBlock)

@end
