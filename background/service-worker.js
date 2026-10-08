/**
 * Service Worker (Background Script)
 * Handles extension lifecycle and message passing
 */

// Debug mode - set to false for production
const DEBUG = true;
const log = (...args) => DEBUG && console.log(...args);

import {
  initializeStorage,
  getSelectedServer,
  getServerById,
  getSettings,
  updateState,
  getState,
  addProxyDomain,
  removeProxyDomain,
  getProxyDomains,
  getNoProxyDomains,  // NEW
  addNoProxyDomain,  // NEW
  removeNoProxyDomain,  // NEW
  updateSettings,
  getServers,
  updateServers
} from './storage-manager.js';

import {
  enableProxy,
  disableProxy,
  updateProxyConfig
} from './proxy-manager.js';

// Initialize storage on extension install
chrome.runtime.onInstalled.addListener(async (details) => {
  log('[Service Worker] Extension installed:', details.reason);
  await initializeStorage();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  log('[Service Worker] Extension started');
  await initializeStorage();
});

/**
 * Handle connect action
 */
async function handleConnect() {
  log('[Service Worker] handleConnect called');
  try {
    const server = await getSelectedServer();
    const proxyDomains = await getProxyDomains();
    const noProxyDomains = await getNoProxyDomains();
    const settings = await getSettings();
    const globalMode = settings.globalMode || false;

    log('[Service Worker] Selected server:', server);
    log('[Service Worker] Proxy domains:', proxyDomains);
    log('[Service Worker] No-proxy domains:', noProxyDomains);
    log('[Service Worker] Global mode:', globalMode);

    if (!server) {
      throw new Error('No server selected');
    }

    // Validate server configuration
    if (!server.host || !server.port) {
      throw new Error('Server configuration incomplete');
    }

    log('[Service Worker] Calling enableProxy with server:', server);
    const result = await enableProxy(server, proxyDomains, globalMode, noProxyDomains);

    if (!result.success) {
      throw new Error(result.error || 'Failed to enable proxy');
    }

    // Wait for Chrome to apply proxy settings (critical for SOCKS5)
    log('[Service Worker] Waiting for proxy settings to apply...');
    log('[Service Worker] Proxy config: %s://%s:%s', server.protocol, server.host, server.port);
    const delayStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    log('[Service Worker] Proxy settings applied (waited %dms)', Date.now() - delayStart);

    await updateState({
      isConnected: true,
      lastConnectedServer: server
    });

    // Update icon to connected state
    await updateIcon(true);

    log('[Service Worker] ========================================');
    log('[Service Worker] ✓ Successfully connected to proxy!');
    log('[Service Worker] Server: %s (%s://%s:%s)', server.name, server.protocol, server.host, server.port);
    log('[Service Worker] Global mode: %s', globalMode);
    log('[Service Worker] ========================================');
    return { success: true, server };

  } catch (error) {
    console.error('[Service Worker] ========================================');
    console.error('[Service Worker] ✗ Connect FAILED:', error.message);
    console.error('[Service Worker] Error details:', error);
    console.error('[Service Worker] ========================================');

    // Ensure proxy is disabled on failure
    try {
      await disableProxy();
      await updateState({
        isConnected: false
      });
      await updateIcon(false);
    } catch (cleanupError) {
      console.error('[Service Worker] Failed to cleanup after connect failure:', cleanupError);
    }

    return { success: false, error: error.message };
  }
}

/**
 * Handle disconnect action
 */
