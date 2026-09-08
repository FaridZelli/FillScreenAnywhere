// ---- Environment Detection (mirrors content.js) -------------------------
const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
                  (!('ontouchstart' in window) && navigator.maxTouchPoints === 0);

if (!isDesktop) document.documentElement.classList.add('is-mobile');

const $ = (id) => document.getElementById(id);
const defaults = { mode: 'deny', allowList: [], denyList: [], capTaller: true, capWider: true };

function setMode(mode) {
    $('modeDeny').classList.toggle('active', mode === 'deny');
    $('modeAllow').classList.toggle('active', mode === 'allow');
    $('denyList').style.display = mode === 'deny' ? '' : 'none';
    $('allowList').style.display = mode === 'allow' ? '' : 'none';
    $('listHint').textContent = mode === 'deny'
        ? 'Runs on every site except these.'
        : 'Only runs on these sites.';
}

function save() {
    const mode = $('modeAllow').classList.contains('active') ? 'allow' : 'deny';
    chrome.storage.sync.set({
        mode,
        denyList: $('denyList').value.split('\n').map((v) => v.trim()).filter(Boolean),
        allowList: $('allowList').value.split('\n').map((v) => v.trim()).filter(Boolean),
        capTaller: $('capTaller').checked,
        capWider: $('capWider').checked,
    });
}

chrome.storage.sync.get(defaults, (s) => {
    setMode(s.mode);
    $('denyList').value = s.denyList.join('\n');
    $('allowList').value = s.allowList.join('\n');
    $('capTaller').checked = s.capTaller;
    $('capWider').checked = s.capWider;
});

$('modeDeny').addEventListener('click', () => { setMode('deny'); save(); });
$('modeAllow').addEventListener('click', () => { setMode('allow'); save(); });
$('denyList').addEventListener('input', save);
$('allowList').addEventListener('input', save);
$('capTaller').addEventListener('change', save);
$('capWider').addEventListener('change', save);

$('restoreDefaults').addEventListener('click', () => {
    chrome.storage.sync.clear(() => {
        setMode(defaults.mode);
        $('denyList').value = '';
        $('allowList').value = '';
        $('capTaller').checked = defaults.capTaller;
        $('capWider').checked = defaults.capWider;
    });
});
