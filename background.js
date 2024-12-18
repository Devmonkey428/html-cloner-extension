// background.js

// Maximum number of concurrent downloads
const MAX_CONCURRENT_DOWNLOADS = 5;

// Object to store URLs per tab
let tabUrls = {};

// Queue to manage pending downloads
let downloadQueue = [];

// Current number of active downloads
let activeDownloads = 0;

// Array to keep track of active download IDs
let activeDownloadIds = [];

// Object to track download progress
let downloadState = {
  total: 0,
  completed: 0
};

// Flag to prevent multiple notifications
let notificationSent = false;

// Listen to all completed network requests
chrome.webRequest.onCompleted.addListener(
  function(details) {
    // Ignore requests that are not associated with a tab
    if (details.tabId === -1) {
      return;
    }

    const url = details.url;
    const tabId = details.tabId;

    // Initialize array for the tab if it doesn't exist
    if (!tabUrls[tabId]) {
      tabUrls[tabId] = [];
    }

    // Add the URL if it's not already stored
    if (!tabUrls[tabId].includes(url)) {
      tabUrls[tabId].push(url);
      // Update storage
      chrome.storage.local.set({ tabUrls: tabUrls }, function() {
        console.log(`URL added for tab ${tabId}: ${url}`);
      });

      // Notify popup if it's open
      chrome.runtime.sendMessage({
        type: "new_url",
        tabId: tabId,
        url: url
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Clean up stored URLs when a tab is closed
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  if (tabUrls[tabId]) {
    delete tabUrls[tabId];
    chrome.storage.local.set({ tabUrls: tabUrls }, function() {
      console.log(`URLs cleared for closed tab ${tabId}`);
    });
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === "get_urls") {
    const tabId = request.tabId;
    sendResponse({ urls: tabUrls[tabId] || [] });
  } else if (request.type === "clear_urls") {
    const tabId = request.tabId;
    if (tabUrls[tabId]) {
      delete tabUrls[tabId];
      chrome.storage.local.set({ tabUrls: tabUrls }, function() {
        console.log(`URLs cleared for tab ${tabId}`);
        // Cancel all active downloads
        activeDownloadIds.forEach(downloadId => {
          chrome.downloads.cancel(downloadId, function() {
            if (chrome.runtime.lastError) {
              console.error(`Failed to cancel download ID ${downloadId}:`, chrome.runtime.lastError);
            } else {
              console.log(`Download ID ${downloadId} canceled.`);
            }
          });
        });
        // Clear the download queue
        downloadQueue = [];
        // Reset download state
        downloadState = {
          total: 0,
          completed: 0
        };
        activeDownloads = 0;
        activeDownloadIds = [];
        notificationSent = false;
        // Notify popup to reset UI
        chrome.runtime.sendMessage({
          type: "download_progress",
          downloadState: downloadState
        });
        sendResponse({ success: true });
      });
      return true; // Keep the message channel open for sendResponse
    }
  } else if (request.type === "initiate_download") {
    const urls = request.urls;
    enqueueDownloads(urls);
    sendResponse({ success: true });
  } else if (request.type === "get_download_progress") {
    sendResponse({ downloadState: downloadState });
  }
});

// Function to enqueue downloads
function enqueueDownloads(urls) {
  urls.forEach(url => {
    downloadQueue.push(url);
    console.log(`URL enqueued for download: ${url}`);
  });
  processQueue();
}

// Function to process the download queue
function processQueue() {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const url = downloadQueue.shift();
    startDownload(url);
  }
}

// Function to start a single download
function startDownload(url) {
  activeDownloads++;
  downloadState.total++;
  console.log(`Starting download (${downloadState.completed + 1}/${downloadState.total}): ${url}`);
  chrome.runtime.sendMessage({
    type: "download_progress",
    downloadState: downloadState
  });

  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    // Ensure the pathname does not start with a '/'
    if (pathname.startsWith('/')) {
      pathname = pathname.substring(1);
    }

    // Default to 'index.html' if pathname is empty
    if (pathname === '') {
      pathname = 'index.html';
    }

    // Prepend 'cloned-project/' to the pathname to create the directory
    const filename = 'cloned-project/' + pathname;

    chrome.downloads.download(
      {
        url: url,
        filename: filename, // Files will be saved under 'cloned-project/' directory
        saveAs: false
      },
      function(downloadId) {
        if (downloadId === undefined) {
          console.error('Download failed for:', url);
          incrementProgress();
        } else {
          console.log(`Download initiated for ID ${downloadId}: ${url}`);
          // Store the active download ID
          activeDownloadIds.push(downloadId);
        }
      }
    );
  } catch (e) {
    console.error('Invalid URL:', url);
    incrementProgress();
  }
}

// Listen for download completion or interruption
chrome.downloads.onChanged.addListener(function(downloadDelta) {
  if (downloadDelta.state && ['complete', 'interrupted'].includes(downloadDelta.state.current)) {
    console.log(`Download state changed to ${downloadDelta.state.current} for ID ${downloadDelta.id}`);
    incrementProgress(downloadDelta.id);
  }
});

// Function to increment download progress
function incrementProgress(downloadId) {
  downloadState.completed++;
  activeDownloads--;

  // Remove the downloadId from activeDownloadIds
  if (downloadId !== undefined) {
    activeDownloadIds = activeDownloadIds.filter(id => id !== downloadId);
  }

  console.log(`Download completed. (${downloadState.completed}/${downloadState.total})`);
  chrome.runtime.sendMessage({
    type: "download_progress",
    downloadState: downloadState
  });

  if (downloadState.completed === downloadState.total) {
    if (!notificationSent) {
      // Send notification only once
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Download Complete',
        message: 'All files have been downloaded successfully.',
        priority: 1
      }, function(notificationId) {
        console.log('Download completion notification sent.');
      });
      notificationSent = true;
    }

    // Reset download state after a short delay to ensure notification is sent
    setTimeout(function() {
      downloadState = {
        total: 0,
        completed: 0
      };
      notificationSent = false;
      console.log('Download state reset.');
    }, 1000);
  }

  // Process next downloads in the queue
  processQueue();
}

// Initialize storage on startup
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.get(['tabUrls'], function(result) {
    if (!result.tabUrls) {
      chrome.storage.local.set({ tabUrls: {} }, function() {
        console.log('Initialized tabUrls in storage.');
      });
    }
  });
});
