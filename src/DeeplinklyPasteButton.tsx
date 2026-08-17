import React from 'react';
import {
  Platform,
  processColor,
  requireNativeComponent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface NativeProps {
  displayMode?: string;
  cornerStyle?: string;
  backgroundColor?: number | null;
  foregroundColor?: number | null;
  style?: StyleProp<ViewStyle>;
  onPasteResult?: (event: { nativeEvent: { handled: boolean } }) => void;
}

/**
 * Resolved lazily so that importing this module on Android — where the view is
 * never registered — does not throw. `isSupported` gates every actual render.
 */
let NativePasteButton: React.ComponentType<NativeProps> | null = null;

function getNativeComponent(): React.ComponentType<NativeProps> {
  if (NativePasteButton == null) {
    NativePasteButton =
      requireNativeComponent<NativeProps>('DeeplinklyPasteButton');
  }
  return NativePasteButton;
}

export interface DeeplinklyPasteButtonProps {
  /**
   * Called after a tap is processed. `handled` is false when the pasted content
   * was not one of your links — useful for hiding the button or explaining the
   * miss. The recovered link itself arrives on the normal deep link listener.
   */
  onPasted?: (handled: boolean) => void;

  /** Rendered on Android and on iOS below 16, where the control does not exist. */
  fallback?: React.ReactNode;

  displayMode?: 'iconOnly' | 'labelOnly' | 'iconAndLabel';

  cornerStyle?: 'small' | 'medium' | 'large' | 'capsule';

  /**
   * Override the control's tint. Left unset, it renders as the system paste
   * button — which is the recommended default: styling it to look like
   * something else is what gets a paste button rejected as misleading.
   */
  backgroundColor?: string;

  foregroundColor?: string;

  /**
   * The control has an intrinsic size but React Native's layout does not read
   * it, so the view needs explicit dimensions. Defaults to 140×40.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Whether the native paste control exists on this device.
 *
 * `<DeeplinklyPasteButton>` already checks this and renders `fallback`
 * otherwise, so it is safe to place unconditionally. Exposed for hosts that
 * want to change surrounding copy rather than just the button.
 */
export const isPasteButtonSupported: boolean =
  Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 16;

/**
 * A system paste button that recovers a deferred deep link with **no "Pasted
 * from…" banner** — the user's tap is the grant, so iOS shows nothing.
 *
 * The recommended deferred-deep-linking path on iOS. The alternative, the
 * automatic pasteboard read, is on by default and does show the banner; turning
 * it off in `Info.plist` and shipping this instead is a perfectly good
 * configuration.
 *
 * Put it on a first-run screen beside something like *"Tapped a link to get
 * here? Restore where you left off."*
 *
 * ```tsx
 * <DeeplinklyPasteButton
 *   onPasted={(handled) => setShowButton(!handled)}
 *   fallback={null}
 * />
 * ```
 */
export function DeeplinklyPasteButton({
  onPasted,
  fallback = null,
  displayMode = 'iconAndLabel',
  cornerStyle = 'capsule',
  backgroundColor,
  foregroundColor,
  style,
}: DeeplinklyPasteButtonProps) {
  if (!isPasteButtonSupported) {
    return <>{fallback}</>;
  }

  const Native = getNativeComponent();

  return (
    <Native
      style={[{ width: 140, height: 40 }, style]}
      displayMode={displayMode}
      cornerStyle={cornerStyle}
      backgroundColor={
        backgroundColor == null
          ? null
          : (processColor(backgroundColor) as number | null)
      }
      foregroundColor={
        foregroundColor == null
          ? null
          : (processColor(foregroundColor) as number | null)
      }
      onPasteResult={(event) => onPasted?.(event.nativeEvent.handled)}
    />
  );
}

export default DeeplinklyPasteButton;
