/**
 * Settings Page Controller
 */

// DOM elements
const domainList = document.getElementById('domainList');
const importDomainsBtn = document.getElementById('importDomainsBtn');
const exportDomainsBtn = document.getElementById('exportDomainsBtn');
const backBtn = document.getElementById('backBtn');

// Server list elements
const serverListView = document.getElementById('serverListView');
const newServerBtn = document.getElementById('newServerBtn');
const importServersBtn = document.getElementById('importServersBtn');
const exportServersBtn = document.getElementById('exportServersBtn');

// Server editor elements
const editorTitle = document.getElementById('editorTitle');
const serverName = document.getElementById('serverName');
const serverHost = document.getElementById('serverHost');
const serverPort = document.getElementById('serverPort');
const serverProtocol = document.getElementById('serverProtocol');
const serverUsername = document.getElementById('serverUsername');
const serverPassword = document.getElementById('serverPassword');
const saveServerBtn = document.getElementById('saveServerBtn');
const selectServerBtn = document.getElementById('selectServerBtn');
const deleteServerBtn = document.getElementById('deleteServerBtn');

const VALID_PROTOCOLS = ['http', 'https', 'socks5'];

// State
let currentDomains = [];
let currentSettings = {};
let servers = [];
let editingServerId = null; // null = creating a new server

/**
 * Initialize settings page
 */
