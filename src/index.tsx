import { NativeEventEmitter } from 'react-native';
import NativeDeeplinkly from './NativeDeeplinkly';
import type {
  AttributionLevel,
  DeeplinklyContent,
  DeeplinklyLink,
  DeeplinklyLinkOptions,
  DeeplinklyPurchase,
  DeeplinklyResult,
  DeeplinklyUserData,
  EventParameterValue,
} from './types';

export * from './types';
export {
  DeeplinklyPasteButton,
  isPasteButtonSupported,
  type DeeplinklyPasteButtonProps,
} from './DeeplinklyPasteButton';

const LINK_EVENT = 'DeeplinklyDidResolveLink';

// The module doubles as the emitter. Passing it is what iOS requires (its
// RCTEventEmitter owns the subscription) and what the new architecture wants on
// both platforms; Android's old-architecture path ignores the argument.
// TurboModuleRegistry hands back the NativeModules proxy when the new
// architecture is off, so this is the same object either way.
//
// Built on first use, not at module scope. `NativeEventEmitter`'s constructor
// probes the module for `addListener`/`removeListeners`, and when the native
// module is missing those reads hit the throwing proxy from
// `NativeDeeplinkly.ts` — so constructing eagerly raised the not-linked error on
// *import*, taking the bundle down before a host could call `isAvailable()` to
// find out why. That defeated the deferral the proxy exists to provide.
let emitter: NativeEventEmitter | undefined;

function getEmitter(): NativeEventEmitter {
  emitter ??= new NativeEventEmitter(
    NativeDeeplinkly as unknown as ConstructorParameters<
      typeof NativeEventEmitter
    >[0]
  );
  return emitter;
}

/** Unsubscribe handle returned by {@link Deeplinkly.addListener}. */
export interface Subscription {
  remove(): void;
}

let readySignalled = false;

/**
 * Fire-and-forget calls swallow their rejection deliberately.
 *
 * A reporting call that fails must never surface as an unhandled rejection in
 * the host app — hosts that funnel those into a crash reporter would record a
 * fatal on something the SDK is designed to retry.
 */
function ignore<T>(p: Promise<T>): void {
  p.catch(() => undefined);
}

