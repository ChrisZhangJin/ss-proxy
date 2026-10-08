/**
 * Popup UI Controller
 */

// DOM elements
const serverList = document.getElementById('serverList');
const username = document.getElementById('username');
const password = document.getElementById('password');
const connectBtn = document.getElementById('connectBtn');
const globalToggle = document.getElementById('globalToggle');
const autoAddToggle = document.getElementById('autoAddToggle');
const settingsBtn = document.getElementById('settingsBtn');
const domainInput = document.getElementById('domainInput');
const domainProxyToggle = document.getElementById('domainProxyToggle');
const statusBar = document.querySelector('.status-bar');
const statusValue = statusBar.querySelector('.status-value');

// State
let currentState = {
  isConnected: false,
  servers: [],
  selectedServerId: null,
  globalMode: false,
  proxyDomains: [],
  noProxyDomains: [],  // NEW: Track domains that should NOT use proxy
  currentDomain: null
};

/**
 * Initialize popup
 */
async function initialize() {
  try {
    // Load servers
    await loadServers();

    // Load state
    await loadState();

    // Load settings
    await loadSettings();

    // Load proxy domains
    await loadProxyDomains();

    // Load no-proxy domains
    await loadNoProxyDomains();

    // Load current domain from active tab
    await loadCurrentDomain();

    // Setup event listeners
    setupEventListeners();

  } catch (error) {
    console.error('Failed to initialize popup:', error);
    showError('Failed to load extension data');
  }
}

/**
 * Get country code from server object
 * Extracts country code from server.country field or parses from server name
 */
function getCountryCodeFromServer(server) {
  // First, check if server has a country field
  if (server.country) {
    return server.country.toUpperCase();
  }

  // Try to extract country code from server name
  // Common patterns: "US Server", "S1 Los Angeles US", "[US]", etc.
  const name = server.name || '';

  // Pattern 1: Country code at the end (e.g., "Los Angeles US")
  const endMatch = name.match(/\s([A-Z]{2})$/i);
  if (endMatch) {
    return endMatch[1].toUpperCase();
  }

  // Pattern 2: Country code in brackets (e.g., "[US] Server")
  const bracketMatch = name.match(/\[([A-Z]{2})\]/i);
  if (bracketMatch) {
    return bracketMatch[1].toUpperCase();
  }

  // Pattern 3: Country code at the beginning (e.g., "US Server")
  const startMatch = name.match(/^([A-Z]{2})\s/i);
  if (startMatch) {
    return startMatch[1].toUpperCase();
  }

  // Pattern 4: Extract from common location names
  const locationMap = {
    'Los Angeles': 'US',
    'Dallas': 'US',
    'Seattle': 'US',
    'Washington': 'US',
    'New York': 'US',
    'San Francisco': 'US',
    'Chicago': 'US',
    'London': 'GB',
    'Tokyo': 'JP',
    'Singapore': 'SG',
    'Hong Kong': 'HK',
    'Sydney': 'AU',
    'Paris': 'FR',
    'Frankfurt': 'DE',
    'Amsterdam': 'NL',
    'Toronto': 'CA',
    'Mumbai': 'IN',
    'Seoul': 'KR',
    'Beijing': 'CN',
    'Shanghai': 'CN'
  };

  for (const [location, code] of Object.entries(locationMap)) {
    if (name.includes(location)) {
      return code;
    }
  }

  // If no country code found, return null
  return null;
}

/**
 * Load servers from storage
 */
async function loadServers() {
  try {
    const servers = await sendMessage({ action: 'getServers' });
    currentState.servers = servers || [];

    // Populate server list
    serverList.innerHTML = '';

    if (!servers || servers.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No servers configured';
      serverList.appendChild(option);
      connectBtn.disabled = true;
      return;
    }

    servers.forEach(server => {
      if (server.enabled) {
        const option = document.createElement('option');
        option.value = server.id;

        // Check if this is a localhost server
        const isLocalhost = server.host === '127.0.0.1' || server.host === 'localhost';

        if (isLocalhost) {
          // For localhost, display as: 服务器名称(主机地址:端口)
          option.textContent = `${server.name} (${server.host}:${server.port})`;
        } else {
          // For remote servers, use country code prefix instead of emoji
          const countryCode = getCountryCodeFromServer(server);
          option.textContent = countryCode ? `[${countryCode}] ${server.name}` : server.name;
        }

        serverList.appendChild(option);
      }
    });

    connectBtn.disabled = servers.length === 0;
  } catch (error) {
    console.error('Failed to load servers:', error);
    serverList.innerHTML = '<option>Error loading servers</option>';
    connectBtn.disabled = true;
  }
}

