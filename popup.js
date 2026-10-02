// Fill Screen Anywhere: popup script.
// It relies on the constants and functions from defaults.js, which popup.html loads first.

// ---- Constants -------------------------------------------------------

// Names the class that popup.html styles for small screens. The name is kept because the selectors in popup.html use it.
const SMALL_SCREEN_CLASS = 'is-small';

// ---- Elements and state ----------------------------------------------

// Returns the element with the given identifier.
const $ = (id) => document.getElementById(id);

// Holds the default settings for this device, which are set once the settings have loaded.
let defaultSettings = null;

// Holds the keys of every on/off setting. Each key is also the identifier of its checkbox.
let toggleKeys = [];

// ---- Interface helpers -----------------------------------------------

// Reads a list textarea and returns its non-empty lines as trimmed entries.
function readList(id) {
    return $(id).value.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Shows the list that belongs to the chosen mode and updates the buttons and the hint.
function setMode(mode) {
    $('modeDeny').classList.toggle('active', mode === 'deny');
    $('modeAllow').classList.toggle('active', mode === 'allow');
    $('denyList').style.display = mode === 'deny' ? '' : 'none';
    $('allowList').style.display = mode === 'allow' ? '' : 'none';
    $('listHint').textContent = mode === 'deny'
        ? 'Runs on every website except these.'
        : 'Only runs on these websites.';
}

// Fills every control with the values of a settings object.
function render(settings) {
    setMode(settings.mode);
    $('denyList').value = settings.denyList.join('\n');
    $('allowList').value = settings.allowList.join('\n');
    for (const key of toggleKeys) $(key).checked = settings[key];
}

// Saves the state of every control to local storage.
function save() {
    const values = {
        mode: $('modeAllow').classList.contains('active') ? 'allow' : 'deny',
        denyList: readList('denyList'),
        allowList: readList('allowList'),
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

    // Saves after every change, and switches the list mode first when one of the mode buttons is clicked.
    $('modeDeny').addEventListener('click', () => { setMode('deny'); save(); });
    $('modeAllow').addEventListener('click', () => { setMode('allow'); save(); });
    $('denyList').addEventListener('input', save);
    $('allowList').addEventListener('input', save);
    for (const key of toggleKeys) $(key).addEventListener('change', save);

    // Removes every stored setting, which brings back the defaults but keeps the saved screen size decision.
    $('restoreDefaults').addEventListener('click', () => {
        chrome.storage.local.remove(Object.keys(defaultSettings), () => render(defaultSettings));
    });

    document.documentElement.style.visibility = '';
});
