# Che cos'è QKERN

QKERN è un [backend](GLOSSAR.md#backend) che non devi costruire da solo. Un'app ha quasi sempre bisogno delle stesse cose dietro le quinte: un [database](GLOSSAR.md#database) per i dati, un login per gli utenti, un posto per i file, aggiornamenti in diretta per chi sta guardando e compiti che girano in background. QKERN porta con sé questi pezzi, già collegati tra loro, e tu li gestisci da un'interfaccia web, la [console](GLOSSAR.md#console).

Gira dove lo metti tu: sul tuo computer in [Docker](GLOSSAR.md#docker), più avanti presso un hoster a tua scelta. QKERN è [open source](GLOSSAR.md#open-source) con licenza [Apache 2.0](GLOSSAR.md#apache-2-0). Il software non costa nulla; costano l'hosting e il lavoro che un'app richiede.

Che cosa QKERN non è: non è un costruttore di siti web, non è un prodotto finito per i clienti finali e non è un'offerta di hosting. QKERN è la base su cui uno sviluppatore costruisce un'app.

## Perché esiste QKERN

Chi conosce Supabase conosce l'idea: un Postgres con tutto quello che gli serve intorno. QKERN segue la stessa strada, con una differenza a cui teniamo. Ogni componente viene verificato contro servizi veri, niente imitazioni. Un vero [PostgreSQL](GLOSSAR.md#postgresql) 17, un vero object storage, un vero server di posta, un vero provider di identità. I protocolli di verifica stanno nel repository, con data, commit e risultato, e i numeri sulla pagina iniziale vengono proprio da questi protocolli.

Oggi sono {{postgresCases}} casi contro PostgreSQL 17 e {{stackCount}} banchi di prova in totale. Quando in questa documentazione compare un numero, viene da un file e non dalla memoria.

## I componenti

| Componente | Che cosa fa | Nella console |
| --- | --- | --- |
| [Console](GLOSSAR.md#console) | L'interfaccia web in cui vedi e imposti tutto | Tutto |
| [Organizzazione](GLOSSAR.md#organizzazione) | Il tuo spazio di lavoro; tutto appartiene a un'organizzazione | Intestazione |
| [Progetto](GLOSSAR.md#progetto) | Un'app con dati, utenti e chiavi propri | Scelta del progetto in alto a sinistra |
| [Ambiente](GLOSSAR.md#ambiente) | development, staging, production; ognuno con il suo database | Scelta dell'ambiente in alto a destra |
| [Database](GLOSSAR.md#database) | PostgreSQL 17 con tabelle, regole e tutto quello che serve | Database, Table Editor, SQL Editor |
| [Data API](GLOSSAR.md#data-api) | Lettura e scrittura via [REST](GLOSSAR.md#rest), con i diritti di chi chiama | API |
| [Auth](GLOSSAR.md#auth) | Login per gli utenti della tua app, con password, provider e più fattori | Auth |
| [Storage](GLOSSAR.md#storage) | File in [bucket](GLOSSAR.md#bucket), privati, con controllo antivirus | Storage |
| [Realtime](GLOSSAR.md#realtime) | Modifiche in diretta a tutti quelli che guardano | Realtime |
| [Queues](GLOSSAR.md#coda) | Compiti che un [worker](GLOSSAR.md#worker) elabora più tardi | Integrazioni, Code |
| [Cron](GLOSSAR.md#cron) e [webhook](GLOSSAR.md#webhook) | Compiti a orario e messaggi verso altri servizi | Funzioni e job |
| [Centro approvazioni](GLOSSAR.md#centro-approvazioni) | Ogni modifica allo schema viene verificata prima di essere eseguita | Centro approvazioni |
| [AI Bridge](GLOSSAR.md#ai-bridge) | Un agente IA prepara le modifiche, le persone le approvano | AI Bridge |

## Come si collegano le parti

La console parla con il [Control Plane](GLOSSAR.md#control-plane). È la parte di QKERN che gestisce organizzazioni, progetti, utenti e approvazioni. Ogni progetto ha un database proprio per ogni ambiente, il [Data Plane](GLOSSAR.md#data-plane). Lì stanno i dati della tua app. La Data API legge e scrive in questo database con i diritti di chi fa la richiesta: una [chiave pubblica](GLOSSAR.md#chiave-pubblica) vede solo quello che la [Row Level Security](GLOSSAR.md#row-level-security) concede a un anonimo, un utente connesso vede le sue righe.

Una modifica alla struttura del database, per esempio una nuova tabella, non passa direttamente. Diventa un [change set](GLOSSAR.md#change-set), finisce nel Centro approvazioni, e QKERN la esegue solo dopo l'approvazione. Per production serve in più una firma dall'esterno. È volutamente più lento di un SQL diretto, ed è il motivo per cui ogni modifica resta tracciabile.

## Tre porte

- Conosco Supabase e voglio vedere qualcosa in un quarto d'ora: [Avvio rapido](SCHNELLSTART.md)
- Costruisco il mio primo backend e voglio capire che cosa sto facendo: [Il primo backend](ERSTES_BACKEND.md)
- Non sono uno sviluppatore e voglio sapere che cosa significa per il mio prodotto: [Per chi fonda](FUER_GRUENDER.md)

I termini che incontri lungo la strada li spiega il [glossario](GLOSSAR.md), ognuno in tre righe.

## In tutta franchezza

- Questa documentazione vale per QKERN {{version}}. QKERN è un Product MVP, non un'offerta di hosting pronta.
- Non esiste un fornitore da cui ottieni QKERN con un clic. Lo gestisci tu o lo fai gestire da qualcuno.
- Oggi una nuova tabella la crei con SQL, non con una procedura guidata nella console.
- In produzione il collegamento di un progetto al suo database lo fa un provisioner. In locale lo fa un piccolo script, quello mostrato nell'Avvio rapido.
- Queste pagine sono nate in tedesco. La versione italiana è una traduzione, come quelle in inglese e francese.
