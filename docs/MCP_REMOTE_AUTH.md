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
| `data:read` | `qkern_table_rows_list`, `qkern_schema_list`, `qkern_query_readonly` |
| `data:write` | `qkern_table_rows_insert`, `qkern_table_row_update`, `qkern_table_row_delete` |
| `project:read` | `qkern_project_get`, `qkern_automation_policy_get` |
| `storage:read` | `qkern_storage_buckets_list`, `qkern_storage_objects_list` |
| `storage:write` | `qkern_storage_object_delete` |
| `queues:read` | `qkern_queues_list`, `qkern_queue_status`, `qkern_queue_message_trace` |
| `queues:write` | `qkern_queue_message_enqueue` |
| `logs:read` | `qkern_logs_search` |
| `migrations:propose` | `qkern_migration_preview` |
| `identity:read` | no tool of its own; it decides whether the request claims carry the user's email address |

One tool has no scope at all and is therefore not registered for an OAuth
session, so it does not appear in `tools/list` either: `qkern_migration_apply_queue`
changes control-plane state and leads to a change in the project database. An
apply through a foreign client is the door nobody wants. It does not fall under
`migrations:propose`, because proposing and applying are two sentences, and it
gets no scope of its own here either.

## The free query and the schema list, under row level security since `2.117`

Both carried no scope from `2.64` to `2.116`, and the reason given then was
correct. They ran through `ProjectDataPlaneService`, which reads with the
project's read role, with `BEGIN READ ONLY` and with `SET LOCAL row_security = on`,
but without `request.jwt.claims`. Row level security was therefore on and the role
carries no `BYPASSRLS`; a policy simply had no claims to read, and a table without
a policy gave everything up. That is not reading as that user, so `data:read` would
have been a sentence the product did not keep. The note said that whoever gives
these two a scope has to put them under row level security first. That happened in
`2.117`, and the two are separate decisions.

**The free query** runs over OAuth through
`GeneratedDataApiPort.queryUnderRowSecurity`, the same door as
`qkern_table_rows_list`: role `authenticated`, the consenting user's claims,
`row_security = on`, `BEGIN READ ONLY`, the same timeouts. What is new is a reading
of the query text. `lib/server/data-plane/free-query.ts` names every relation in
the statement, and each one goes through `assertTableBoundary(..., "select")`
before the query runs, so a table without row level security is unreachable on
this path even when the project role may select from it.

That reading costs restrictions, and they are all named at the tool itself:

- Every table is written with its schema, and that schema is the `schema`
  argument. The query runs with `SET LOCAL search_path = pg_catalog`, so an
  unqualified name would resolve somewhere other than where the reading looked.
  System catalogs and `information_schema` are therefore unreachable by
  construction, not by a blocklist.
- A name from `WITH` is the only relation without a schema that passes, and it
  counts exactly where PostgreSQL counts it: in later bindings and in the body,
  not inside its own binding. `WITH t AS (SELECT * FROM t)` is refused, because
  the inner `t` is the real table.
- Functions, operators and casts must be unqualified, so they resolve in
  `pg_catalog` only. A `SECURITY DEFINER` function of a user schema runs with its
  owner's rights and its body is not in the query text.
- Only these functions are accepted: `abs`, `avg`, `ceil`, `ceiling`,
  `char_length`, `coalesce`, `concat`, `count`, `date_part`, `date_trunc`,
  `floor`, `greatest`, `least`, `length`, `lower`, `ltrim`, `max`, `min`,
  `nullif`, `now`, `round`, `rtrim`, `sum`, `to_char`, `trim`, `upper`. A list and
  not a blocklist, because `pg_catalog` itself is not harmless: `query_to_xml`
  runs a query from a text argument.
- One `SELECT`, no DDL, no DML, no multiple statements and no `WITH RECURSIVE`
  (the parser does not accept it, so it falls at `isReadOnlySql`).
- At most 100 rows, 256 KiB and 5 seconds, and columns whose name looks like a
  secret are left out and named in `omitted`.

