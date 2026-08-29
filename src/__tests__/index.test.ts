/**
 * Behaviour tests for the JS wrapper.
 *
 * These cover the parts of `src/index.tsx` that carry real risk: the
 * once-only readiness signal, and the promise-swallowing that keeps a failing
 * reporting call from surfacing as an unhandled rejection in a host app. Both
 * are invisible to the type checker.
 *
 * The native module is injected through `NativeModules`, which is the documented
 * old-architecture fallback in `NativeDeeplinkly.ts` — so these exercise the same
 * import path a legacy-architecture host uses. `resolved` is captured at module
 * load, so every test re-requires the module after installing its mock.
 */

const LINK_EVENT = 'DeeplinklyDidResolveLink';

/** A native module where every method resolves with a plausible value. */
function happyNative() {
  return {
    jsReady: jest.fn().mockResolvedValue(undefined),
    isAvailable: jest.fn().mockResolvedValue(true),
    getDeeplinklyId: jest.fn().mockResolvedValue('device-1'),
    setUserId: jest.fn().mockResolvedValue(undefined),
    setUserData: jest.fn().mockResolvedValue(true),
    clearUserData: jest.fn().mockResolvedValue(true),
    setConsent: jest.fn().mockResolvedValue(true),
    setPushToken: jest.fn().mockResolvedValue(true),
    getInstallAttribution: jest.fn().mockResolvedValue({ source: 'deep_link' }),
    resetPrivacyData: jest.fn().mockResolvedValue(true),
    generateLink: jest.fn().mockResolvedValue({ success: true, url: 'https://x/y' }),
    logEvent: jest.fn().mockResolvedValue(true),
    logPurchase: jest.fn().mockResolvedValue(true),
    disableTracking: jest.fn().mockResolvedValue(true),
    setAttributionLevel: jest.fn().mockResolvedValue(true),
    getAttributionLevel: jest.fn().mockResolvedValue('full'),
    setCheckPasteboardOnInstall: jest.fn().mockResolvedValue(true),
    willShowPasteboardBanner: jest.fn().mockResolvedValue(false),
    checkPasteboardNow: jest.fn().mockResolvedValue(true),
    setDebugMode: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
}

/** Every method of the mock is defined, which keeps the assertions unguarded. */
type NativeMock = ReturnType<typeof happyNative>;

/**
 * Installs `native` as the linked module and returns a freshly-evaluated copy of
 * the public API, plus the emitter native events travel on.
 *
 * `resetModules` rather than `isolateModules`, deliberately. The library builds
 * its `NativeEventEmitter` lazily, and `react-native`'s entry point exposes
 * modules through lazy property getters — so the emitter resolves
 * `RCTDeviceEventEmitter` at first *use*, not at import. Under `isolateModules`
 * that use happens after the isolated registry is gone, so the library subscribes
 * to a different singleton than the test publishes on and no event is ever
 * delivered. One shared registry keeps both on the same instance.
 */
function loadWith(native: NativeMock | undefined) {
  jest.resetModules();
  const rn = require('react-native');
  if (native) {
    rn.NativeModules.RNDeeplinkly = native;
  } else {
    delete rn.NativeModules.RNDeeplinkly;
  }
  const api = require('../index') as typeof import('../index');
  return {
    ...api,
    deviceEventEmitter: rn.DeviceEventEmitter as {
      emit: (event: string, payload: unknown) => void;
    },
  };
}

describe('readiness signal', () => {
  it('calls jsReady on the first addListener', () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.addListener(() => {});

    expect(native.jsReady).toHaveBeenCalledTimes(1);
  });

  it('calls jsReady only once no matter how many listeners attach', () => {
    // The native side treats delivery as final, and re-signalling readiness
    // re-attaches the native listener. One signal per bundle, not per listener.
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    const a = Deeplinkly.addListener(() => {});
    const b = Deeplinkly.addListener(() => {});
    Deeplinkly.addListener(() => {});
    a.remove();
    b.remove();
    Deeplinkly.addListener(() => {});

    expect(native.jsReady).toHaveBeenCalledTimes(1);
  });

  it('does not signal readiness merely by importing the module', () => {
    // Attaching before JS is listening loses links outright, so nothing may
    // signal readiness until a handler actually exists.
    const native = happyNative();
    loadWith(native);

    expect(native.jsReady).not.toHaveBeenCalled();
  });

  it('survives jsReady rejecting, without an unhandled rejection', async () => {
    const native = happyNative();
    native.jsReady.mockRejectedValue(new Error('boom'));
    const { Deeplinkly } = loadWith(native);

    expect(() => Deeplinkly.addListener(() => {})).not.toThrow();
    await Promise.resolve();
  });
});

