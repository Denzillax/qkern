# @qkern/cli

Secret-free local workflow CLI for QKERN. This Alpha package is private and is
not published to a registry. Build it with `npm run build:cli`, then run
`node cli/dist/main.js` from a project directory.

Project keys are read only from `QKERN_PROJECT_KEY`. Configuration never contains
credentials, migration planning never executes SQL, and seed checking accepts
only bounded INSERT statements.

## License

Apache License 2.0. See `LICENSE` in this package.
