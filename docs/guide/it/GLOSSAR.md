# Glossario

Circa novanta termini, in ordine alfabetico, ognuno in tre righe: che cos'è, dove compare in QKERN e come si chiama in Supabase. I termini tecnici usati nelle spiegazioni hanno una voce propria.

## AI Bridge

- **Che cos'è:** Una via con cui un agente IA come Claude Code o Codex prepara modifiche al tuo progetto senza eseguirle da solo.
- **In QKERN:** Vista AI Bridge nella console. L'agente legge lo schema e crea anteprime; l'approvazione segue la regola del progetto.
- **In Supabase:** Nessun equivalente diretto; il più vicino è il server MCP di Supabase.

## Ambiente

- **Che cos'è:** Una versione separata di un progetto: development per costruire, staging per verificare, production per i clienti.
- **In QKERN:** Scelta in alto a destra nella console; ognuno ha il suo database, e production ha regole più severe.
- **In Supabase:** Branches, all'incirca.

## Anon Key

- **Che cos'è:** Il nome che Supabase dà alla chiave che può stare in un frontend e vede solo quello che le regole concedono a un anonimo.
- **In QKERN:** In QKERN si chiama chiave pubblica; vedi quella voce.
- **In Supabase:** Anon Key.

## Apache 2.0

- **Che cos'è:** Una licenza open source: usare, modificare e ridistribuire liberamente, anche a scopo commerciale, senza dover pubblicare il proprio codice.
- **In QKERN:** La licenza di QKERN, dell'SDK e della CLI; il file LICENSE nel repository.
- **In Supabase:** Supabase è sotto Apache 2.0 e in parte sotto altre licenze.

## API

- **Che cos'è:** Un linguaggio fisso fatto di richieste e risposte, con cui due programmi comunicano, per esempio il tuo frontend e il backend.
- **In QKERN:** Tutto quello che QKERN offre verso l'esterno è un'API; la vista API mostra la Data API e le chiavi.
- **In Supabase:** API.

## Auth

- **Che cos'è:** Tutto ciò che riguarda l'accesso: account, password, accesso tramite altri fornitori, più fattori, sessioni.
- **In QKERN:** Project Auth per gli utenti della tua app, vista Auth. Separato dal login della console stessa.
- **In Supabase:** Auth, tecnicamente GoTrue.

## Backend

- **Che cos'è:** La parte invisibile di un'app: database, login, file, regole. Il frontend mostra, il backend sa.
- **In QKERN:** QKERN è un backend che non devi costruire da solo.
- **In Supabase:** Anche Supabase è un backend.

## Backup

- **Che cos'è:** Una copia dei dati da cui ripristinare dopo un errore o un guasto.
- **In QKERN:** Un drill dimostra backup e ripristino fino a un momento preciso contro un PostgreSQL vero; nella console, sotto Backup, c'è ancora un segnaposto.
- **In Supabase:** Backups sotto Database, con Point-in-time Recovery nel piano a pagamento.

## Bucket

- **Che cos'è:** Un contenitore per file nell'object storage, con regole proprie su chi può mettere dentro e prendere fuori.
- **In QKERN:** Vista Storage, Bucket. I bucket sono privati, i caricamenti vengono controllati contro i virus.
- **In Supabase:** Bucket.

## Centro approvazioni

- **Che cos'è:** Il posto in cui le modifiche aspettano finché una persona o una regola le approva.
- **In QKERN:** Vista Centro approvazioni. Regole: manuale, protetta, autonoma; production richiede in più una firma dall'esterno.
- **In Supabase:** Nessun equivalente.

## Certificato

- **Che cos'è:** Il documento d'identità di un server per TLS, rilasciato da un ente di cui ci si fida.
- **In QKERN:** Il backup drill crea il proprio e verifica contro di esso con verify-full.
- **In Supabase:** Uguale.

## Certificazione

- **Che cos'è:** In QKERN: una verifica contro servizi veri, il cui protocollo sta nel repository. Nessuna verifica da parte di terzi.
- **In QKERN:** I numeri sulla pagina iniziale vengono da questi protocolli; un test vieta i numeri scritti a mano.
- **In Supabase:** Nessun equivalente.

