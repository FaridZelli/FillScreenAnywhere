// Fill Screen Anywhere: tunables, default settings, and the shared settings loader.
// The popup and the content script both load this file, so every part of the extension reads the same values.

// ---- Tunables --------------------------------------------------------

// Sets the distance, in pixels, that two fingers must travel before a pinch gesture is recognized.
const PINCH_THRESHOLD = 40;

// Sets how long, in milliseconds, the YouTube fullscreen button must be held to count as a long press.
const LONG_PRESS_MS = 550;

// Sets the length, in milliseconds, of the haptic feedback that confirms a long press on devices that support it.
const LONG_PRESS_VIBRATION_MS = 30;

// Sets the scale that removes letterboxing by cropping exactly one quarter of the video, which is the reciprocal of 0.75.
const LETTERBOX_SCALE = 1.333333;

// Sets how long, in milliseconds, the on-screen buttons stay visible after the last interaction.
const UI_HIDE_DELAY = 3000;

// Sets the smallest scale that counts as a real zoom. A zoom at or below this scale is disabled, and the buttons that would trigger it are hidden.
const ZOOM_THRESHOLD = 1.02;

// Sets the duration, in milliseconds, of the zoom animation.
const ZOOM_DURATION_MS = 500;

// Sets the extra time, in milliseconds, to wait after the zoom animation ends before the temporary styles are restored.
const ZOOM_CLEANUP_MARGIN_MS = 50;

// Defines the CSS transition that animates the zoom.
const ZOOM_TRANSITION = `transform ${ZOOM_DURATION_MS}ms ease`;

// Defines the 16:9 aspect ratio as a number.
const RATIO_16_9 = 16 / 9;

// Defines the 3:2 aspect ratio as a number.
const RATIO_3_2 = 3 / 2;

// Defines the 2:1 aspect ratio as a number.
const RATIO_2_1 = 2 / 1;

// Sets how far a video ratio may differ from 16:9 and still count as a 16:9 video.
const ASPECT_TOLERANCE = 0.08;

// Sets the media query that identifies a device with a mouse or trackpad.
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

// Sets the smallest screen dimension, in CSS pixels, that makes a device without a fine pointer count as a large screen.
const LARGE_SCREEN_MIN_DIMENSION = 480;

// Lists the domains, including their subdomains, that receive the YouTube handling.
const YOUTUBE_DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

// Sets the selector that matches the YouTube fullscreen button. The attribute matches are case-insensitive and also cover the exit button.
const YOUTUBE_FULLSCREEN_BUTTON_SELECTOR =
    '.ytp-fullscreen-button, button[aria-label*="full screen" i], button[title*="full screen" i]';

// Sets the selector that matches the YouTube element that wraps the video, which is the element that is zoomed instead of the video itself.
const YOUTUBE_ZOOM_CONTAINER_SELECTOR = '.html5-video-container';

// ---- Defaults --------------------------------------------------------

// Sets the key under which the large or small screen decision is stored. The decision is made once and never changes.
const LARGE_SCREEN_STORAGE_KEY = 'isLargeScreen';

// Defines the default settings that do not depend on the screen size.
const DEFAULT_SETTINGS = Object.freeze({
    mode: 'deny',
    allowList: [],
    denyList: [],
    alwaysFillScreen: false,
    backgroundPlay: false,
    centerVideos: true,
    pinchGestures: true,
    zoomAnimation: true,
    capTaller: true,
    capWider: true,
});

// Defines the default settings that depend on the screen size. Large and small screens are treated as equals.
const SCREEN_SIZE_DEFAULTS = Object.freeze({
    large: Object.freeze({ hideButtons: false, overrideYouTube: false }),
    small: Object.freeze({ hideButtons: true, overrideYouTube: true }),
});

// ---- Shared settings loader ------------------------------------------

// Decides whether this device has a large screen. A device with a mouse or trackpad always counts as large.
function detectIsLargeScreen() {
    if (window.matchMedia(FINE_POINTER_QUERY).matches) return true;
    const width = window.screen.width || window.innerWidth || 0;
    const height = window.screen.height || window.innerHeight || 0;
    return Math.min(width, height) >= LARGE_SCREEN_MIN_DIMENSION;
}

// Builds a fresh, mutable copy of every default setting for the given screen size.
function buildDefaultSettings(isLargeScreen) {
    const sizeDefaults = SCREEN_SIZE_DEFAULTS[isLargeScreen ? 'large' : 'small'];
    return { ...structuredClone(DEFAULT_SETTINGS), ...sizeDefaults };
}

// Tells whether a stored value has the same type as its default, so that corrupted storage never reaches the extension.
function hasSameType(value, reference) {
    return Array.isArray(reference) ? Array.isArray(value) : typeof value === typeof reference;
}

// Loads the settings from local storage and passes them to the callback together with the screen size decision.
// The first context to run decides the screen size, saves it, and every later context reuses the saved value.
function loadSettings(callback) {
    chrome.storage.local.get(null, (result) => {
        const stored = result || {};

        // Reuses the saved screen size decision, or makes and saves it on the very first run.
        let isLargeScreen = stored[LARGE_SCREEN_STORAGE_KEY];
        if (typeof isLargeScreen !== 'boolean') {
            isLargeScreen = detectIsLargeScreen();
            chrome.storage.local.set({ [LARGE_SCREEN_STORAGE_KEY]: isLargeScreen });
        }

        // Overlays every valid stored value on top of the defaults for this screen size.
        const settings = buildDefaultSettings(isLargeScreen);
        for (const key of Object.keys(settings)) {
            if (hasSameType(stored[key], settings[key])) settings[key] = stored[key];
        }
        callback(settings, isLargeScreen);
    });
}
