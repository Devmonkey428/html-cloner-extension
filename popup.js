// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const actionButton = document.getElementById('actionButton');
  const progressContainer = document.getElementById('progressContainer');
  const downloadProgress = document.getElementById('downloadProgress');
  const progressText = document.getElementById('progressText');
  const manualUrlInput = document.getElementById('manualUrl');
  const manualDownloadButton = document.getElementById('manualDownloadButton');

  let currentState = 'start'; // Possible states: start, stopDetecting, download, stopDownloading
  let requests = [];
  let isDownloading = false;

  // Initialize the UI based on stored state
  initializeUI();

  actionButton.addEventListener('click', async () => {
      if (currentState === 'start') {
          await startDetecting();
      } else if (currentState === 'stopDetecting') {
          await stopDetecting();
      } else if (currentState === 'download') {
          await initiateDownload();
      } else if (currentState === 'stopDownloading') {
          await stopDownloading();
      }
  });

  manualDownloadButton.addEventListener('click', async () => {
      const url = manualUrlInput.value.trim();
      if (url === '') {
          alert('Please enter a valid URL.');
          return;
      }

      // Send message to background to start manual download
      chrome.runtime.sendMessage({ action: 'manualDownload', url }, (response) => {
          if (response.status === 'manual_download_started') {
              alert(`Manual download started for: ${response.url}`);
              manualUrlInput.value = '';
          } else if (response.status === 'invalid_url') {
              alert('Invalid URL. Please enter a valid URL.');
          }
      });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'downloadProgress') {
          showProgress(message.downloadedCount, message.totalFiles);
      } else if (message.action === 'downloadComplete') {
          resetUI();
      }
  });

  async function initializeUI() {
      // Get current state from background
      chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
          if (response.isDetecting) {
              currentState = 'stopDetecting';
              actionButton.textContent = 'Stop Detecting';
          } else if (response.isDownloading) {
              currentState = 'stopDownloading';
              actionButton.textContent = 'Stop Downloading';
              showProgress(response.downloadedCount, response.totalFiles);
          } else {
              // Check if there are requests ready for download
              chrome.runtime.sendMessage({ action: 'getRequests' }, (resp) => {
                  if (resp.requests && resp.requests.length > 0) {
                      currentState = 'download';
                      actionButton.textContent = 'Download';
                  } else {
                      currentState = 'start';
                      actionButton.textContent = 'Start Detecting';
                  }
              });
          }
      });

      // Listen for download progress updates
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message.action === 'downloadProgress') {
              showProgress(message.downloadedCount, message.totalFiles);
          } else if (message.action === 'downloadComplete') {
              resetUI();
          }
      });
  }

  async function startDetecting() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
          alert('No active tab found.');
          return;
      }

      // Clear caches by reloading the page without cache
      chrome.tabs.reload(tab.id, { bypassCache: true }, () => {
          // Send message to background to start detecting
          chrome.runtime.sendMessage({ action: 'startDetecting', tabId: tab.id }, (response) => {
              if (response.status === 'detecting') {
                  currentState = 'stopDetecting';
                  actionButton.textContent = 'Stop Detecting';
              } else if (response.status === 'already_detecting') {
                  alert('Already detecting requests.');
              }
          });
      });
  }

  async function stopDetecting() {
      chrome.runtime.sendMessage({ action: 'stopDetecting' }, (response) => {
          if (response.status === 'stopped') {
              currentState = 'download';
              actionButton.textContent = 'Download';
              fetchRequests();
          } else if (response.status === 'not_detecting') {
              alert('Detection was not active.');
          }
      });
  }

  function fetchRequests() {
      chrome.runtime.sendMessage({ action: 'getRequests' }, (response) => {
          requests = response.requests;
          console.log(`Detected ${requests.length} unique requests.`);
          if (requests.length === 0) {
              alert('No files detected to download.');
              currentState = 'start';
              actionButton.textContent = 'Start Detecting';
          }
      });
  }

  async function initiateDownload() {
      if (requests.length === 0) {
          alert('No files detected to download.');
          currentState = 'start';
          actionButton.textContent = 'Start Detecting';
          return;
      }

      const confirmDownload = confirm(`You are about to download ${requests.length} files. Continue?`);
      if (!confirmDownload) return;

      // Send message to background to start download
      chrome.runtime.sendMessage({ action: 'startDownload' }, (response) => {
          if (response.status === 'download_started') {
              currentState = 'stopDownloading';
              actionButton.textContent = 'Stop Downloading';
              showProgress(0, requests.length);
          } else {
              alert('Download could not be started.');
          }
      });
  }

  async function stopDownloading() {
      // Send message to background to stop download
      chrome.runtime.sendMessage({ action: 'stopDownload' }, (response) => {
          if (response.status === 'download_stopped') {
              currentState = 'start';
              actionButton.textContent = 'Start Detecting';
              hideProgress();
          } else {
              alert('Download is not active.');
          }
      });
  }

  function showProgress(downloaded, total) {
      progressContainer.classList.remove('hidden');
      const percent = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
      downloadProgress.value = percent;
      progressText.textContent = `${percent}% (${downloaded}/${total})`;
  }

  function hideProgress() {
      progressContainer.classList.add('hidden');
      downloadProgress.value = 0;
      progressText.textContent = '0% (0/0)';
  }

  function resetUI() {
      currentState = 'start';
      actionButton.textContent = 'Start Detecting';
      hideProgress();
      chrome.runtime.sendMessage({ action: 'clearRequests' }, () => { });
  }
});