## Change Set

- **Che cos'è:** Una proposta di modifica alla struttura del database, che viene verificata e approvata prima di essere eseguita.
- **In QKERN:** Nasce da un SQL che scrive nel SQL Editor o tramite l'AI Bridge; attende nel Centro approvazioni.
- **In Supabase:** Migrations, però senza approvazione integrata.

## Chiave API

- **Che cos'è:** Un lungo segreto che un programma invia con ogni richiesta, così il backend sa a quale progetto appartiene.
- **In QKERN:** Chiave pubblica e chiave di servizio, create nella vista API. Il segreto appare una volta; QKERN salva solo un checksum.
- **In Supabase:** Anon Key e Service Role Key.

## Chiave di progetto

- **Che cos'è:** Termine che raccoglie chiave pubblica e chiave di servizio di un progetto.
- **In QKERN:** Vista API.
- **In Supabase:** API Keys.

## Chiave di servizio

- **Che cos'è:** La chiave per i server, mai per un frontend.
- **In QKERN:** Vista API, Chiave di servizio per il server. Imposta il claim service_role; la Row Level Security vale comunque.
- **In Supabase:** Service Role Key, che in Supabase aggira le regole.

## Chiave esterna

- **Che cos'è:** Una colonna che punta alla riga di un'altra tabella, per esempio il numero cliente in un ordine.
- **In QKERN:** Normali chiavi esterne di PostgreSQL; lo Schema Visualizer che le disegna è ancora un segnaposto.
- **In Supabase:** Foreign Key.

## Chiave primaria

- **Che cos'è:** La colonna che rende unica ogni riga, di solito un numero o un UUID.
- **In QKERN:** Obbligatoria per ogni tabella che la Data API espone.
- **In Supabase:** Primary Key.

## Chiave pubblica

- **Che cos'è:** La chiave che può stare in un frontend. Può fare solo quello che le regole concedono a un anonimo.
- **In QKERN:** Vista API, Chiave pubblica per il browser. Imposta il claim anon; vale la Row Level Security.
- **In Supabase:** Anon Key.

## CLI

- **Che cos'è:** Un programma per la riga di comando che svolge compiti senza interfaccia grafica.
- **In QKERN:** Il pacchetto @qkern/cli: configurare un progetto, scaricare lo schema, verificare le migrazioni.
- **In Supabase:** Supabase CLI.

## Coda

- **Che cos'è:** Una fila d'attesa per compiti che non vanno svolti subito; un worker li prende uno dopo l'altro.
- **In QKERN:** Project Queues in PostgreSQL, vista Integrazioni, Code; con dedupe, lease e dead letter.
- **In Supabase:** pgmq.

## Colonna

- **Che cos'è:** Un campo di una tabella, per esempio title o done, con un tipo fisso.
- **In QKERN:** Il Table Editor mostra le colonne; la Data API nasconde le colonne sensibili come le password.
- **In Supabase:** Column.

## Compose

- **Che cos'è:** Uno strumento di Docker che avvia insieme più container secondo un file.
- **In QKERN:** docker-compose.yml avvia PostgreSQL, Redis, object storage e antivirus; gli stack di certificazione sono file Compose separati.
- **In Supabase:** Anche l'ambiente locale di Supabase usa Compose.

## Console

- **Che cos'è:** L'interfaccia web di QKERN, in cui vedi e gestisci progetti, dati, utenti e regole.
- **In QKERN:** Sotto /console dopo l'accesso. Molte viste sono reali, alcune dicono apertamente di essere segnaposto.
- **In Supabase:** Studio.

## Container

- **Che cos'è:** Un programma in una scatola chiusa con tutto quello che gli serve, avviato da Docker.
- **In QKERN:** I servizi del Compose di sviluppo e le Functions girano in container.
- **In Supabase:** Uguale.

## Control Plane

- **Che cos'è:** La parte di QKERN che gestisce organizzazioni, progetti, utenti della console e approvazioni.
- **In QKERN:** Un database PostgreSQL proprio, qkern_control; la console parla con lui.
- **In Supabase:** La dashboard di Supabase e la sua API di gestione.

