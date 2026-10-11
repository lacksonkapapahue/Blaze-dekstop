# Changelog

Full notes per release are in README.md ("What's in vX") and docs/plan-vX.md.

## v0.8.1 (MCP servers shared with Blaze CLI)
- MCP servers live in `~/.blaze/mcp.json` in the standard `{"mcpServers": {name: {command, args, env} | {url, headers}}}` shape (plus `"type": "sse"`, `"disabled": true`), shared with Blaze CLI. Desktop follows outside edits, keeps keys it doesn't own, and moves its older servers into the file once.
- Transports: stdio (with `env`), Streamable HTTP and HTTP+SSE (with `headers`); `${VAR}` expands from the environment. Tokens typed into Desktop stay in the keychain.
- Tools are named `mcp__<server>__<tool>`.
- Every MCP tool asks first until set to Always allow; Off hides it.
- Settings › MCP servers: add, enable/disable, check status, per-tool approval.
- CI: the specialist lifecycle test waits up to 15 s for worktrees (flaked on Linux runners).

## v0.8.0 (the Design studio)
- Write-back edits, Directions as live branches, brand kit and taste memory, copy any window, the critic, voice while pointing, states board, visual history, phone preview, one-click ship (Worker 0.7.0 `/v1/comments`).
- Fixed the flaky `blaze.db: database is locked` test.
