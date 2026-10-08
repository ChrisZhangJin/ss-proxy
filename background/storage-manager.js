/**
 * Storage Manager
 * Handles all chrome.storage operations
 */

// Debug mode - set to false for production
const DEBUG = true;
const log = (...args) => DEBUG && console.log(...args);

// Default configuration
const DEFAULT_SERVERS = [
  {
    id: 'default-proxy',
    name: 'SG-01',
    host: '192.168.32.101',
    port: 18387,
    protocol: 'socks5', // 'http', 'https', or 'socks5'
    username: '', // Optional: for proxy authentication
    password: '', // Optional: for proxy authentication
    enabled: true,
    country: null // Country code for display
  }
];

const DEFAULT_PROXY_DOMAINS = [
  'google.com',
  'youtube.com',
  'facebook.com',
  'twitter.com'
];

const DEFAULT_NO_PROXY_DOMAINS = [];  // Empty by default

const DEFAULT_SETTINGS = {
  globalMode: false, // false = only proxy listed domains, true = proxy all
  autoConnect: false,
  selectedServerId: 'default-proxy',
  skipConnectionTest: true, // Skip connection test (Service Worker fetch doesn't use proxy)
  subscriptionUrls: [], // Domain list subscription URLs
  lastSubscriptionUpdate: null, // Last time subscriptions were updated
  autoUpdateSubscription: false, // Auto-update subscriptions daily
  serverSubscriptionUrl: '', // URL to fetch server list remotely
  autoAddBlocked: true // Auto-add domains whose direct connections time out / reset
};

const DEFAULT_STATE = {
  isConnected: false,
  lastConnectedServer: null
};

/**
 * Load domains from sample-domains.txt file
 */
async function loadSampleDomains() {
  try {
    const url = chrome.runtime.getURL('sample-domains.txt');
    const response = await fetch(url);
    
    if (!response.ok) {
      log('[Storage Manager] Failed to load sample-domains.txt:', response.status);
      return [];
    }
    
    const text = await response.text();
    const domains = text
      .split(/[\n\r]+/)
      .map(d => d.trim())
      .filter(d => d.length > 0 && !d.startsWith('#'))
      .map(d => normalizeDomain(d))
      .filter(d => d.length > 0);
    
    log('[Storage Manager] Loaded', domains.length, 'domains from sample-domains.txt');
    return domains;
  } catch (error) {
    console.error('[Storage Manager] Failed to load sample-domains.txt:', error);
    return [];
  }
}

/**
 * Initialize storage with default values
 */
async function initializeStorage() {
  const data = await chrome.storage.local.get([
    'servers',
    'proxyDomains',
    'noProxyDomains',  // NEW
    'settings',
    'state',
    'sampleDomainsLoaded'  // Flag to track if sample-domains.txt has been loaded
  ]);

  const updates = {};

  if (!data.servers) {
    updates.servers = DEFAULT_SERVERS;
  }

  // Load sample-domains.txt on first install or if not loaded yet
  if (!data.proxyDomains || !data.sampleDomainsLoaded) {
    const sampleDomains = await loadSampleDomains();
    
    if (sampleDomains.length > 0) {
      // Merge with default domains, removing duplicates
      const existingDomains = data.proxyDomains || DEFAULT_PROXY_DOMAINS;
      const allDomains = [...new Set([...existingDomains, ...sampleDomains])];
      updates.proxyDomains = allDomains;
      updates.sampleDomainsLoaded = true;
      log('[Storage Manager] Loaded', sampleDomains.length, 'domains from sample-domains.txt');
    } else {
      // If loading failed, use defaults
      if (!data.proxyDomains) {
        updates.proxyDomains = DEFAULT_PROXY_DOMAINS;
      }
      updates.sampleDomainsLoaded = true;
    }
  }

  if (!data.noProxyDomains) {  // NEW
    updates.noProxyDomains = DEFAULT_NO_PROXY_DOMAINS;
  }

  if (!data.settings) {
    updates.settings = DEFAULT_SETTINGS;
  }

  if (!data.state) {
    updates.state = DEFAULT_STATE;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
    log('Storage initialized with defaults:', updates);
  }

  return data;
}

