// background.js

const MAX_CONCURRENT_DOWNLOADS = 5; // Increased concurrency limit for faster downloads

let isDetecting = false;
let requestUrls = new Set();
let activeTabId = null;

// Download Queue
let downloadQueue = [];
let activeDownloads = 0;
let downloadedCount = 0;
let totalFiles = 0;
let isDownloading = false;

// Manual Download Queue
let manualDownloadQueue = [];
let activeManualDownloads = 0;

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startDetecting') {
        if (!isDetecting) {
            isDetecting = true;
            requestUrls.clear();
            activeTabId = message.tabId;
            // Add webRequest listener scoped to the active tab
            chrome.webRequest.onCompleted.addListener(
                handleRequest,
                { urls: ["<all_urls>"], tabId: activeTabId }
            );
            // Persist state
            chrome.storage.local.set({ isDetecting, activeTabId });
            sendResponse({ status: 'detecting' });
        } else {
            sendResponse({ status: 'already_detecting' });
        }
    } else if (message.action === 'stopDetecting') {
        if (isDetecting) {
            chrome.webRequest.onCompleted.removeListener(handleRequest);
            isDetecting = false;
            activeTabId = null;
            // Persist state
            chrome.storage.local.set({ isDetecting, activeTabId });
            sendResponse({ status: 'stopped' });
        } else {
            sendResponse({ status: 'not_detecting' });
        }
    } else if (message.action === 'getRequests') {
        sendResponse({ requests: Array.from(requestUrls) });
    } else if (message.action === 'clearRequests') {
        requestUrls.clear();
        sendResponse({ status: 'cleared' });
    } else if (message.action === 'getState') {
        sendResponse({ isDetecting, activeTabId, isDownloading, downloadedCount, totalFiles });
    } else if (message.action === 'startDownload') {
        if (!isDownloading && requestUrls.size > 0) {
            isDownloading = true;
            downloadedCount = 0;
            totalFiles = requestUrls.size;
            downloadQueue = Array.from(requestUrls);
            chrome.storage.local.set({ isDownloading, downloadedCount, totalFiles, downloadQueue });
            processQueue();
            sendResponse({ status: 'download_started' });
        } else {
            sendResponse({ status: 'download_not_started' });
        }
    } else if (message.action === 'stopDownload') {
        if (isDownloading) {
            isDownloading = false;
            downloadQueue = [];
            // Note: Ongoing downloads cannot be cancelled via the downloads API
            chrome.storage.local.set({ isDownloading, downloadedCount, totalFiles, downloadQueue });
            sendResponse({ status: 'download_stopped' });
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Cloning Stopped',
                message: `Cloning was stopped by the user.`,
                priority: 1
            });
        } else {
            sendResponse({ status: 'download_not_active' });
        }
    } else if (message.action === 'manualDownload') {
        const url = message.url;
        if (url && isValidUrl(url)) {
            manualDownloadQueue.push(url);
            processManualQueue();
            sendResponse({ status: 'manual_download_started', url });
        } else {
            sendResponse({ status: 'invalid_url' });
        }
    }
    return true; // Keep the message channel open for sendResponse
});

function handleRequest(details) {
    // Exclude data URLs and chrome-extension URLs
    if (!details.url.startsWith('data:') && !details.url.startsWith('chrome-extension://')) {
        requestUrls.add(details.url);
    }
}

// Restore state on startup
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get(['isDetecting', 'activeTabId', 'isDownloading', 'downloadedCount', 'totalFiles', 'downloadQueue'], (result) => {
        isDetecting = result.isDetecting || false;
        activeTabId = result.activeTabId || null;
        isDownloading = result.isDownloading || false;
        downloadedCount = result.downloadedCount || 0;
        totalFiles = result.totalFiles || 0;
        downloadQueue = result.downloadQueue || Array.from(requestUrls);

        if (isDetecting && activeTabId !== null) {
            chrome.webRequest.onCompleted.addListener(
                handleRequest,
                { urls: ["<all_urls>"], tabId: activeTabId }
            );
        }

        if (isDownloading) {
            processQueue();
        }
    });
});

