// Fill Screen Anywhere: popup script.
// It relies on the constants and functions from defaults.js, which popup.html loads first.

// ---- Constants -------------------------------------------------------

// Names the class that popup.html styles for small screens. The name is kept because the selectors in popup.html use it.
const SMALL_SCREEN_CLASS = 'is-small';

// Maps each fill mode value to the identifier of its switch button.
const FILL_MODE_BUTTONS = {
    manual: 'fillModeManual',
    auto: 'fillModeAuto',
    remember: 'fillModeRemember',
};

// Maps each fill mode value to the description shown below its switch.
const FILL_MODE_HINTS = {
    manual: 'Fill the screen manually.',
    auto: 'Fill the screen automatically (up to 1.2× zoom).',
    remember: 'Save and restore the last zoom state.',
};

// Maps each background play value to the identifier of its switch button.
const BACKGROUND_PLAY_BUTTONS = {
    off: 'bgPlayOff',
    everywhere: 'bgPlayEverywhere',
    custom: 'bgPlayCustom',
};

// Maps each background play value to the description shown below its switch or domain list.
const BACKGROUND_PLAY_HINTS = {
    off: 'Do not play videos in the background.',
    everywhere: 'Keep playing videos while using other apps.',
    custom: 'Keep playing videos while using other apps.\nOnly runs on these websites.',
};

// ---- Elements and state ----------------------------------------------

// Returns the element with the given identifier.
const $ = (id) => document.getElementById(id);

// Holds the default settings for this device, which are set once the settings have loaded.
let defaultSettings = null;

// Holds the keys of every on/off setting. Each key is also the identifier of its checkbox.
let toggleKeys = [];

// Holds the currently selected fill mode.
let currentFillMode = DEFAULT_SETTINGS.fillMode;

// Holds the currently selected background play mode.
let currentBackgroundPlay = DEFAULT_SETTINGS.backgroundPlay;

// ---- Interface helpers -----------------------------------------------

// Reads a list textarea and returns its non-empty lines as trimmed entries.
function readList(id) {
    return $(id).value.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Shows the list that belongs to the chosen site list mode and updates the buttons and the hint.
function setMode(mode) {
    $('modeDeny').classList.toggle('active', mode === 'deny');
    $('modeAllow').classList.toggle('active', mode === 'allow');
    $('denyList').style.display = mode === 'deny' ? '' : 'none';
    $('allowList').style.display = mode === 'allow' ? '' : 'none';
    $('listHint').textContent = mode === 'deny'
        ? 'Runs on every website except these.'
        : 'Only runs on these websites.';
}

// Updates the fill mode switch buttons and its description.
function setFillMode(mode) {
    currentFillMode = mode;
    for (const [value, id] of Object.entries(FILL_MODE_BUTTONS)) {
        $(id).classList.toggle('active', value === mode);
    }
    $('fillModeHint').textContent = FILL_MODE_HINTS[mode];
}

// Updates the background play switch buttons, custom domain textarea visibility, and description.
function setBackgroundPlay(mode) {
    currentBackgroundPlay = mode;
    for (const [value, id] of Object.entries(BACKGROUND_PLAY_BUTTONS)) {
        $(id).classList.toggle('active', value === mode);
    }
    $('backgroundPlayList').style.display = mode === 'custom' ? '' : 'none';
    $('backgroundPlayHint').textContent = BACKGROUND_PLAY_HINTS[mode];
}

// Fills every control with the values of a settings object.
function render(settings) {
    setMode(settings.mode);
    $('denyList').value = settings.denyList.join('\n');
    $('allowList').value = settings.allowList.join('\n');
    setFillMode(settings.fillMode);
    setBackgroundPlay(settings.backgroundPlay);
    $('backgroundPlayList').value = settings.backgroundPlayList.join('\n');
    for (const key of toggleKeys) $(key).checked = settings[key];
}

// Saves the state of every control to local storage.
function save() {
    const values = {
        mode: $('modeAllow').classList.contains('active') ? 'allow' : 'deny',
        denyList: readList('denyList'),
        allowList: readList('allowList'),
        fillMode: currentFillMode,
        backgroundPlay: currentBackgroundPlay,
        backgroundPlayList: readList('backgroundPlayList'),
    };
    for (const key of toggleKeys) values[key] = $(key).checked;
    chrome.storage.local.set(values);
}

// ---- Boot ------------------------------------------------------------

// Keeps the page hidden until the screen size decision is known, so that the layout does not jump.
document.documentElement.style.visibility = 'hidden';

// Loads the settings, shows them, and only then starts listening for changes, so that nothing is saved before the real values are shown.
loadSettings((settings, isLargeScreen) => {
    defaultSettings = buildDefaultSettings(isLargeScreen);
    toggleKeys = Object.keys(defaultSettings).filter((key) => typeof defaultSettings[key] === 'boolean');
    document.documentElement.classList.toggle(SMALL_SCREEN_CLASS, !isLargeScreen);
    render(settings);

    // Saves after every change, and updates the active switch state first when a segmented button is clicked.
    $('modeDeny').addEventListener('click', () => { setMode('deny'); save(); });
    $('modeAllow').addEventListener('click', () => { setMode('allow'); save(); });
    $('denyList').addEventListener('input', save);
    $('allowList').addEventListener('input', save);

    for (const [value, id] of Object.entries(FILL_MODE_BUTTONS)) {
        $(id).addEventListener('click', () => { setFillMode(value); save(); });
    }

    for (const [value, id] of Object.entries(BACKGROUND_PLAY_BUTTONS)) {
        $(id).addEventListener('click', () => { setBackgroundPlay(value); save(); });
    }
    $('backgroundPlayList').addEventListener('input', save);

    for (const key of toggleKeys) $(key).addEventListener('change', save);

    // Restores and persists the defaults for the current screen size so later browser restarts never overwrite them.
    $('restoreDefaults').addEventListener('click', () => {
        chrome.storage.local.set(defaultSettings, () => render(defaultSettings));
    });

    document.documentElement.style.visibility = '';
});

// Opens external links in a new browser tab
document.getElementById('openLink').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: e.currentTarget.href });
    window.close();
});
