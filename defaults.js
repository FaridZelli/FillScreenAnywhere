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

// Sets the maximum fill-screen scale that triggers automatic fill in Auto fill mode.
const AUTO_FILL_MAX_SCALE = 1.2;

// Sets a small floating-point margin so exact 1.2x ratios are not rejected by binary rounding error.
const AUTO_FILL_EPSILON = 1e-9;

// Sets the duration, in milliseconds, of the zoom animation.
const ZOOM_DURATION_MS = 500;

// Sets the extra time, in milliseconds, to wait after the zoom animation ends before the temporary styles are restored.
const ZOOM_CLEANUP_MARGIN_MS = 50;

// Defines the CSS transition that animates the zoom.
const ZOOM_TRANSITION = `transform ${ZOOM_DURATION_MS}ms ease`;

// Defines the 9:16 aspect ratio as a number.
const RATIO_9_16 = 9 / 16;

// Defines the 3:2 aspect ratio as a number.
const RATIO_3_2 = 3 / 2;

// Defines the 16:9 aspect ratio as a number.
const RATIO_16_9 = 16 / 9;

// Defines the 2:1 aspect ratio as a number.
const RATIO_2_1 = 2 / 1;

// Defines the 12:5 aspect ratio as a number.
const RATIO_12_5 = 12 / 5;

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

// Sets the key under which the large or small screen decision is cached for the current browser session.
const LARGE_SCREEN_STORAGE_KEY = 'isLargeScreen';

// Sets the key under which the last zoom mode is stored.
const LAST_ZOOM_STORAGE_KEY = 'lastZoomMode';

// Defines the valid string values for multi-state settings, so corrupted or legacy storage never reaches the extension.
const ALLOWED_SETTING_VALUES = Object.freeze({
    mode: Object.freeze(['deny', 'allow']),
    fillMode: Object.freeze(['manual', 'auto', 'remember']),
    backgroundPlay: Object.freeze(['off', 'everywhere', 'custom']),
});

// Defines the default settings that do not depend on the screen size.
const DEFAULT_SETTINGS = Object.freeze({
    mode: 'deny',
    allowList: [],
    denyList: [],
    fillMode: 'manual',
    backgroundPlay: 'off',
    backgroundPlayList: [],
    centerVideos: true,
    pinchGestures: true,
    zoomAnimation: true,
    limitCropAll: true,
});

// Defines the default settings that depend on the screen size. Large and small screens are treated as equals.
const SCREEN_SIZE_DEFAULTS = Object.freeze({
    large: Object.freeze({ hideButtons: false, overrideYouTube: false, limitCrop16By9: false }),
    small: Object.freeze({ hideButtons: true, overrideYouTube: true, limitCrop16By9: true }),
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

// Tells whether a stored value is valid for the given setting key, so that corrupted or legacy storage never reaches the extension.
function isValidSettingValue(key, value, reference) {
    if (key in ALLOWED_SETTING_VALUES) return ALLOWED_SETTING_VALUES[key].includes(value);
    if (Array.isArray(reference)) return Array.isArray(value) && value.every((item) => typeof item === 'string');
    return typeof value === typeof reference;
}

// Resolves the screen size decision for the current browser session.
// Uses session storage where available so the decision is made once per browser start and cleared automatically on restart.
function resolveIsLargeScreen(callback) {
    const sessionStorage = chrome.storage && chrome.storage.session;
    if (!sessionStorage) {
        callback(detectIsLargeScreen());
        return;
    }
    try {
        sessionStorage.get(LARGE_SCREEN_STORAGE_KEY, (result) => {
            if (chrome.runtime.lastError) {
                callback(detectIsLargeScreen());
                return;
            }
            let isLargeScreen = result && result[LARGE_SCREEN_STORAGE_KEY];
            if (typeof isLargeScreen !== 'boolean') {
                isLargeScreen = detectIsLargeScreen();
                sessionStorage.set({ [LARGE_SCREEN_STORAGE_KEY]: isLargeScreen });
            }
            callback(isLargeScreen);
        });
    } catch (error) {
        callback(detectIsLargeScreen());
    }
}

// Loads the settings from local storage and passes them to the callback together with the current session's screen size decision.
// Missing defaults are persisted once on first run so that future browser restarts with a different screen size never change saved settings.
function loadSettings(callback) {
    resolveIsLargeScreen((isLargeScreen) => {
        chrome.storage.local.get(null, (result) => {
            const stored = result || {};

            // Preserves the screen size saved by an older version when initializing defaults during an upgrade.
            const hasLegacyScreenSize = typeof stored[LARGE_SCREEN_STORAGE_KEY] === 'boolean';
            const defaultsScreenSize = hasLegacyScreenSize ? stored[LARGE_SCREEN_STORAGE_KEY] : isLargeScreen;

            const settings = buildDefaultSettings(defaultsScreenSize);
            const missingDefaults = {};
            for (const key of Object.keys(settings)) {
                if (isValidSettingValue(key, stored[key], settings[key])) {
                    settings[key] = stored[key];
                } else {
                    missingDefaults[key] = settings[key];
                }
            }

            if (Object.keys(missingDefaults).length > 0) {
                chrome.storage.local.set(missingDefaults);
            }
            if (LARGE_SCREEN_STORAGE_KEY in stored) {
                chrome.storage.local.remove(LARGE_SCREEN_STORAGE_KEY);
            }

            callback(settings, isLargeScreen);
        });
    });
}