// Function to process the download queue with concurrency control
function processQueue() {
    while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0 && isDownloading) {
        const url = downloadQueue.shift();
        activeDownloads += 1;
        downloadFile(url).then(() => {
            activeDownloads -= 1;
            downloadedCount += 1;
            chrome.storage.local.set({ downloadedCount, downloadQueue });
            // Notify popup of progress
            chrome.runtime.sendMessage({ action: 'downloadProgress', downloadedCount, totalFiles });
            if (downloadedCount === totalFiles) {
                isDownloading = false;
                chrome.storage.local.set({ isDownloading, downloadedCount, totalFiles, downloadQueue: [] });
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: 'Cloning Finished',
                    message: `Successfully cloned ${downloadedCount} files.`,
                    priority: 1
                });
                // Reset button text by notifying popup
                chrome.runtime.sendMessage({ action: 'downloadComplete' });
            } else {
                processQueue();
            }
        }).catch((error) => {
            console.error(`Failed to download ${url}:`, error);
            activeDownloads -= 1;
            downloadedCount += 1;
            chrome.storage.local.set({ downloadedCount, downloadQueue });
            // Notify popup of progress
            chrome.runtime.sendMessage({ action: 'downloadProgress', downloadedCount, totalFiles });
            if (downloadedCount === totalFiles) {
                isDownloading = false;
                chrome.storage.local.set({ isDownloading, downloadedCount, totalFiles, downloadQueue: [] });
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: 'Cloning Finished',
                    message: `Successfully cloned ${downloadedCount} files.`,
                    priority: 1
                });
                // Reset button text by notifying popup
                chrome.runtime.sendMessage({ action: 'downloadComplete' });
            } else {
                processQueue();
            }
        });
    }
}

// Function to process manual download queue with concurrency control
function processManualQueue() {
    while (activeManualDownloads < MAX_CONCURRENT_DOWNLOADS && manualDownloadQueue.length > 0) {
        const url = manualDownloadQueue.shift();
        activeManualDownloads += 1;
        downloadFile(url).then(() => {
            activeManualDownloads -= 1;
            // Notify popup of manual download completion
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Manual Download Finished',
                message: `Successfully downloaded: ${url}`,
                priority: 1
            });
            processManualQueue();
        }).catch((error) => {
            console.error(`Failed to download ${url}:`, error);
            activeManualDownloads -= 1;
            // Notify popup of manual download failure
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Manual Download Failed',
                message: `Failed to download: ${url}`,
                priority: 1
            });
            processManualQueue();
        });
    }
}

// Function to download a single file
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(url);
            let path = urlObj.pathname;

            if (path.endsWith('/')) {
                path += 'index.html';
            } else if (!path.includes('.')) {
                path += '/index.html';
            }

            // Remove leading '/'
            if (path.startsWith('/')) {
                path = path.substring(1);
            }

            const filename = `cloned-project/${path}`;

            chrome.downloads.download({
                url: url,
                filename: filename,
                conflictAction: 'overwrite',
                saveAs: false
            }, (downloadId) => {
                if (downloadId === undefined) {
                    console.error(`Failed to download: ${url}`);
                    reject(`Failed to download: ${url}`);
                    return;
                }

                // Listen for download completion
                const onChanged = (delta) => {
                    if (delta.id === downloadId) {
                        if (delta.state && delta.state.current === 'complete') {
                            chrome.downloads.onChanged.removeListener(onChanged);
                            resolve();
                        } else if (delta.state && delta.state.current === 'interrupted') {
                            chrome.downloads.onChanged.removeListener(onChanged);
                            reject(`Download interrupted: ${url}`);
                        }
                    }
                };

                chrome.downloads.onChanged.addListener(onChanged);
            });
        } catch (error) {
            console.error(`Invalid URL: ${url}`);
            reject(`Invalid URL: ${url}`);
        }
    });
}

// Helper function to validate URLs
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}
