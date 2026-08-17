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
   * The click this link resolved to, or `null` when the backend did not
   * recognise it. The key is always present; only its value may be null.
   */
  click_id: string | null;

  /**
   * The link's own parameters — from the backend when it could be reached, and
   * from the URL itself when it could not, so one read path covers both.
   */
  params: Record<string, unknown>;
}

/** Parameter values accepted by {@link Deeplinkly.logEvent}. */
export type EventParameterValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

/** Well-known event names the backend reports on without extra configuration. */
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