## Cron

- **Che cos'è:** Compiti a orario, per esempio ogni notte alle tre.
- **In QKERN:** Vista Integrazioni, Cron. Ogni scadenza finisce come messaggio in una coda, così due scheduler producono esattamente un messaggio.
- **In Supabase:** pg_cron.

## Data API

- **Che cos'è:** L'interfaccia con cui il tuo frontend legge e scrive righe, con i diritti di chi chiama.
- **In QKERN:** Costruita in automatico dalle tue tabelle; indirizzo tables, nome della tabella, rows sotto progetto e ambiente. Espone solo tabelle con Row Level Security.
- **In Supabase:** PostgREST.

## Data Plane

- **Che cos'è:** Il database di un progetto per ogni ambiente, in cui stanno i dati della tua app.
- **In QKERN:** Separato dal Control Plane; in locale è il database project_database.
- **In Supabase:** Il database del progetto.

## Database

- **Che cos'è:** Un programma che salva i dati in tabelle, li ritrova in fretta e fa rispettare le regole.
- **In QKERN:** PostgreSQL 17, uno per progetto e ambiente.
- **In Supabase:** PostgreSQL.

## Docker

- **Che cos'è:** Uno strumento che avvia programmi in container senza doverli installare.
- **In QKERN:** Il Compose di sviluppo e tutti gli stack di certificazione girano in Docker.
- **In Supabase:** Uguale.

## Edge Functions

- **Che cos'è:** Il nome che Supabase dà al codice proprio che gira nel backend su richiesta.
- **In QKERN:** In QKERN si chiamano Functions; girano in container con controllo del traffico in uscita.
- **In Supabase:** Edge Functions.

## Endpoint

- **Che cos'è:** Un singolo indirizzo di un'API, per esempio le righe di una tabella.
- **In QKERN:** Tutti gli endpoint sono nell'OpenAPI sotto /api/openapi.json e nella vista API.
- **In Supabase:** Endpoint.

## Estensione

- **Che cos'è:** Un modulo aggiuntivo per PostgreSQL, per esempio per la cifratura o le pianificazioni.
- **In QKERN:** La vista Database, Estensioni mostra quali sono attive nel database di progetto.
- **In Supabase:** Extensions.

## Evidenza

- **Che cos'è:** Una prova che non si può falsificare in seguito: firmata, datata, verificabile.
- **In QKERN:** I log e i manifest sotto docs/evidence e l'evidenza di backup firmata che il verifier legge.
- **In Supabase:** Nessun equivalente.

## Frontend

- **Che cos'è:** La parte visibile di un'app: la pagina nel browser, l'app sul telefono.
- **In QKERN:** QKERN non fornisce un frontend; fornisce ciò con cui un frontend comunica.
- **In Supabase:** Uguale.

## Funzione (database)

- **Che cos'è:** Un pezzo di logica che gira nel database stesso e si può chiamare via SQL o tramite l'API.
- **In QKERN:** Vista Database, Funzioni; chiamata tramite la Data API sotto rpc e il nome della funzione.
- **In Supabase:** Database Functions, chiamata tramite rpc.

## GoTrue

- **Che cos'è:** Il servizio che in Supabase si occupa dell'accesso.
- **In QKERN:** In QKERN si chiama Project Auth; vedi Auth.
- **In Supabase:** GoTrue.

## Hash della password

- **Che cos'è:** Da una password si ricava un checksum che non si può riconvertire; si salva solo quello.
- **In QKERN:** Argon2id con un pepper preso dalla configurazione, separato per la console e per Project Auth.
- **In Supabase:** bcrypt in GoTrue.

## Immagine

- **Che cos'è:** Il modello da cui Docker avvia un container, per esempio postgres:17-alpine.
- **In QKERN:** I manifest sotto docs/evidence indicano le immagini di ogni esecuzione.
- **In Supabase:** Uguale.

## Indice

