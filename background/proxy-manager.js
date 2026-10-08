/**
 * Proxy Manager
 * Manages Chrome proxy settings using chrome.proxy API
 */

// Debug mode - set to false for production
const DEBUG = true;
const log = (...args) => DEBUG && console.log(...args);

/**
 * Generate PAC (Proxy Auto-Config) script
 */
function generatePACScript(server, proxyDomains, globalMode, noProxyDomains = []) {
  try {
    if (!server || !server.protocol || !server.host || !server.port) {
      throw new Error('Invalid server configuration');
    }

    const proxyString = `${server.protocol.toUpperCase()} ${server.host}:${server.port}`;

    // Sanitize domains to prevent script injection
    const sanitizeDomain = (domain) => {
      return String(domain)
        .replace(/["'\\]/g, '')           // Remove quotes and backslashes
        .replace(/[\r\n\t]/g, '')         // Remove newlines and tabs
        .replace(/[<>]/g, '')             // Remove angle brackets (XSS prevention)
        .replace(/[(){}[\]]/g, '')        // Remove brackets and braces
        .replace(/[;,]/g, '')             // Remove semicolons and commas
        .replace(/[/\\]/g, '')            // Remove slashes (path separators)
        .replace(/\s+/g, '')              // Remove all whitespace characters
        .toLowerCase()                    // Convert to lowercase for case-insensitive matching
        .replace(/[^a-z0-9.-]/g, '');     // Keep only valid domain characters
    };

    // Generate domain matching conditions for proxy domains
    const domainChecks = (proxyDomains || []).map(domain => {
      const safeDomain = sanitizeDomain(domain);
      return `    if (dnsDomainIs(host, ".${safeDomain}") || host.toLowerCase() === "${safeDomain}") {
      return "${proxyString}";
    }`;
    }).join('\n');

    // Generate domain matching conditions for no-proxy domains
    const noProxyChecks = (noProxyDomains || []).map(domain => {
      const safeDomain = sanitizeDomain(domain);
      return `    if (dnsDomainIs(host, ".${safeDomain}") || host.toLowerCase() === "${safeDomain}") {
      return "DIRECT";
    }`;
    }).join('\n');

    const pacScript = `
function FindProxyForURL(url, host) {
  // Never proxy localhost and local networks (performance optimized)
  if (isPlainHostName(host) ||
      host === "127.0.0.1" ||
      host === "localhost" ||
      shExpMatch(host, "*.local") ||
      shExpMatch(host, "10.*") ||
      shExpMatch(host, "172.16.*") ||
      shExpMatch(host, "172.17.*") ||
      shExpMatch(host, "172.18.*") ||
      shExpMatch(host, "172.19.*") ||
      shExpMatch(host, "172.2?.*") ||
      shExpMatch(host, "172.30.*") ||
      shExpMatch(host, "172.31.*") ||
      shExpMatch(host, "192.168.*") ||
      shExpMatch(host, "127.*")) {
    return "DIRECT";
  }

  // Check no-proxy domain list first (takes priority)
${noProxyChecks}

  // Global mode: proxy everything except local and no-proxy domains
  if (${globalMode}) {
    return "${proxyString}";
  }

  // Check proxy domain list
${domainChecks}

  // Default: direct connection
  return "DIRECT";
}
    `.trim();

    return pacScript;
  } catch (error) {
    console.error('[Proxy Manager] Failed to generate PAC script:', error);
    throw error;
  }
}

/**
 * Enable proxy with the given server
 */
async function enableProxy(server, proxyDomains = [], globalMode = false, noProxyDomains = []) {
  log('[Proxy Manager] enableProxy called with:', server);
  try {
    if (!server) {
      console.error('[Proxy Manager] No server provided');
      throw new Error('No server provided');
    }

    log('[Proxy Manager] Proxy domains:', proxyDomains);
    log('[Proxy Manager] No-proxy domains:', noProxyDomains);
    log('[Proxy Manager] Global mode:', globalMode);

    const pacScript = generatePACScript(server, proxyDomains, globalMode, noProxyDomains);
    log('[Proxy Manager] Generated PAC script length:', pacScript.length);
    log('[Proxy Manager] PAC script preview (first 500 chars):\n%s', pacScript.substring(0, 500));

    const config = {
      mode: 'pac_script',
      pacScript: {
        data: pacScript
      }
    };

    log('[Proxy Manager] Setting Chrome proxy config...');
    log('[Proxy Manager] Config mode: %s', config.mode);
    log('[Proxy Manager] Proxy string in PAC: %s %s:%s', server.protocol.toUpperCase(), server.host, server.port);

    const setStart = Date.now();
    await chrome.proxy.settings.set({
      value: config,
      scope: 'regular'
    });
    const setDuration = Date.now() - setStart;

    log('[Proxy Manager] ✓ Successfully enabled proxy for:', server.name, server.host);
    log('[Proxy Manager] Proxy URL:', `${server.protocol.toUpperCase()} ${server.host}:${server.port}`);
    log('[Proxy Manager] Chrome proxy.settings.set() took %dms', setDuration);

    return { success: true, server };

  } catch (error) {
    console.error('[Proxy Manager] ✗ Failed to enable proxy:', error);
    console.error('[Proxy Manager] Error details:', error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Disable proxy (use direct connection)
 */
async function disableProxy() {
  try {
    log('[Proxy Manager] Disabling proxy...');
    const clearStart = Date.now();

    await chrome.proxy.settings.clear({
      scope: 'regular'
    });

    const clearDuration = Date.now() - clearStart;
    log('[Proxy Manager] ✓ Proxy disabled successfully (took %dms)', clearDuration);
    return { success: true };

  } catch (error) {
    console.error('[Proxy Manager] ✗ Failed to disable proxy:', error);
    console.error('[Proxy Manager] Error details:', error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Update proxy configuration (e.g., when domain list changes)
 */
async function updateProxyConfig(server, proxyDomains = [], globalMode = false, noProxyDomains = []) {
  try {
    if (!server) {
      return { success: false, error: 'No server provided' };
    }

    // Re-enable proxy with updated configuration
    await enableProxy(server, proxyDomains, globalMode, noProxyDomains);
    log('[Proxy Manager] Proxy configuration updated');
    return { success: true };

  } catch (error) {
    console.error('[Proxy Manager] Failed to update proxy config:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current proxy settings
 */
async function getProxySettings() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get(
      { incognito: false },
      (config) => {
        resolve(config);
      }
    );
  });
}

// Export functions
export {
  generatePACScript,
  enableProxy,
  disableProxy,
  updateProxyConfig,
  getProxySettings
};