describe('event delivery', () => {
  it('forwards the native envelope to the handler unchanged', () => {
    const { Deeplinkly, deviceEventEmitter } = loadWith(happyNative());

    const handler = jest.fn();
    Deeplinkly.addListener(handler);

    const envelope = { click_id: 'abc', params: { screen: 'home' } };
    deviceEventEmitter.emit(LINK_EVENT, envelope);

    expect(handler).toHaveBeenCalledWith(envelope);
  });

  it('stops delivering after remove()', () => {
    const { Deeplinkly, deviceEventEmitter } = loadWith(happyNative());

    const handler = jest.fn();
    const sub = Deeplinkly.addListener(handler);
    sub.remove();

    deviceEventEmitter.emit(LINK_EVENT, { click_id: 'a', params: {} });

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers one event to each of several listeners', () => {
    const { Deeplinkly, deviceEventEmitter } = loadWith(happyNative());

    const first = jest.fn();
    const second = jest.fn();
    Deeplinkly.addListener(first);
    Deeplinkly.addListener(second);

    deviceEventEmitter.emit(LINK_EVENT, { click_id: 'a', params: {} });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('delivers exactly one callback per emitted event, not one per attach', () => {
    // The whole bridge is built around "exactly one envelope per link". A
    // duplicate here would look identical to a double native delivery.
    const { Deeplinkly, deviceEventEmitter } = loadWith(happyNative());

    const handler = jest.fn();
    Deeplinkly.addListener(handler);
    deviceEventEmitter.emit(LINK_EVENT, { click_id: 'a', params: {} });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('pass-through', () => {
  it('maps generateLink content to the wire names the service requires', () => {
    // The camelCase public surface is translated here, not natively: the API
    // rejects `canonicalIdentifier` with "Missing canonical_identifier". Content
    // and options stay two maps because the native side flat-merges them.
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.generateLink(
      {
        canonicalIdentifier: 'p/1',
        title: 'T',
        imageUrl: 'https://img',
        metadata: { a: '1' },
      },
      { channel: 'test', feature: 'f', tags: ['x'] }
    );

    expect(native.generateLink).toHaveBeenCalledWith(
      {
        canonical_identifier: 'p/1',
        title: 'T',
        image_url: 'https://img',
        metadata: { a: '1' },
      },
      { channel: 'test', feature: 'f', tags: ['x'] }
    );
  });

  it('omits absent optional content fields rather than sending them null', () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.generateLink({ canonicalIdentifier: 'p/2' }, { channel: 'c', feature: 'f' });

    const [content] = native.generateLink!.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(content).not.toHaveProperty('title');
    expect(content).not.toHaveProperty('description');
    expect(content).not.toHaveProperty('image_url');
    expect(content.metadata).toEqual({});
  });

  it('drops an empty tags array instead of sending one', () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.generateLink(
      { canonicalIdentifier: 'p/3' },
      { channel: 'c', feature: 'f', tags: [] }
    );

    const [, options] = native.generateLink!.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(options).not.toHaveProperty('tags');
  });

  it('forwards an uncatalogued event name without validating it', () => {
    // Validation lives in the native DeeplinklyEvent so every host gets the same
    // answer. A JS-side check here is how the four surfaces start to diverge.
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.logEvent('not_a_catalogued_event', { unknown_param: 'x' });

    expect(native.logEvent).toHaveBeenCalledWith('not_a_catalogued_event', {
      unknown_param: 'x',
    });
  });

  it('passes a null userId through rather than dropping the call', () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.setUserId(null);

    expect(native.setUserId).toHaveBeenCalledWith(null);
  });
});

describe('failure values when the native call rejects', () => {
  // Each getter has its own documented failure value; a host distinguishes
  // "no API key" from "call failed" with isAvailable().
  const rejecting = (): NativeMock => {
    const native = happyNative();
    for (const key of Object.keys(native) as Array<keyof NativeMock>) {
      if (key !== 'addListener' && key !== 'removeListeners') {
        native[key].mockRejectedValue(new Error('native exploded'));
      }
    }
    return native;
  };

  it('isAvailable resolves false', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(Deeplinkly.isAvailable()).resolves.toBe(false);
  });

  it('getDeeplinklyId resolves an empty string', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(Deeplinkly.getDeeplinklyId()).resolves.toBe('');
  });

  it('getInstallAttribution resolves an empty object', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(Deeplinkly.getInstallAttribution()).resolves.toEqual({});
  });

  it('logEvent resolves false', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(Deeplinkly.logEvent('purchase', {})).resolves.toBe(false);
  });

  it('setUserId does not reject, since it is fire-and-forget', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    expect(() => Deeplinkly.setUserId('u')).not.toThrow();
    await Promise.resolve();
  });

  it('setUserData resolves false', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(Deeplinkly.setUserData({ email: 'a@b.com' })).resolves.toBe(
      false
    );
  });

  it('logPurchase resolves false', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    await expect(
      Deeplinkly.logPurchase({ value: 1, currency: 'USD' })
    ).resolves.toBe(false);
  });

  it('clearUserData does not reject, since it is fire-and-forget', async () => {
    const { Deeplinkly } = loadWith(rejecting());
    expect(() => Deeplinkly.clearUserData()).not.toThrow();
    await Promise.resolve();
  });
});

