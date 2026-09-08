chrome.commands.onCommand.addListener((command) => {
    if (command === "fill-screen" || command === "remove-letterbox") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                // Send message to content script; catch errors if script isn't loaded
                chrome.tabs.sendMessage(tabs[0].id, { action: command }, () => {
                    if (chrome.runtime.lastError) {
                        // Suppress connection errors when content script isn't active on the page
                    }
                });
            }
        });
    }
});
