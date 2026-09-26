# Il primo backend

> Per sviluppatori che mettono in piedi un [backend](GLOSSAR.md#backend) per la prima volta. Fai la stessa strada dell'[Avvio rapido](SCHNELLSTART.md), ma qui prima di ogni passo trovi perché serve, e dopo che cosa è appena successo. Se leggi tutto, conta mezz'ora.

## Che cos'è un backend

Un'app ha due metà. Il [frontend](GLOSSAR.md#frontend) è quello che l'utente vede: la pagina nel browser, l'app sul telefono. Il backend è tutto quello che sta dietro: il [database](GLOSSAR.md#database) in cui stanno i dati, il login, i file, le regole su chi può fare che cosa.

Frontend e backend comunicano attraverso un'[API](GLOSSAR.md#api), un linguaggio fisso fatto di richieste e risposte. In QKERN è [REST](GLOSSAR.md#rest) su HTTP: il frontend chiede "dammi le righe della tabella notes", il backend risponde in [JSON](GLOSSAR.md#json).

QKERN è un backend di questo tipo, già costruito. Il tuo lavoro è avviarlo, dirgli quali tabelle esistono e chi può vederle, e poi parlarci dal frontend.

## Che cosa ti serve

- [Node.js](GLOSSAR.md#node-js) {{node}} o più recente, con [npm](GLOSSAR.md#npm). Node esegue JavaScript fuori dal browser; QKERN stesso è scritto in TypeScript e gira su Node.
- Docker Desktop. [Docker](GLOSSAR.md#docker) avvia i programmi in scatole chiuse, i [container](GLOSSAR.md#container), senza che tu debba installarli. PostgreSQL, Redis, l'object storage e l'antivirus li ottieni così con un solo comando.
- Git, per scaricare il codice sorgente.
- PowerShell o una Bash; gli esempi qui sono in PowerShell.

Per prima cosa scarica il codice sorgente; tutti i comandi successivi girano in questa cartella, dove si trova `package.json`. `git clone` scarica il repository, cioè il codice sorgente con tutta la sua storia, sul tuo computer:

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Avviare i servizi

Perché: QKERN è fatto del programma vero e proprio e di quattro servizi di cui ha bisogno. I servizi arrivano da Docker, il programma lo avvii al passo 3.

```powershell
node --version
docker compose up -d
```

Che cosa è successo: `node --version` mostra `v{{node}}` o superiore; altrimenti aggiorna Node. [Compose](GLOSSAR.md#compose) legge il file `docker-compose.yml` e avvia in background `postgres`, `redis`, `minio` e `clamav`, più quattro brevi container di verifica che terminano subito. Al primo avvio PostgreSQL crea due database: quello del [Control Plane](GLOSSAR.md#control-plane), in cui QKERN tiene i propri dati, e `project_database`, in cui staranno i dati della tua app. Ci vuole mezzo minuto.

> Il database di progetto nasce solo su un volume nuovo. Un [volume](GLOSSAR.md#volume) è lo spazio di memoria di un container che sopravvive ai riavvii. Se hai già avviato QKERN in passato, `docker compose down -v` cancella tutti i dati locali e riparti da zero.

## 2. Configurazione

Perché: QKERN legge le sue impostazioni dalle [variabili d'ambiente](GLOSSAR.md#variabile-d-ambiente). Il file `.env.example` le elenca tutte con una spiegazione; la tua copia si chiama `.env.local` e contiene valori che riguardano solo te.

```powershell
Copy-Item .env.example .env.local
```

Apri `.env.local` e cambia sei cose:

- `QKERN_RUNTIME_MODE=postgres` è già impostato così; lascialo. Dice a QKERN di usare il database vero al posto di una memoria che si svuota a ogni riavvio.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` e `QKERN_STATEMENT_ENCRYPTION_KEY`: inserisci per ognuno un valore casuale diverso. Un pepper è un segreto che QKERN mescola in ogni [hash della password](GLOSSAR.md#hash-della-password); senza, un database rubato sarebbe più facile da forzare. Il terzo valore cifra le istruzioni SQL salvate nel Control Plane. Generalo con il comando qui sotto, eseguito tre volte.
- Nel blocco "Lokaler Schnellstart" attiva le due righe JSON commentate (togli il `# ` all'inizio). Dicono a QKERN dove si trova `project_database` e con quali login la raggiunge.
- Più in basso imposta i quattro interruttori su `true`: `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`. Sono spenti apposta, perché nessuno esponga un database per sbaglio.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Che cosa è successo: hai detto a QKERN dove sono i suoi database e con che cosa protegge le password. Il file `.env.local` resta da te; è elencato in `.gitignore` e non finisce mai in un repository.

## 3. Avviare QKERN

Perché: `npm ci` scarica le librerie di cui QKERN ha bisogno, esattamente nelle versioni del lockfile. `npm run dev` avvia il programma in modalità di sviluppo, in cui le modifiche al codice si vedono subito.

```powershell
npm ci
npm run dev
```

Che cosa è successo: compare una riga con `Ready` e `http://localhost:3000`. `localhost` è il tuo computer, `3000` la [porta](GLOSSAR.md#porta) su cui QKERN resta in ascolto. Apri la pagina nel browser: è la pagina iniziale di QKERN. Il terminale resta aperto finché QKERN gira; i comandi successivi vanno in un secondo terminale nella stessa cartella.

## 4. Registrazione

Perché: la [console](GLOSSAR.md#console) è l'interfaccia con cui usi QKERN. Richiede un account, così più avanti si sa chi ha modificato che cosa.

Clicca su "Crea un progetto" oppure apri `http://localhost:3000/register`. Inserisci un indirizzo e-mail e una password di almeno dodici caratteri. L'indirizzo non deve essere reale; in locale QKERN non invia e-mail.

Che cosa è successo: QKERN ha creato il tuo account, più un'[organizzazione](GLOSSAR.md#organizzazione) (il tuo spazio di lavoro) e un [progetto](GLOSSAR.md#progetto) chiamato "First Project". Un progetto è un'app: ha dati propri, utenti propri, chiavi proprie. Ogni progetto ha tre [ambienti](GLOSSAR.md#ambiente), development, staging e production, così puoi fare prove senza toccare dati veri.

Apri in basso a sinistra "Impostazioni", poi "Generale": lì trovi l'ID del progetto e l'ID dell'organizzazione. Ti servono entrambi tra poco; copiali da qualche parte.

## 5. Collegare l'ambiente al database

Perché: un progetto appena creato non sa ancora dove si trova il suo database. In produzione un [provisioner](GLOSSAR.md#provisioner) crea un server di database e registra la connessione. In locale non ce n'è uno; uno script fa esattamente questa singola registrazione.

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Che cosa è successo: `Gebunden: development von <projekt-id> an managed:database-1`. `managed:database-1` è il nome con cui il tuo `.env.local` conosce il database di progetto. Lo script accede con il login del provisioner e modifica una sola riga, e solo finché l'ambiente è ancora in attesa. Una seconda chiamata termina con "Keine wartende Umgebung gefunden" (nessun ambiente in attesa trovato), ed è giusto così: un ambiente già collegato non si può deviare altrove.

L'ID dell'organizzazione serve perché altrimenti la [Row Level Security](GLOSSAR.md#row-level-security) non mostra nessuna riga al provisioner. È la stessa protezione che più avanti separa i tuoi utenti tra loro, e vale anche per QKERN stesso.

## 6. Creare una tabella

Perché: i dati stanno nelle [tabelle](GLOSSAR.md#tabella), con [colonne](GLOSSAR.md#colonna) per i campi e [righe](GLOSSAR.md#riga) per le voci. Costruiamo una tabella per le note. Per farlo parli direttamente con PostgreSQL nella sua lingua, l'[SQL](GLOSSAR.md#sql).

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

Che cosa è successo, riga per riga:

- `SET ROLE qkern_ledger_owner`: da adesso lavori come proprietario di tutte le tabelle, il [proprietario del registro](GLOSSAR.md#proprietario-del-registro). Non può accedere da solo, come in produzione; per questo la deviazione tramite `SET ROLE`.
- `CREATE TABLE`: la tabella `notes` con un numero come [chiave primaria](GLOSSAR.md#chiave-primaria), un titolo e una spunta.
- `ENABLE ROW LEVEL SECURITY`: da adesso il database decide riga per riga chi può vederla. Senza questa riga QKERN non espone affatto la tabella tramite l'API.
- I due `CREATE POLICY`: le [regole](GLOSSAR.md#policy). Tutti possono leggere, tutti possono inserire. Per un'app vera qui scriveresti "solo il proprietario della riga".
- `INSERT`: la prima riga.

Con `\q` esci da psql.

## 7. Ottenere una chiave di progetto

Perché: chi parla con il database tramite l'API deve identificarsi. Una [chiave API](GLOSSAR.md#chiave-api) è un lungo segreto che QKERN associa a un progetto.

Nella console apri "API" e sotto "Chiavi API del progetto" clicca su "Chiave pubblica". Il browser chiede un nome; `demo` basta. La chiave appare una sola volta con l'avviso "Copia adesso, appare una sola volta"; QKERN ne salva solo un checksum. Copiala in una variabile d'ambiente del secondo terminale:

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Che cosa è successo: hai una [chiave pubblica](GLOSSAR.md#chiave-pubblica). "Pubblica" significa che può stare in un frontend, dove chiunque la può vedere, perché può fare solo quello che la Row Level Security concede a un anonimo. Le nostre due regole qui sopra permettono di leggere e di inserire. Una [chiave di servizio](GLOSSAR.md#chiave-di-servizio) è pensata per i server; in QKERN nemmeno lei aggira le regole.

## 8. Leggere via REST

Perché: è la strada che farà più avanti il tuo frontend. Una richiesta HTTP a un indirizzo, la chiave nell'intestazione, JSON in risposta.

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Che cosa è successo: una risposta con `data`, al suo interno `rows` con esattamente una riga, `title` vale `Erste Notiz`. Leggi l'indirizzo da sinistra a destra: progetto, ambiente, tabella, righe. Lo stesso indirizzo con `select=id,title` restituisce solo le due colonne; `filter=done:eq:false` filtra. QKERN costruisce questa [Data API](GLOSSAR.md#data-api) a partire da quello che c'è nel database; tu non scrivi codice per farlo.

## 9. Leggere via SDK

Perché: in un'app vera non vuoi comporre indirizzi a mano. L'[SDK](GLOSSAR.md#sdk) è una libreria che lo fa per te e ti dà i tipi per le tue tabelle.

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

Che cosa è successo: un array con un oggetto, `title: 'Erste Notiz'`. L'SDK ha inviato la stessa richiesta che hai fatto tu al passo 8, solo con la chiave nell'intestazione `x-qkern-key`; non finisce mai in un URL, dove potrebbe comparire nei log.

## 10. Vedere nel Table Editor

Perché: la console mostra gli stessi dati tramite la stessa API, con le stesse regole; non esiste un ingresso sul retro.

Torna nella console: apri "Table Editor" e scegli `public.notes`. La riga c'è, e con "Inserisci riga" ne aggiungi una seconda.

Ora hai: QKERN in locale, un progetto con il database collegato, una tabella con Row Level Security, una chiave, e la riga letta in tre modi.

## Come proseguire

- Utenti per la tua app: [Auth](GLOSSAR.md#auth) nel manuale, sezione 6. Un utente connesso riceve un [JWT](GLOSSAR.md#jwt), e le tue regole possono dire "solo il proprietario della riga".
- File: [Storage](GLOSSAR.md#storage) nel manuale, sezione 7. I bucket sono privati, i caricamenti vengono controllati contro i virus.
- Aggiornamenti in diretta: [Realtime](GLOSSAR.md#realtime) nel manuale, sezione 8.
- Compiti in background: [Queues](GLOSSAR.md#coda), Cron e webhook nel manuale, sezioni da 9 a 9b.

Il manuale si trova nel repository in `docs/HANDBUCH.md`.

## In tutta franchezza

- Ultimo passaggio misurato della stessa strada: 26 settembre 2026, 31 minuti di fila, di cui circa sette minuti di soli comandi; i dettagli sono in `docs/evidence/2026-09-26/`.
- Il collegamento del passo 5 lo fa uno script al posto di un provisioner. Esegue solo quell'unico UPDATE e non crea alcun incarico.
- La tabella nasce con SQL, non con una procedura guidata. La strada con change set e Centro approvazioni richiede il worker delle migrazioni con il suo catalogo di connessioni, che nell'avvio rapido locale non è configurato.
- Le due regole del passo 6 permettono tutto a chiunque. Per un'app vera sono troppo generose; il manuale mostra regole per singolo utente.