/**
 * The camelCase-to-snake_case rename at the bridge.
 *
 * Both native sides read `fields.getString("phone_number")`, and a mismatch
 * here is silent: the native side finds nothing and stores a user with no
 * phone rather than failing. Nothing downstream would notice until a
 * conversion quietly stopped matching, so the wire shape is pinned.
 */
describe('user data and purchases cross the bridge under the keys native reads', () => {
  it('setUserData renames every field and sends nulls for the rest', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setUserData({
      userId: 'u1',
      email: 'ada@example.com',
      phoneNumber: '+441234567890',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      gender: 'f',
      street: '12 Example Street',
      city: 'London',
      state: 'Greater London',
      zip: 'W1A 1AA',
      country: 'GB',
    });

    expect(native.setUserData).toHaveBeenCalledWith({
      user_id: 'u1',
      email: 'ada@example.com',
      phone_number: '+441234567890',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '1815-12-10',
      gender: 'f',
      street: '12 Example Street',
      city: 'London',
      state: 'Greater London',
      zip: 'W1A 1AA',
      country: 'GB',
      custom_data: null,
    });
  });

  // The open field. It rides the same call rather than a new method so an app
  // that never uses it pays nothing, and so there is one validation path.
  it('sends custom data under custom_data', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setUserData({
      email: 'ada@example.com',
      customData: { mixpanel_distinct_id: 'abc123', clevertap_id: 'xyz' },
    });

    expect(native.setUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_data: { mixpanel_distinct_id: 'abc123', clevertap_id: 'xyz' },
      })
    );
  });

  // Nothing is validated here on purpose: the caps on entry count, key and
  // value length live in the two native SDKs, so there is one implementation of
  // the rule rather than three that can drift apart.
  it('passes an oversized custom map through for native to judge', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    const big: Record<string, string> = {};
    for (let i = 0; i < 50; i++) big[`key${i}`] = `value${i}`;
    await Deeplinkly.setUserData({ customData: big });

    const sent = native.setUserData.mock.calls[0][0] as {
      custom_data: Record<string, string>;
    };
    expect(Object.keys(sent.custom_data)).toHaveLength(50);
  });

  /**
   * An omitted field crosses as null rather than being left off. The native
   * side merges and treats both the same way today, but sending the key keeps
   * "not supplied" expressible if that ever stops being true.
   */
  it('setUserData sends null for a field that was not supplied', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setUserData({ email: 'ada@example.com' });

    expect(native.setUserData).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', city: null })
    );
  });

  it('logPurchase renames the optional fields and defaults the parameters', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.logPurchase({
      value: 49.99,
      // Not uppercased here: normalisation is native, so this bridge and a
      // native caller cannot disagree about what 'usd' becomes.
      currency: 'usd',
      orderId: 'order-1',
      quantity: 2,
      productId: 'sku-9',
      parameters: { coupon: 'SPRING' },
    });

    expect(native.logPurchase).toHaveBeenCalledWith({
      value: 49.99,
      currency: 'usd',
      order_id: 'order-1',
      quantity: 2,
      product_id: 'sku-9',
      parameters: { coupon: 'SPRING' },
    });
  });

  it('logPurchase sends nulls and an empty parameter map when only the amount is given', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.logPurchase({ value: 10, currency: 'EUR' });

    expect(native.logPurchase).toHaveBeenCalledWith({
      value: 10,
      currency: 'EUR',
      order_id: null,
      quantity: null,
      product_id: null,
      parameters: {},
    });
  });

  it('clearUserData is forwarded to native', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    Deeplinkly.clearUserData();
    await Promise.resolve();

    expect(native.clearUserData).toHaveBeenCalled();
  });
});

describe('when the native module is not linked', () => {
  it('importing the module does not throw', () => {
    // Throwing at import would take down the bundle before a host could call
    // isAvailable() to find out what went wrong.
    expect(() => loadWith(undefined)).not.toThrow();
  });

  it('isAvailable answers false rather than propagating the proxy error', async () => {
    const { Deeplinkly } = loadWith(undefined);
    await expect(Deeplinkly.isAvailable()).resolves.toBe(false);
  });

  it('getDeeplinklyId answers its failure value', async () => {
    const { Deeplinkly } = loadWith(undefined);
    await expect(Deeplinkly.getDeeplinklyId()).resolves.toBe('');
  });
});

