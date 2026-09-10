(function () {
'use strict';

// ---- Tunables --------------------------------------------------------
const PINCH_THRESHOLD = 40;
const TRANSITION = 'transform 500ms ease';
const LONG_PRESS_MS = 550;
const LETTERBOX_SCALE = 1.333333; // 1 / 0.75 (Crops exactly 25% of the video)
const UI_HIDE_DELAY = 3000;

// ---- Aspect-ratio limits ----------------------------------------------
const RATIO_16_9 = 16 / 9;
const RATIO_3_2 = 3 / 2;
const RATIO_2_1 = 2 / 1;

// ---- Options (popup) settings -----------------------------------------
let capTallerLimit = true;
let capWiderLimit = true;

function hostMatches(host, entry) {
    entry = entry.trim().toLowerCase();
    if (!entry) return false;
    return host === entry || host.endsWith('.' + entry);
}

function isSiteEnabled(settings) {
    const host = location.hostname.toLowerCase();
    const list = settings.mode === 'allow' ? settings.allowList : settings.denyList;
    const matched = list.some(entry => hostMatches(host, entry));
    return settings.mode === 'allow' ? matched : !matched;
}

// ---- Environment Detection -------------------------------------------
const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches || 
                  (!('ontouchstart' in window) && navigator.maxTouchPoints === 0);

// ---- YouTube detection -----------------------------------------------
const isYouTube = /(?:^|.|-)youtube.com$|(?:^|.|-)youtu.be$|(?:^|.|-)youtube-nocookie.com$/i.test(location.hostname);

// ---- State -----------------------------------------------------------
let fullscreenEl = null;
let videoEl = null;
let targetEl = null;       
let playerEl = null;       
let zoomed = false;
let currentMode = 0; // 0: none, 1: fill, 2: letterbox
let savedStyle = null;
let pinchStartDist = null;
let gestureDone = false;
let pointers = new Set();
let zoomTimeoutId = null; 

// Aspect ratio state
let is16x9Video = false;
let is16x9Screen = false;
let isTallerHorizontalScreen = false;
let videoResizeHandler = null;

// YouTube long-press state (Mobile only)
let ytLongPressTimer = null;
let ytFsButton = null;

// Desktop button state
let btnContainer = null;

// Desktop UI auto-hide state
let uiHideTimer = null;
let uiHoverCount = 0;
let uiFocusCount = 0;
let uiInteractionHandler = null;

// ---- Desktop Button SVGs ---------------------------------------------
const svgFill = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-maximize" style="width: 20px; height: 20px; flex-shrink: 0;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M16 4l4 0l0 4"/><path d="M14 10l6 -6"/><path d="M8 20l-4 0l0 -4"/><path d="M4 20l6 -6"/><path d="M16 20l4 0l0 -4"/><path d="M14 14l6 6"/><path d="M8 4l-4 0l0 4"/><path d="M4 4l6 6"/></svg>`;
const svgReset = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-minimize" style="width: 20px; height: 20px; flex-shrink: 0;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 9l4 0l0 -4"/><path d="M3 3l6 6"/><path d="M5 15l4 0l0 4"/><path d="M3 21l6 -6"/><path d="M19 9l-4 0l0 -4"/><path d="M15 9l6 -6"/><path d="M19 15l-4 0l0 4"/><path d="M15 15l6 6"/></svg>`;
const svgLetterbox = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-crop"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M7 4v12a1 1 0 0 0 1 1h12" /><path d="M4 7h12a1 1 0 0 1 1 1v12" /></svg>`;

// ---- Helpers ---------------------------------------------------------
function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function findVideo(root) {
    if (!root) return null;
    if (root.tagName === 'VIDEO') return root;
    const videos = root.querySelectorAll('video');
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];
    let best = videos[0], bestArea = 0;
    videos.forEach(v => {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = v; }
    });
    return best;
}

function touchDistance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function fillScale(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return 1;
    const vr = vw / vh, sr = window.innerWidth / window.innerHeight;
    return Math.max(vr / sr, sr / vr);
}

// ---- Universal crop limitation ----------------------------------------
function capScaleForHorizontalDisplay(scale, video) {
    if (!video) return scale;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    if (!vw || !vh || !sw || !sh) return scale;

    const vRatio = vw / vh;
    const sRatio = sw / sh;

    // Limitation applies only when the device display is horizontal.
    if (sRatio <= 1) return scale;

    let capped = scale;

    // If video is 3:2 or taller, and the display is wider than the video,
    // never crop it wider than 16:9.
    if (capTallerLimit && vRatio <= RATIO_3_2 && sRatio > vRatio) {
        capped = Math.min(capped, RATIO_16_9 / vRatio);
    }

    // If video is 2:1 or wider, and the display is taller than the video,
    // never crop it taller than 16:9.
    if (capWiderLimit && vRatio >= RATIO_2_1 && sRatio < vRatio) {
        capped = Math.min(capped, vRatio / RATIO_16_9);
    }

    return capped;
}

function cappedFillScale(video) {
    return capScaleForHorizontalDisplay(fillScale(video), video);
}

// ---- Aspect Ratio Detection ------------------------------------------
function updateAspectRatios() {
    if (!videoEl) {
        is16x9Video = false;
        is16x9Screen = false;
        isTallerHorizontalScreen = false;
        return;
    }

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    if (!vw || !vh || !sw || !sh) {
        is16x9Video = false;
        is16x9Screen = false;
        isTallerHorizontalScreen = false;
        return;
    }

    const vRatio = vw / vh;
    const sRatio = sw / sh;

    const TOLERANCE = 0.08;

    is16x9Video = (vRatio > RATIO_16_9 - TOLERANCE && vRatio < RATIO_16_9 + TOLERANCE);
    is16x9Screen = (sRatio > RATIO_16_9 - TOLERANCE && sRatio < RATIO_16_9 + TOLERANCE);
    isTallerHorizontalScreen = (sRatio > 1.0 && sRatio <= RATIO_16_9 - TOLERANCE);
}

// ---- Gesture-blocking helpers (Mobile only) --------------------------
function blockTouchEvent(e) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}

function blockPointerEvent(e) {
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}

function setTouchAction(el) {
    if (el) el.style.setProperty('touch-action', 'none', 'important');
}

// ---- Core zoom (pixel-anchored to video center) ----------------------
function applyZoom(mode) {
    if (!targetEl || !fullscreenEl) return;

    if (zoomTimeoutId) {
        clearTimeout(zoomTimeoutId);
        zoomTimeoutId = null;
    }

    currentMode = mode;

    if (mode !== 0) {
        let scale = 1;

        if (mode === 1) {
            scale = cappedFillScale(videoEl);
        } else if (mode === 2) {
            scale = capScaleForHorizontalDisplay(LETTERBOX_SCALE, videoEl);
        }

        if (scale <= 1.02) {
            currentMode = 0;
            zoomed = false;
            updateDesktopButtons();
            return;
        }

        targetEl.style.transition = 'none';
        targetEl.style.transform = 'none';
        void targetEl.offsetWidth;

        const videoRect = videoEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();

        if (videoRect.width === 0 || videoRect.height === 0) return;

        const ox = (videoRect.left + videoRect.width / 2) - tRect.left;
        const oy = (videoRect.top + videoRect.height / 2) - tRect.top;

        targetEl.style.setProperty('transform-origin', `${ox}px ${oy}px`, 'important');
        targetEl.style.transition = TRANSITION;
        void targetEl.offsetWidth;
        targetEl.style.transform = `scale(${scale})`;
    } else {
        targetEl.style.transition = TRANSITION;
        void targetEl.offsetWidth;
        targetEl.style.transform = '';

        zoomTimeoutId = setTimeout(() => {
            zoomTimeoutId = null;
            if (!targetEl) return;
            targetEl.style.transition = (savedStyle && savedStyle.targetTransition) || '';
            if (savedStyle && savedStyle.targetOrigin)
                targetEl.style.setProperty('transform-origin', savedStyle.targetOrigin, 'important');
            else
                targetEl.style.removeProperty('transform-origin');
        }, 550);
    }

    zoomed = (mode !== 0);
    updateDesktopButtons();
}

// ---- Mobile: Pinch gesture -------------------------------------------
function onTouchStart(e) {
    // if (isYouTube) return;
    if (e.touches.length === 2) {
        blockTouchEvent(e);
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        gestureDone = false;
    } else {
        pinchStartDist = null;
    }
}

function onTouchMove(e) {
    // if (isYouTube) return;
    if (e.touches.length !== 2) return;
    blockTouchEvent(e);
    if (pinchStartDist === null || gestureDone) return;
    const delta = touchDistance(e.touches[0], e.touches[1]) - pinchStartDist;
    if (!zoomed && delta > PINCH_THRESHOLD)       { applyZoom(1); gestureDone = true; }
    else if (zoomed && delta < -PINCH_THRESHOLD)  { applyZoom(0); gestureDone = true; }
}

function onTouchEnd(e) {
    if (e.touches.length < 2) { pinchStartDist = null; gestureDone = false; }
}

function onPointerDown(e) {
    if (e.pointerType !== 'touch') return;
    pointers.add(e.pointerId);
    if (pointers.size >= 2) blockPointerEvent(e);
}

function onPointerMove(e) {
    if (e.pointerType !== 'touch' || pointers.size < 2) return;
    blockPointerEvent(e);
}

function onPointerEnd(e) {
    if (e.pointerType !== 'touch') return;
    pointers.delete(e.pointerId);
}

// ---- Mobile: YouTube long-press --------------------------------------
function findYTFullscreenButton() {
    return document.querySelector('.ytp-fullscreen-button') ||
           document.querySelector('button[aria-label*="Full screen" i]') ||
           document.querySelector('button[aria-label*="Exit full screen" i]') ||
           document.querySelector('button[title*="Full screen" i]') ||
           document.querySelector('button[title*="Exit full screen" i]');
}

function onYTFsTouchStart(e) {
    if (e.touches.length !== 1) return;
    ytLongPressTimer = setTimeout(() => {
        ytLongPressTimer = null;
        if (navigator.vibrate) navigator.vibrate(30);
        applyZoom(zoomed ? 0 : 1);
    }, LONG_PRESS_MS);
}

function onYTFsTouchEnd()    { if (ytLongPressTimer) { clearTimeout(ytLongPressTimer); ytLongPressTimer = null; } }
function onYTFsTouchMove()   { if (ytLongPressTimer) { clearTimeout(ytLongPressTimer); ytLongPressTimer = null; } }

function attachYTLongPress() {
    const btn = findYTFullscreenButton();
    if (!btn || btn === ytFsButton) return;
    detachYTLongPress();
    ytFsButton = btn;
    btn.addEventListener('touchstart',  onYTFsTouchStart, { passive: true });
    btn.addEventListener('touchend',    onYTFsTouchEnd,   { passive: true });
    btn.addEventListener('touchcancel', onYTFsTouchEnd,   { passive: true });
    btn.addEventListener('touchmove',   onYTFsTouchMove,  { passive: true });
}

function detachYTLongPress() {
    if (!ytFsButton) return;
    ytFsButton.removeEventListener('touchstart',  onYTFsTouchStart);
    ytFsButton.removeEventListener('touchend',    onYTFsTouchEnd);
    ytFsButton.removeEventListener('touchcancel', onYTFsTouchEnd);
    ytFsButton.removeEventListener('touchmove',   onYTFsTouchMove);
    ytFsButton = null;
    if (ytLongPressTimer) { clearTimeout(ytLongPressTimer); ytLongPressTimer = null; }
}

// ---- Desktop UI visibility -------------------------------------------
function isUiPinned() {
    return uiHoverCount > 0 || uiFocusCount > 0;
}

function showDesktopButtons() {
    if (!btnContainer) return;

    btnContainer.style.opacity = '1';
    btnContainer.style.visibility = 'visible';

    if (uiHideTimer) {
        clearTimeout(uiHideTimer);
        uiHideTimer = null;
    }

    uiHideTimer = setTimeout(hideDesktopButtons, UI_HIDE_DELAY);
}

function hideDesktopButtons() {
    if (!btnContainer) return;

    uiHideTimer = null;

    if (isUiPinned()) return;

    btnContainer.style.opacity = '0';
    btnContainer.style.visibility = 'hidden';
}

function scheduleHideDesktopButtons() {
    if (uiHideTimer) {
        clearTimeout(uiHideTimer);
        uiHideTimer = null;
    }

    uiHideTimer = setTimeout(hideDesktopButtons, UI_HIDE_DELAY);
}

function attachUiInteractionListeners() {
    if (uiInteractionHandler) return;

    uiInteractionHandler = () => showDesktopButtons();

    document.addEventListener('mousemove', uiInteractionHandler, { capture: true, passive: true });
    document.addEventListener('keydown', uiInteractionHandler, { capture: true });
    document.addEventListener('touchstart', uiInteractionHandler, { capture: true, passive: true });
    document.addEventListener('pointerdown', uiInteractionHandler, { capture: true, passive: true });
}

function detachUiInteractionListeners() {
    if (!uiInteractionHandler) return;

    document.removeEventListener('mousemove', uiInteractionHandler, { capture: true });
    document.removeEventListener('keydown', uiInteractionHandler, { capture: true });
    document.removeEventListener('touchstart', uiInteractionHandler, { capture: true });
    document.removeEventListener('pointerdown', uiInteractionHandler, { capture: true });

    uiInteractionHandler = null;
}

// ---- Desktop: Hovering Buttons ---------------------------------------
function createButton(text, svg, onClick) {
    const btn = document.createElement('button');
    btn.className = 'fs-action-btn';
    btn.style.cssText = `
        background: rgba(28,28,28,0.8); color: #fff;
        border: 0px; padding: 8px 14px;
        border-radius: 28px; cursor: pointer; font-size: 14px; font-weight: 500;
        opacity: 0.4; transition: opacity 0.2s, background 0.2s;
        pointer-events: auto; backdrop-filter: blur(4px); font-family: sans-serif;
        display: flex; align-items: center; gap: 6px; white-space: nowrap;
    `;

    btn.innerHTML = svg + `<span>${text}</span>`;

    btn.addEventListener('mouseenter', () => {
        uiHoverCount++;
        btn.style.opacity = '1';
        showDesktopButtons();
    });

    btn.addEventListener('mouseleave', () => {
        uiHoverCount = Math.max(0, uiHoverCount - 1);
        btn.style.opacity = '0.4';
        scheduleHideDesktopButtons();
    });

    btn.addEventListener('focus', () => {
        uiFocusCount++;
        btn.style.opacity = '1';
        showDesktopButtons();
    });

    btn.addEventListener('blur', () => {
        uiFocusCount = Math.max(0, uiFocusCount - 1);
        btn.style.opacity = '0.4';
        scheduleHideDesktopButtons();
    });

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showDesktopButtons();
        onClick();
    });

    return btn;
}

function updateDesktopButtons() {
    if (!btnContainer) return;

    uiHoverCount = 0;
    uiFocusCount = 0;

    btnContainer.innerHTML = '';

    if (currentMode !== 0) {
        const btnReset = createButton('Reset', svgReset, () => applyZoom(0));
        btnContainer.appendChild(btnReset);
        return;
    }

    if (is16x9Video && is16x9Screen) {
        const btnLetterbox = createButton('Remove Letterboxing', svgLetterbox, () => applyZoom(2));
        btnContainer.appendChild(btnLetterbox);
    } else if (is16x9Video && isTallerHorizontalScreen) {
        const btnFill = createButton('Fill Screen', svgFill, () => applyZoom(1));
        const btnLetterbox = createButton('Remove Letterboxing', svgLetterbox, () => applyZoom(2));
        btnContainer.appendChild(btnFill);
        btnContainer.appendChild(btnLetterbox);
    } else {
        const btnFill = createButton('Fill Screen', svgFill, () => applyZoom(1));
        btnContainer.appendChild(btnFill);
    }
}

function createDesktopButtons(root) {
    if (btnContainer) return;

    btnContainer = document.createElement('div');
    btnContainer.id = 'fs-btn-container';
    btnContainer.style.cssText = `
        position: fixed; right: 12px; top: 25%; transform: translateY(-25%);
        z-index: 2147483647; display: flex; flex-direction: column; gap: 10px;
        pointer-events: none;
        opacity: 0; visibility: hidden;
        transition: opacity 0.25s ease, visibility 0.25s;
    `;

    root.appendChild(btnContainer);
}

function removeDesktopButtons() {
    if (btnContainer && btnContainer.parentNode) {
        btnContainer.parentNode.removeChild(btnContainer);
    }
    btnContainer = null;
}

// ---- YouTube: block context menu in fullscreen -----------------------
function onContextMenu(e) {
    if (isYouTube && fullscreenEl) { e.preventDefault(); e.stopPropagation(); }
}

// ---- Setup / teardown ------------------------------------------------
function onResize() {
    updateAspectRatios();

    if (currentMode !== 0) {
        applyZoom(currentMode);
    } else {
        updateDesktopButtons();
    }
}

function setup(root) {
    const video = findVideo(root);
    if (!video) return;

    fullscreenEl = root;
    videoEl = video;
    zoomed = false;
    currentMode = 0;

    if (isYouTube) {
        targetEl = document.querySelector('.html5-video-container') || video;
        playerEl = document.querySelector('#movie_player') || root;
    } else {
        targetEl = video;
        playerEl = root;
    }

    savedStyle = {
        targetTransform:  targetEl.style.transform,
        targetTransition: targetEl.style.transition,
        targetOrigin:     targetEl.style.transformOrigin,
        videoOpacity:     videoEl.style.opacity,
        videoWillChange:  videoEl.style.willChange,
        videoTouchAction: videoEl.style.touchAction,
        playerOverflow:   playerEl ? playerEl.style.overflow : '',
        rootOverflow:     root.style.overflow,
        rootTouchAction:  root.style.touchAction,
    };

    if (isYouTube) {
        videoEl.style.opacity = '0.999';
        targetEl.style.willChange = 'transform';
        if (playerEl) playerEl.style.overflow = 'hidden';
    } else {
        videoEl.style.willChange = 'transform';
        root.style.overflow = 'hidden';
    }

    if (isDesktop) {
        createDesktopButtons(root);
        updateAspectRatios();
        updateDesktopButtons();
        attachUiInteractionListeners();
        showDesktopButtons();

        videoResizeHandler = () => {
            updateAspectRatios();
            if (currentMode === 0) {
                updateDesktopButtons();
            } else {
                applyZoom(currentMode);
            }
        };

        videoResizeHandler();
        videoEl.addEventListener('loadedmetadata', videoResizeHandler, { once: true });
        videoEl.addEventListener('resize', videoResizeHandler);
    } else {
        setTouchAction(videoEl);
        if (root !== videoEl) setTouchAction(root);

        root.addEventListener('touchstart',  onTouchStart,  { capture: true, passive: false });
        root.addEventListener('touchmove',   onTouchMove,   { capture: true, passive: false });
        root.addEventListener('touchend',    onTouchEnd,    { capture: true, passive: true  });
        root.addEventListener('touchcancel', onTouchEnd,    { capture: true, passive: true  });

        if (window.PointerEvent) {
            root.addEventListener('pointerdown',   onPointerDown,  { capture: true, passive: true });
            root.addEventListener('pointermove',   onPointerMove,  { capture: true, passive: true });
            root.addEventListener('pointerup',     onPointerEnd,   { capture: true, passive: true });
            root.addEventListener('pointercancel', onPointerEnd,   { capture: true, passive: true });
        }

        if (isYouTube) {
            attachYTLongPress();
            setTimeout(attachYTLongPress, 400);
            setTimeout(attachYTLongPress, 1200);
        }
    }

    window.addEventListener('resize', onResize);
}

function teardown() {
    if (zoomTimeoutId) {
        clearTimeout(zoomTimeoutId);
        zoomTimeoutId = null;
    }

    if (isDesktop) {
        detachUiInteractionListeners();

        if (uiHideTimer) {
            clearTimeout(uiHideTimer);
            uiHideTimer = null;
        }

        uiHoverCount = 0;
        uiFocusCount = 0;

        removeDesktopButtons();

        if (videoEl && videoResizeHandler) {
            videoEl.removeEventListener('loadedmetadata', videoResizeHandler);
            videoEl.removeEventListener('resize', videoResizeHandler);
            videoResizeHandler = null;
        }
    } else {
        if (fullscreenEl) {
            fullscreenEl.removeEventListener('touchstart',  onTouchStart,  { capture: true });
            fullscreenEl.removeEventListener('touchmove',   onTouchMove,   { capture: true });
            fullscreenEl.removeEventListener('touchend',    onTouchEnd,    { capture: true });
            fullscreenEl.removeEventListener('touchcancel', onTouchEnd,    { capture: true });

            if (window.PointerEvent) {
                fullscreenEl.removeEventListener('pointerdown',   onPointerDown,  { capture: true });
                fullscreenEl.removeEventListener('pointermove',   onPointerMove,  { capture: true });
                fullscreenEl.removeEventListener('pointerup',     onPointerEnd,   { capture: true });
                fullscreenEl.removeEventListener('pointercancel', onPointerEnd,   { capture: true });
            }
        }

        if (isYouTube) detachYTLongPress();
    }

    window.removeEventListener('resize', onResize);

    if (targetEl && savedStyle) {
        targetEl.style.transform = savedStyle.targetTransform;
        targetEl.style.transition = savedStyle.targetTransition;
        targetEl.style.transformOrigin = savedStyle.targetOrigin;
        targetEl.style.willChange = savedStyle.videoWillChange;
    }

    if (videoEl && savedStyle) {
        videoEl.style.opacity = savedStyle.videoOpacity;
        videoEl.style.touchAction = savedStyle.videoTouchAction;
    }

    if (playerEl && savedStyle) playerEl.style.overflow = savedStyle.playerOverflow;

    if (fullscreenEl && savedStyle) {
        fullscreenEl.style.overflow = savedStyle.rootOverflow;
        fullscreenEl.style.touchAction = savedStyle.rootTouchAction;
    }

    fullscreenEl = null;
    videoEl = null;
    targetEl = null;
    playerEl = null;
    zoomed = false;
    currentMode = 0;
    savedStyle = null;
    pinchStartDist = null;
    gestureDone = false;
    pointers.clear();
}

// ---- Fullscreen lifecycle --------------------------------------------
function onFullscreenChange() {
    const root = currentFullscreenElement();

    if (root) {
        if (fullscreenEl) teardown();
        setup(root);
    } else if (fullscreenEl) {
        if (zoomed) applyZoom(0);
        teardown();
    }
}

// ---- Force viewport-fit=cover ----------------------------------------
function forceViewportFitCover() {
    let meta = document.querySelector('meta[name="viewport"]');

    if (meta) {
        let content = meta.getAttribute('content') || '';
        content = content.replace(/viewport-fit\s*=\s*[^,;\s]+/gi, '')
                         .replace(/,\s*,/g, ',')
                         .replace(/^,|,$/g, '')
                         .trim();

        meta.setAttribute('content', (content ? content + ', ' : '') + 'viewport-fit=cover');
    } else {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
        (document.head || document.documentElement).appendChild(meta);
    }
}

// ---- Boot ------------------------------------------------------------
chrome.storage.sync.get(
    { mode: 'deny', allowList: [], denyList: [], capTaller: true, capWider: true },
    (settings) => {
        if (!isSiteEnabled(settings)) return;

        capTallerLimit = settings.capTaller;
        capWiderLimit = settings.capWider;

        forceViewportFitCover();

        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        document.addEventListener('contextmenu', onContextMenu, true);

        if (currentFullscreenElement()) onFullscreenChange();
    }
);

// ---- Keyboard Shortcuts Handler --------------------------------------
function handleShortcut(type) {
    if (!videoEl || !isDesktop) return;

    const isFillPresent = currentMode === 1 || (currentMode === 0 && !(is16x9Video && is16x9Screen));
    const isLetterboxPresent = currentMode === 2 || (currentMode === 0 && is16x9Video && (is16x9Screen || isTallerHorizontalScreen));

    if (type === 'fill' && isFillPresent) {
        applyZoom(currentMode === 1 ? 0 : 1);
    } else if (type === 'letterbox' && isLetterboxPresent) {
        applyZoom(currentMode === 2 ? 0 : 2);
    }
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'fill-screen') {
        handleShortcut('fill');
    } else if (request.action === 'remove-letterbox') {
        handleShortcut('letterbox');
    }
});

})();