- **Che cos'è:** Una specie di rubrica nel database, che rende veloce la ricerca in tabelle grandi.
- **In QKERN:** Vista Database, Indici.
- **In Supabase:** Indexes.

## Job

- **Che cos'è:** Un singolo compito in una coda, che un worker va a prendere.
- **In QKERN:** Messaggi in Project Queues; vista Integrazioni, Code.
- **In Supabase:** Message in pgmq.

## JSON

- **Che cos'è:** Un formato di testo per i dati, facile da leggere per i programmi: parentesi graffe, nomi, valori.
- **In QKERN:** Tutte le risposte dell'API sono in JSON; anche la configurazione nel blocco Lokaler Schnellstart.
- **In Supabase:** Uguale.

## JWT

- **Che cos'è:** Un documento d'identità firmato che un utente connesso invia con ogni richiesta; il backend verifica la firma invece di interrogare il database.
- **In QKERN:** Project Auth rilascia i JWT; le chiavi per farlo sono nella vista Impostazioni, Chiavi JWT.
- **In Supabase:** JWT.

## Log di audit

- **Che cos'è:** Un registro che dice chi ha modificato che cosa e quando, e che non si può alterare in seguito senza che si noti.
- **In QKERN:** Vista Log, Audit. Le voci sono concatenate con hash; un restore drill ricalcola la catena.
- **In Supabase:** Audit Logs sotto Authentication, con una portata più ridotta.

## MCP

- **Che cos'è:** Un protocollo con cui gli agenti IA chiamano strumenti, per esempio per leggere lo schema.
- **In QKERN:** QKERN offre un server MCP per gli agenti; manuale, sezione 10.
- **In Supabase:** Supabase MCP.

## Memory Mode

- **Che cos'è:** Una modalità di funzionamento in cui QKERN tiene tutto nella memoria di lavoro; al riavvio tutto sparisce.
- **In QKERN:** QKERN_RUNTIME_MODE=memory, solo per provare l'interfaccia. L'Avvio rapido usa postgres.
- **In Supabase:** Nessun equivalente.

## Metodo HTTP

- **Che cos'è:** Il verbo di una richiesta: GET legge, POST crea, PATCH modifica, DELETE cancella.
- **In QKERN:** La Data API usa esattamente questi quattro per le righe.
- **In Supabase:** Uguale.

## Migrazione

- **Che cos'è:** Una modifica alla struttura del database, scritta in SQL, con un numero, così gira ovunque nello stesso ordine.
- **In QKERN:** Il Control Plane ha migrazioni numerate sotto db/migrations; le modifiche ai progetti passano come change set.
- **In Supabase:** Migrations.

## Modulo

- **Che cos'è:** Una parte delimitata di QKERN con un compito proprio e un confine proprio, per esempio Storage o Queues.
- **In QKERN:** I confini sono descritti in docs/MODULES.md.
- **In Supabase:** Nessun equivalente.

## Node.js

- **Che cos'è:** Il runtime che esegue JavaScript fuori dal browser.
- **In QKERN:** QKERN richiede Node.js 24.7 o più recente.
- **In Supabase:** Uguale, per supabase-js.

## npm

- **Che cos'è:** Il gestore di pacchetti di Node.js: scarica librerie ed esegue script.
- **In QKERN:** npm ci installa, npm run dev avvia, npm install @qkern/sdk scarica l'SDK.
- **In Supabase:** Uguale.

## OAuth

- **Che cos'è:** Una procedura con cui un utente accede tramite un altro fornitore, per esempio con il suo account Google.
- **In QKERN:** Metodo di accesso in Project Auth, certificato contro veri provider OIDC.
- **In Supabase:** Social Login.

## Oggetto

- **Che cos'è:** Un file nell'object storage, con nome e metadati.
- **In QKERN:** Ciò che sta in un bucket.
- **In Supabase:** Object.

## Open Source

- **Che cos'è:** Il codice sorgente è pubblico e si può usare e modificare secondo una licenza.
- **In QKERN:** QKERN è open source con licenza Apache 2.0.
- **In Supabase:** Uguale.

## Organizzazione

