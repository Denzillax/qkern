# QKERN Agent Instructions

Before changing the project, read `STATUS.md`, `docs/CLAUDE_HANDOFF.md`,
`docs/STUFENPLAN.md`, `docs/HANDBUCH.md`, `docs/MODULES.md` and
`docs/DOCS_MAINTENANCE.md`.

For every material feature, migration, public API, configuration, security boundary
or release change, update the applicable documentation in the same change. Always
keep `STATUS.md` honest about implemented, preview and open work. Update the current
release note, stage status, handbook, OpenAPI, `.env.example`, security and QA docs
when their contract changes. Do not rewrite historical release notes.

Do not call a Product Preview production-ready. Do not claim Swiss data residency,
compliance, HA, RPO/RTO or Go-live readiness without the required external evidence.
Run strict typecheck, tests and production build before packaging a release.

Every versioned checkpoint must be independently resumable without chat history.
Update the package version, `STATUS.md`, the current release note, stage plan,
handbook, QA evidence and `docs/CLAUDE_HANDOFF.md`; then create a source archive
that excludes dependencies, build output, local environment files and credentials.
Record the exact verification result and the next bounded task. Never overwrite or
rewrite a historical release note or silently reuse a previous version number.
