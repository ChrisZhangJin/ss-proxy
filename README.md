# SS Proxy

<img src="assets/icons/icon128.png" width="96" align="right" alt="SS Proxy icon" />

A lightweight Chrome extension (Manifest V3) for switching your browser between
**multiple local or remote proxy servers**, with **per-domain smart routing**
(PAC), a one-click **global mode**, and automatic detection of **blocked
domains**.

It is designed to sit in front of a local proxy client such as Shadowsocks,
Hysteria 2, sing-box, mihomo (Clash Meta) or V2Ray. Those clients handle the
protocol; this extension decides which browser traffic goes to them.

> The UI is in Simplified Chinese. Labels are quoted below with a translation.

---

## Features

- **Multiple servers**: create, edit, delete and switch between any number of
  HTTP / HTTPS / SOCKS5 proxy servers. Each server has its own optional
  username and password.
- **Smart routing (PAC)**: only domains in your list go through the proxy;
  everything else connects directly. Subdomains match automatically
  (`google.com` also covers `mail.google.com`).
- **Global mode**: send all traffic through the proxy with one toggle.
  Local and private network addresses always stay direct.
- **Blocked-domain auto-detect**: when a site in your list loads resources from
  other domains that time out or get reset (for example YouTube loading
  `googlevideo.com`), those domains are added to the proxy list for you.
- **One-click per-site toggle**: add or remove the current tab's domain from
  the popup.
- **Import / export**:
  - server list as JSON, so you can back up or move your configuration;
  - domain list as plain text.
- **Proxy authentication**: credentials are supplied automatically when the
  proxy asks for them.
- **Status badge**: the toolbar icon shows `ON` while connected.

## Supported protocols

The extension uses Chrome's built-in proxy support, which speaks:

| Protocol | Typical use |
|----------|-------------|
| `SOCKS5` | Local Shadowsocks / Hysteria 2 / sing-box / Clash client (recommended) |
| `HTTP`   | HTTP proxy, or a client's HTTP inbound |
| `HTTPS`  | TLS-encrypted HTTP proxy |

### Shadowsocks, Hysteria 2, VLESS, Trojan…

Chrome extensions cannot implement these protocols themselves, because they
can't open raw TCP/UDP sockets. Run a local client that exposes a SOCKS5 or
HTTP port, then add that port as a server in this extension:

| Client | Protocols | Example local inbound |
|--------|-----------|-----------------------|
| [shadowsocks-libev / shadowsocks-rust](https://github.com/shadowsocks) | Shadowsocks | `socks5://127.0.0.1:1080` |
| [Hysteria](https://github.com/apernet/hysteria) | Hysteria 2 | `socks5: listen: 127.0.0.1:1080` |
| [sing-box](https://github.com/SagerNet/sing-box) | SS, Hysteria 2, VLESS, Trojan, TUIC… | `mixed` inbound on `127.0.0.1:2080` |
| [mihomo (Clash Meta)](https://github.com/MetaCubeX/mihomo) | SS, Hysteria 2, VLESS, Trojan… | `mixed-port: 7890` |

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/ChrisZhangJin/ss-proxy.git
   ```
2. Open `chrome://extensions` in Chrome (or any Chromium browser such as Edge,
   Brave or Arc).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `ss-proxy` folder.
5. Pin the extension to the toolbar.

To update, `git pull`, then click the reload icon on the extension card.

## Usage

### Popup

| Control | What it does |
|---------|--------------|
| Server dropdown | Pick the active server |
| 用户名 / 密码 (username / password) | Optional credentials, saved per server |
| ▶ 连接 / ■ 断开 (connect / disconnect) | Turn the proxy on or off |
| 全局代理 (global proxy) | Proxy all traffic, not just listed domains |
| 自动添加被墙域名 (auto-add blocked domains) | Enable the blocked-domain detector |
| 此域名使用代理 (proxy this domain) | Add or remove the current tab's domain from the proxy list |
| ⚙️ | Open the settings page |

### Settings page

The settings page has three panels.

1. **指定走代理的域名 (proxied domains)**: one domain per line. Changes are
   saved automatically after 1 second.
   - **📥 导入列表 / 📤 导出列表** import or export the list as a `.txt` file.
   - Lines starting with `#` are ignored when importing.
2. **服务器列表 (server list)**: all servers. The active one is marked with ●.
   - Click a server to edit it.
   - **＋ 新建服务器** creates a new server.
   - **📥 导入服务器 / 📤 导出服务器** import or export servers as JSON.
3. **编辑服务器 (edit server)**: name, host, port, protocol and optional
   credentials.
   - **✓ 保存** saves the server.
   - **设为当前** makes it the active server.
   - **✕ 删除** deletes it.

If you edit the active server while connected, the change takes effect
immediately.

### Routing rules

Each request is decided in this order:

1. Local and private addresses → **direct**:
   - `localhost`, `127.*`, `10.*`, `172.16–31.*`, `192.168.*`;
   - `*.local` and plain host names.
2. Domain in the no-proxy list → **direct**.
3. Global mode on → **proxy**.
4. Domain, or a parent domain, in the proxy list → **proxy**.
5. Anything else → **direct**.

### Blocked-domain auto-detect

Modern sites load content from many domains. YouTube, for instance, uses
`ytimg.com` for thumbnails, `ggpht.com` for avatars and `googlevideo.com` for
video. If only `youtube.com` is in your list, the page loads but images and
video fail.

With **自动添加被墙域名** on, a domain is added to the proxy list when **all**
of these are true:

- you are connected and **not** in global mode;
- the page making the request is itself in the proxy list (e.g. `youtube.com`);
- the request went direct and failed with `ERR_CONNECTION_TIMED_OUT`,
  `ERR_TIMED_OUT`, `ERR_CONNECTION_RESET`, `ERR_CONNECTION_CLOSED` or
  `ERR_CONNECTION_REFUSED`;
- it failed **at least twice within 2 minutes**.

The host is shortened to its base domain before it is added:

- `rr4---sn-xxx.googlevideo.com` → `googlevideo.com`
- `www.google.com.sg` → `google.com.sg`

Reload the page once after the domains are added. Failures on sites that are
*not* in your list are ignored, so unrelated websites never change your list.
Raw IP addresses are never added.

To find blocked domains by hand, open DevTools (F12). Failed requests appear
in red in the **Network** tab, and the **Console** shows lines like
`Failed to load resource: net::ERR_CONNECTION_TIMED_OUT`.

## Server import / export format

Export produces a file like this:

```json
{
  "type": "ss-proxy-servers",
  "version": 1,
  "exportedAt": "2026-10-08T03:00:00.000Z",
  "selectedServerId": "server-abc123",
  "servers": [
    {
      "id": "server-abc123",
      "name": "HY2-Tokyo",
      "host": "127.0.0.1",
      "port": 1080,
      "protocol": "socks5",
      "username": "",
      "password": "",
      "enabled": true,
      "country": null
    }
  ]
}
```

Import accepts this format or a plain array of server objects:

- `host`, `port` (1–65535) and `protocol` (`http`, `https` or `socks5`) are
  required.
- Missing `id` and `name` values are generated.
- A server whose `id` matches an existing server replaces it; other servers
  are appended.
- Existing servers are never deleted by an import.
- Invalid entries are skipped, and the import reports how many.

> ⚠️ Exported files contain passwords in **plain text**. Keep them private and
> don't commit them to a public repository.

## Project structure

```
ss-proxy/
├── manifest.json              # Extension manifest (MV3)
├── background/
│   ├── service-worker.js      # Message handling, connect/disconnect, auth, blocked-domain detector
│   ├── proxy-manager.js       # PAC script generation, chrome.proxy settings
│   └── storage-manager.js     # chrome.storage.local access and defaults
├── popup/                     # Toolbar popup (server picker, toggles)
├── settings/                  # Settings page (domains, server list, server editor)
├── utils/debug.js             # Debug logger
└── assets/icons/              # Icons + create_icons.py generator
```

### Storage (`chrome.storage.local`)

| Key | Contents |
|-----|----------|
| `servers` | Array of server objects |
| `proxyDomains` | Domains routed through the proxy |
| `noProxyDomains` | Domains always connected directly |
| `settings` | `selectedServerId`, `globalMode`, `autoAddBlocked`, … |
| `state` | `isConnected`, `lastConnectedServer` |
| `autoAddedDomains` | Last 50 domains added by the detector |

### Regenerating icons

```bash
python3 assets/icons/create_icons.py assets/icons
```

This needs only Python. Edit the colours or shapes at the top of the script to
change the design.

## Permissions

| Permission | Why |
|------------|-----|
| `proxy` | Apply the PAC script / proxy settings |
| `storage` | Save servers, domains and settings |
| `tabs`, `activeTab` | Read the current tab's domain for the per-site toggle |
| `webRequest` | Detect failed requests for blocked-domain auto-detect |
| `webRequestAuthProvider` | Supply proxy credentials |
| `<all_urls>` | Needed by `webRequest` and proxy authentication |

## Privacy

- All configuration stays in your browser's local extension storage.
- The extension sends none of your data anywhere and has no analytics or
  telemetry.
- Credentials are stored unencrypted in `chrome.storage.local`, the same as most
  proxy extensions.
- `DEBUG` is set to `true` in the source files. With it on, background messages
  are logged to the extension's console, and those messages can include
  credentials. Set `DEBUG = false` in `background/*.js` for everyday use.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Page partly loads in proxy mode but fully in global mode | Some resource domains are missing from the list. Turn on auto-detect, or check DevTools for `ERR_CONNECTION_TIMED_OUT` and add those domains. |
| Nothing goes through the proxy | Check that the local client is running and listening on the host and port you configured. Then reconnect. |
| SOCKS5 proxy asks for a password | Chrome doesn't support SOCKS5 authentication. Use a local client without auth, or use its HTTP inbound. |
| Changes don't apply | Disconnect and connect again, or reload the extension in `chrome://extensions`. |
