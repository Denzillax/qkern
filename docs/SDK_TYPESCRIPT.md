# QKERN TypeScript SDK

Das frameworkfreie SDK liegt unter `sdk/typescript` und trägt die Paketidentität
`@qkern/sdk`. Der Stand `1.7.0-alpha.3` wird reproduzierbar als ESM plus
Typdeklarationen nach `sdk/typescript/dist` gebaut. Das Paket bleibt absichtlich
`private` und wird in diesem Alpha nicht in eine Registry publiziert.

```ts
type Database = {
  public: { Tables: {
    orders: {
      Row: { id: string; status: string; total: number };
      Insert: { status: string; total: number };
      Update: { status?: string };
    };
  } };
};

const qkern = createQkernClient<Database>({
  baseUrl: "https://api.example.ch",
  projectId: "project-id",
  environment: "production",
  projectKey,
  accessToken,
});

const result = await qkern.from("orders").select({
  columns: ["id", "status"],
  filters: [{ column: "status", operator: "eq", value: "paid" }],
  limit: 20,
});
```

`insert` nimmt seit Fall `2.115` ein zweites Argument mit `onConflict` und wird
damit zum Upsert:

```ts
await qkern.from("orders").insert(
  [{ status: "paid", total: 42 }],
  { onConflict: ["id"] },
);
```

Es ist dieselbe Route und dasselbe Verb wie ohne, nur mit einem Feld mehr im
Rumpf. Der Konfliktschlüssel muss ein Primärschlüssel oder eindeutiger Index der
Tabelle sein, und ob er das ist, entscheidet der Katalog der Projektdatenbank.
Das SDK prüft nur die Gestalt der Spaltennamen; passt der Schlüssel nicht, kommt
`GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN` mit Status 400 zurück. Ein Upsert
verlangt am Server zusätzlich das Recht zum Ändern.

Enthalten sind typed Select/Insert/Upsert/Update/Delete, Schema-Introspection, Queue-
Enqueue/Status/DLQ, Project-Auth-Basisaufrufe und Storage-Listen. Projekt-Key und
App-Token werden ausschließlich in Headern übertragen. Requests folgen keinen
Redirects, haben feste Timeouts und begrenzte Responses. Write-Aufrufe werden nie
automatisch wiederholt; Queue-Retry-Sicherheit entsteht explizit über `dedupeKey`.
Fehler geben nur bounded Codes, Status und sichere Request-ID aus, nie Servertext.

Lokales HTTP ist nur für `localhost` und `127.0.0.1` zulässig; alle anderen Ziele
benötigen eine exakte HTTPS-Origin ohne Pfad, Query oder Credentials. Das SDK
speichert Credentials nicht dauerhaft und enthält keine Telemetrie.

`npm run build:sdk` erzeugt JavaScript, Source Maps sowie `.d.ts`/Declaration Maps;
`npm run verify:packages` prüft den tatsächlichen Tarball-Inhalt. Der Live-Schema-
Typ wird über `qkern schema pull` generiert.

Offen: Registry-Publishing, Browser-/Node-Bundler-Matrix außerhalb des vorhandenen
Node-Smokes, React-Helfer, Upload-Streaming, Realtime-Client und publizierte Examples.
