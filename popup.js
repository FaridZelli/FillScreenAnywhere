// ---- Environment Detection (mirrors content.js) -------------------------
function detectIsDesktop() {
    let hasFinePointer = false;
    try {
        hasFinePointer = window.matchMedia &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (e) {
        hasFinePointer = false;
    }
    if (hasFinePointer) return true;
    const w = (window.screen && window.screen.width) || window.innerWidth || 0;
    const h = (window.screen && window.screen.height) || window.innerHeight || 0;
    return Math.min(w, h) >= 480;
}
const isDesktop = detectIsDesktop();
if (!isDesktop) document.documentElement.classList.add('is-mobile');
if (isDesktop) document.documentElement.classList.add('is-desktop');
const $ = (id) => document.getElementById(id);
const defaults = {
    mode: 'deny',
    allowList: [],
    denyList: [],
    capTaller: true,
    capWider: true,
    centerVideos: true,
    pinchGestures: true,
    toggleButtons: true,
    overrideYouTube: true
};
function setMode(mode) {
    $('modeDeny').classList.toggle('active', mode === 'deny');
    $('modeAllow').classList.toggle('active', mode === 'allow');
    $('denyList').style.display = mode === 'deny' ? '' : 'none';
    $('allowList').style.display = mode === 'allow' ? '' : 'none';
    $('listHint').textContent = mode === 'deny'
    ? 'Runs on every website except these.'
    : 'Only runs on these websites.';
}
function save() {
    const mode = $('modeAllow').classList.contains('active') ? 'allow' : 'deny';
    chrome.storage.sync.set({
        mode,
        denyList: $('denyList').value.split('\n').map((v) => v.trim()).filter(Boolean),
        allowList: $('allowList').value.split('\n').map((v) => v.trim()).filter(Boolean),
        capTaller: $('capTaller').checked,
        capWider: $('capWider').checked,
        centerVideos: $('centerVideos').checked,
        pinchGestures: $('pinchGestures').checked,
        toggleButtons: $('toggleButtons').checked,
        overrideYouTube: $('overrideYouTube').checked,
    });
}
chrome.storage.sync.get(defaults, (s) => {
    setMode(s.mode);
    $('denyList').value = s.denyList.join('\n');
    $('allowList').value = s.allowList.join('\n');
    $('capTaller').checked = s.capTaller;
    $('capWider').checked = s.capWider;
    $('centerVideos').checked = s.centerVideos;
    $('pinchGestures').checked = s.pinchGestures;
    $('toggleButtons').checked = s.toggleButtons;
    $('overrideYouTube').checked = s.overrideYouTube;
});
$('modeDeny').addEventListener('click', () => { setMode('deny'); save(); });
$('modeAllow').addEventListener('click', () => { setMode('allow'); save(); });
$('denyList').addEventListener('input', save);
$('allowList').addEventListener('input', save);
$('capTaller').addEventListener('change', save);
$('capWider').addEventListener('change', save);
$('centerVideos').addEventListener('change', save);
$('pinchGestures').addEventListener('change', save);
$('toggleButtons').addEventListener('change', save);
$('overrideYouTube').addEventListener('change', save);
$('restoreDefaults').addEventListener('click', () => {
    chrome.storage.sync.clear(() => {
        chrome.storage.sync.set(defaults, () => {
            setMode(defaults.mode);
            $('denyList').value = '';
            $('allowList').value = '';
            $('capTaller').checked = defaults.capTaller;
            $('capWider').checked = defaults.capWider;
            $('centerVideos').checked = defaults.centerVideos;
            $('pinchGestures').checked = defaults.pinchGestures;
            $('toggleButtons').checked = defaults.toggleButtons;
            $('overrideYouTube').checked = defaults.overrideYouTube;
        });
    });
});