- **Che cos'è:** Lo spazio di lavoro a cui appartiene tutto: progetti, utenti della console, fatture.
- **In QKERN:** Creata alla registrazione; l'ID si trova sotto Impostazioni, Generale.
- **In Supabase:** Organization.

## Piano a tappe

- **Che cos'è:** Il piano che fissa in quale ordine cresce QKERN, con criteri di entrata e di uscita per ogni tappa.
- **In QKERN:** docs/STUFENPLAN.md.
- **In Supabase:** Nessun equivalente.

## Point-in-time Recovery

- **Che cos'è:** Ripristino a un momento preciso, non solo all'ultimo backup.
- **In QKERN:** Dimostrato contro un PostgreSQL vero con archivio WAL; nella console è ancora un segnaposto.
- **In Supabase:** PITR nel piano a pagamento.

## Policy

- **Che cos'è:** Una regola nel database che dice chi può vedere o modificare quali righe.
- **In QKERN:** Vista Database, Policy. Senza policy la Row Level Security non espone nulla.
- **In Supabase:** Policies.

## Porta

- **Che cos'è:** Un numero con cui si raggiunge un programma su un computer.
- **In QKERN:** QKERN resta in ascolto sulla 3000, PostgreSQL sulla 5432.
- **In Supabase:** Uguale.

## PostgreSQL

- **Che cos'è:** Un database libero e molto diffuso, mantenuto da trent'anni.
- **In QKERN:** Versione 17, per il Control Plane e per ogni database di progetto.
- **In Supabase:** Uguale.

## PostgREST

- **Che cos'è:** Il servizio che in Supabase trasforma le tabelle in un'API REST.
- **In QKERN:** In QKERN si chiama Data API e fa parte del programma stesso.
- **In Supabase:** PostgREST.

## Production Apply

- **Che cos'è:** L'esecuzione di una modifica approvata nell'ambiente production.
- **In QKERN:** Oltre all'approvazione richiede la firma di un signer esterno; runbook in docs.
- **In Supabase:** Nessun equivalente.

## Progetto

- **Che cos'è:** Un'app con dati, utenti, file e chiavi propri.
- **In QKERN:** Alla registrazione nasce First Project; l'ID si trova sotto Impostazioni, Generale.
- **In Supabase:** Project.

## Proprietario del registro

- **Che cos'è:** Il ruolo del database a cui appartengono tutte le tabelle di un progetto. Non può accedere; ci si passa con SET ROLE.
- **In QKERN:** qkern_ledger_owner nel database di progetto; la contabilità delle migrazioni richiede che non abbia un login.
- **In Supabase:** Nessun equivalente diretto; Supabase lavora con il ruolo postgres.

## Provider

- **Che cos'è:** Un fornitore tramite cui gli utenti accedono, per esempio Google o un login aziendale.
- **In QKERN:** Vista Auth, Metodi di accesso; certificato contro Dex e Mailpit.
- **In Supabase:** Auth Providers.

## Provisioner

- **Che cos'è:** Il servizio che crea un database per un nuovo progetto e ne registra la connessione.
- **In QKERN:** Un worker proprio che parla con un broker HTTPS; in locale lo sostituisce npm run dev:bind-project-database.
- **In Supabase:** In Supabase lavora invisibile in background.

## Pubblicazione

- **Che cos'è:** Un elenco di tabelle di cui PostgreSQL segnala le modifiche verso l'esterno, per esempio per gli aggiornamenti in diretta.
- **In QKERN:** Vista Database, Pubblicazioni; è la base di Realtime.
- **In Supabase:** Publications.

## Q-Orbit

- **Che cos'è:** L'animazione sulla pagina iniziale: componenti che girano intorno al nucleo.
- **In QKERN:** Solo grafica, nessuna funzione.
- **In Supabase:** Nessun equivalente.

## Rate Limit

- **Che cos'è:** Un limite a quante volte qualcosa può succedere in un certo tempo, per esempio tentativi di accesso al minuto.
- **In QKERN:** Integrato in modo fisso per registrazione e accesso; la regolazione per progetto è ancora un segnaposto.
- **In Supabase:** Rate Limits sotto Authentication.

