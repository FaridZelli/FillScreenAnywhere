// Fill Screen Anywhere: background script.
// The commands API is missing on Firefox for Android, so the listener is only added where the API exists.

if (chrome.commands) {
    chrome.commands.onCommand.addListener((command) => {
        if (command === "fill-screen" || command === "remove-letterbox") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;

                // Reads the last error to suppress it when the page has no content script to receive the message.
                chrome.tabs.sendMessage(tabs[0].id, { command }, () => {
                    void chrome.runtime.lastError;
                });
            });
        }
    });
}
