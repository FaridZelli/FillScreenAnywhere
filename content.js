// Fill Screen Anywhere: content script.
// It runs in the extension world of every frame and relies on the constants and functions from defaults.js.
// The background play logic lives in page-visibility-api.js, which runs in the page world. This file only exposes whether background play is enabled.

(function () {
    'use strict';

    // ---- Background play bridge ------------------------------------------

    // Names the custom event that carries the background play state to page-visibility-api.js. Both files must use the same name.
    const BACKGROUND_PLAY_STATE_EVENT = 'fill-screen-anywhere:background-play';

    // Names the custom event that page-visibility-api.js dispatches to ask for the current state. Both files must use the same name.
    const BACKGROUND_PLAY_REQUEST_EVENT = 'fill-screen-anywhere:background-play-request';

    // Holds whether background play is enabled for this site, or null until the settings have loaded.
    let backgroundPlayEnabled = null;

    // Sends the background play state to the page world. Nothing is sent before the settings have loaded.
    function sendBackgroundPlayState() {
        if (backgroundPlayEnabled === null) return;
        window.dispatchEvent(new CustomEvent(BACKGROUND_PLAY_STATE_EVENT, { detail: backgroundPlayEnabled }));
    }

    // ---- Constants -------------------------------------------------------

    // Identifies the zoom mode in which the video shows at its natural size.
    // The zoom mode values are stored under LAST_ZOOM_STORAGE_KEY, so they must never change.
    const ZOOM_NONE = 0;

    // Identifies the zoom mode that fills the screen with the video.
    const ZOOM_FILL = 1;

    // Identifies the zoom mode that crops the letterbox bars off the video.
    const ZOOM_LETTERBOX = 2;

    // Turns a stored value into a zoom mode. Anything that is not a known zoom-in mode counts as ZOOM_NONE, so corrupted storage never reaches the extension.
    function toZoomMode(value) {
        return value === ZOOM_FILL || value === ZOOM_LETTERBOX ? value : ZOOM_NONE;
    }

    // Maps the command names declared in manifest.json to the zoom modes that they toggle.
    const COMMAND_ZOOM_MODES = {
        'fill-screen': ZOOM_FILL,
        'remove-letterbox': ZOOM_LETTERBOX,
    };

    // Lists the events that reveal the on-screen buttons when the user interacts with the page.
    const INTERACTION_EVENTS = ['mousemove', 'keydown', 'touchstart', 'pointerdown'];

    // Stores the icon of the fill button.
    const ICON_FILL = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-maximize" style="width: 20px; height: 20px; flex-shrink: 0;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M16 4l4 0l0 4"/><path d="M14 10l6 -6"/><path d="M8 20l-4 0l0 -4"/><path d="M4 20l6 -6"/><path d="M16 20l4 0l0 -4"/><path d="M14 14l6 6"/><path d="M8 4l-4 0l0 4"/><path d="M4 4l6 6"/></svg>`;

    // Stores the icon of the reset button.
    const ICON_RESET = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-minimize" style="width: 20px; height: 20px; flex-shrink: 0;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 9l4 0l0 -4"/><path d="M3 3l6 6"/><path d="M5 15l4 0l0 4"/><path d="M3 21l6 -6"/><path d="M19 9l-4 0l0 -4"/><path d="M15 9l6 -6"/><path d="M19 15l-4 0l0 4"/><path d="M15 15l6 6"/></svg>`;

    // Stores the icon of the letterbox button.
    const ICON_LETTERBOX = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-crop"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M7 4v12a1 1 0 0 0 1 1h12" /><path d="M4 7h12a1 1 0 0 1 1 1v12" /></svg>`;

    // Maps each zoom mode to the label and icon of the on-screen button that selects it. The no-zoom mode is the reset button.
    const BUTTON_DEFINITIONS = {
        [ZOOM_NONE]: { label: 'Reset', icon: ICON_RESET },
        [ZOOM_FILL]: { label: 'Fill Screen', icon: ICON_FILL },
        [ZOOM_LETTERBOX]: { label: 'Remove Letterboxing', icon: ICON_LETTERBOX },
    };

    // Stores the inline style of every on-screen button.
    const BUTTON_STYLE = `
        background: rgba(28,28,28,0.8); color: #fff;
        border: 0px; padding: 8px 14px;
        border-radius: 28px; cursor: pointer; font-size: 14px; font-weight: 500;
        opacity: 0.4; transition: opacity 0.2s, background 0.2s;
        pointer-events: auto; backdrop-filter: blur(4px); font-family: sans-serif;
        display: flex; align-items: center; gap: 6px; white-space: nowrap;
    `;

    // Stores the inline style of the container that holds the on-screen buttons.
    const BUTTON_CONTAINER_STYLE = `
        position: fixed; right: 12px; top: 25%; transform: translateY(-25%);
        z-index: 2147483647; display: flex; flex-direction: column; gap: 10px;
        pointer-events: none;
        opacity: 0; visibility: hidden;
        transition: opacity 0.25s ease, visibility 0.25s;
    `;

    // ---- Environment -----------------------------------------------------

    // Stores the lowercase hostname of the current frame, which is used for YouTube detection and site matching.
    const hostname = location.hostname.toLowerCase();

    // Tells whether the current frame belongs to YouTube.
    const isYouTube = YOUTUBE_DOMAINS.some((domain) => hostMatches(domain));

    // ---- State -----------------------------------------------------------

    // Holds the loaded settings, which are the single source of truth for every setting.
    let settings = null;

    // Holds the element that is currently fullscreen. It is null when no fullscreen video is playing, and it is the only element the extension keeps.
    let fullscreenEl = null;

    // Holds the current zoom mode.
    let zoomMode = ZOOM_NONE;

    // Holds the remembered zoom mode that should still be applied automatically as soon as it becomes available, or ZOOM_NONE when nothing is pending.
    let pendingZoomMode = ZOOM_NONE;

    // Holds the remembered zoom mode, which is the last zoom mode that the user chose.
    // It is kept in memory so that entering fullscreen can apply it instantly, and it follows the stored value across frames and tabs.
    let lastZoomMode = ZOOM_NONE;

    // Holds the timer that restores the temporary zoom styles once the zoom-out animation ends.
    let zoomCleanupTimer = null;

    // Maps each running feature, identified by its start function, to the controller that stops it.
    const runningFeatures = new Map();

    // Maps each modified element to the original inline value and priority of every style property that was changed on it.
    const originalStyles = new Map();

    // Holds the distance between the two fingers when the current pinch started.
    let pinchStartDistance = null;

    // Tells whether the current pinch has already triggered its zoom.
    let gestureDone = false;

    // Holds the identifiers of the touch pointers that are currently down.
    const touchPointers = new Set();

    // Tells whether a multi-finger touch gesture is in progress, so that YouTube must not see the rest of its touch events.
    let hidingTouchesFromYouTube = false;

    // Tells whether a multi-finger pointer gesture is in progress, so that YouTube must not see the rest of its pointer events.
    let hidingPointersFromYouTube = false;

    // Holds the touch that YouTube saw start, as its target and Touch object, so that the touch can be cancelled for YouTube. It is null when there is nothing to cancel.
    let youTubeFirstTouch = null;

    // Holds the touch pointer that YouTube saw start, as its target and pointer identifier, so that the pointer can be cancelled for YouTube. It is null when there is nothing to cancel.
    let youTubeFirstPointer = null;

    // Holds the timer that recognizes a long press on the YouTube fullscreen button.
    let longPressTimer = null;

    // Holds the container of the on-screen buttons, or null while the buttons are hidden by the settings.
    let buttonContainer = null;

    // Holds the timer that hides the on-screen buttons after a period without interaction.
    let hideTimer = null;

    // Holds the time of the last interaction that revealed the on-screen buttons.
    let lastActivityTime = 0;

    // ---- Feature lifecycle -----------------------------------------------

    // Brings a feature in line with its desired state. A feature is identified by its start function, which receives an abort signal.
    // Stopping a feature aborts its signal, which removes its listeners and runs its cleanup.
    function syncFeature(start, shouldRun) {
        const running = runningFeatures.get(start);
        if (Boolean(running) === Boolean(shouldRun)) return;
        if (running) {
            runningFeatures.delete(start);
            running.abort();
            return;
        }
        const controller = new AbortController();
        runningFeatures.set(start, controller);
        start(controller.signal);
    }

    // Registers a cleanup function that runs once when the abort signal fires.
    function onStop(signal, cleanup) {
        signal.addEventListener('abort', cleanup, { once: true });
    }

    // Adds a capturing listener that is removed automatically when the abort signal fires.
    function listenCapture(target, type, handler, signal, passive = true) {
        target.addEventListener(type, handler, { capture: true, passive, signal });
    }

    // Brings every fullscreen feature in line with the settings and with whether a fullscreen video is playing.
    // The YouTube gesture block must be synced after the pinch gestures, because its listeners have to be registered after theirs.
    function syncFeatures() {
        const inFullscreen = Boolean(fullscreenEl);
        const onYouTube = inFullscreen && isYouTube && settings.overrideYouTube;
        syncFeature(startSession, inFullscreen);
        syncFeature(startGestures, inFullscreen && settings.pinchGestures);
        syncFeature(startButtons, inFullscreen && !settings.hideButtons);
        syncFeature(startYouTubeOverrides, onYouTube);
        syncFeature(startYouTubeGestureBlock, onYouTube && settings.pinchGestures);
    }

    // ---- Site matching ---------------------------------------------------

    // Tells whether the current hostname equals a list entry or is a subdomain of it.
    function hostMatches(entry) {
        if (typeof entry !== 'string') return false;
        const domain = entry.trim().toLowerCase();
        if (!domain) return false;
        return hostname === domain || hostname.endsWith('.' + domain);
    }

    // Tells whether the extension is enabled on the current site according to the allow or deny list.
    function isSiteEnabled() {
        const isAllowMode = settings.mode === 'allow';
        const matched = (isAllowMode ? settings.allowList : settings.denyList).some(hostMatches);
        return isAllowMode ? matched : !matched;
    }

    // ---- Page helpers ----------------------------------------------------

    // Finds the video inside a root element. When several videos exist, it returns the one with the largest area.
    function findVideo(root) {
        if (root.tagName === 'VIDEO') return root;
        const videos = root.querySelectorAll('video');
        if (videos.length < 2) return videos[0] || null;
        let best = videos[0];
        let bestArea = 0;
        for (const video of videos) {
            const rect = video.getBoundingClientRect();
            if (rect.width * rect.height > bestArea) {
                best = video;
                bestArea = rect.width * rect.height;
            }
        }
        return best;
    }

    // Returns the element that is scaled when zooming, which is the video itself except on YouTube.
    function getZoomTarget(video) {
        return (isYouTube && video.closest(YOUTUBE_ZOOM_CONTAINER_SELECTOR)) || video;
    }

    // Returns the distance in pixels between two touch points.
    function touchDistance(a, b) {
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    // ---- Style bookkeeping -----------------------------------------------

    // Sets an inline style property and remembers its original value the first time that it is changed.
    function setStyle(el, property, value, important = false) {
        let saved = originalStyles.get(el);
        if (!saved) {
            saved = new Map();
            originalStyles.set(el, saved);
        }
        if (!saved.has(property)) {
            saved.set(property, {
                value: el.style.getPropertyValue(property),
                priority: el.style.getPropertyPriority(property),
            });
        }
        el.style.setProperty(property, value, important ? 'important' : '');
    }

    // Puts one inline style property of one element back to its original value.
    function restoreStyle(el, property) {
        const saved = originalStyles.get(el);
        const original = saved && saved.get(property);
        if (!original) return;
        if (original.value) {
            el.style.setProperty(property, original.value, original.priority);
        } else {
            el.style.removeProperty(property);
        }
        saved.delete(property);
    }

    // Puts one inline style property back to its original value on every element that it was changed on.
    function restoreProperty(property) {
        for (const el of originalStyles.keys()) restoreStyle(el, property);
    }

    // Puts every modified inline style back to its original value and forgets all modified elements.
    function restoreAllStyles() {
        for (const [el, saved] of originalStyles) {
            for (const property of [...saved.keys()]) restoreStyle(el, property);
        }
        originalStyles.clear();
    }

    // ---- Zoom calculation ------------------------------------------------

    // Returns the video ratio and the screen ratio, or null while either size is still unknown.
    function getRatios(video) {
        const { videoWidth, videoHeight } = video;
        const { innerWidth, innerHeight } = window;
        if (!videoWidth || !videoHeight || !innerWidth || !innerHeight) return null;
        return { videoRatio: videoWidth / videoHeight, screenRatio: innerWidth / innerHeight };
    }

    // Limits a scale so that tall and wide videos are never cropped excessively on a horizontal display.
    function capScale(scale, videoRatio, screenRatio) {
        // Applies the limits only when the display is horizontal.
        if (screenRatio <= 1) return scale;
        let capped = scale;

        // Never crops a 3:2 or taller video wider than 16:9 on a display that is wider than the video.
        if (settings.capTaller && videoRatio <= RATIO_3_2 && screenRatio > videoRatio) {
            capped = Math.min(capped, RATIO_16_9 / videoRatio);
        }

        // Never crops a 2:1 or wider video taller than 16:9 on a display that is taller than the video.
        if (settings.capWider && videoRatio >= RATIO_2_1 && screenRatio < videoRatio) {
            capped = Math.min(capped, videoRatio / RATIO_16_9);
        }
        return capped;
    }

    // Returns the scale that a zoom mode would apply to the video, or one when the mode does not apply to this video.
    // Removing the letterbox applies only to 16:9 videos.
    function getZoomScale(mode, video) {
        const ratios = getRatios(video);
        if (!ratios) return 1;
        const { videoRatio, screenRatio } = ratios;
        let scale = 1;
        if (mode === ZOOM_FILL) {
            scale = Math.max(videoRatio / screenRatio, screenRatio / videoRatio);
        } else if (mode === ZOOM_LETTERBOX && Math.abs(videoRatio - RATIO_16_9) < ASPECT_TOLERANCE) {
            scale = LETTERBOX_SCALE;
        } else {
            return 1;
        }
        return capScale(scale, videoRatio, screenRatio);
    }

    // Returns the transform origin that keeps the center of the video fixed while the target scales, or null when the video has no size.
    function getZoomOrigin(video, target) {
        const videoRect = video.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (!videoRect.width || !videoRect.height) return null;
        const x = videoRect.left + videoRect.width / 2 - targetRect.left;
        const y = videoRect.top + videoRect.height / 2 - targetRect.top;
        return `${x}px ${y}px`;
    }

    // ---- Zoom application ------------------------------------------------

    // Puts the temporary transition and transform origin of the zoom target back to their original values.
    function restoreZoomStyles(target) {
        restoreStyle(target, 'transition');
        restoreStyle(target, 'transform-origin');
    }

    // Removes the zoom from the target, either with the zoom animation or instantly.
    function clearZoom(target, animate) {
        setStyle(target, 'transition', animate ? ZOOM_TRANSITION : 'none');
        void target.offsetWidth;
        restoreStyle(target, 'transform');
        if (animate) {
            // Waits for the animation to end before the temporary styles are restored.
            zoomCleanupTimer = setTimeout(() => {
                zoomCleanupTimer = null;
                restoreZoomStyles(target);
            }, ZOOM_DURATION_MS + ZOOM_CLEANUP_MARGIN_MS);
        } else {
            void target.offsetWidth;
            restoreZoomStyles(target);
        }
    }

    // Applies a zoom mode to the fullscreen video. A mode that does not reach the zoom threshold leaves the video unzoomed.
    function applyZoom(mode, animate) {
        const video = fullscreenEl && findVideo(fullscreenEl);
        if (!video) return;
        const target = getZoomTarget(video);
        const scale = getZoomScale(mode, video);
        const wasZoomed = zoomMode !== ZOOM_NONE;
        clearTimeout(zoomCleanupTimer);
        zoomCleanupTimer = null;

        // Resets the target to its natural size and measures the transform origin from there.
        let origin = null;
        if (scale > ZOOM_THRESHOLD) {
            setStyle(target, 'transition', 'none');
            setStyle(target, 'transform', 'none');
            origin = getZoomOrigin(video, target);
        }

        if (origin) {
            // Scales the target around the center of the video, with or without animation.
            setStyle(target, 'transform-origin', origin, true);
            if (animate) {
                setStyle(target, 'transition', ZOOM_TRANSITION);
                void target.offsetWidth;
            }
            setStyle(target, 'transform', `scale(${scale})`);
            zoomMode = mode;
        } else {
            // Leaves the video unzoomed and undoes any change that was made while measuring.
            zoomMode = ZOOM_NONE;
            if (wasZoomed || scale > ZOOM_THRESHOLD) clearZoom(target, animate && wasZoomed);
        }
        updateButtons();
    }

    // Stores the zoom mode that the user chose, so that the next fullscreen session can pick up where this one left off.
    // Nothing is stored while the remember zoom state setting is off.
    function saveZoomMode(mode) {
        if (!settings.rememberZoom) return;
        lastZoomMode = mode;
        chrome.storage.local.set({ [LAST_ZOOM_STORAGE_KEY]: mode });
    }

    // Applies a zoom mode that the user requested. The animation follows the zoom animation setting.
    // The zoom mode is remembered only when the request changed it, so that a request that cannot zoom the video does not erase the remembered mode.
    // The user's choice replaces any pending automatic zoom. The automatic zoom and the layout refreshes never reach this function, so only the user's own choices are remembered.
    function setZoom(mode) {
        pendingZoomMode = ZOOM_NONE;
        const previousMode = zoomMode;
        applyZoom(mode, settings.zoomAnimation);
        if (zoomMode !== previousMode) saveZoomMode(zoomMode);
    }

    // Switches a zoom mode on when no zoom is active, and switches it off when it is the active mode.
    function toggleZoom(mode) {
        if (zoomMode === mode) {
            setZoom(ZOOM_NONE);
        } else if (zoomMode === ZOOM_NONE) {
            setZoom(mode);
        }
    }

    // Brings the zoom in line with the current layout without animation. It also applies the remembered zoom mode as soon as that mode becomes available for the video.
    // Until then the video simply stays zoomed out, and the stored mode is left untouched.
    function refreshZoom() {
        if (!fullscreenEl) return;
        if (pendingZoomMode !== ZOOM_NONE && zoomMode === ZOOM_NONE) {
            const video = findVideo(fullscreenEl);
            if (video && getZoomScale(pendingZoomMode, video) > ZOOM_THRESHOLD) {
                const mode = pendingZoomMode;
                pendingZoomMode = ZOOM_NONE;
                applyZoom(mode, false);
                return;
            }
        }
        if (zoomMode !== ZOOM_NONE) {
            applyZoom(zoomMode, false);
        } else {
            updateButtons();
        }
    }

    // ---- Feature: fullscreen session -------------------------------------

    // Prepares the fullscreen element and the video for zooming, and keeps the zoom in line with size changes. Stopping it restores every modified style.
    function startSession(signal) {
        const video = findVideo(fullscreenEl);
        const target = getZoomTarget(video);
        setStyle(fullscreenEl, 'overflow', 'hidden');
        setStyle(target, 'will-change', 'transform');

        // Refreshes the zoom whenever the window or the video changes size.
        listenCapture(window, 'resize', refreshZoom, signal);
        listenCapture(fullscreenEl, 'loadedmetadata', refreshZoom, signal);
        listenCapture(fullscreenEl, 'resize', refreshZoom, signal);

        // Refreshes the zoom whenever the layout box of the video or the zoom target changes size.
        const resizeObserver = new ResizeObserver(() => refreshZoom());
        resizeObserver.observe(video);
        if (target !== video) resizeObserver.observe(target);

        onStop(signal, () => {
            resizeObserver.disconnect();
            clearTimeout(zoomCleanupTimer);
            zoomCleanupTimer = null;
            restoreAllStyles();
        });
    }

    // ---- Feature: viewport-fit=cover -------------------------------------

    // Returns viewport meta content with any existing viewport-fit directive replaced by viewport-fit=cover.
    function withViewportFitCover(content) {
        const directives = (content || '')
            .split(',')
            .map((directive) => directive.trim())
            .filter((directive) => directive && !/^viewport-fit\s*=/i.test(directive));
        directives.push('viewport-fit=cover');
        return directives.join(', ');
    }

    // Forces viewport-fit=cover for as long as the extension is enabled on the page. Stopping it restores or removes the viewport meta tag.
    function startViewport(signal) {
        let meta = document.querySelector('meta[name="viewport"]');
        const created = !meta;
        const originalContent = meta ? meta.getAttribute('content') : null;
        if (created) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
            (document.head || document.documentElement).appendChild(meta);
        } else {
            meta.setAttribute('content', withViewportFitCover(originalContent));
        }

        onStop(signal, () => {
            if (created) {
                meta.remove();
            } else if (originalContent === null) {
                meta.removeAttribute('content');
            } else {
                meta.setAttribute('content', originalContent);
            }
        });
    }

    // ---- Feature: pinch gestures -----------------------------------------

    // Cancels the default behavior of a touch event and hides it from the page.
    function blockTouchEvent(event) {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
    }

    // Starts tracking a pinch when exactly two fingers touch the screen.
    function onTouchStart(event) {
        if (event.touches.length === 2) {
            blockTouchEvent(event);
            pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
            gestureDone = false;
            cancelYouTubeTouch();
        } else {
            pinchStartDistance = null;
        }
    }

    // Zooms in when the fingers spread apart and zooms out when they pinch together, once per gesture.
    function onTouchMove(event) {
        if (event.touches.length !== 2) return;
        blockTouchEvent(event);
        if (pinchStartDistance === null || gestureDone) return;
        const delta = touchDistance(event.touches[0], event.touches[1]) - pinchStartDistance;
        if (zoomMode === ZOOM_NONE && delta > PINCH_THRESHOLD) {
            setZoom(ZOOM_FILL);
            gestureDone = true;
        } else if (zoomMode !== ZOOM_NONE && delta < -PINCH_THRESHOLD) {
            setZoom(ZOOM_NONE);
            gestureDone = true;
        }
    }

    // Ends the current pinch when fewer than two fingers remain on the screen. It ignores the cancellations that the extension sends to YouTube.
    function onTouchEnd(event) {
        if (event.isTrusted && event.touches.length < 2) {
            pinchStartDistance = null;
            gestureDone = false;
        }
    }

    // Tracks a touch pointer and hides multi-touch pointer events from the page.
    function onPointerDown(event) {
        if (event.pointerType !== 'touch') return;
        touchPointers.add(event.pointerId);
        if (touchPointers.size >= 2) event.stopImmediatePropagation();
        if (touchPointers.size === 2) cancelYouTubeTouch();
    }

    // Hides pointer movement from the page while several touch pointers are down.
    function onPointerMove(event) {
        if (event.pointerType !== 'touch' || touchPointers.size < 2) return;
        event.stopImmediatePropagation();
    }

    // Stops tracking a touch pointer that was lifted or cancelled. It ignores the cancellations that the extension sends to YouTube.
    function onPointerEnd(event) {
        if (!event.isTrusted || event.pointerType !== 'touch') return;
        touchPointers.delete(event.pointerId);
    }

    // Listens for pinch gestures on the fullscreen element and disables the browser's own touch handling there. Stopping it restores the touch handling.
    function startGestures(signal) {
        const video = findVideo(fullscreenEl);
        if (video) setStyle(video, 'touch-action', 'none', true);
        setStyle(fullscreenEl, 'touch-action', 'none', true);

        listenCapture(fullscreenEl, 'touchstart', onTouchStart, signal, false);
        listenCapture(fullscreenEl, 'touchmove', onTouchMove, signal, false);
        listenCapture(fullscreenEl, 'touchend', onTouchEnd, signal);
        listenCapture(fullscreenEl, 'touchcancel', onTouchEnd, signal);
        listenCapture(fullscreenEl, 'pointerdown', onPointerDown, signal);
        listenCapture(fullscreenEl, 'pointermove', onPointerMove, signal);
        listenCapture(fullscreenEl, 'pointerup', onPointerEnd, signal);
        listenCapture(fullscreenEl, 'pointercancel', onPointerEnd, signal);

        onStop(signal, () => {
            restoreProperty('touch-action');
            touchPointers.clear();
            pinchStartDistance = null;
            gestureDone = false;
        });
    }

    // ---- Feature: YouTube overrides --------------------------------------

    // Cancels a pending long press on the YouTube fullscreen button.
    function cancelLongPress() {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    // Starts the long press timer when a single finger touches the YouTube fullscreen button. A long press toggles the letterbox removal.
    function onFullscreenButtonTouchStart(event) {
        if (event.touches.length !== 1 || !event.target.closest(YOUTUBE_FULLSCREEN_BUTTON_SELECTOR)) return;

        cancelLongPress();
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (navigator.vibrate) navigator.vibrate(LONG_PRESS_VIBRATION_MS);
            setZoom(zoomMode === ZOOM_NONE ? ZOOM_LETTERBOX : ZOOM_NONE);
        }, LONG_PRESS_MS);
    }

    // Suppresses every context menu inside the fullscreen YouTube player.
    function onPlayerContextMenu(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    // Runs every YouTube override. The overrides are the long press on the fullscreen button and the suppression of the context menu.
    // The listeners sit on the fullscreen element, so they keep working when YouTube rebuilds its player controls.
    function startYouTubeOverrides(signal) {
        listenCapture(fullscreenEl, 'touchstart', onFullscreenButtonTouchStart, signal);
        listenCapture(fullscreenEl, 'touchend', cancelLongPress, signal);
        listenCapture(fullscreenEl, 'touchcancel', cancelLongPress, signal);
        listenCapture(fullscreenEl, 'touchmove', cancelLongPress, signal);
        listenCapture(fullscreenEl, 'contextmenu', onPlayerContextMenu, signal, false);

        onStop(signal, cancelLongPress);
    }

    // Tells YouTube that the first finger that it saw touch down was cancelled, once a second finger lands.
    // YouTube never sees the rest of the gesture, so without this it would keep waiting for that finger, and a press and hold to play at 2X speed would never end.
    function cancelYouTubeTouch() {
        const pointer = youTubeFirstPointer;
        const touch = youTubeFirstTouch;
        youTubeFirstPointer = null;
        youTubeFirstTouch = null;

        if (pointer && pointer.target.isConnected) {
            pointer.target.dispatchEvent(new PointerEvent('pointercancel', {
                pointerId: pointer.pointerId,
                pointerType: 'touch',
                isPrimary: true,
                bubbles: true,
                composed: true,
            }));
        }

        if (touch && touch.target.isConnected) {
            try {
                touch.target.dispatchEvent(new TouchEvent('touchcancel', {
                    touches: [],
                    targetTouches: [],
                    changedTouches: [touch.touch],
                    bubbles: true,
                    composed: true,
                }));
            } catch (error) {
                // Leaves YouTube alone on browsers that cannot construct touch events.
            }
        }
    }

    // Hides touch events from YouTube while two or more fingers are down, so that its own swipe and pinch gestures cannot fire.
    // Once a second finger has landed, it keeps hiding until the last finger lifts, so that a finger left over after the pinch is not read as a swipe.
    // It also remembers the first finger, which YouTube sees before the second one lands, so that cancelYouTubeTouch can cancel it.
    function onYouTubeGestureTouch(event) {
        if (!event.isTrusted) return;
        const ending = event.type === 'touchend' || event.type === 'touchcancel';
        // An ending event no longer lists the fingers that it lifted in touches, so those are added back.
        const fingers = event.touches.length + (ending ? event.changedTouches.length : 0);

        if (event.type === 'touchstart' && fingers === 1) {
            hidingTouchesFromYouTube = false;
            youTubeFirstTouch = { target: event.target, touch: event.changedTouches[0] };
        }
        if (fingers >= 2) hidingTouchesFromYouTube = true;

        const hiding = hidingTouchesFromYouTube;
        if (ending && event.touches.length === 0) {
            hidingTouchesFromYouTube = false;
            youTubeFirstTouch = null;
        }
        if (hiding) event.stopImmediatePropagation();
    }

    // Does the same for pointer events. The touch pointers are tracked by the pinch gestures, whose listeners run first on the same element.
    function onYouTubeGesturePointer(event) {
        if (!event.isTrusted || event.pointerType !== 'touch') return;

        const ending = event.type === 'pointerup' || event.type === 'pointercancel';
        const fingers = touchPointers.size + (ending ? 1 : 0);

        if (event.type === 'pointerdown' && fingers === 1) {
            hidingPointersFromYouTube = false;
            youTubeFirstPointer = { target: event.target, pointerId: event.pointerId };
        }
        if (fingers >= 2) hidingPointersFromYouTube = true;

        const hiding = hidingPointersFromYouTube;
        if (ending && touchPointers.size === 0) {
            hidingPointersFromYouTube = false;
            youTubeFirstPointer = null;
        }
        if (hiding) event.stopImmediatePropagation();
    }

    // Disables YouTube's own swipe and pinch gestures while several fingers touch the screen. It runs after the pinch gestures, which it relies on.
    function startYouTubeGestureBlock(signal) {
        for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            listenCapture(fullscreenEl, type, onYouTubeGestureTouch, signal);
        }
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
            listenCapture(fullscreenEl, type, onYouTubeGesturePointer, signal);
        }

        onStop(signal, () => {
            hidingTouchesFromYouTube = false;
            hidingPointersFromYouTube = false;
            youTubeFirstTouch = null;
            youTubeFirstPointer = null;
        });
    }

    // ---- Feature: on-screen buttons --------------------------------------

    // Records an interaction and makes sure that a timer is running that will hide the buttons later.
    function markActivity() {
        lastActivityTime = performance.now();
        if (!hideTimer) hideTimer = setTimeout(onHideTimer, UI_HIDE_DELAY);
    }

    // Hides the buttons once the interaction delay has passed, unless the pointer or the keyboard focus is on them.
    function onHideTimer() {
        hideTimer = null;
        if (!buttonContainer) return;
        const remaining = UI_HIDE_DELAY - (performance.now() - lastActivityTime);
        if (remaining > 0) {
            hideTimer = setTimeout(onHideTimer, remaining);
            return;
        }
        if (buttonContainer.matches(':hover, :focus-within')) return;
        buttonContainer.style.opacity = '0';
        buttonContainer.style.visibility = 'hidden';
    }

    // Reveals the buttons and restarts the countdown that hides them.
    function showButtons() {
        if (!buttonContainer) return;
        buttonContainer.style.opacity = '1';
        buttonContainer.style.visibility = 'visible';
        markActivity();
    }

    // Creates the on-screen button that selects a zoom mode.
    function createButton(mode) {
        const { label, icon } = BUTTON_DEFINITIONS[mode];
        const button = document.createElement('button');
        button.style.cssText = BUTTON_STYLE;
        button.innerHTML = icon;
        const text = document.createElement('span');
        text.textContent = label;
        button.appendChild(text);

        // Highlights the button while the pointer or the keyboard focus is on it, and dims it afterwards.
        const highlight = () => {
            button.style.opacity = '1';
            showButtons();
        };
        const dim = () => {
            button.style.opacity = '0.4';
            markActivity();
        };
        for (const type of ['mouseenter', 'focus']) button.addEventListener(type, highlight);
        for (const type of ['mouseleave', 'blur']) button.addEventListener(type, dim);

        // Applies the zoom mode of the button without letting the page see the click.
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showButtons();
            setZoom(mode);
        });
        return button;
    }

    // Shows the buttons that fit the current state: the reset button while zoomed, otherwise every zoom that reaches the zoom threshold.
    // The buttons are rebuilt only when this set changes, so that hover and focus survive unrelated updates.
    function updateButtons() {
        if (!buttonContainer) return;
        const video = findVideo(fullscreenEl);
        const modes = zoomMode !== ZOOM_NONE
            ? [ZOOM_NONE]
            : [ZOOM_FILL, ZOOM_LETTERBOX].filter((mode) => video && getZoomScale(mode, video) > ZOOM_THRESHOLD);
        const key = modes.join();
        if (buttonContainer.dataset.modes === key) return;
        buttonContainer.dataset.modes = key;
        buttonContainer.replaceChildren(...modes.map(createButton));
    }

    // Adds the on-screen buttons to the fullscreen element. Stopping it removes them again.
    function startButtons(signal) {
        buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = BUTTON_CONTAINER_STYLE;
        fullscreenEl.appendChild(buttonContainer);

        for (const type of INTERACTION_EVENTS) listenCapture(document, type, showButtons, signal);
        updateButtons();
        showButtons();

        onStop(signal, () => {
            clearTimeout(hideTimer);
            hideTimer = null;
            buttonContainer.remove();
            buttonContainer = null;
        });
    }

    // ---- Fullscreen lifecycle --------------------------------------------

    // Starts working on a fullscreen element that contains a video. The remembered zoom mode, if any, is applied instantly as part of this initial zoom when the video supports it.
    // A video that was last left zoomed out, or that does not support the remembered mode, is simply left alone.
    function enterFullscreen(root) {
        fullscreenEl = root;
        zoomMode = ZOOM_NONE;
        pendingZoomMode = settings.rememberZoom ? lastZoomMode : ZOOM_NONE;
        syncFeatures();
        refreshZoom();
    }

    // Stops working on the fullscreen element, which restores everything that was modified on the page.
    function exitFullscreen() {
        if (!fullscreenEl) return;
        fullscreenEl = null;
        zoomMode = ZOOM_NONE;
        pendingZoomMode = ZOOM_NONE;
        syncFeatures();
    }

    // Reacts to every fullscreen change by restoring the page and, if a video is fullscreen now, starting over with it.
    function onFullscreenChange() {
        exitFullscreen();
        const root = document.fullscreenElement;
        if (root && findVideo(root)) enterFullscreen(root);
    }

    // Watches for fullscreen changes while the extension is enabled on this site. Stopping it also restores the page.
    function startFullscreenListener(signal) {
        document.addEventListener('fullscreenchange', onFullscreenChange, { signal });
        onStop(signal, exitFullscreen);
        if (document.fullscreenElement) onFullscreenChange();
    }

    // ---- Settings --------------------------------------------------------

    // Applies a freshly loaded settings object to every part of the content script.
    function applySettings(loadedSettings) {
        settings = loadedSettings;
        const siteEnabled = isSiteEnabled();
        syncFeature(startViewport, siteEnabled && settings.centerVideos);
        syncFeature(startFullscreenListener, siteEnabled);
        syncFeatures();
        refreshZoom();

        // Tells the page world whether background play is enabled for this site.
        backgroundPlayEnabled = siteEnabled && settings.backgroundPlay;
        sendBackgroundPlayState();
    }

    // ---- Messages and boot -----------------------------------------------

    // Toggles the zoom that a keyboard command stands for, but only while a video is fullscreen.
    chrome.runtime.onMessage.addListener((message) => {
        const mode = COMMAND_ZOOM_MODES[message && message.command];
        if (mode === undefined || !fullscreenEl) return;
        toggleZoom(mode);
    });

    // Follows the remembered zoom mode, and reloads and reapplies every setting whenever any other stored value changes.
    // The zoom mode changes on every zoom, and reapplying the settings would refresh the zoom and cut its animation short, so a change to it alone never reloads the settings.
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (LAST_ZOOM_STORAGE_KEY in changes) lastZoomMode = toZoomMode(changes[LAST_ZOOM_STORAGE_KEY].newValue);
        if (Object.keys(changes).some((key) => key !== LAST_ZOOM_STORAGE_KEY)) loadSettings(applySettings);
    });

    // Answers the page world when it asks for the state, which happens if it started after the settings had already loaded.
    window.addEventListener(BACKGROUND_PLAY_REQUEST_EVENT, sendBackgroundPlayState);

    // Loads the remembered zoom mode first, so that a video that is already fullscreen when the script starts can use it, and then loads and applies the stored settings.
    chrome.storage.local.get(LAST_ZOOM_STORAGE_KEY, (result) => {
        lastZoomMode = toZoomMode(result && result[LAST_ZOOM_STORAGE_KEY]);
        loadSettings(applySettings);
    });
})();