async function initialize() {
  try {
    await loadDomains();
    await loadSettings();
    await loadServers();
    editServer(currentSettings.selectedServerId);
    setupEventListeners();
    await loadVersion();
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
}

/**
 * Load and display version from VERSION file
 */
async function loadVersion() {
  try {
    const versionDisplay = document.getElementById('versionDisplay');
    const response = await fetch('../../VERSION');
    if (response.ok) {
      const version = await response.text();
      // Trim whitespace and remove any extra lines
      const cleanVersion = version.trim();
      versionDisplay.textContent = `Shadowsocks Proxy v${cleanVersion}`;
    } else {
      console.warn('Failed to load VERSION file, using default');
    }
  } catch (error) {
    console.warn('VERSION file not found or readable:', error);
    // Keep default version display if file can't be loaded
  }
}

/**
 * Load proxy domains
 */
async function loadDomains() {
  const domains = await sendMessage({ action: 'getProxyDomains' });
  currentDomains = domains || [];
  renderDomainList();
}

/**
 * Load settings
 */
async function loadSettings() {
  const settings = await sendMessage({ action: 'getSettings' });
  currentSettings = settings || {};
}

/**
 * Load all servers
 */
async function loadServers() {
  servers = (await sendMessage({ action: 'getServers' })) || [];
  renderServerList();
}

/**
 * Render server list
 */
function renderServerList() {
  serverListView.innerHTML = '';

  if (servers.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'server-list-empty';
    empty.textContent = '暂无服务器，请点击“新建服务器”';
    serverListView.appendChild(empty);
    return;
  }

  servers.forEach(server => {
    const item = document.createElement('li');
    item.className = 'server-item';
    if (server.id === editingServerId) {
      item.classList.add('editing');
    }

    const dot = document.createElement('span');
    dot.className = 'server-item-dot';
    dot.textContent = server.id === currentSettings.selectedServerId ? '●' : '';
    dot.title = '当前使用';

    const text = document.createElement('div');
    text.className = 'server-item-text';
    const name = document.createElement('span');
    name.className = 'server-item-name';
    name.textContent = server.name || '(未命名)';
    const addr = document.createElement('span');
    addr.className = 'server-item-addr';
    addr.textContent = `${server.protocol}://${server.host}:${server.port}`;
    text.append(name, addr);

    item.append(dot, text);
    item.addEventListener('click', () => editServer(server.id));
    serverListView.appendChild(item);
  });
}

/**
 * Show a server in the editor (or an empty form for a new server)
 */
function editServer(serverId) {
  const server = servers.find(s => s.id === serverId) || null;
  editingServerId = server ? server.id : null;

  editorTitle.textContent = server ? '编辑服务器' : '新建服务器';
  serverName.value = server ? server.name || '' : '';
  serverHost.value = server ? server.host || '' : '127.0.0.1';
  serverPort.value = server ? server.port || '' : '1080';
  serverProtocol.value = server ? server.protocol || 'socks5' : 'socks5';
  serverUsername.value = server ? server.username || '' : '';
  serverPassword.value = server ? server.password || '' : '';

  selectServerBtn.disabled = !server || server.id === currentSettings.selectedServerId;
  deleteServerBtn.disabled = !server;

  renderServerList();
}

/**
 * Generate a unique server ID
 */
function generateServerId() {
  return `server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate and normalize a server object. Returns null if invalid.
 */
function normalizeServer(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const host = String(raw.host || '').trim();
  const port = parseInt(raw.port);
  const protocol = String(raw.protocol || 'socks5').toLowerCase();

  if (!host || !port || port < 1 || port > 65535 || !VALID_PROTOCOLS.includes(protocol)) {
    return null;
  }

  return {
    id: raw.id ? String(raw.id) : generateServerId(),
    name: String(raw.name || '').trim() || `${host}:${port}`,
    host,
    port,
    protocol,
    username: String(raw.username || ''),
    password: String(raw.password || ''),
    enabled: raw.enabled !== false,
    country: raw.country || null
  };
}

/**
 * Persist server list and refresh UI
 */
async function saveServers(newServers) {
  const result = await sendMessage({ action: 'updateServers', servers: newServers });
  if (!result || !result.success) {
    throw new Error((result && result.error) || '保存失败');
  }
  await loadSettings();
  await loadServers();
}

/**
 * Render domain list in textarea
 */
function renderDomainList() {
  // Sort domains alphabetically
  const sortedDomains = [...currentDomains].sort();
  domainList.value = sortedDomains.join('\n');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Domain list textarea - auto-save on change with improved debouncing
  let saveTimeout;
  let isSaving = false;
  let pendingSave = false;

  domainList.addEventListener('input', () => {
    clearTimeout(saveTimeout);

    // If currently saving, mark that another save is pending
    if (isSaving) {
      pendingSave = true;
      return;
    }

    saveTimeout = setTimeout(async () => {
      isSaving = true;
      await handleSaveDomains();
      isSaving = false;

      // If another save was requested while saving, trigger it now
      if (pendingSave) {
        pendingSave = false;
        setTimeout(async () => {
          isSaving = true;
          await handleSaveDomains();
          isSaving = false;
        }, 100);
      }
    }, 1000); // Auto-save after 1 second of inactivity
  });

  // Refresh domain list when it changes elsewhere (e.g. auto-added blocked domains)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.proxyDomains && document.activeElement !== domainList) {
      loadDomains();
    }
  });

  // Back button
  backBtn.addEventListener('click', () => {
    window.close();
  });

  // Server list / editor buttons
  newServerBtn.addEventListener('click', () => {
    editServer(null);
    serverName.focus();
  });
  saveServerBtn.addEventListener('click', handleSaveServer);
  selectServerBtn.addEventListener('click', handleSelectServer);
  deleteServerBtn.addEventListener('click', handleDeleteServer);
  importServersBtn.addEventListener('click', handleImportServers);
  exportServersBtn.addEventListener('click', handleExportServers);

  // Import/Export buttons
  importDomainsBtn.addEventListener('click', handleImportDomains);
  exportDomainsBtn.addEventListener('click', handleExportDomains);
}

/**
 * Handle saving domains from textarea
 */
async function handleSaveDomains() {
  try {
    // Parse domains from textarea
    const text = domainList.value;
    const domains = text
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    // Find new domains to add
    const newDomains = domains.filter(d => !currentDomains.includes(d));

    // Find domains to remove
    const removedDomains = currentDomains.filter(d => !domains.includes(d));

    // Add new domains
    for (const domain of newDomains) {
      await sendMessage({
        action: 'addProxyDomain',
        domain
      });
    }

    // Remove deleted domains
    for (const domain of removedDomains) {
      await sendMessage({
        action: 'removeProxyDomain',
        domain
      });
    }

    // Reload
    await loadDomains();
    showNotification('域名列表已保存');

  } catch (error) {
    console.error('Failed to save domains:', error);
    showNotification('保存失败: ' + error.message, 'error');
  }
}

/**
 * Handle clearing all domains - removed feature
 */
// async function handleClearAll() {
//   if (!confirm(`确定要清空所有 ${currentDomains.length} 个域名吗？`)) {
//     return;
//   }
//
//   try {
//     // Remove all domains one by one
//     for (const domain of currentDomains) {
//       await sendMessage({
//         action: 'removeProxyDomain',
//         domain
//       });
//     }
//
//     showNotification('已清空所有域名');
//     await loadDomains();
//
//   } catch (error) {
//     console.error('Failed to clear domains:', error);
//     showNotification(error.message, 'error');
//   }
// }

/**
 * Handle saving the server in the editor (create or update)
 */
async function handleSaveServer() {
  try {
    const existing = servers.find(s => s.id === editingServerId);
    const server = normalizeServer({
      ...existing,
      id: editingServerId,
      name: serverName.value,
      host: serverHost.value,
      port: serverPort.value,
      protocol: serverProtocol.value,
      username: serverUsername.value.trim(),
      password: serverPassword.value
    });

    if (!server) {
      showNotification('请输入有效的主机地址和端口号 (1-65535)', 'error');
      alert('请输入有效的主机地址和端口号 (1-65535)');
      return;
    }

    const newServers = existing
      ? servers.map(s => (s.id === server.id ? server : s))
      : [...servers, server];

    await saveServers(newServers);
    editServer(server.id);
    showNotification(existing ? '服务器已保存' : '服务器已创建', 'success');

  } catch (error) {
    console.error('Failed to save server:', error);
    showNotification('保存失败: ' + error.message, 'error');
  }
}

/**
 * Handle making the edited server the active one
 */
async function handleSelectServer() {
  try {
    if (!editingServerId) return;

    await sendMessage({
      action: 'updateSettings',
      settings: { selectedServerId: editingServerId }
    });
    await loadSettings();
    editServer(editingServerId);
    showNotification('已设为当前服务器', 'success');

  } catch (error) {
    console.error('Failed to select server:', error);
    showNotification('切换失败: ' + error.message, 'error');
  }
}

/**
 * Handle deleting the edited server
 */
async function handleDeleteServer() {
  try {
    const server = servers.find(s => s.id === editingServerId);
    if (!server) return;

    if (!confirm(`确定要删除服务器 "${server.name}" 吗？`)) {
      return;
    }

    await saveServers(servers.filter(s => s.id !== server.id));
    editServer(currentSettings.selectedServerId);
    showNotification('服务器已删除', 'success');

  } catch (error) {
    console.error('Failed to delete server:', error);
    showNotification('删除失败: ' + error.message, 'error');
  }
}

/**
 * Handle importing servers from a JSON file.
 * Servers with an existing ID are updated, others are appended.
 */
async function handleImportServers() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  input.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;

      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data && data.servers;
      if (!Array.isArray(list)) {
        throw new Error('文件格式无效，缺少 servers 列表');
      }

      const imported = list.map(normalizeServer).filter(Boolean);
      const skipped = list.length - imported.length;
      if (imported.length === 0) {
        throw new Error('文件中没有有效的服务器');
      }

      const merged = [...servers];
      for (const server of imported) {
        const index = merged.findIndex(s => s.id === server.id);
        if (index === -1) {
          merged.push(server);
        } else {
          merged[index] = server;
        }
      }

      await saveServers(merged);
      editServer(editingServerId || currentSettings.selectedServerId);

      const message = `成功导入 ${imported.length} 个服务器` + (skipped ? `，跳过 ${skipped} 个无效项` : '');
      showNotification(message, 'success');
      alert(message);

    } catch (error) {
      console.error('Failed to import servers:', error);
      showNotification('导入失败: ' + error.message, 'error');
      alert('导入失败: ' + error.message);
    }
  };

  input.click();
}

/**
 * Handle exporting servers to a JSON file
 */
function handleExportServers() {
  try {
    const data = {
      type: 'ss-proxy-servers',
      version: 1,
      exportedAt: new Date().toISOString(),
      selectedServerId: currentSettings.selectedServerId,
      servers
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `proxy-servers-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification('服务器列表已导出', 'success');
  } catch (error) {
    console.error('Failed to export servers:', error);
    showNotification('导出失败: ' + error.message, 'error');
  }
}

/**
 * Handle importing domains from file
 */
async function handleImportDomains() {
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.list';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      const domains = text
        .split(/[\n\r]+/)
        .map(d => d.trim())
        .filter(d => d.length > 0 && !d.startsWith('#'));

      // Add to existing domains
      for (const domain of domains) {
        if (!currentDomains.includes(domain)) {
          await sendMessage({ action: 'addProxyDomain', domain });
        }
      }

      await loadDomains();
      showNotification(`成功导入 ${domains.length} 个域名`, 'success');
    };

    input.click();
  } catch (error) {
    console.error('Failed to import domains:', error);
    showNotification('导入失败: ' + error.message, 'error');
  }
}

/**
 * Handle exporting domains to file
 */
async function handleExportDomains() {
  try {
    const text = currentDomains.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `proxy-domains-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification('域名列表已导出', 'success');
  } catch (error) {
    console.error('Failed to export domains:', error);
    showNotification('导出失败: ' + error.message, 'error');
  }
}

/**
 * Send message to background script
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}]`, message);
  // Simple notification - can be enhanced with toast system
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