async function handleDisconnect() {
  try {
    const result = await disableProxy();

    if (result.success) {
      await updateState({
        isConnected: false
      });

      // Update icon to disconnected state
      await updateIcon(false);

      return { success: true };
    } else {
      throw new Error(result.error || 'Failed to disable proxy');
    }

  } catch (error) {
    console.error('[Service Worker] Disconnect failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update extension badge based on connection state
 */
async function updateIcon(isConnected) {
  try {
    // Use badge text instead of dynamic icons (more reliable)
    await chrome.action.setBadgeText({
      text: isConnected ? 'ON' : ''
    });
    await chrome.action.setBadgeBackgroundColor({
      color: isConnected ? '#34a853' : '#000000'
    });
    log('[Service Worker] Badge updated:', isConnected ? 'ON' : 'OFF');
  } catch (error) {
    console.warn('[Service Worker] Failed to update badge:', error);
  }
}

/**
 * Handle adding current tab's domain to proxy list
 */
async function handleAddCurrentDomain() {
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      throw new Error('No active tab found');
    }

    const url = new URL(tab.url);
    const domain = url.hostname;

    const added = await addProxyDomain(domain);

    if (added) {
      // Update proxy configuration if connected
      const server = await getSelectedServer();
      const proxyDomains = await getProxyDomains();
      const settings = await getSettings();
      const globalMode = settings.globalMode || false;
      await updateProxyConfig(server, proxyDomains, globalMode);
      return { success: true, domain };
    } else {
      return { success: false, error: 'Domain already in list' };
    }

  } catch (error) {
    console.error('[Service Worker] Failed to add domain:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current tab's domain
 */
async function handleGetCurrentTabDomain() {
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      return { success: false, error: 'No active tab found' };
    }

    const url = new URL(tab.url);
    const domain = url.hostname;

    log('[Service Worker] Current tab domain:', domain);
    return { success: true, domain };

  } catch (error) {
    console.error('[Service Worker] Failed to get current tab domain:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update server credentials
 */
async function handleUpdateServerCredentials(serverId, username, password) {
  try {
    const servers = await getServers();
    const serverIndex = servers.findIndex(s => s.id === serverId);

    if (serverIndex === -1) {
      return { success: false, error: 'Server not found' };
    }

    servers[serverIndex].username = username;
    servers[serverIndex].password = password;

    await updateServers(servers);

    log('[Service Worker] Updated credentials for server:', serverId);
    return { success: true };

  } catch (error) {
    console.error('[Service Worker] Failed to update server credentials:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save server list, keep the selected server valid and
 * re-apply proxy config if connected (selected server may have changed)
 */
async function handleUpdateServers(servers) {
  await updateServers(servers);

  const settings = await getSettings();
  if (!servers.some(s => s.id === settings.selectedServerId)) {
    const fallback = servers.find(s => s.enabled) || servers[0];
    await updateSettings({ selectedServerId: fallback ? fallback.id : null });
  }

  const state = await getState();
  if (state.isConnected) {
    const server = await getSelectedServer();
    if (server) {
      const proxyDomains = await getProxyDomains();
      const noProxyDomains = await getNoProxyDomains();
      await updateProxyConfig(server, proxyDomains, settings.globalMode || false, noProxyDomains);
    } else {
      await handleDisconnect();
    }
  }
}

/**
 * Test proxy connection by making a request through it
 */
async function testProxyConnection(server, timeout = 10000) {
  return new Promise((resolve) => {
    log('[Service Worker] testProxyConnection: Starting test...');
    log('[Service Worker] testProxyConnection: Server=%s://%s:%s, Timeout=%dms',
        server.protocol, server.host, server.port, timeout);

    const controller = new AbortController();
    const fetchStart = Date.now();

    const timeoutId = setTimeout(() => {
      const elapsed = Date.now() - fetchStart;
      log('[Service Worker] testProxyConnection: TIMEOUT after %dms', elapsed);
      controller.abort();
      resolve(false);
    }, timeout);

    // Use fetch with proxy settings - this will use the configured Chrome proxy
    // Use HTTPS for better SOCKS5 compatibility
    log('[Service Worker] testProxyConnection: Sending fetch request...');
    fetch('https://www.google.com/generate_204', {
      method: 'GET',
      signal: controller.signal,
      // Fetch will use Chrome's proxy settings automatically
    })
    .then(response => {
      const elapsed = Date.now() - fetchStart;
      clearTimeout(timeoutId);

      log('[Service Worker] testProxyConnection: Got response in %dms', elapsed);
      log('[Service Worker] testProxyConnection: Status=%d, OK=%s', response.status, response.ok);

      // Check if we got a valid response
      if (response.ok || response.status === 204) {
        log('[Service Worker] testProxyConnection: SUCCESS - Valid response received');
        resolve(true);
      } else {
        log('[Service Worker] testProxyConnection: FAILED - Invalid status code');
        resolve(false);
      }
    })
    .catch(error => {
      const elapsed = Date.now() - fetchStart;
      clearTimeout(timeoutId);

      log('[Service Worker] testProxyConnection: ERROR after %dms', elapsed);
      log('[Service Worker] testProxyConnection: Error name=%s, message=%s', error.name, error.message);

      // Check if this is a timeout or network error
      if (error.name === 'AbortError') {
        log('[Service Worker] testProxyConnection: Request was aborted (timeout)');
      } else if (error.name === 'TypeError') {
        log('[Service Worker] testProxyConnection: Network error (proxy may be unreachable)');
      } else {
        log('[Service Worker] testProxyConnection: Unknown error type');
      }

      // For invalid proxy servers (like example.com), this will fail
      // which is what we want - it means the proxy isn't working
      resolve(false);
    });
  });
}

/**
 * Handle test proxy connection request from settings page
 */
async function handleTestProxyConnection(server) {
  log('[Service Worker] Testing proxy connection:', server);

  try {
    if (!server || !server.host || !server.port) {
      return { success: false, error: 'Invalid server configuration' };
    }

    // Check if server looks like localhost/private IP
    const isLocalServer =
      server.host === '127.0.0.1' ||
      server.host === 'localhost' ||
      server.host.startsWith('192.168.') ||
      server.host.startsWith('10.') ||
      server.host.startsWith('172.16.') ||
      server.host.startsWith('172.17.') ||
      server.host.startsWith('172.18.') ||
      server.host.startsWith('172.19.') ||
      (server.host.startsWith('172.2') && parseInt(server.host.split('.')[1]) >= 20 && parseInt(server.host.split('.')[1]) <= 29) ||
      server.host.startsWith('172.30.') ||
      server.host.startsWith('172.31.');

    // For local SOCKS5 proxies, assume they're working if the host is reachable
    if (isLocalServer && server.protocol === 'socks5') {
      log('[Service Worker] Local SOCKS5 proxy detected - skipping fetch test (known limitation)');
      return {
        success: true,
        message: '配置已验证（本地SOCKS5代理）',
        note: 'Service Worker无法测试SOCKS5代理，但配置正确。请访问代理域名验证连接。'
      };
    }

    // For non-local or non-SOCKS5, attempt the test
    log('[Service Worker] Attempting proxy connection test...');
    const testResult = await testProxyConnection(server, 10000);

    if (testResult) {
      log('[Service Worker] Proxy test succeeded');
      return { success: true, message: '连接测试成功' };
    } else {
      log('[Service Worker] Proxy test failed');
      return {
        success: false,
        error: 'Connection test timed out',
        note: '注意：Service Worker的fetch()无法通过代理。即使测试失败，代理可能仍然正常工作。请尝试访问代理域名验证。'
      };
    }

  } catch (error) {
    console.error('[Service Worker] Proxy test error:', error);
    return {
      success: false,
      error: error.message,
      note: '注意：测试失败不一定代表代理不工作。请尝试访问代理域名验证。'
    };
  }
}

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('[Service Worker] Received message:', message.action, message);

  switch (message.action) {
    case 'connect':
      handleConnect().then(sendResponse);
      return true; // Keep channel open for async response

    case 'disconnect':
      handleDisconnect().then(sendResponse);
      return true;

    case 'getState':
      getState().then(sendResponse);
      return true;

    case 'getSettings':
      getSettings().then(sendResponse);
      return true;

    case 'updateSettings':
      updateSettings(message.settings)
        .then(async () => {
          // Update proxy config if settings changed
          const server = await getSelectedServer();
          const proxyDomains = await getProxyDomains();
          const noProxyDomains = await getNoProxyDomains();
          const settings = await getSettings();
          const globalMode = settings.globalMode || false;
          return updateProxyConfig(server, proxyDomains, globalMode, noProxyDomains);
        })
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getServers':
      getServers().then(sendResponse);
      return true;

    case 'updateServers':
      handleUpdateServers(message.servers)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getProxyDomains':
      getProxyDomains().then(sendResponse);
      return true;

    case 'addProxyDomain':
      addProxyDomain(message.domain)
        .then(async (added) => {
          if (added) {
            const server = await getSelectedServer();
            const proxyDomains = await getProxyDomains();
            const noProxyDomains = await getNoProxyDomains();
            const settings = await getSettings();
            const globalMode = settings.globalMode || false;
            return updateProxyConfig(server, proxyDomains, globalMode, noProxyDomains).then(() => ({ success: true, domain: message.domain }));
          } else {
            return { success: false, error: 'Domain already exists' };
          }
        })
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'removeProxyDomain':
      removeProxyDomain(message.domain)
        .then(async () => {
          const server = await getSelectedServer();
          const proxyDomains = await getProxyDomains();
          const noProxyDomains = await getNoProxyDomains();
          const settings = await getSettings();
          const globalMode = settings.globalMode || false;
          return updateProxyConfig(server, proxyDomains, globalMode, noProxyDomains);
        })
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getNoProxyDomains':  // NEW
      getNoProxyDomains().then(sendResponse);
      return true;

    case 'addNoProxyDomain':  // NEW
      addNoProxyDomain(message.domain)
        .then(async (added) => {
          if (added) {
            const server = await getSelectedServer();
            const proxyDomains = await getProxyDomains();
            const noProxyDomains = await getNoProxyDomains();
            const settings = await getSettings();
            const globalMode = settings.globalMode || false;
            // Update proxy config with both proxy and no-proxy domains
            return updateProxyConfig(server, proxyDomains, globalMode, noProxyDomains).then(() => ({ success: true, domain: message.domain }));
          } else {
            return { success: false, error: 'Domain already exists' };
          }
        })
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'removeNoProxyDomain':  // NEW
      removeNoProxyDomain(message.domain)
        .then(async () => {
          const server = await getSelectedServer();
          const proxyDomains = await getProxyDomains();
          const noProxyDomains = await getNoProxyDomains();
          const settings = await getSettings();
          const globalMode = settings.globalMode || false;
          // Update proxy config with both proxy and no-proxy domains
          return updateProxyConfig(server, proxyDomains, globalMode, noProxyDomains);
        })
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'addCurrentDomain':
      handleAddCurrentDomain().then(sendResponse);
      return true;

    case 'getSelectedServer':
      getSelectedServer().then(sendResponse);
      return true;

    case 'getServerById':
      getServerById(message.serverId).then(sendResponse);
      return true;

    case 'updateServerCredentials':
      handleUpdateServerCredentials(message.serverId, message.username, message.password)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getCurrentTabDomain':
      handleGetCurrentTabDomain().then(sendResponse);
      return true;

    case 'testProxyConnection':
      handleTestProxyConnection(message.server).then(sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

/**
 * Blocked-domain detector
 * When connected in domain-list mode, requests made by a page whose domain is in
 * the proxy list, that went DIRECT and failed with a connection timeout/reset
 * (typical GFW behavior), get their domain auto-added to the proxy list.
 */
const BLOCKED_ERRORS = new Set([
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_TIMED_OUT',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED'
]);
const BLOCK_THRESHOLD = 2;              // failures needed before auto-adding
const BLOCK_WINDOW_MS = 2 * 60 * 1000;  // ...within this time window
const blockFailures = new Map();        // domain -> [timestamps]
let autoAddQueue = Promise.resolve();   // serialize storage writes

// Second-level labels used under country TLDs, e.g. google.com.sg, bbc.co.uk
const SECOND_LEVEL_LABELS = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/**
 * Reduce a hostname to its registrable domain: i.ytimg.com -> ytimg.com,
 * www.google.com.sg -> google.com.sg
 */
function getBaseDomain(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL_LABELS.has(sld) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

function matchesDomainList(host, domains) {
  return domains.some(d => host === d || host.endsWith('.' + d));
}

function isLocalHost(host) {
  return host === 'localhost' ||
    !host.includes('.') ||
    host.endsWith('.local') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||  // raw IPs: can't tell what to add
    host.includes(':');                   // IPv6 literal
}

async function handleRequestError(details) {
  if (!BLOCKED_ERRORS.has(details.error)) return;

  let host;
  try {
    host = new URL(details.url).hostname.toLowerCase();
  } catch {
    return;
  }
  if (isLocalHost(host)) return;

  const [state, settings] = await Promise.all([getState(), getSettings()]);
  if (!state.isConnected || settings.globalMode || !settings.autoAddBlocked) return;

  // Only care about requests that went DIRECT
  const [proxyDomains, noProxyDomains] = await Promise.all([getProxyDomains(), getNoProxyDomains()]);
  if (matchesDomainList(host, proxyDomains) || matchesDomainList(host, noProxyDomains)) return;

  // Only learn from pages that are themselves in the proxy list
  // (e.g. youtube.com loading ytimg.com), never from unrelated sites
  let initiatorHost;
  try {
    initiatorHost = new URL(details.initiator).hostname.toLowerCase();
  } catch {
    return; // no initiator (e.g. typed navigation) -> ignore
  }
  if (!matchesDomainList(initiatorHost, proxyDomains)) return;

  const domain = getBaseDomain(host);
  const now = Date.now();
  const recent = (blockFailures.get(domain) || []).filter(t => now - t < BLOCK_WINDOW_MS);
  recent.push(now);
  blockFailures.set(domain, recent);
  log('[Detector] %s failed (%s) on %s, %d/%d', host, details.error, initiatorHost, recent.length, BLOCK_THRESHOLD);

  if (recent.length < BLOCK_THRESHOLD) return;
  blockFailures.delete(domain);

  autoAddQueue = autoAddQueue.then(async () => {
    const added = await addProxyDomain(domain);
    if (!added) return;

    const server = await getSelectedServer();
    const latestSettings = await getSettings();
    await updateProxyConfig(server, await getProxyDomains(), latestSettings.globalMode || false, await getNoProxyDomains());

    // Remember for the popup / settings page
    const { autoAddedDomains = [] } = await chrome.storage.local.get('autoAddedDomains');
    autoAddedDomains.unshift({ domain, host, error: details.error, time: now });
    await chrome.storage.local.set({ autoAddedDomains: autoAddedDomains.slice(0, 50) });

    log('[Detector] ✓ Auto-added blocked domain to proxy list:', domain);
  }).catch(error => console.error('[Detector] Failed to auto-add domain:', error));
}

chrome.webRequest.onErrorOccurred.addListener(
  details => { handleRequestError(details); },
  { urls: ['http://*/*', 'https://*/*'] }
);

/**
 * Handle proxy authentication requests
 */
chrome.webRequest.onAuthRequired.addListener(async (details, callback) => {
  log('[Service Worker] Auth required for:', details.challenger.host);

  try {
    const server = await getSelectedServer();

    // Only provide credentials if they exist and are not empty
    if (server && server.username && server.username.trim() && server.password && server.password.trim()) {
      callback({
        username: server.username,
        password: server.password
      });
      log('[Service Worker] Provided credentials for proxy auth');
    } else {
      log('[Service Worker] No credentials configured, skipping authentication');
      callback(); // Cancel authentication - proxy doesn't require it
    }
  } catch (error) {
    console.error('[Service Worker] Failed to get credentials for auth:', error);
    callback(); // Cancel authentication on error
  }
}, { urls: ['<all_urls>'] });

log('[Service Worker] Service worker initialized successfully!');