describe('user-data bridge keys against the catalogue', () => {
  /**
   * `setUserData` writes its bridge payload out one key at a time
   * (`src/index.tsx`), and both native modules read it back one key at a time.
   * That is a hand-maintained list of exactly the kind the generated catalogue
   * exists to remove, and a published npm package freezes it as firmly as a
   * compiled binary does — so a field added to the catalogue and missed here is
   * a field no React Native app can send until the next release.
   *
   * `tool/signals.json` is the canonical catalogue, copied into this repo by
   * `gen_signals.dart` and kept honest by its `--check`. Reading it here is what
   * turns that copy from a reference into a gate.
   */
  const catalogue = JSON.parse(
    require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'tool', 'signals.json'),
      'utf8',
    ),
  ) as { signals: Record<string, { scope: string }> };

  const userScope = Object.entries(catalogue.signals)
    .filter(([, spec]) => spec.scope === 'user')
    .map(([name]) => name);

  /**
   * The bridge spells these without the catalogue's `user_` prefix, with two
   * exceptions it does not derive: `user_id` is the catalogue's
   * `custom_user_id`, and `phone_number` is its `user_phone`.
   *
   * These are the strings both native modules read back by name
   * (`DeeplinklyModule.kt`, `RNDeeplinkly.swift`), so they are the bridge's
   * contract and not a spelling anyone is free to tidy — renaming one here
   * without the two native modules silently drops that field. The exceptions
   * are written down rather than smoothed over for the same reason.
   */
  const CATALOGUE_NAME: Readonly<Record<string, string>> = {
    user_id: 'custom_user_id',
    phone_number: 'user_phone',
  };

  function catalogueNameFor(bridgeKey: string): string {
    return CATALOGUE_NAME[bridgeKey] ?? `user_${bridgeKey}`;
  }

  function bridgeKeys(): string[] {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);
    void Deeplinkly.setUserData({
      userId: 'u',
      email: 'a@b.c',
      phoneNumber: '+15551234567',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      gender: 'f',
      street: '1 Main St',
      city: 'London',
      state: 'LDN',
      zip: 'NW1',
      country: 'GB',
    });
    return Object.keys(native.setUserData.mock.calls[0][0] as object);
  }

  it('sends every user-scope signal the catalogue defines', () => {
    const sent = bridgeKeys().map(catalogueNameFor);
    expect(userScope.filter((name) => !sent.includes(name))).toEqual([]);
  });

  it('sends nothing the catalogue does not define', () => {
    // The service is fail-closed, so an invented key is dropped silently rather
    // than reported — which is why this direction needs a test of its own.
    const sent = bridgeKeys().map(catalogueNameFor);
    expect(sent.filter((name) => !userScope.includes(name))).toEqual([]);
  });
});

describe('consent and the push token cross the bridge under the keys native reads', () => {
  it('setConsent renames every field', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setConsent({
      adUserData: 'granted',
      adPersonalization: 'denied',
      isEea: true,
    });

    expect(native.setConsent).toHaveBeenCalledWith({
      ad_user_data: 'granted',
      ad_personalization: 'denied',
      is_eea: true,
    });
  });

  /**
   * The distinction the whole API rests on: an omitted field is not the same as
   * `'unknown'`. It has to reach native as null so the merge leaves the stored
   * answer alone, rather than as a value that overwrites it.
   */
  it('setConsent sends null for a field that was not supplied', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setConsent({ isEea: false });

    expect(native.setConsent).toHaveBeenCalledWith({
      ad_user_data: null,
      ad_personalization: null,
      is_eea: false,
    });
  });

  it('setPushToken forwards the token and the provider', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setPushToken('tok-123', 'fcm');

    expect(native.setPushToken).toHaveBeenCalledWith({
      token: 'tok-123',
      provider: 'fcm',
    });
  });

  /**
   * Omitting the provider must reach native as null rather than as a guess made
   * here: each bridge applies its own platform default, FCM on Android and APNs
   * on iOS, and JavaScript does not know which one it is talking to.
   */
  it('setPushToken sends a null provider when none is given', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setPushToken('tok-123');

    expect(native.setPushToken).toHaveBeenCalledWith({
      token: 'tok-123',
      provider: null,
    });
  });

  /** Null means "forget it", and has to survive the boundary as null. */
  it('setPushToken forwards a null token', async () => {
    const native = happyNative();
    const { Deeplinkly } = loadWith(native);

    await Deeplinkly.setPushToken(null);

    expect(native.setPushToken).toHaveBeenCalledWith({
      token: null,
      provider: null,
    });
  });
});
