// Fill Screen Anywhere: Page Visibility API override for background play.
// The manifest loads this file in the page world ("world": "MAIN") at document_start in every frame, so it runs before any script of the page.
// While background play is enabled, it makes the page believe that it is always visible and focused, so that media keeps playing in background tabs.
// This file has no access to the extension APIs or to defaults.js. content.js tells it whether background play is enabled through custom events.

(function () {
    'use strict';

    // ---- Constants -------------------------------------------------------

    // Names the custom event that carries the background play state from content.js to this file. Both files must use the same name.
    const STATE_EVENT = 'fill-screen-anywhere:background-play';

    // Names the custom event that this file dispatches to ask content.js for the current state. Both files must use the same name.
    const REQUEST_EVENT = 'fill-screen-anywhere:background-play-request';

    // Sets how long, in milliseconds, the override stays active while content.js has not reported a state yet.
    // If content.js never answers, the override switches itself off after this time so that the page is never spoofed by accident.
    const STATE_TIMEOUT_MS = 3000;

    // Maps each Page Visibility property to the value that it reports while background play is enabled.
    // Only the properties that the browser really has are overridden, so that feature detection on the page keeps giving the native answer.
    const VISIBILITY_OVERRIDES = {
        hidden: false,
        webkitHidden: false,
        mozHidden: false,
        msHidden: false,
        visibilityState: 'visible',
        webkitVisibilityState: 'visible',
        mozVisibilityState: 'visible',
        msVisibilityState: 'visible',
    };

    // Lists the visibility events that are stopped before they reach the page while background play is enabled.
    const VISIBILITY_EVENTS = [
        'visibilitychange',
        'webkitvisibilitychange',
        'mozvisibilitychange',
        'msvisibilitychange',
    ];

    // Lists the window focus events that are stopped before they reach the page while background play is enabled.
    const FOCUS_EVENTS = ['blur', 'focus'];

    // Identifies the mode in which content.js has not reported the state yet. The override is active, because a tab that loads in the background must be covered from the first script.
    const MODE_UNKNOWN = 0;

    // Identifies the mode in which background play is enabled for this page.
    const MODE_ENABLED = 1;

    // Identifies the mode in which background play is disabled for this page and the browser's real values show through.
    const MODE_DISABLED = 2;

    // ---- Native references -----------------------------------------------

    // Keeps its own references to everything that is used after the page scripts start, so that a page that replaces these built-ins cannot break the override.
    const reflectApply = Reflect.apply;
    const NativeEvent = Event;
    const nativeDispatchEvent = EventTarget.prototype.dispatchEvent;
    const nativeStopImmediatePropagation = Event.prototype.stopImmediatePropagation;

    // Keeps the native visibilityState getter, which is the only way to learn the real visibility once the getters are overridden.
    const nativeVisibilityStateGetter = (Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') || {}).get;

    // ---- State -----------------------------------------------------------

    // Holds the current mode.
    let mode = MODE_UNKNOWN;

    // Tells whether this file is dispatching a visibility event of its own, which must reach the page.
    let emitting = false;

    // Tells whether the page currently sees the overridden values.
    function isOverriding() {
        return mode !== MODE_DISABLED;
    }

    // Tells whether the browser really reports the page as not visible.
    function isReallyHidden() {
        return Boolean(nativeVisibilityStateGetter) && reflectApply(nativeVisibilityStateGetter, document, []) !== 'visible';
    }

    // Dispatches a visibilitychange event that the page is allowed to see.
    function emitVisibilityChange() {
        emitting = true;
        try {
            reflectApply(nativeDispatchEvent, document, [new NativeEvent('visibilitychange', { bubbles: true })]);
        } finally {
            emitting = false;
        }
    }

    // Switches to a new mode. When this changes what the page sees while the tab is really hidden, the page is told with a visibilitychange event.
    // This repairs the page after a tab that loaded in the background turns out to have background play disabled, and after the setting is toggled.
    function setMode(nextMode) {
        if (nextMode === mode) return;
        const wasOverriding = isOverriding();
        mode = nextMode;
        if (wasOverriding !== isOverriding() && isReallyHidden()) emitVisibilityChange();
    }

    // ---- Property overrides ----------------------------------------------

    // Replaces a getter on Document.prototype with a proxy that reports the given value while the override is active.
    // The native getter always runs first, so that calls on invalid receivers still throw exactly like the native one.
    // A proxy keeps the name, the length, and the native-looking toString of the original getter.
    function overrideGetter(property, overriddenValue) {
        const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, property);
        if (!descriptor || typeof descriptor.get !== 'function') return;
        const getter = new Proxy(descriptor.get, {
            apply(target, thisArg, args) {
                const realValue = reflectApply(target, thisArg, args);
                return isOverriding() ? overriddenValue : realValue;
            },
        });
        try {
            Object.defineProperty(Document.prototype, property, { get: getter });
        } catch (error) {
            // Leaves a non-configurable property alone.
        }
    }

    // Replaces a method on Document.prototype with a proxy that returns the given value while the override is active.
    function overrideMethod(property, overriddenValue) {
        const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, property);
        if (!descriptor || typeof descriptor.value !== 'function') return;
        const method = new Proxy(descriptor.value, {
            apply(target, thisArg, args) {
                const realValue = reflectApply(target, thisArg, args);
                return isOverriding() ? overriddenValue : realValue;
            },
        });
        try {
            Object.defineProperty(Document.prototype, property, { value: method });
        } catch (error) {
            // Leaves a non-configurable property alone.
        }
    }

    // ---- Event blocking --------------------------------------------------

    // Stops a visibility event at the start of the capture phase, so that no page listener on the window or the document can observe it.
    function blockVisibilityEvent(event) {
        if (isOverriding() && !emitting) reflectApply(nativeStopImmediatePropagation, event, []);
    }

    // Stops a focus event that targets the window itself. Focus events that target elements pass through the window during the capture phase and must not be touched.
    function blockFocusEvent(event) {
        if (isOverriding() && event.target === window) reflectApply(nativeStopImmediatePropagation, event, []);
    }

    // ---- Communication with content.js -----------------------------------

    // Receives the background play state from content.js and hides the message from the page.
    // The channel is not authenticated, because both worlds share the same DOM. A page can only use it to turn the override off for itself.
    function onStateEvent(event) {
        if (typeof event.detail !== 'boolean') return;
        reflectApply(nativeStopImmediatePropagation, event, []);
        setMode(event.detail ? MODE_ENABLED : MODE_DISABLED);
    }

    // ---- Install ---------------------------------------------------------

    for (const [property, overriddenValue] of Object.entries(VISIBILITY_OVERRIDES)) {
        overrideGetter(property, overriddenValue);
    }
    overrideMethod('hasFocus', true);

    // Registers the blockers on the window in the capture phase. They are registered before any page script runs, so they always run first.
    for (const type of VISIBILITY_EVENTS) window.addEventListener(type, blockVisibilityEvent, true);
    for (const type of FOCUS_EVENTS) window.addEventListener(type, blockFocusEvent, true);
    window.addEventListener(STATE_EVENT, onStateEvent, true);

    // Asks content.js for the state, because content.js may have reported it before this file started listening. If content.js has not loaded yet, it reports the state on its own later.
    reflectApply(nativeDispatchEvent, window, [new NativeEvent(REQUEST_EVENT)]);

    // Gives up on content.js if it never reports a state.
    setTimeout(() => {
        if (mode === MODE_UNKNOWN) setMode(MODE_DISABLED);
    }, STATE_TIMEOUT_MS);
})();