## Realtime

- **Che cos'è:** Inviare subito le modifiche ai dati a tutti quelli che stanno guardando, senza ricaricare.
- **In QKERN:** Vista Realtime, Inspector; tramite WebSocket, certificato contro un PostgreSQL vero.
- **In Supabase:** Realtime.

## Refresh Token

- **Che cos'è:** Un secondo documento d'identità con cui si rinnova un JWT scaduto senza accedere di nuovo.
- **In QKERN:** Parte di Project Auth; viene sostituito a ogni rinnovo.
- **In Supabase:** Refresh Token.

## REST

- **Che cos'è:** Un modo di costruire le API: indirizzi per le cose, metodi HTTP per le azioni, JSON per i dati.
- **In QKERN:** Tutta l'API di QKERN è REST; descritta nell'OpenAPI.
- **In Supabase:** Uguale.

## Riga

- **Che cos'è:** Una voce in una tabella, per esempio una nota.
- **In QKERN:** Il Table Editor mostra, inserisce, modifica e cancella righe, sempre con Row Level Security.
- **In Supabase:** Row.

## Row Level Security

- **Che cos'è:** Una regola direttamente nel database che decide riga per riga chi può vederla o modificarla.
- **In QKERN:** Obbligatoria per ogni tabella che la Data API espone; le regole si trovano sotto Database, Policy. Nemmeno la chiave di servizio la aggira.
- **In Supabase:** Row Level Security, stesso nome.

## Runtime Mode

- **Che cos'è:** L'interruttore che decide se QKERN usa database veri o tiene tutto nella memoria di lavoro.
- **In QKERN:** QKERN_RUNTIME_MODE=postgres oppure memory in .env.local.
- **In Supabase:** Nessun equivalente.

## Ruolo

- **Che cos'è:** Un account utente in PostgreSQL con determinati diritti, per esempio di sola lettura.
- **In QKERN:** QKERN lavora con molti ruoli dai diritti ristretti; la vista Database, Ruoli mostra quelli del database di progetto.
- **In Supabase:** Roles.

## Schema

- **Che cos'è:** Due significati: la struttura di un database (quali tabelle, quali colonne) e uno spazio dei nomi al suo interno, per esempio public.
- **In QKERN:** La Data API lavora nello schema public; la vista Database mostra la struttura.
- **In Supabase:** Uguale.

## SDK

- **Che cos'è:** Una libreria che rende comoda un'API nel linguaggio dello sviluppatore, con tipi e funzioni al posto degli indirizzi.
- **In QKERN:** @qkern/sdk per TypeScript e JavaScript; npm install @qkern/sdk@alpha.
- **In Supabase:** supabase-js.

## Service Role Key

- **Che cos'è:** La chiave di Supabase che aggira la Row Level Security.
- **In QKERN:** In QKERN si chiama chiave di servizio e non aggira le regole; chi deve vedere tutto riceve una regola che lo dice.
- **In Supabase:** Service Role Key.

## Sessione

- **Che cos'è:** Il tempo tra accesso e uscita, durante il quale il backend riconosce un utente.
- **In QKERN:** La console e Project Auth gestiscono ciascuno le proprie sessioni.
- **In Supabase:** Session.

## SQL

- **Che cos'è:** Il linguaggio con cui si parla con un database: CREATE TABLE, SELECT, INSERT.
- **In QKERN:** SQL Editor nella console (in sola lettura); ciò che scrive diventa un change set.
- **In Supabase:** Uguale.

## Stack di certificazione

- **Che cos'è:** Un'installazione usa e getta fatta di container, in cui gira una verifica contro servizi veri e che poi sparisce.
- **In QKERN:** docker-compose.*-certification.yml; npm run test:postgres:docker e simili.
- **In Supabase:** Nessun equivalente.

## Storage

- **Che cos'è:** Archivio per file: immagini, documenti, caricamenti.
- **In QKERN:** Project Storage, vista Storage; compatibile S3, privato, con controllo antivirus tramite ClamAV.
- **In Supabase:** Storage.