export const Deeplinkly = {
  /**
   * Subscribe to resolved deep links.
   *
   * Safe to call at any point — links that resolved before the first listener
   * attached are queued natively and delivered on subscribe, so a cold start
   * from a link does not race the JS bundle.
   */
  addListener(handler: (link: DeeplinklyLink) => void): Subscription {
    // NativeEventEmitter types its payload as `Object`, so the envelope's shape
    // is asserted here rather than at every call site. The native side builds it
    // — see DeeplinklyLink.
    const sub = getEmitter().addListener(LINK_EVENT, (payload) =>
      handler(payload as unknown as DeeplinklyLink)
    );

    if (!readySignalled) {
      readySignalled = true;
      ignore(NativeDeeplinkly.jsReady());
    }

    return sub;
  },

  /**
   * Whether the SDK found an API key and initialised.
   *
   * False means the key is missing from `AndroidManifest.xml` or `Info.plist`.
   * Every other method still answers while disabled — with its documented
   * failure value — so this is how you tell a misconfigured build apart from a
   * call that simply failed. Worth asserting once on a debug build.
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await NativeDeeplinkly.isAvailable();
    } catch {
      return false;
    }
  },

  /** Stable Deeplinkly device id for this install. Empty string on failure. */
  async getDeeplinklyId(): Promise<string> {
    try {
      return await NativeDeeplinkly.getDeeplinklyId();
    } catch {
      return '';
    }
  },

  /** Sets your app's user id (`custom_user_id`). Pass `null` to clear it. */
  setUserId(userId: string | null): void {
    ignore(NativeDeeplinkly.setUserId(userId));
  },

  /**
   * Record what you know about the person using your app.
   *
   * These are the fields a conversion is matched on once it is forwarded to
   * Meta's Conversions API or Google's enhanced conversions. On iOS with App
   * Tracking Transparency denied — which is most devices — a hashed email is
   * the only match key that still exists, so supplying one here is the
   * difference between a purchase attributed to the campaign that produced it
   * and one that is not.
   *
   * Values are sent as supplied and hashed only at forwarding time. On-device
   * hashing would look safer and buy nothing: the digest of a normalised email
   * is exactly the value Meta matches on, so anyone holding it holds the match
   * key. Supply only what your own privacy policy and consent flow allow — the
   * SDK cannot know what you told your users.
   *
   * Each call **merges**: a field left undefined is left as it was. A single
   * field therefore cannot be cleared by omitting it — {@link clearUserData}
   * erases all of them, and {@link setUserId} with `null` clears just the id.
   *
   * The rules are enforced natively, so a native-only integration gets the same
   * answer this one does. Resolves false if any field was malformed, in which
   * case **nothing** was stored.
   */
  async setUserData(data: DeeplinklyUserData): Promise<boolean> {
    try {
      // Snake_case at the boundary: these are the keys both native bridges
      // read, and they are the catalogue's own spelling.
      return await NativeDeeplinkly.setUserData({
        user_id: data.userId ?? null,
        email: data.email ?? null,
        phone_number: data.phoneNumber ?? null,
        first_name: data.firstName ?? null,
        last_name: data.lastName ?? null,
        date_of_birth: data.dateOfBirth ?? null,
        gender: data.gender ?? null,
        street: data.street ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        zip: data.zip ?? null,
        country: data.country ?? null,
      });
    } catch {
      return false;
    }
  },

  /**
   * Forget everything {@link setUserData} and {@link setUserId} recorded, here
   * and on Deeplinkly's servers.
   *
   * Call it on sign-out, or when someone withdraws consent. Unlike letting the
   * values simply stop being sent, this actively erases them: the next
   * enrichment carries each previously-set field as an empty value, which the
   * backend reads as "null this column" rather than "not reported". The erasure
   * is re-sent until it is delivered, so calling this on a device that is
   * offline still takes effect once it is not.
   */
  clearUserData(): void {
    ignore(NativeDeeplinkly.clearUserData());
  },

  /** Install attribution for this device. Empty object on failure. */
  async getInstallAttribution(): Promise<Record<string, string>> {
    try {
      return (await NativeDeeplinkly.getInstallAttribution()) as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  },

  /** Create a Deeplinkly link for a piece of content. */
  async generateLink(
    content: DeeplinklyContent,
    options: DeeplinklyLinkOptions
  ): Promise<DeeplinklyResult> {
    try {
      const raw = (await NativeDeeplinkly.generateLink(
        {
          canonical_identifier: content.canonicalIdentifier,
          ...(content.title != null && { title: content.title }),
          ...(content.description != null && {
            description: content.description,
          }),
          ...(content.imageUrl != null && { image_url: content.imageUrl }),
          metadata: content.metadata ?? {},
        },
        {
          channel: options.channel,
          feature: options.feature,
          ...(options.tags?.length ? { tags: options.tags } : {}),
        }
      )) as Record<string, unknown> | null;

      if (raw == null) {
        return {
          success: false,
          errorCode: 'NULL_NATIVE_RESPONSE',
          errorMessage: 'No response from native layer',
        };
      }

      return {
        success: raw.success === true,
        url: raw.url as string | undefined,
        errorCode: raw.error_code as string | undefined,
        errorMessage: raw.error_message as string | undefined,
      };
    } catch (e) {
      return {
        success: false,
        errorCode: 'NATIVE_EXCEPTION',
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  },

  /**
   * Log a custom event. Resolves true if accepted by the native layer and the
   * backend.
   *
   * The rules are enforced natively rather than here, so a native-only
   * integration gets the same answer this one does:
   *
   * - event name: non-empty after trimming, at most 64 characters
   * - at most 25 parameters
   * - parameter keys: non-empty after trimming, at most 64 characters, and may
   *   not start with `_dl_` (reserved for the metadata the SDK attaches to
   *   every event, which the backend excludes from the parameter budget)
   * - string values: at most 256 characters
   * - array/object values: stored as compact JSON, and it is that encoded form
   *   the 256 limit applies to; values that will not encode are rejected
   * - any type other than string, number, boolean, array or object is rejected
   *
   * A rejected event resolves false and sends nothing.
   */
  async logEvent(
    eventName: string,
    parameters: Record<string, EventParameterValue> = {}
  ): Promise<boolean> {
    try {
      return await NativeDeeplinkly.logEvent(eventName, parameters);
    } catch {
      return false;
    }
  },

  /**
   * Log a purchase.
   *
   * A thin, typed wrapper over {@link logEvent} rather than a separate
   * pipeline: it sends the event named `purchase` with `value` and `currency`
   * set, and everything true of `logEvent` — the retry queue, the parameter
   * limits, the device block — is true of this too.
   *
   * The wrapper exists because those two keys have to be spelled the same way
   * by every caller. `logEvent` is untyped, so left to themselves one app sends
   * `revenue`, another sends `"USD 49.99"`, and a conversion forwarder has to
   * guess. Meta's Conversions API wants `custom_data.value` and `currency`;
   * Google wants a conversion value and currency. This is the one spelling both
   * can be built from.
   *
   * Rejected natively — resolving false and sending nothing — if the value is
   * negative or not finite, the currency is not three letters, the quantity is
   * negative, or `parameters` collides with a reserved key.
   */
  async logPurchase(purchase: DeeplinklyPurchase): Promise<boolean> {
    try {
      return await NativeDeeplinkly.logPurchase({
        value: purchase.value,
        currency: purchase.currency,
        order_id: purchase.orderId ?? null,
        quantity: purchase.quantity ?? null,
        product_id: purchase.productId ?? null,
        parameters: purchase.parameters ?? {},
      });
    } catch {
      return false;
    }
  },

  /**
   * Turn all reporting off, or back on.
   *
   * The switch for a consent flow's "don't track me". While disabled the SDK
   * sends no enrichment, no events and no error reports, and skips the iOS
   * pasteboard read. Pending reporting retries are deleted. Deep links still
   * resolve and are still delivered to listeners — the link a user tapped keeps
   * working — but functional requests omit the stable Deeplinkly ID and custom
   * user ID while tracking is disabled.
   *
   * Persists across launches on both platforms. Enabled by default.
   *
   * Wins over {@link setAttributionLevel}: while disabled,
   * {@link getAttributionLevel} reports `'none'` whatever level was set. Use
   * {@link setAttributionLevel} when you need a middle ground rather than an
   * off switch.
   */
  async setTrackingEnabled(enabled: boolean): Promise<boolean> {
    try {
      return await NativeDeeplinkly.disableTracking(!enabled);
    } catch {
      return false;
    }
  },

  /**
   * Delete Deeplinkly's locally stored privacy data.
   *
   * Removes the stable Deeplinkly ID, custom user ID, attribution, cached
   * device profile, session/event state, pasteboard state, and pending queues.
   * Tracking remains disabled after deletion; call {@link setTrackingEnabled}
   * with `true` only after the user opts back in.
   */
  async resetPrivacyData(): Promise<boolean> {
    try {
      return await NativeDeeplinkly.resetPrivacyData();
    } catch {
      return false;
    }
  },

  /**
   * Restrict how much the SDK may report about this device.
   *
   * The level persists across launches. To start restricted before any JS
   * runs, set `DeeplinklyAttributionLevel` in `Info.plist` (iOS) or the
   * `com.deeplinkly.sdk.attribution_level` manifest meta-data (Android) —
   * enrichment can be sent during module registration, before this could be
   * called.
   */
  async setAttributionLevel(level: AttributionLevel): Promise<boolean> {
    try {
      return await NativeDeeplinkly.setAttributionLevel(level);
    } catch {
      return false;
    }
  },

  /**
   * The attribution level currently in force. Reports `'none'` when tracking
   * is disabled, even if a higher level was set.
   */
  async getAttributionLevel(): Promise<AttributionLevel> {
    try {
      const raw = await NativeDeeplinkly.getAttributionLevel();
      return (['full', 'reduced', 'minimal', 'none'] as const).includes(
        raw as AttributionLevel
      )
        ? (raw as AttributionLevel)
        : 'full';
    } catch {
      return 'full';
    }
  },

  /**
   * Turn the automatic pasteboard read on or off.
   *
   * iOS-only — Android uses the Play Install Referrer and needs no clipboard
   * access. The SDK reads the pasteboard once on first launch to recover a link
   * tapped before install, and iOS shows its "Pasted from…" banner for that
   * read.
   *
   * **On by default.** To turn it *off*, do it in `Info.plist` rather than here
   * — this call arrives after module registration, by which point the read has
   * already happened:
   *
   * ```xml
   * <key>DeeplinklyCheckPasteboardOnInstall</key>
   * <false/>
   * ```
   *
   * Turning it *on* from JS performs the read immediately rather than waiting
   * for a next launch the pasteboard may not survive to. Pass `checkNow` as
   * false to suppress that.
   *
   * Resolves false on Android, where there is nothing to enable.
   */
  async setCheckPasteboardOnInstall(
    enabled: boolean,
    checkNow: boolean = true
  ): Promise<boolean> {
    try {
      return await NativeDeeplinkly.setCheckPasteboardOnInstall(
        enabled,
        checkNow
      );
    } catch {
      return false;
    }
  },

  /**
   * Whether reading the pasteboard right now would show the system banner.
   *
   * Checking costs nothing and shows no banner itself, so it is safe to call on
   * a first-run screen to decide whether to explain the prompt before it
   * appears. Always false on Android.
   */
  async willShowPasteboardBanner(): Promise<boolean> {
    try {
      return await NativeDeeplinkly.willShowPasteboardBanner();
    } catch {
      return false;
    }
  },

  /**
   * Perform the pasteboard read now, if enabled and not already run. Pair with
   * {@link willShowPasteboardBanner} to show your own explanation first.
   * Always false on Android.
   */
  async checkPasteboardNow(): Promise<boolean> {
    try {
      return await NativeDeeplinkly.checkPasteboardNow();
    } catch {
      return false;
    }
  },

  /** Enable verbose native logging. Off by default. */
  setDebugMode(enabled: boolean): void {
    ignore(NativeDeeplinkly.setDebugMode(enabled));
  },
};

export default Deeplinkly;
