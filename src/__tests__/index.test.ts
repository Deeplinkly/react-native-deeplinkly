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
    getInstallAttribution: jest.fn().mockResolvedValue({ source: 'deep_link' }),
    resetPrivacyData: jest.fn().mockResolvedValue(true),
    generateLink: jest.fn().mockResolvedValue({ success: true, url: 'https://x/y' }),
    logEvent: jest.fn().mockResolvedValue(true),
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
  it('maps generateLink content to the wire names the backend requires', () => {
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
