package com.deeplinkly.reactnative

import android.app.Activity
import android.content.Intent
import com.deeplinkly.android_deeplinkly.Deeplinkly
import com.deeplinkly.android_deeplinkly.DeeplinklyDeepLinkListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkObject
import io.mockk.slot
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the bridge's lifecycle contract.
 *
 * These deliberately cover only what has actually broken or could break
 * silently: when the deep link listener is attached, and when the cold-start
 * launch intent is handed to the SDK. Both are invisible to the compiler, and a
 * regression in either loses links with no error anywhere.
 *
 * Methods that build a `WritableMap` are not tested here. `Arguments.createMap()`
 * returns a `WritableNativeMap`, which needs the React JNI library loaded, so it
 * cannot run in a JVM unit test — those paths are covered by the on-device
 * checklist in docs/NATIVE_SDK_MIGRATION.md instead.
 */
class DeeplinklyModuleTest {

    private lateinit var context: ReactApplicationContext

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        mockkObject(Deeplinkly)
        every { Deeplinkly.isEnabled } returns true
        every { Deeplinkly.init(any(), any()) } returns Unit
        every { Deeplinkly.setDeepLinkListener(any()) } returns Unit
        every { Deeplinkly.onActivityLaunch(any()) } returns Unit
        every { Deeplinkly.onForeground() } returns Unit
        every { Deeplinkly.onNewIntent(any(), any()) } returns Unit
    }

    @After
    fun tearDown() {
        unmockkAll()
        clearAllMocks()
    }

    private fun module() = DeeplinklyModule(context)

    // -- initialisation ------------------------------------------------------

    @Test
    fun `init opts out of the SDK's automatic launch intent capture`() {
        // The SDK registers its ActivityLifecycleCallbacks inside init() and reads
        // the launch intent from onActivityCreated. A React Native module is
        // constructed while the bundle is evaluated, long after MainActivity's
        // onCreate has returned, so auto-capture can never see the launch
        // activity. Leaving it on dropped every cold-start link silently.
        module()

        verify(exactly = 1) { Deeplinkly.init(any(), false) }
        verify(exactly = 0) { Deeplinkly.init(any(), true) }
    }

    @Test
    fun `init registers for activity and lifecycle callbacks`() {
        val created = module()

        verify(exactly = 1) { context.addActivityEventListener(created) }
        verify(exactly = 1) { context.addLifecycleEventListener(created) }
    }

    @Test
    fun `construction does not attach the deep link listener`() {
        // Both SDKs treat delivery as final, and emitting with no JS subscriber
        // succeeds silently — so attaching before JS is listening loses the link
        // outright, with no error anywhere.
        module()

        verify(exactly = 0) { Deeplinkly.setDeepLinkListener(any()) }
    }

    // -- readiness ----------------------------------------------------------

    @Test
    fun `jsReady attaches the listener and resolves`() {
        val promise = mockk<Promise>(relaxed = true)
        val listener = slot<DeeplinklyDeepLinkListener>()

        module().jsReady(promise)

        verify(exactly = 1) { Deeplinkly.setDeepLinkListener(capture(listener)) }
        assertNotNull(listener.captured)
        verify(exactly = 1) { promise.resolve(null) }
    }

    @Test
    fun `jsReady still resolves when the SDK is disabled`() {
        // A host with no API key must not hang on this promise.
        every { Deeplinkly.isEnabled } returns false
        val promise = mockk<Promise>(relaxed = true)

        module().jsReady(promise)

        verify(exactly = 0) { Deeplinkly.setDeepLinkListener(any()) }
        verify(exactly = 1) { promise.resolve(null) }
    }

    @Test
    fun `isAvailable reports the SDK gate`() {
        val enabled = mockk<Promise>(relaxed = true)
        module().isAvailable(enabled)
        verify { enabled.resolve(true) }

        every { Deeplinkly.isEnabled } returns false
        val disabled = mockk<Promise>(relaxed = true)
        module().isAvailable(disabled)
        verify { disabled.resolve(false) }
    }

    // -- cold start ---------------------------------------------------------

    @Test
    fun `onHostResume hands the launch intent to the SDK`() {
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)

        module().onHostResume()

        verify(exactly = 1) { Deeplinkly.onActivityLaunch(any()) }
    }

    @Test
    fun `onHostResume captures the launch intent only once across many resumes`() {
        // onHostResume fires on *every* foreground. Re-running the cold-start work
        // would re-resolve the launch intent and re-report attribution on each app
        // switch — and the SDK's EXTRA_CONSUMED guard lives on the Intent
        // instance, so it does not survive the activity being recreated across a
        // configuration change. The once-per-instance flag is what makes the
        // replay impossible rather than merely unlikely.
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)
        val created = module()

        created.onHostResume()
        created.onHostResume()
        created.onHostResume()

        verify(exactly = 1) { Deeplinkly.onActivityLaunch(any()) }
    }

    @Test
    fun `onHostResume reports the foreground on every resume`() {
        // Unlike the launch capture, this one is per-foreground by design: it is
        // the app-open signal.
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)
        val created = module()

        created.onHostResume()
        created.onHostResume()

        verify(exactly = 2) { Deeplinkly.onForeground() }
    }

    @Test
    fun `onHostResume does nothing at all when the SDK is disabled`() {
        every { Deeplinkly.isEnabled } returns false
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)

        module().onHostResume()

        verify(exactly = 0) { Deeplinkly.onActivityLaunch(any()) }
        verify(exactly = 0) { Deeplinkly.onForeground() }
        verify(exactly = 0) { Deeplinkly.setDeepLinkListener(any()) }
    }

    @Test
    fun `onHostResume captures the launch intent even before JS is ready`() {
        // Ordering against jsReady must not matter: a link resolved before JS
        // subscribes is held in the SDK's persistent queue and drained when the
        // listener attaches. Gating the capture on jsIsReady would lose the link
        // whenever the activity resumed first, which is the common case.
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)
        val created = module()

        created.onHostResume()

        verify(exactly = 1) { Deeplinkly.onActivityLaunch(any()) }
        verify(exactly = 0) { Deeplinkly.setDeepLinkListener(any()) }
    }

    @Test
    fun `onHostResume re-attaches the listener once JS is ready`() {
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)
        val created = module()
        created.jsReady(mockk(relaxed = true))

        created.onHostResume()

        // Once from jsReady, once from the resume: re-attaching is idempotent
        // because there is a single listener slot, and it re-drains whatever
        // queued while backgrounded.
        verify(exactly = 2) { Deeplinkly.setDeepLinkListener(any()) }
    }

    @Test
    fun `onHostResume survives having no current activity`() {
        every { context.currentActivity } returns null

        module().onHostResume()

        verify(exactly = 0) { Deeplinkly.onActivityLaunch(any()) }
        verify(exactly = 1) { Deeplinkly.onForeground() }
    }

    // -- warm start ---------------------------------------------------------

    @Test
    fun `onNewIntent forwards the intent to the SDK`() {
        val activity = mockk<Activity>(relaxed = true)
        every { context.currentActivity } returns activity
        val intent = mockk<Intent>(relaxed = true)

        module().onNewIntent(intent)

        verify(exactly = 1) { Deeplinkly.onNewIntent(activity, intent) }
    }

    @Test
    fun `onNewIntent falls back to the react context when there is no activity`() {
        // The activity is read at call time rather than captured, so it can be
        // gone; the SDK only needs a Context to reach prefs and the queue.
        every { context.currentActivity } returns null
        val intent = mockk<Intent>(relaxed = true)

        module().onNewIntent(intent)

        verify(exactly = 1) { Deeplinkly.onNewIntent(context, intent) }
    }

    // -- teardown -----------------------------------------------------------

    @Test
    fun `invalidate detaches without shutting the SDK down`() {
        // Deeplinkly is an object that outlives React Native's Catalyst instance,
        // and init latches on a one-way AtomicBoolean. shutdown() cancels the IO
        // scope with no way to revive it, so a dev-mode reload would leave every
        // later call targeting a dead scope.
        val created = module()

        created.invalidate()

        verify(exactly = 1) { Deeplinkly.setDeepLinkListener(null) }
        verify(exactly = 0) { Deeplinkly.shutdown() }
        verify(exactly = 1) { context.removeActivityEventListener(created) }
        verify(exactly = 1) { context.removeLifecycleEventListener(created) }
    }

    @Test
    fun `a rebuilt module captures the launch intent again`() {
        // A dev-mode reload builds a new module against the same SDK singleton.
        // The once-only flag is per instance, so the new one still does its
        // cold-start work; the SDK's own guards stop a duplicate delivery.
        every { context.currentActivity } returns mockk<Activity>(relaxed = true)

        val first = module()
        first.onHostResume()
        first.invalidate()

        val second = module()
        second.onHostResume()

        verify(exactly = 2) { Deeplinkly.onActivityLaunch(any()) }
    }

    // -- identity -----------------------------------------------------------

    @Test
    fun `getName is the name the JS side looks up`() {
        // src/NativeDeeplinkly.ts resolves 'RNDeeplinkly'. If these drift the
        // module silently fails to link and every call hits the not-linked proxy.
        assertTrue(DeeplinklyModule.NAME == "RNDeeplinkly")
        assertTrue(module().name == "RNDeeplinkly")
    }

    @Test
    fun `identity calls answer even when the SDK is disabled`() {
        // getDeeplinklyId and resetPrivacyData are local operations that need no
        // API key, so they stay available on a misconfigured build.
        every { Deeplinkly.isEnabled } returns false
        every { Deeplinkly.getDeeplinklyId() } returns "device-1"
        val promise = mockk<Promise>(relaxed = true)

        module().getDeeplinklyId(promise)

        verify(exactly = 1) { promise.resolve("device-1") }
    }

    @Test
    fun `logEvent answers false rather than hanging when disabled`() {
        every { Deeplinkly.isEnabled } returns false
        val promise = mockk<Promise>(relaxed = true)

        module().logEvent("purchase", mockk(relaxed = true), promise)

        verify(exactly = 1) { promise.resolve(false) }
        assertFalse(Deeplinkly.isEnabled)
    }

    /**
     * Same contract for the three methods added with user data: a disabled SDK
     * answers its documented failure value rather than leaving the JS promise
     * pending forever.
     */
    @Test
    fun `setUserData answers false rather than hanging when disabled`() {
        every { Deeplinkly.isEnabled } returns false
        val promise = mockk<Promise>(relaxed = true)

        module().setUserData(mockk(relaxed = true), promise)

        verify(exactly = 1) { promise.resolve(false) }
    }

    @Test
    fun `clearUserData answers false rather than hanging when disabled`() {
        every { Deeplinkly.isEnabled } returns false
        val promise = mockk<Promise>(relaxed = true)

        module().clearUserData(promise)

        verify(exactly = 1) { promise.resolve(false) }
    }

    @Test
    fun `logPurchase answers false rather than hanging when disabled`() {
        every { Deeplinkly.isEnabled } returns false
        val promise = mockk<Promise>(relaxed = true)

        module().logPurchase(mockk(relaxed = true), promise)

        verify(exactly = 1) { promise.resolve(false) }
    }
}
