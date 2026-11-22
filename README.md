# Browser MCP Bridge — Universal

Control your real Firefox with any AI agent, any version.

## Universal install (AI-proof)

MCP config — works for **any** agent (Claude, Cursor, OpenCode/Bob, Windsurf). Uses latest GH, auto-fixes version drift:

```json
{
  "mcpServers": {
    "firefox": {
      "command": "npx",
      "args": ["-y", "github:nullthrix/firefox-mcp-server"]
    }
  }
}
```

Or pinned npm (auto-syncs manifest):

```json
{ "mcpServers": { "browser": { "command": "npx", "args": ["ff-browser-mcp-bridge@latest"] } } }
```

For OpenCode add to `~/.config/opencode/opencode.json`:
```json
{ "mcp": { "servers": { "firefox": { "command": ["node","/Users/YOU/opencode/tools/firefox-mcp/dist/index.js"], "type": "local" } } } }
```

Then: `git clone https://github.com/nullthrix/firefox-mcp-server && cd firefox-mcp-server && npm install && npm run build` — `scripts/sync-version.mjs` syncs `extension/manifest.json` from `package.json` so AMO/npm never drift.

## Connect

1. Install Firefox addon: https://addons.mozilla.org/en-US/firefox/addon/ff-browser-mcp-bridge/
2. Open any https page (not `about:`), click toolbar icon → badge `ON`. Toggle OFF→ON to reconnect after server restart.
3. Any AI can self-heal: if `No connection` or `Timeout` → server logs `protocol X vs Y — update`, extension accepts both `getUrl`/`get_url` via `TYPE_ALIASES` (`src/protocol.ts`).

## Universal fixes in v0.1.2

- Single version source (`package.json` → `extension/manifest.json` via `scripts/sync-version.mjs`)
- Hello handshake (`hello {version,protocol}`) with warn not fail
- Alias fallback (`getUrl` ↔ `get_url`, `browser_snapshot` ↔ `snapshot`) so any combo works
- Stale WS kill on new connection (`src/server.ts`)

## License

Apache-2.0
