# Remote MCP authentication

Since `2.64.0` the remote MCP transport runs on QKERN's own OAuth server
(`2.82`, migration `0062`). This file used to describe a target; it now describes
what is built, and what deliberately is not.

## The two modes

`QKERN_MCP_AUTH` selects how `mcp/http-server.ts` admits callers. Without the
variable the default is `oauth` under `NODE_ENV=production` and `static`
otherwise.

`static` is the local development transport: one Bearer from `QKERN_MCP_TOKEN`,
one tenant from the process environment, every tool. It refuses to start under
`NODE_ENV=production` and refuses to leave the loopback interface. That token is
not revocable, names no user and carries no scopes, which is exactly why it stays
on the developer's machine.

`oauth` is the remote transport. It is described below.

## What a caller presents

Two headers, and both are required:

- `x-qkern-key`: a project API key. It names organization, project and
  environment.
- `Authorization: Bearer qk_oauth_…`: an opaque token issued by this project's
  own authorization code flow with PKCE.

The tenant comes from the key alone. `QKERN_MCP_ORGANIZATION_ID`,
`QKERN_MCP_PROJECT_ID` and `QKERN_MCP_ENVIRONMENT` are not read on this path.
The token row is looked up inside that tenant, so a token presented with a key of
another project simply has no row there, and the answer is the one unknown tokens
get. Swapping tenant through headers is not blocked, it is inexpressible.

## Scope to tool

The mapping lives in `mcp/tool-scopes.ts` and nowhere else.

| Scope | Tools |
| --- | --- |
| `data:read` | `qkern_table_rows_list` |
| `data:write` | `qkern_table_rows_insert`, `qkern_table_row_update`, `qkern_table_row_delete` |
| `identity:read` | no tool of its own; it decides whether the request claims carry the user's email address |

Every other tool is unreachable over OAuth and is not registered for such a
session, so it does not appear in `tools/list` either. The reasons are written out
in `mcp/tool-scopes.ts`; the short version is that `data:read` promises reading
under row level security as that user, and `qkern_query_readonly`,
`qkern_schema_list`, the control-plane tools, Storage, Queues and the migration
tools all do something else. A migration apply through a foreign client is the
door nobody wants, and it stays shut with every scope that exists.

Write does not imply read, the same way it does not at the Data API.

## Claims, refusals and sessions

A tool call runs with `role: authenticated`, `sub` set to the consenting user and
`external` carrying `token_use: "oauth"`, `client_id` and `scope`. These are the
same claims `oauthPrincipal` builds for REST in
`lib/server/data-plane/generated-http.ts`, so a policy cannot tell the two
transports apart, and can tell a foreign application apart from the project's own.

Unknown, expired, revoked and locked-out tokens all get `401` with no reason. A
valid token whose scopes open no tool gets `403` with its own sentence, because
that is an authorization question and re-authenticating would change nothing.
Revocation is deleting the OAuth client; migration `0062` cascades its tokens
away.

A session belongs to the token that opened it. The session id alone is not a key:
a later request carrying a different token is treated as an unknown session,
because the registered tools hang on that session's server object.

Binding beyond loopback requires `QKERN_MCP_ALLOWED_HOSTS`, otherwise DNS
rebinding protection would fall away silently.

## Codex client configuration

Codex supports Streamable HTTP with OAuth, tool allowlists and per-server or
per-tool approval policy. A remote target is in `examples/codex-mcp.oauth.toml`.
The most important server-wide security instructions remain self-contained in the
first 512 characters of the MCP `instructions` field.

Reference: [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

## Certification

Case `(2.91)` in `tests/postgres.integration.test.ts` runs the whole path against
the real database: a real user, a real client, a real code with PKCE, a real
token, the real gate, a real MCP client over the SDK transport, the real generated
Data API under real policies. It asserts the exact tool list per scope bundle, a
real read and a real write under row level security, and the identical refusal of
an ungranted, an expired, a tenant-swapped and a revoked token.
