# Browser MCP Bridge

Control your real, logged-in Firefox with AI — without giving up your privacy.

## About

Browser MCP Bridge is an MCP server + Firefox WebExtension that lets AI agents (Claude, Cursor, Windsurf, Bob) drive your actual Firefox browser. No separate browser profile. No cloud relay. Everything stays on your machine.

Connect one tab at a time by clicking the toolbar icon. The badge turns **ON** when live. Click again to disconnect.

## Setup

**1. Add to your MCP client config**

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["ff-browser-mcp-bridge@latest"]
    }
  }
}
```

**2. Install the Firefox extension**

Search **Browser MCP Bridge** on [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ff-browser-mcp-bridge/) and install it.

**3. Connect a tab**

Click the **Browser MCP Bridge** toolbar icon in the tab you want to control. The badge turns **ON** when connected.

## Why

Most browser automation tools spin up a clean browser instance — which means you're not logged in, your cookies are gone, and bot detection kicks in immediately.

Browser MCP Bridge uses your real Firefox session:

- **Private** — automation runs entirely locally. Nothing leaves your machine.
- **Logged in** — your existing cookies, sessions, and saved credentials work as-is.
- **Real fingerprint** — uses your actual browser profile, not a headless automation signature.
- **Fast** — no network relay, no remote browser farm. Commands execute directly in your tab.

## Credits

- [BrowserMCP](https://github.com/BrowserMCP/mcp) — the original concept of bridging a real browser session to an MCP server.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — the ARIA snapshot approach and tool design that both projects build on.

## License

Apache-2.0