## Studio

- **Che cos'è:** L'interfaccia web di Supabase.
- **In QKERN:** In QKERN si chiama console.
- **In Supabase:** Studio.

## supabase-js

- **Che cos'è:** La libreria JavaScript di Supabase.
- **In QKERN:** In QKERN si chiama @qkern/sdk.
- **In Supabase:** supabase-js.

## Tabella

- **Che cos'è:** Dati in righe e colonne, come una tabella in un foglio di calcolo, ma con tipi e regole fissi.
- **In QKERN:** Table Editor nella console; creata con SQL, esposta con Row Level Security e chiave primaria.
- **In Supabase:** Table.

## Tenant

- **Che cos'è:** Un cliente o un'organizzazione i cui dati sono separati da tutti gli altri, anche se usano lo stesso software.
- **In QKERN:** Ogni organizzazione è un tenant; la Row Level Security nel Control Plane li separa, anche per QKERN stesso.
- **In Supabase:** Ogni progetto Supabase è un'istanza a sé.

## Test di mutazione

- **Che cos'è:** Si inserisce apposta un errore e si controlla che i test lo trovino. Se restano verdi, non servono a niente.
- **In QKERN:** Ogni release ne ha uno; il risultato è in docs/evidence come Mutation.
- **In Supabase:** Nessun equivalente.

## TLS

- **Che cos'è:** Cifratura per le connessioni; il lucchetto nel browser.
- **In QKERN:** Obbligatoria in produzione tra QKERN e i suoi database; il backup drill la impone anche in locale.
- **In Supabase:** Uguale.

## Token

- **Che cos'è:** Un documento d'identità in forma di testo che un programma invia per farsi riconoscere; JWT e Refresh Token sono token.
- **In QKERN:** Li rilascia Project Auth; le chiavi API sono un altro tipo di documento d'identità.
- **In Supabase:** Uguale.

## Trigger

- **Che cos'è:** Un pezzo di logica che il database esegue da solo quando succede qualcosa, per esempio quando si inserisce una riga.
- **In QKERN:** Vista Database, Trigger.
- **In Supabase:** Triggers.

## URL firmato

- **Che cos'è:** Un link a un file che vale solo per un tempo limitato e porta una firma.
- **In QKERN:** È il modo in cui Storage rende disponibili per poco tempo i file privati.
- **In Supabase:** Signed URL.

## Variabile d'ambiente

- **Che cos'è:** Un'impostazione che un programma legge dal suo ambiente all'avvio, per esempio un indirizzo o un segreto.
- **In QKERN:** Tutte le impostazioni di QKERN; modello .env.example, la tua copia .env.local.
- **In Supabase:** Uguale.

## Volume

- **Che cos'è:** Lo spazio di memoria di un container che sopravvive ai riavvii.
- **In QKERN:** qkern-postgres contiene i database del Compose di sviluppo; docker compose down -v lo cancella.
- **In Supabase:** Uguale.

## WAL

- **Che cos'è:** Il registro in cui PostgreSQL scrive ogni modifica prima che diventi valida; da lì si può ripristinare qualsiasi momento.
- **In QKERN:** Il backup drill archivia segmenti WAL e ripristina da questi.
- **In Supabase:** Uguale, invisibile.

## Webhook

- **Che cos'è:** Un messaggio che il backend invia a un indirizzo esterno quando succede qualcosa.
- **In QKERN:** Vista Funzioni e job; la firma dei messaggi è certificata contro un Vault vero.
- **In Supabase:** Database Webhooks.

## WebSocket

- **Che cos'è:** Una connessione che resta aperta, così il backend può inviare messaggi di sua iniziativa.
- **In QKERN:** Realtime usa WebSocket; protocollo in docs/REALTIME_PROTOCOL.md.
- **In Supabase:** Uguale.

## Worker

- **Che cos'è:** Un programma in background che elabora i compiti di una coda.
- **In QKERN:** Sette processi propri: Queues, Compute, migrazioni, incidenti, Realtime, Apply, provisioner.
- **In Supabase:** In Supabase lavora invisibile in background.
