# Per chi fonda

> Per chi si fa costruire un prodotto e vuole sapere che ruolo ha QKERN. Niente riga di comando, niente codice. Dove serve un termine tecnico, rimanda al [glossario](GLOSSAR.md).

## Che cosa significa QKERN per il tuo prodotto

Ogni app ha una parte visibile e una invisibile. Quella visibile è l'interfaccia che usano i tuoi clienti. Quella invisibile è il [backend](GLOSSAR.md#backend): lì stanno i dati, lì si creano gli account, si salvano i file, si controllano i permessi. Di solito gli sviluppatori ricostruiscono questa parte invisibile per ogni prodotto, e in genere si prende metà del tempo.

QKERN è questa parte invisibile, già pronta. [Database](GLOSSAR.md#database), login, file, aggiornamenti in diretta, compiti in background, con un'interfaccia, la [console](GLOSSAR.md#console), in cui si vede che cosa succede. Il tuo sviluppatore costruisce l'interfaccia del tuo prodotto e la collega a QKERN, invece di gettare lui stesso le fondamenta.

Il paragone che gli sviluppatori conoscono: QKERN fa quello che fa Supabase. La differenza sta nel modo in cui viene verificato; ne parliamo più sotto.

## Che cosa puoi farti costruire

Tre esempi, tutti con gli stessi componenti:

- **Un'app di prenotazione.** I clienti creano un account (login), vedono gli orari liberi (database), prenotano (database più regole su chi può vedere quale prenotazione), ricevono una conferma (compito in background), e un calendario in ufficio mostra subito le nuove prenotazioni (aggiornamenti in diretta).
- **Un'area riservata ai soci.** I soci paganti accedono, caricano documenti (file con controllo antivirus) e vedono solo i propri; un amministratore li vede tutti. La regola "solo i propri" sta nel database stesso, non da qualche parte nel codice dove la si può dimenticare.
- **Una gestione interna.** I collaboratori tengono aggiornati clienti e ordini in tabelle che la console mostra direttamente. All'inizio basta l'editor di tabelle integrato; un'interfaccia propria arriva quando è chiaro che cosa serve.

Che cosa QKERN non è: non è un kit con cui metti insieme un'app a clic da solo, senza sviluppatori. È lo strumento dello sviluppatore.

## Quanto costa

Il software non costa nulla. QKERN è [open source](GLOSSAR.md#open-source) con la [licenza Apache 2.0](GLOSSAR.md#apache-2-0): uso libero, anche commerciale, senza costi di licenza e senza obbligo di rendere pubblico il proprio codice.

A costare sono due cose:

- **Esercizio.** QKERN deve girare da qualche parte. Su un server in affitto o in un cloud; i costi dipendono da dimensioni e fornitore e partono da poche decine di franchi al mese. Oggi non esiste un'offerta in cui prendi QKERN in affitto già ospitato. È in programma, ma non c'è ancora.
- **Tempo degli sviluppatori.** L'interfaccia del tuo prodotto e il collegamento a QKERN. Questo tempo è minore che senza QKERN, però non è zero.

## Dove si trovano i dati

Dove gira QKERN. QKERN non invia dati a noi né a terzi; non c'è un servizio centrale attraverso cui passa qualcosa. Se QKERN gira su un server a Zurigo, i dati stanno a Zurigo.

QKERN è sviluppato in Svizzera. Oggi non esiste una prova verificata sul luogo dei dati o sull'hosting, perché non esiste un'offerta di hosting. Chi ha bisogno di una dichiarazione su protezione dei dati o ubicazione la riceve da chi gestisce il server, non da QKERN.

## Che cosa significa qui "certificato"

Sulla pagina iniziale e in questa documentazione trovi numeri come "{{postgresCases}} casi superati". Significa:

- Ogni componente viene verificato contro servizi veri, niente imitazioni. Un vero [PostgreSQL](GLOSSAR.md#postgresql), un vero archivio di file, un vero server di posta. Oggi sono {{stackCount}} banchi di prova di questo tipo.
- La verifica parte in automatico a ogni modifica, e i protocolli stanno con data e risultato nel repository, il luogo in cui si gestisce il codice sorgente.
- I numeri sulla pagina iniziale vengono letti da questi protocolli. Se lì c'è scritto {{postgresCases}}, esiste un file che dice {{postgresCases}}. Un test impedisce che qualcuno inserisca un numero a mano.
- Ne fa parte una controprova: si inserisce apposta un errore e si controlla che la verifica lo trovi. Una verifica che resta verde con un errore inserito non serve a niente.

Che cosa non significa: nessuna certificazione da parte di un'autorità o di un ente di controllo, nessun marchio di qualità, nessuna responsabilità. Qui "certificato" è una parola per "dimostrato contro servizi veri, con la prova consultabile".

## Che cosa manca oggi

QKERN si definisce un Product MVP: le fondamenta ci sono, molte viste della console sono ancora segnaposto che dicono apertamente che cosa non sanno ancora fare. Non ci sono un'offerta di hosting, una fatturazione, una gestione del team nella console. Chi oggi costruisce con QKERN costruisce con uno strumento che si muove ancora.

## Domande per il tuo sviluppatore

Sette domande con cui puoi avviare una conversazione sul backend senza costruirne uno tu:

1. La [Row Level Security](GLOSSAR.md#row-level-security) è attiva su ogni tabella, e che cosa dice la regola per un cliente che non ha fatto l'accesso?
2. Quali chiavi stanno nell'app che i clienti scaricano, e che cosa possono fare?
3. Chi può approvare una modifica al database per production, e dove vedo dopo chi è stato?
4. Dove girano i [backup](GLOSSAR.md#backup), fino a quando si può tornare indietro nel ripristino, e quando è stato provato l'ultima volta?
5. Di quali servizi ha bisogno QKERN in esercizio, e che cosa succede se uno di questi si ferma?
6. Come si riportano fuori i dati, se un giorno cambiamo strumento?
7. Di quello che ci serve, che cosa è oggi un segnaposto in QKERN?

## In tutta franchezza

- Questa pagina descrive QKERN {{version}}, un Product MVP. Molte cose si muovono ancora.
- Non esiste un'offerta di hosting né una prova sul luogo dei dati. Entrambe sono in programma.
- Le indicazioni sui costi di esercizio sono ordini di grandezza, non un'offerta.
- "Certificato" è una parola per verifiche documentate, non per un controllo da parte di terzi.
