/**
 * Public types for the Deeplinkly React Native SDK.
 *
 * These mirror the native SDK surfaces one-for-one — the wire shapes crossing
 * the bridge are the same snake_case maps the native layer already speaks, so a
 * native-only integration and this one get identical answers.
 */

/**
 * How much the SDK may report about a device.
 *
 * Each level is a strict subset of the one above it. Set with
 * {@link Deeplinkly.setAttributionLevel}. Levels gate *reporting* only. Deep
 * links resolve and are delivered to your app at every level, including
 * `'none'`: resolving a link sends its id and nothing describing the device,
 * whatever the level.
 */
export type AttributionLevel =
  /** Everything the SDK collects, including high-entropy device signals. The default. */
  | 'full'
  /**
   * Drops the high-entropy hardware signals — screen geometry, pixel ratio,
   * core count, device model, and the Android advertising ID and Android ID.
   * Keeps the coarse context campaign reporting actually uses: locale,
   * timezone, OS and app version.
   */
  | 'reduced'
  /**
   * Only what a deep link needs to function: the install's own id, the app
   * build, and the link being reported on. Nothing describing the device.
   */
  | 'minimal'
  /**
   * No enrichment is sent at all. Deep links still resolve and are still
   * delivered to your app — this suppresses reporting, not functionality.
   */
  | 'none';

/**
 * A single advertising-consent answer, in Google's vocabulary.
 *
 * These are not Deeplinkly's invention and are deliberately not renamed: they
 * are the values Google Ads accepts on an uploaded conversion, so carrying them
 * verbatim means the forwarder does no translation and there is no mapping
 * table to get backwards.
 *
 * `'unknown'` is a positive statement — the app asked, or had the chance to,
 * and has no answer. Never calling {@link Deeplinkly.setConsent} at all leaves
 * the field absent, which says the app has no consent model wired up. Google
 * treats those differently, so there is deliberately no fourth value for
 * "not set": absence is expressed by omitting the field.
 */
export type ConsentState = 'granted' | 'denied' | 'unknown';

/**
 * Which push service a token addresses, so the uninstall prober knows what to
 * speak. One React Native app ships to both platforms, so this is explicit
 * rather than inferred.
 */
export type PushProvider = 'apns' | 'fcm';

/**
 * The person's advertising-consent answers, for {@link Deeplinkly.setConsent}.
 *
 * Every field is optional and each call merges, so an omitted field is left as
 * it was rather than cleared — you can report {@link DeeplinklyConsent.isEea}
 * at launch and the two answers when your banner is answered.
 */
export interface DeeplinklyConsent {
  /**
   * Whether user data may be sent to ad networks for measurement. Google
   * Consent Mode's `ad_user_data`.
   */
  adUserData?: ConsentState;

  /**
   * Whether that data may be used to personalise advertising. Google Consent
   * Mode's `ad_personalization`.
   */
  adPersonalization?: ConsentState;

  /**
   * Whether you consider this person in scope for GDPR. Your app knows this; we
   * do not, and a geo-IP guess is not a consent record.
   */
  isEea?: boolean;
}

/** The content a generated link points at. */
export interface DeeplinklyContent {
  /** Stable identifier for the thing being linked to. Required. */
  canonicalIdentifier: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  /** Free-form payload delivered back to the app when the link is opened. */
  metadata?: Record<string, unknown>;
}

/** Campaign attribution for a generated link. */
export interface DeeplinklyLinkOptions {
  channel: string;
  feature: string;
  /**
   * Free-form labels attached to the generated link.
   *
   * A list, not a map — the API only understands a list (or a comma-separated
   * string), and anything else is silently discarded server-side.
   */
  tags?: string[];
}

/** Outcome of {@link Deeplinkly.generateLink}. */
export interface DeeplinklyResult {
  success: boolean;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * A resolved deep link, delivered to {@link Deeplinkly.addListener}.
 *
 * The envelope is identical on both platforms: the native SDKs build it, and the
 * bridge forwards it unchanged.
 */
export interface DeeplinklyLink {
  /**
   * The click this link resolved to, or `null` when the service did not
   * recognise it. The key is always present; only its value may be null.
   */
  click_id: string | null;

  /**
   * The link's own parameters — from the service when it could be reached, and
   * from the URL itself when it could not, so one read path covers both.
   */
  params: Record<string, unknown>;
}

/**
 * What you know about the person using your app, for {@link Deeplinkly.setUserData}.
 *
 * Every field is optional and each call merges, so you can supply an email at
 * sign-up and an address at checkout. Values are sent as supplied and hashed
 * only when a conversion is forwarded.
 */
export interface DeeplinklyUserData {
  /** Your own identifier for this person, reported as `custom_user_id`. */
  userId?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** `YYYY-MM-DD`. */
  dateOfBirth?: string | null;
  /** `"m"` or `"f"` — the only two values Meta's `ge` accepts. */
  gender?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** ISO-3166-1 alpha-2, e.g. `"US"`. */
  country?: string | null;
  /**
   * Identifiers Deeplinkly does not name — typically your own product-analytics
   * ids, such as a Mixpanel distinct id or a CleverTap id.
   *
   * Up to 10 entries, keys up to 64 characters and values up to 256. Anything
   * larger rejects the whole call, as one bad typed field does.
   *
   * It exists so attaching a new identifier does not have to wait for an app
   * release: your binary is frozen for a whole release cycle, and the set of
   * ids you may need is not.
   */
  customData?: Record<string, string | null> | null;
}

/** A purchase, for {@link Deeplinkly.logPurchase}. */
export interface DeeplinklyPurchase {
  /** The amount, in {@link currency}. Must be finite and not negative. */
  value: number;
  /** ISO-4217, e.g. `"USD"`. Case-insensitive. */
  currency: string;
  /** Your own id for the transaction. What Google deduplicates conversions on. */
  orderId?: string | null;
  quantity?: number | null;
  productId?: string | null;
  /**
   * Anything else to put on the event. May not contain `value`, `currency`,
   * `order_id`, `quantity` or `product_id` — pass those as fields above.
   */
  parameters?: Record<string, EventParameterValue>;
}

/** Parameter values accepted by {@link Deeplinkly.logEvent}. */
export type EventParameterValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

/** Well-known event names the service reports on without extra configuration. */
export const DeeplinklyEvent = {
  login: 'login',
  signup: 'signup',
  logout: 'logout',
  purchase: 'purchase',
  addToCart: 'add_to_cart',
  removeFromCart: 'remove_from_cart',
  beginCheckout: 'begin_checkout',
  addPaymentInfo: 'add_payment_info',
  viewItem: 'view_item',
  viewItemList: 'view_item_list',
  search: 'search',
  share: 'share',
  invite: 'invite',
  appOpen: 'app_open',
  sessionStart: 'session_start',
  screenView: 'screen_view',
  levelUp: 'level_up',
  tutorialComplete: 'tutorial_complete',
  refund: 'refund',
} as const;

export type DeeplinklyEventName =
  (typeof DeeplinklyEvent)[keyof typeof DeeplinklyEvent];
