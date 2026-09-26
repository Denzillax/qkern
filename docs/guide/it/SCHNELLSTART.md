# Avvio rapido

> Per sviluppatori che conoscono Supabase. Obiettivo: QKERN in locale in [Docker](GLOSSAR.md#docker), un [progetto](GLOSSAR.md#progetto), una [tabella](GLOSSAR.md#tabella), una riga letta via [REST](GLOSSAR.md#rest) e via [SDK](GLOSSAR.md#sdk). I comandi richiedono circa sette minuti, con lettura e clic un quarto d'ora. Sotto "In tutta franchezza" trovi quanto è durato l'ultimo passaggio misurato.

## Che cosa ti serve

- [Node.js](GLOSSAR.md#node-js) {{node}} o più recente, con [npm](GLOSSAR.md#npm)
- Docker Desktop, avviato
- Git, per scaricare il codice sorgente
- PowerShell o una Bash; gli esempi qui sono in PowerShell

Per prima cosa scarica il codice sorgente; tutti i comandi successivi girano in questa cartella, dove si trova `package.json`:

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Avviare i servizi

```powershell
node --version
docker compose up -d
```

Risultato atteso: `v{{node}}` o superiore. Docker segnala `postgres`, `redis`, `minio` e `clamav` come avviati, più quattro brevi container di verifica che terminano subito. Al primo avvio PostgreSQL crea il database del [Control Plane](GLOSSAR.md#control-plane) e il database di progetto `project_database`; ci vuole mezzo minuto.

> Il database di progetto nasce solo su un volume nuovo. Se hai già avviato QKERN in passato, `docker compose down -v` cancella tutti i dati locali e riparti da zero.

## 2. Configurazione

```powershell
Copy-Item .env.example .env.local
```

Apri `.env.local` e cambia sei cose:

- `QKERN_RUNTIME_MODE=postgres` è già impostato così; lascialo.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` e `QKERN_STATEMENT_ENCRYPTION_KEY`: inserisci per ognuno un valore casuale diverso. Generalo con il comando qui sotto, eseguito tre volte.
- Nel blocco "Lokaler Schnellstart" attiva le due righe JSON commentate (togli il `# ` all'inizio).
- Più in basso imposta i quattro interruttori su `true`: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Il file `.env.local` resta da te; è elencato in `.gitignore` e non finisce mai in un repository.

## 3. Avviare QKERN

```powershell
npm ci
npm run dev
```

Risultato atteso: una riga con `Ready` e `http://localhost:3000`. Apri la pagina nel browser: è la pagina iniziale di QKERN.

## 4. Registrazione

Clicca su "Crea un progetto" oppure apri `http://localhost:3000/register`. Inserisci un indirizzo e-mail e una password di almeno dodici caratteri. L'indirizzo non deve essere reale; in locale QKERN non invia e-mail.

Dopo la registrazione arrivi nella [console](GLOSSAR.md#console). QKERN ha creato per te un'[organizzazione](GLOSSAR.md#organizzazione) e un progetto chiamato "First Project". Apri in basso a sinistra "Impostazioni", poi "Generale": lì trovi l'ID del progetto e l'ID dell'organizzazione. Ti servono entrambi tra poco; copiali da qualche parte.

## 5. Collegare l'ambiente al database

In produzione un [provisioner](GLOSSAR.md#provisioner) collega ogni [ambiente](GLOSSAR.md#ambiente) al suo database. In locale non ce n'è uno; uno script fa esattamente questo singolo passo, in un secondo terminale nella cartella del codice sorgente:

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Risultato atteso: `Gebunden: development von <projekt-id> an managed:database-1`. Lo script accede con il login del provisioner e modifica una sola riga, e solo finché l'ambiente è ancora in attesa. Una seconda chiamata termina con "Keine wartende Umgebung gefunden" (nessun ambiente in attesa trovato), ed è giusto così.

L'ID dell'organizzazione serve perché altrimenti la [Row Level Security](GLOSSAR.md#row-level-security) non mostra nessuna riga al provisioner, esattamente come in produzione.

## 6. Creare una tabella

Apri una sessione SQL nel database di progetto:

```powershell
docker compose exec postgres psql -U qkern -d project_database
```

E crea la tabella:

```sql
SET ROLE qkern_ledger_owner;
CREATE TABLE public.notes (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_read_all ON public.notes FOR SELECT USING (true);
CREATE POLICY notes_write_anon ON public.notes FOR INSERT WITH CHECK (true);
INSERT INTO public.notes (title) VALUES ('Erste Notiz');
```

`SET ROLE` è necessario perché il proprietario di tutte le tabelle, il [proprietario del registro](GLOSSAR.md#proprietario-del-registro), non può accedere da solo, come in produzione. La Data API lavora poi con i diritti di chi chiama, e senza Row Level Security non espone affatto una tabella. Con `\q` esci da psql.

## 7. Ottenere una chiave di progetto

Nella console apri "API" e sotto "Chiavi API del progetto" clicca su "Chiave pubblica". Il browser chiede un nome; `demo` basta. La chiave appare una sola volta con l'avviso "Copia adesso, appare una sola volta"; QKERN ne salva solo un checksum. Copiala in una variabile d'ambiente del secondo terminale:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Una [chiave pubblica](GLOSSAR.md#chiave-pubblica) può fare solo quello che la Row Level Security concede a un anonimo. Le nostre due regole qui sopra permettono di leggere e di inserire.

## 8. Leggere via REST

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Risultato atteso: una risposta con `data`, al suo interno `rows` con esattamente una riga, `title` vale `Erste Notiz`. Lo stesso indirizzo con `select=id,title` restituisce solo le due colonne; `filter=done:eq:false` filtra. Le regole per farlo stanno nella [Data API](GLOSSAR.md#data-api).

## 9. Leggere via SDK

In una cartella vuota fuori dalla cartella del codice sorgente:

```powershell
mkdir qkern-demo; cd qkern-demo; npm init -y; npm install @qkern/sdk@alpha
```

Crea il file `demo.mjs`:

```js
import { createQkernClient } from "@qkern/sdk";
const qkern = createQkernClient({ baseUrl: "http://localhost:3000", projectId: "<projekt-id>", environment: "development", projectKey: process.env.QKERN_PUBLIC_KEY });
const result = await qkern.from("notes").select({ limit: 10 });
console.log(result.rows);
```

Ed eseguilo:

```powershell
node demo.mjs
```

Risultato atteso: un array con un oggetto, `title: 'Erste Notiz'`. L'SDK invia la chiave nell'intestazione `x-qkern-key`; non finisce mai in un URL.

## 10. Vedere nel Table Editor

Torna nella console: apri "Table Editor" e scegli `public.notes`. La riga c'è, e con "Inserisci riga" ne aggiungi una seconda. Il Table Editor usa la stessa Data API del tuo script, con le stesse regole.

Ora hai: QKERN in locale, un progetto con il database collegato, una tabella con Row Level Security, una chiave, e la riga letta in tre modi.

## Supabase e QKERN

| In Supabase | In QKERN |
| --- | --- |
| Studio | Console |
| Anon Key | Chiave pubblica; vale la Row Level Security |
| Service Role Key | Chiave di servizio; la Row Level Security vale anche qui |
| PostgREST | Data API |
| GoTrue | Project Auth |
| Storage | Project Storage, privato, con controllo antivirus |
| Realtime | Realtime |
| Edge Functions | Functions in container |
| supabase-js | @qkern/sdk |
| Supabase CLI | @qkern/cli |
| Migrations | Change set con Centro approvazioni |
| SQL della dashboard | SQL Editor in sola lettura; ciò che scrive diventa un change set |

La differenza più grande nel lavoro di tutti i giorni: in QKERN nemmeno la chiave di servizio aggira la Row Level Security. Chi deve vedere tutto riceve una regola che lo dice.

## In tutta franchezza

- Ultimo passaggio misurato: 26 settembre 2026, cartella nuova, 31 minuti di fila. Circa 24 minuti sono andati in due errori nel testo, trovati e corretti in quell'occasione, e in una deviazione con un secondo account; i comandi in sé hanno richiesto circa sette minuti. Log e manifest in `docs/evidence/2026-09-26/`.
- Il collegamento del passo 5 lo fa uno script al posto di un provisioner. Esegue solo quell'unico UPDATE e non crea alcun incarico.
- La tabella nasce con SQL, non con una procedura guidata. La strada con change set e Centro approvazioni richiede il worker delle migrazioni con il suo catalogo di connessioni, che nell'avvio rapido locale non è configurato.
- La chiave di servizio non aggira la Row Level Security, anche se il nome lo fa pensare.