/**
 * Load connection state
 */
async function loadState() {
  const state = await sendMessage({ action: 'getState' });
  currentState.isConnected = state.isConnected;

  updateUI();
}

/**
 * Load settings
 */
async function loadSettings() {
  const settings = await sendMessage({ action: 'getSettings' });
  currentState.selectedServerId = settings.selectedServerId;
  currentState.globalMode = settings.globalMode;

  // Update UI
  serverList.value = settings.selectedServerId;

  // Update global toggle
  globalToggle.setAttribute('data-state', settings.globalMode ? 'on' : 'off');

  // Update auto-add toggle
  currentState.autoAddBlocked = settings.autoAddBlocked !== false;
  autoAddToggle.setAttribute('data-state', currentState.autoAddBlocked ? 'on' : 'off');

  // Load credentials for selected server
  await loadServerCredentials();
}

/**
 * Load credentials for the currently selected server
 */
async function loadServerCredentials() {
  try {
    const selectedServerId = serverList.value;
    if (!selectedServerId) {
      username.value = '';
      password.value = '';
      return;
    }

    const server = await sendMessage({
      action: 'getServerById',
      serverId: selectedServerId
    });

    if (server) {
      username.value = server.username || '';
      password.value = server.password || '';
    }
  } catch (error) {
    console.error('Failed to load server credentials:', error);
  }
}

/**
 * Save credentials for the currently selected server
 */
async function saveServerCredentials() {
  try {
    const selectedServerId = serverList.value;
    if (!selectedServerId) {
      return;
    }

    const result = await sendMessage({
      action: 'updateServerCredentials',
      serverId: selectedServerId,
      username: username.value.trim(),
      password: password.value
    });

    if (result.success) {
      showSuccess('凭据已保存');
    } else {
      showError('保存凭据失败');
    }
  } catch (error) {
    console.error('Failed to save server credentials:', error);
    showError('保存凭据失败: ' + error.message);
  }
}

/**
 * Load proxy domains
 */
async function loadProxyDomains() {
  const domains = await sendMessage({ action: 'getProxyDomains' });
  currentState.proxyDomains = domains || [];
}

/**
 * Load no-proxy domains
 */
async function loadNoProxyDomains() {
  const domains = await sendMessage({ action: 'getNoProxyDomains' });
  currentState.noProxyDomains = domains || [];
}

/**
 * Load current domain from active tab
 */
async function loadCurrentDomain() {
  try {
    const result = await sendMessage({ action: 'getCurrentTabDomain' });

    if (result.success) {
      currentState.currentDomain = result.domain;
      updateDomainDisplay();
    } else {
      currentState.currentDomain = null;
      domainInput.value = '';
    }
  } catch (error) {
    console.error('Failed to load current domain:', error);
    currentState.currentDomain = null;
    domainInput.value = '';
  }
}

/**
 * Check if a domain matches any domain in the proxy list
 * Supports parent domain matching (e.g., www.google.com matches google.com)
 */
function isDomainInProxyList(domain) {
  if (!domain) return false;

  // Check exact match first
  if (currentState.proxyDomains.includes(domain)) {
    return true;
  }

  // Check parent domain matching
  // For example: www.google.com should match if google.com is in the list
  // This mimics the PAC script's dnsDomainIs() function
  for (const proxyDomain of currentState.proxyDomains) {
    // Check if current domain ends with .proxyDomain
    if (domain.endsWith('.' + proxyDomain)) {
      return true;
    }
    // Also check if proxyDomain ends with .domain (reverse match)
    // This handles cases where the list has www.google.com and we visit google.com
    if (proxyDomain.endsWith('.' + domain)) {
      return true;
    }
  }

  return false;
}

/**
 * Update domain display based on current page
 */
