# @qkern/sdk

Typed, framework-free ESM client for QKERN. This Alpha package is private and is
not published to a registry. Build it from the repository root with
`npm run build:sdk`; distributable JavaScript and declarations are written to
`sdk/typescript/dist`.

```ts
import { createQkernClient } from "@qkern/sdk";
import type { Database } from "./qkern/types/database.js";

const qkern = createQkernClient<Database>({
  baseUrl: "http://localhost:3000",
  projectId: "project-local",
  environment: "development",
  projectKey: process.env.QKERN_PROJECT_KEY,
});

const result = await qkern.from("orders").select({ limit: 20 });
```

Keys and tokens remain caller-owned and are sent only as headers. Writes are not
retried automatically.

## License

Apache License 2.0. See `LICENSE` in this package.