/**
 * Get all servers
 */
async function getServers() {
  const { servers } = await chrome.storage.local.get('servers');
  return servers || DEFAULT_SERVERS;
}

/**
 * Get server by ID
 */
async function getServerById(serverId) {
  const servers = await getServers();
  return servers.find(s => s.id === serverId);
}

/**
 * Update servers
 */
async function updateServers(servers) {
  await chrome.storage.local.set({ servers });
}

/**
 * Get proxy domains
 */
async function getProxyDomains() {
  const { proxyDomains } = await chrome.storage.local.get('proxyDomains');
  return proxyDomains || DEFAULT_PROXY_DOMAINS;
}

/**
 * Add domain to proxy list
 */
async function addProxyDomain(domain) {
  // Normalize domain (remove protocol, www, trailing slash, port)
  const normalized = normalizeDomain(domain);

  const domains = await getProxyDomains();

  if (!domains.includes(normalized)) {
    domains.push(normalized);
    await chrome.storage.local.set({ proxyDomains: domains });
    return true;
  }

  return false; // Domain already exists
}

/**
 * Remove domain from proxy list
 */
async function removeProxyDomain(domain) {
  const domains = await getProxyDomains();
  const filtered = domains.filter(d => d !== domain);
  await chrome.storage.local.set({ proxyDomains: filtered });
}

/**
 * Get no-proxy domains
 */
async function getNoProxyDomains() {
  const { noProxyDomains } = await chrome.storage.local.get('noProxyDomains');
  return noProxyDomains || DEFAULT_NO_PROXY_DOMAINS;
}

/**
 * Add domain to no-proxy list
 */
async function addNoProxyDomain(domain) {
  // Normalize domain (remove protocol, www, trailing slash, port)
  const normalized = normalizeDomain(domain);

  const domains = await getNoProxyDomains();

  if (!domains.includes(normalized)) {
    domains.push(normalized);
    await chrome.storage.local.set({ noProxyDomains: domains });
    return true;
  }

  return false; // Domain already exists
}

/**
 * Remove domain from no-proxy list
 */
async function removeNoProxyDomain(domain) {
  const domains = await getNoProxyDomains();
  const filtered = domains.filter(d => d !== domain);
  await chrome.storage.local.set({ noProxyDomains: filtered });
}

/**
 * Normalize domain name
 * Remove protocol, www, path, port, wildcards
 */
function normalizeDomain(domain) {
  let normalized = domain.toLowerCase().trim();

  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//, '');

  // Remove www.
  normalized = normalized.replace(/^www\./, '');

  // Remove path, query, fragment
  normalized = normalized.split('/')[0];
  normalized = normalized.split('?')[0];
  normalized = normalized.split('#')[0];

  // Remove port
  normalized = normalized.split(':')[0];

  // Remove wildcards
  normalized = normalized.replace(/^\*\./, '');

  return normalized;
}

/**
 * Get settings
 */
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

/**
 * Update settings
 */
async function updateSettings(newSettings) {
  const currentSettings = await getSettings();
  const updated = { ...currentSettings, ...newSettings };
  await chrome.storage.local.set({ settings: updated });
}

/**
 * Get connection state
 */
async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return state || DEFAULT_STATE;
}

/**
 * Update connection state
 */
async function updateState(newState) {
  const currentState = await getState();
  const updated = { ...currentState, ...newState };
  await chrome.storage.local.set({ state: updated });
}

/**
 * Get selected server
 */
async function getSelectedServer() {
  const settings = await getSettings();
  const server = await getServerById(settings.selectedServerId);
  return server;
}

// Export functions
export {
  initializeStorage,
  getServers,
  getServerById,
  updateServers,
  getProxyDomains,
  addProxyDomain,
  removeProxyDomain,
  getNoProxyDomains,  // NEW
  addNoProxyDomain,  // NEW
  removeNoProxyDomain,  // NEW
  normalizeDomain,
  getSettings,
  updateSettings,
  getState,
  updateState,
  getSelectedServer
};
