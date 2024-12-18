// popup.js

document.addEventListener('DOMContentLoaded', function() {
  const urlListDiv = document.getElementById('urlList');
  const clearButton = document.getElementById('clearButton');
  const downloadButton = document.getElementById('downloadButton');
  const manualDownloadButton = document.getElementById('manualDownloadButton');
  const manualUrlInput = document.getElementById('manualUrl');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar').firstElementChild;
  const progressPercent = document.getElementById('progressPercent');

  let currentTabId = null;

  // Get the active tab ID
  function getActiveTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) {
        callback(null);
        return;
      }
      callback(tabs[0].id);
    });
  }

  // Load URLs for the active tab and display them
  function loadUrls() {
    getActiveTab(function(tabId) {
      if (tabId === null) {
        urlListDiv.innerHTML = 'No active tab.';
        return;
      }
      currentTabId = tabId;
      chrome.runtime.sendMessage({ type: "get_urls", tabId: tabId }, function(response) {
        const urls = response.urls;
        if (urls.length === 0) {
          urlListDiv.innerHTML = 'No URLs detected.';
          return;
        }
        urlListDiv.innerHTML = '';
        urls.forEach(function(url) {
          addUrlToList(url);
        });
      });
    });
  }

  // Add a single URL to the list
  function addUrlToList(url) {
    const div = document.createElement('div');
    div.className = 'url-item';
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.className = 'url-link';
    div.appendChild(link);
    urlListDiv.appendChild(div);
  }

  loadUrls();

  // Listen for new URLs and download progress from background
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === "new_url" && request.tabId === currentTabId) {
      addUrlToList(request.url);
    } else if (request.type === "download_progress") {
      updateProgressBar(request.downloadState);
    }
  });

  // Clear all URLs for the active tab
  clearButton.addEventListener('click', function() {
    if (currentTabId === null) {
      alert('No active tab.');
      return;
    }
    chrome.runtime.sendMessage({ type: "clear_urls", tabId: currentTabId }, function(response) {
      if (response && response.success) {
        urlListDiv.innerHTML = 'No URLs detected.';
        resetProgressBar(); // Reset the progress bar
      }
    });
  });

  // Download all URLs for the active tab
  downloadButton.addEventListener('click', function() {
    if (currentTabId === null) {
      alert('No active tab.');
      return;
    }
    chrome.runtime.sendMessage({ type: "get_urls", tabId: currentTabId }, function(response) {
      const urls = response.urls;
      if (urls.length === 0) {
        alert('No URLs to download.');
        return;
      }
      initiateDownload(urls);
    });
  });

  // Manual download of a specific URL
  manualDownloadButton.addEventListener('click', function() {
    const url = manualUrlInput.value.trim();
    if (url === '') {
      alert('Please enter a URL.');
      return;
    }
    initiateDownload([url]);
    manualUrlInput.value = '';
  });

  // Function to initiate downloads
  function initiateDownload(urls) {
    chrome.runtime.sendMessage({ type: "initiate_download", urls: urls }, function(response) {
      if (response && response.success) {
        showProgressBar();
      }
    });
  }

  // Show the progress bar
  function showProgressBar() {
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
  }

  // Reset and hide the progress bar
  function resetProgressBar() {
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
  }

  // Update the progress bar based on downloadState
  function updateProgressBar(downloadState) {
    if (downloadState.total === 0) {
      // No active downloads
      resetProgressBar();
      return;
    }
    const percent = downloadState.total > 0 ? Math.round((downloadState.completed / downloadState.total) * 100) : 0;
    progressBar.style.width = percent + '%';
    progressPercent.textContent = percent + '%';
    if (downloadState.completed === downloadState.total) {
      // All downloads completed
      setTimeout(function() {
        resetProgressBar();
        loadUrls();
      }, 1000);
    }
  }

  // Fetch and display current download progress when popup is opened
  function fetchDownloadProgress() {
    chrome.runtime.sendMessage({ type: "get_download_progress" }, function(response) {
      const downloadState = response.downloadState;
      if (downloadState.total > 0) {
        showProgressBar();
        updateProgressBar(downloadState);
      } else {
        resetProgressBar();
      }
    });
  }

  fetchDownloadProgress();
});
