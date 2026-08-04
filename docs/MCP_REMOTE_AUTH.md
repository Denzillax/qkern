# Remote MCP authentication target

QKERN's current static Bearer transport is restricted to the local, explicitly
scoped product demonstration. A shared remote deployment must not select its
organization, project or environment from process-wide defaults.

## Required production claims and checks

Every MCP request must resolve a server-validated principal containing:

- issuer and audience bound to the QKERN MCP resource;
- expiry, issued-at and a unique token/session identifier;
- user or service actor, organization, project and environment;
- explicit tool scopes such as `project:read`, `schema:read`, `query:read` and
  `migration:preview`;
- revocation state checked before session initialization and sensitive tools.

The MCP session must remain bound to that principal. A later request cannot
change tenant or scopes through headers, tool arguments or environment values.
Migration previews still require QKERN's own immutable Change Set and Approval
flow; OAuth authorization does not replace an Approval.

## Codex client configuration

Codex supports Streamable HTTP with OAuth, server-advertised scopes, tool
allowlists and per-server or per-tool approval policy. The production target is
provided in `examples/codex-mcp.oauth.toml`. The most important server-wide
security instructions must remain self-contained in the first 512 characters
of the MCP `instructions` field.

Reference: [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

## Acceptance gate

Remote mode remains disabled until automated tests cover invalid issuer and
audience, expired and revoked tokens, tenant/scope swapping, MCP session replay,
read-only/write tool separation and forced re-authentication after revocation.