function updateDomainDisplay() {
  if (currentState.currentDomain) {
    // Remove 'www.' prefix for display
    let displayDomain = currentState.currentDomain;
    if (displayDomain.startsWith('www.')) {
      displayDomain = displayDomain.substring(4);
    }
    domainInput.value = displayDomain;

    // Check if domain matches any domain in proxy list (including parent domain matching)
    const isInProxyList = isDomainInProxyList(currentState.currentDomain);

    // Update domain proxy toggle
    if (isInProxyList) {
      domainProxyToggle.setAttribute('data-state', 'on');
    } else {
      domainProxyToggle.setAttribute('data-state', 'off');
    }
  } else {
    domainInput.value = '';
    domainProxyToggle.setAttribute('data-state', 'off');
  }
}

/**
 * Update UI based on connection state
 */
function updateUI() {
  if (currentState.isConnected) {
    connectBtn.textContent = '■ 断开';
    connectBtn.classList.add('connected');
    statusValue.textContent = '已连接';
    statusValue.className = 'status-value connected';

    // Enable global toggle when connected
    globalToggle.disabled = false;
    globalToggle.style.opacity = '1';
    globalToggle.style.cursor = 'pointer';
  } else {
    connectBtn.innerHTML = '<span class="connect-icon">▶</span> 连接';
    connectBtn.classList.remove('connected');
    statusValue.textContent = '未连接';
    statusValue.className = 'status-value disconnected';

    // Disable global toggle when not connected
    globalToggle.disabled = true;
    globalToggle.style.opacity = '0.5';
    globalToggle.style.cursor = 'not-allowed';
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Server selection change
  serverList.addEventListener('change', async (e) => {
    const serverId = e.target.value;
    await sendMessage({
      action: 'updateSettings',
      settings: { selectedServerId: serverId }
    });
    currentState.selectedServerId = serverId;
    // Load credentials for newly selected server
    await loadServerCredentials();
  });

  // Username change - save to current server
  username.addEventListener('change', async (e) => {
    await saveServerCredentials();
  });

  // Password change - save to current server
  password.addEventListener('change', async (e) => {
    await saveServerCredentials();
  });

  // Connect/Disconnect button
  connectBtn.addEventListener('click', async () => {
    await handleConnectToggle();
  });

  // Global mode toggle button
  globalToggle.addEventListener('click', async () => {
    // Check if connected before allowing toggle
    if (!currentState.isConnected) {
      showError('请先连接代理服务器');
      return;
    }

    const newGlobalMode = !currentState.globalMode;
    await sendMessage({
      action: 'updateSettings',
      settings: { globalMode: newGlobalMode }
    });
    currentState.globalMode = newGlobalMode;

    globalToggle.setAttribute('data-state', newGlobalMode ? 'on' : 'off');

    showSuccess(`全局代理 ${newGlobalMode ? '已开启' : '已关闭'}`);
  });

  // Auto-add blocked domains toggle
  autoAddToggle.addEventListener('click', async () => {
    const newAutoAdd = !currentState.autoAddBlocked;
    await sendMessage({
      action: 'updateSettings',
      settings: { autoAddBlocked: newAutoAdd }
    });
    currentState.autoAddBlocked = newAutoAdd;

    autoAddToggle.setAttribute('data-state', newAutoAdd ? 'on' : 'off');

    showSuccess(`自动添加被墙域名 ${newAutoAdd ? '已开启' : '已关闭'}`);
  });

  // Settings button - opens settings page
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  // Domain proxy toggle - adds/removes current domain from proxy list
  domainProxyToggle.addEventListener('click', async () => {
    if (!currentState.currentDomain) {
      showError('没有当前域名可切换');
      return;
    }

    // Remove 'www.' prefix for proxy list operations
    let domainToToggle = currentState.currentDomain;
    if (domainToToggle.startsWith('www.')) {
      domainToToggle = domainToToggle.substring(4);
    }

    const toggleState = domainProxyToggle.getAttribute('data-state');
    const isCurrentlyOn = toggleState === 'on';

    if (isCurrentlyOn) {
      // Remove from proxy list
      await handleRemoveDomain(domainToToggle);
      domainProxyToggle.setAttribute('data-state', 'off');
    } else {
      // Add to proxy list - use the displayed domain (without www.)
      domainInput.value = domainToToggle;
      await handleAddDomain(true);
      domainProxyToggle.setAttribute('data-state', 'on');
    }
  });
}

/**
 * Handle connect/disconnect toggle
 */
async function handleConnectToggle() {
  try {
    connectBtn.disabled = true;

    if (currentState.isConnected) {
      // Disconnect
      const result = await sendMessage({ action: 'disconnect' });
      if (result.success) {
        currentState.isConnected = false;
        showSuccess('已断开连接');
      } else {
        throw new Error(result.error || 'Failed to disconnect');
      }
    } else {
      // Connect
      showToast('正在测试代理连接...', 'info');
      const result = await sendMessage({ action: 'connect' });
      if (result.success) {
        currentState.isConnected = true;
        showSuccess(`已连接: ${result.server.name}`);
      } else {
        throw new Error(result.error || 'Failed to connect');
      }
    }

    updateUI();

  } catch (error) {
    console.error('Connection toggle failed:', error);
    showError(error.message);
    currentState.isConnected = false;
    updateUI();
  } finally {
    connectBtn.disabled = false;
  }
}

/**
 * Handle adding domain
 */
async function handleAddDomain(isProxy) {
  try {
    const domain = domainInput.value.trim();

    if (!domain) {
      showError('请输入域名');
      return;
    }

    if (isProxy) {
      const result = await sendMessage({ action: 'addProxyDomain', domain });
      if (result.success) {
        showSuccess(`已添加到代理列表: ${domain}`);
        // Reload domains and refresh display
        await loadProxyDomains();
        updateDomainDisplay();
      } else {
        showError(result.error || '添加失败');
      }
    } else {
      // For "no proxy" we just clear the input for now
      // In the full implementation, this would add to a "direct" list
      showSuccess(`${domain} 不走代理 (功能待实现)`);
      domainInput.value = '';
    }

  } catch (error) {
    console.error('Failed to add domain:', error);
    showError(error.message);
  }
}

/**
 * Handle removing domain from proxy list
 */
async function handleRemoveDomain(domain) {
  try {
    if (!domain) {
      showError('没有域名可移除');
      return;
    }

    const result = await sendMessage({ action: 'removeProxyDomain', domain });
    if (result.success) {
      showSuccess(`已从代理列表移除: ${domain}`);
      // Reload domains and refresh display
      await loadProxyDomains();
      updateDomainDisplay();
    } else {
      showError(result.error || '移除失败');
    }

  } catch (error) {
    console.error('Failed to remove domain:', error);
    showError(error.message);
  }
}

/**
 * Handle adding domain to no-proxy list
 */
async function handleAddNoProxyDomain() {
  try {
    const domain = domainInput.value.trim();

    if (!domain) {
      showError('请输入域名');
      return;
    }

    const result = await sendMessage({ action: 'addNoProxyDomain', domain });
    if (result.success) {
      showSuccess(`已添加到直连列表: ${domain}`);
      // Reload domains and refresh display
      await loadNoProxyDomains();
      updateDomainDisplay();
    } else {
      showError(result.error || '添加失败');
    }

  } catch (error) {
    console.error('Failed to add no-proxy domain:', error);
    showError(error.message);
  }
}

/**
 * Handle removing domain from no-proxy list
 */
async function handleRemoveNoProxyDomain(domain) {
  try {
    if (!domain) {
      showError('没有域名可移除');
      return;
    }

    const result = await sendMessage({ action: 'removeNoProxyDomain', domain });
    if (result.success) {
      showSuccess(`已从直连列表移除: ${domain}`);
      // Reload domains and refresh display
      await loadNoProxyDomains();
      updateDomainDisplay();
    } else {
      showError(result.error || '移除失败');
    }

  } catch (error) {
    console.error('Failed to remove no-proxy domain:', error);
    showError(error.message);
  }
}

/**
 * Send message to background script
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    console.log('Sending message:', message);
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('Message response:', response);
        resolve(response);
      }
    });
  });
}

/**
 * Show success message
 */
function showSuccess(message) {
  console.log('✓', message);
  showToast(message, 'success');
}

/**
 * Show error message
 */
function showError(message) {
  console.error('✗', message);
  showToast(message, 'error');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  // Add to container
  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 3000);
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