**The schema list** is a different question with a different answer. Knowing a
schema is not reading rows, and `inspectSchema` shows every table of a schema with
every column, including the ones without a policy and the ones without a select
privilege. Over OAuth the tool therefore answers with `listReadableTables`: the
tables this surface serves for reading, sensitive-named columns dropped. That is
the same document the same token already gets over `generated-openapi` and through
GraphQL introspection, and both of those doors ask for `data:read`. A scope that
holds at one door and not at the other would not be a scope. `project:read` would
have been the wrong answer: it describes the shape of the project environment, and
the shape of the data belongs to the Data API.

For the static local bearer both tools stay what they were: the whole catalog and
a query without a policy, on the developer's machine and nowhere else.

What Supabase does here is worth naming, because it is the opposite choice. Its
MCP `execute_sql` connects with an elevated role, bypasses row level security and
offers a `--read-only` flag as the mitigation; the server is authenticated by a
developer's token, not by an end user's consent, and a prompt injection reading
private tables through it has been demonstrated publicly. QKERN's free query is
not that tool. It reads as the consenting user or it refuses.

`storage:write` arrived in migration `0078` together with the one tool that
checks it. Until then it was left out, because a scope nobody checks is a label,
and a label on a consent page is worse than a missing entry: the user reads a
boundary that holds nowhere.

That tool is a delete and not an upload. An upload here is a reservation, then
the bytes at the provider against a short-lived grant, then a completion that
compares the checksum of the whole file and starts the scanner. A tool cannot do
the middle step, and one that takes the bytes itself would push them through a
model context and have the model vouch for the checksum the completion compares.
The scope also covers no bucket: creating, changing and removing a bucket demand
the operator role and have no entry in the table.

Write does not imply read, the same way it does not at the Data API.
`queues:write` opens enqueueing and not the queue list, and it opens no worker
operation at all. Claim, lease, renewal and completion are deliberately outside
MCP, they have no entry in the table, and a name without an entry is not a
permission.

The six scopes added in migration `0073` change nothing about the HTTP doors.
`ProjectOAuthAdmission` stays at `reject` for Queues, Functions and Storage;
opening a door means checking its claims, its role and its refusals, which is a
cut per door. The reading storage tools and the queues also run inside this server
with `role: admin` on the operator's behalf rather than under the consenting
user's row level security, so `storage:read` and `queues:read` say something about
this project environment and nothing about that user's own data. What carries that
is the ceiling on the client: an owner or administrator writes which scopes an
application may ever ask for, and a user can only consent to what already stands
there.

Deleting an object is the exception, because that ceiling alone would not be
enough there. The operator role gives up every object of every bucket, including
another user's; for a read that stays an open boundary, for a delete it would be a
privilege escalation through one end user's consent.
`qkern_storage_object_delete` therefore runs with `role: authenticated` and the
consenting user's id, and the write policy of the bucket decides per object: an
`owner` bucket gives up only that user's own objects, a `private` bucket none. The
ceiling on the client still stands above it, as the second boundary.

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

Case `(2.117)` in `tests/postgres.integration.test.ts` certifies the free query
against the real database: two real users, two real consents, two real tokens, one
table under a policy on `sub` and one table without row level security that the
project role may select from. The same statement gives each user exactly their own
rows, the table without row level security answers
`GENERATED_DATA_API_RLS_REQUIRED` although the role can read it, and the schema
list leaves that table and a sensitive-named column out. The reading itself is
certified without a database in `tests/mcp-free-query.test.ts`.

Case `(2.91)` in `tests/postgres.integration.test.ts` runs the whole path against
the real database: a real user, a real client, a real code with PKCE, a real
token, the real gate, a real MCP client over the SDK transport, the real generated
Data API under real policies. It asserts the exact tool list per scope bundle, a
real read and a real write under row level security, and the identical refusal of
an ungranted, an expired, a tenant-swapped and a revoked token.
