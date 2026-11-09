# SIEVER Mail — la vision

Il documento guida di SIEVER Mail: che cos'è, come funziona e perché. Dove il codice o altri testi dicono cose diverse, vale questo; ciò che si decide di nuovo si scrive qui, nel suo posto. Le decisioni sono motivate: il perché conta quanto il cosa.

Come si tiene: ogni argomento in un posto solo, gli altri lo richiamano (§N, anche nei commenti del codice); le decisioni in breve stanno in fondo (§16).

---

## 0. In una frase

SIEVER Mail è un **sistema operativo personale per il lavoro**, e anche per la vita, pensato per chi ha molto da seguire. Le sue app — Posta, Calendario, File, e quelle che verranno — sono **alla pari**: ognuna porta i suoi oggetti dalle sue connessioni. Nessuna è la fonte prima, con le altre intorno. Un solo Segretario li tiene insieme e **capisce il lavoro dell'utente**, ovunque si manifesti. Funziona benissimo anche senza AI, come insieme di app ben fatte; con l'AI accesa diventa **intelligente**: è questa la parola chiave.

Lo scopo è uno: essere davvero utile e ridurre il tempo davanti a queste app, togliendo dalla testa dell'utente tutto ciò che può esserne tolto.

Il nome resta SIEVER Mail per ora, per non fare una migrazione enorme, ma non dice più tutto: SIEVER Mail non è più un client di posta, e non è più fatto per un'azienda sola. Nel codice, nei testi e nella mente del Segretario non c'è un centro di posta.

Lo regge una sola distinzione:

- **Il Segretario decide cosa ha senso.** È un agente solo, con una sola identità, che lavora in molte esecuzioni parallele.
- **Il sistema garantisce che possa farlo in modo coerente.** Identità dei messaggi, stato del lavoro versionato, coda di lavoro durevole, permessi, idempotenza.

Libertà semantica massima, sopra un'infrastruttura deterministica.

### 0.1 Le app, le fonti, gli oggetti

| Gruppo            | App                                                      | Cosa porta                                                                                               | Connessioni                                        |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| La scrivania      | **Oggi**                                                 | la giornata dell'utente vista dal Segretario: cose aperte da ogni fonte, appuntamenti, lettera, proposte | nessuna: è del Segretario, c'è solo con l'AI       |
| Le fonti          | **Posta**                                                | i messaggi                                                                                               | caselle di posta                                   |
|                   | **Calendario**                                           | gli eventi                                                                                               | calendari                                          |
|                   | **File** (in arrivo)                                     | i documenti, dove stanno                                                                                 | volumi del computer e di rete, drive dei fornitori |
| Le viste derivate | **Contatti** (in arrivo)                                 | le persone e le organizzazioni                                                                           | nessuna propria: aggregano le fonti                |
|                   | **Progetti** (in arrivo come app; già vivi nel registro) | i contesti in cui le cose stanno insieme                                                                 | nessuna propria: aggregano le fonti                |

**Le fonti sono alla pari.** Ognuna ha:

- le sue connessioni, nella stessa scheda;
- i suoi oggetti, con un'identità stabile (un messaggio per chiave, un evento per chiave, un file per volume e percorso);
- un modo in cui il Segretario se ne accorge (§4.5) e degli strumenti con cui legge, cerca e agisce (§5);
- la sua app, con le sue viste.

Nessuna fonte ha privilegi nel modello del lavoro: una cosa aperta, un progetto, una proposta possono nascere da ognuna, e stanno insieme senza che una faccia da contenitore delle altre.

**Aggiungere una fonte non rompe niente.** Messaggi istantanei, telefonate, altro: è una famiglia di connessioni nuova, un tipo di oggetto nuovo, un modo per accorgersene, i suoi strumenti, la sua app. Il registro, il Segretario, Oggi e i Progetti li accolgono come accolgono posta e calendario. Più fonti vuol dire un modello più completo della vita dell'utente, quindi un Segretario più utile.

**Le viste derivate non possiedono niente.** Contatti e Progetti mostrano insieme ciò che sta nelle fonti, dove sta, senza copiarlo né spostarlo.

---

## 1. Per tutti, e su misura: il pubblico e le estensioni

**SIEVER Mail è per tutti.** La versione pubblica funziona da sola, per chiunque e per qualunque lavoro: un ufficio tecnico, uno studio legale, un medico, uno studente, chi organizza la partita del giovedì. Non porta le convenzioni di nessuno: il Segretario impara come lavora il suo utente da ciò che vede — la posta, il calendario, i file, ciò che gli si dice — e ci si adegua.

**Un'estensione privata la fa su misura per un'organizzazione:** un'azienda, uno studio, un professionista. Si scrive per chi la chiede e si installa con la sua edizione dell'app. Aggiunge:

- **istruzioni morbide per il Segretario**: come lavora quella realtà, come chiama le cose, dove le tiene. Sono le sue convenzioni vere, e valgono dove gli esempi generali dei prompt dicono altro;
- **strumenti propri** per il Segretario, dopo quelli dell'app;
- **azioni nell'interfaccia**: un pulsante nel lettore, la sua finestra, un comando con la sua scorciatoia, una scheda nelle Impostazioni, le proposte che sa eseguire;
- **i suoi dati**, nelle sue tabelle, e i **segni** che lascia sui messaggi: ciò che ha fatto di loro fuori dalla posta (§6.3);
- **la forma della casa**: il carattere, i colori, la firma predefinita.

**Non rinomina le sezioni e non impone procedure.** Il pubblico funziona da solo e il privato parte solo più informato, su ogni fonte allo stesso modo: posta, calendario, file. Il Segretario resta lo stesso, con la stessa libertà: l'estensione gli dice di più, non gli dice come lavorare.

**Le estensioni portano il nome legale dell'ente per cui sono**, e un identificativo che è quel nome in minuscolo con i trattini: «Siever S.r.l.» è `siever-srl`. L'identificativo tiene le cose dell'estensione separate da quelle dell'app e da quelle di ogni altra estensione (§15.4).

**Siever S.r.l. è la prima.** È uno studio di impiantistica, e la sua estensione aggiunge ARCHIVIA SIEVER — un pulsante che salva la posta nella pratica giusta dell'archivio condiviso e poi la archivia nel senso del provider, lasciandole il segno «Archiviato Siever» (§6.3) —, un Segretario che sa come lo studio chiama le pratiche e dove le tiene, con uno strumento per guardare l'archivio, proporre dove archiviare e archiviare, e il carattere, il colore e la firma dello studio. I suoi dettagli stanno nel README del suo repository, privato.

**Che cosa vuol dire, in pratica, «pubblico generale».**

- **L'interfaccia** non ha scritte, esempi o comportamenti di un'organizzazione: ciò che appare è di tutti, o arriva dall'estensione installata.
- **I prompt** danno esempi presi da lavori diversi, detti come esempi; nessuna convenzione. Nemmeno per i nomi dei progetti: il Segretario li capisce da ciò che ha davanti, senza partire da uno schema (non «codice · nome», che è il modo di qualcuno, non di tutti).
- **Il codice e i suoi documenti** non nominano estensioni, persone o aziende reali: gli esempi sono inventati (`acme-srl`, `brenta.it`).

**Dove l'utente la vede.** In Impostazioni › Estensione: il nome dell'estensione installata, che cosa aggiunge, il suo identificativo e la versione dell'app; oppure che non ce n'è nessuna, e che per averne una si contattano gli sviluppatori. In fondo alla colonna delle Impostazioni, sempre, e al passaggio sul marchio in cima alla barra (§13.1): la versione di SIEVER Mail e, se c'è, il nome dell'estensione.

---

## 2. Il Segretario: un'identità, molte esecuzioni

### 2.1 Cosa è condiviso e cosa no

| Livello                                                                | Condiviso tra le esecuzioni?                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Identità e valori (`segretario.md`), più le istruzioni dell'estensione | sì, sempre: è il prompt di sistema di ogni esecuzione           |
| Strumenti (lo stesso catalogo, nello stesso ordine)                    | sì                                                              |
| Memoria (il quaderno) e stato del lavoro (il registro)                 | sì                                                              |
| Compito del momento (`compiti/*.md`)                                   | no: lo riceve con il primo messaggio                            |
| Permessi effettivi (cosa può fare senza chiedere)                      | dipendono dal compito: in background non agisce verso l'esterno |
| Finestra di contesto                                                   | no: ogni esecuzione ha la sua e il suo ciclo di vita            |

**"Stessa identità" non vuol dire "stessa sessione".**

- Una sessione unica che cresce all'infinito sarebbe lenta, fragile e dipendente dall'ordine.
- La continuità viene da memoria, registro e diario condivisi.
- Ogni esecuzione legge ciò che le altre hanno scritto. È la stessa mente, come un professionista che non tiene tutto in testa ma riapre gli appunti.

### 2.2 Ogni punto AI dell'app è un'esecuzione dello stesso agente

| Dove l'utente lo vede                                                                                            | Esecuzione (compito)                                                        | Come restituisce il risultato                                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Nota sotto ogni messaggio, cose aperte, progetti, risposte pronte, eventi proposti, le proposte di un'estensione | **lettura** dei messaggi nuovi (la fonte Posta)                             | strumenti `nota`, `impegni`, `progetti`, `risposta`, `calendario`, quelli dell'estensione |
| Preparazione di un incontro, cose aperte nate da un evento, eventi nei progetti, conflitti e inviti              | **calendario**, quando gli eventi appaiono o cambiano (la fonte Calendario) | `nota`, `impegni`, `progetti`, `calendario`, `connessioni`                                |
| Oggi (la lettera), solleciti, ripasso delle cose aperte, preparazione delle riunioni                             | **giornata** (al mattino), su tutte le fonti                                | `oggi`, `nota`, `risposta`, `impegni`, `calendario`                                       |
| "Il punto" di un progetto                                                                                        | **punto** (quando è superato), su tutto ciò che il progetto raccoglie       | `progetti`                                                                                |
| Chat (pannello)                                                                                                  | **richiesta**                                                               | qualunque strumento, con le conferme                                                      |
| ⌘J nell'editor                                                                                                   | **scrittura**                                                               | `scrivi_bozza` sul messaggio aperto                                                       |
| Revisione prima dell'invio                                                                                       | **revisione**                                                               | `revisione`                                                                               |
| "Chiedi alla posta" nella ricerca                                                                                | **ricerca**                                                                 | `mostra` (la ricerca da mostrare e tenere)                                                |
| Conoscimi, riflessione, Al passo                                                                                 | **conoscimi**, **riflessione**, **al_passo**                                | `memoria`, `progetti`, `impegni`, `connessioni`                                           |

Due conseguenze.

**I risultati sono chiamate di strumenti.**

- La lettura non restituisce un JSON: annota con `nota`, apre e chiude con `impegni`, collega con `progetti`.
- Sono le stesse chiamate che farebbe la chat se l'utente glielo chiedesse.
- Il modello sceglie quanto lavorare: due ricerche per una mail, dieci passi per un'altra.
- Il modello produce anche effetti collaterali utili: corregge una nota sbagliata di ieri, sistema un evento, aggiorna la memoria, prepara un sollecito che non gli era stato chiesto.

**Per ogni compito c'è un solo vincolo di sistema: l'esito richiesto.**

- È un invariante, non una procedura.
- Una lettura finisce solo quando ogni messaggio del suo ambito ha la sua nota. Se il modello si ferma prima, il sistema glielo dice e lui completa.
- La revisione finisce con `revisione`.
- Il come resta tutto suo.

### 2.3 Effort e limiti: decide il modello

Nessun limite fisso deciso da noi su quanto lavora il modello. Vale la fiducia nella sua intelligenza: è lui a decidere quanti passi fare, quanto pensare, quanto scrivere, cosa tenere nel contesto.

- **Niente tetti di passi, di tempo, di token.** Non ci sono passi massimi per esecuzione (un tetto di 80 aveva fermato un Conoscimi a metà), né minuti per i lavori di sottofondo, né secondi per scrittura, ricerca e rilettura (le ferma l'utente: «Ferma», «Invia subito»), né token per risposta o per il riassunto, né solleciti contati per un compito incompleto.
- **Effort per compito.** Anche non mandarlo è una scelta (vale «high»): allora la scegliamo per compito. Il ragionamento è **sempre acceso**. Valori della documentazione ufficiale DeepSeek: `low`, `high`, `max` (`low` resta `low`; si trasformano solo `medium` e `xhigh`); OpenRouter dichiara per il modello `max`, `high`, `low`, `none`, e il fornitore scelto accetta `reasoning_effort` in modo nativo.
  - **`max`** dove il lavoro è profondo e nessuno lo fa correre: **Conoscimi**, **Al passo**, **riflessione** (la memoria a lungo termine e le correzioni dell'utente), **la chat** (ciò che l'utente chiede, di qualunque complessità), **la giornata** (una volta al giorno, tiene insieme tutto, ed è la prima cosa che l'utente legge: non ha fretta, e la qualità della lettera vale più di qualche secondo).
  - **`low`** dove il lavoro è fatto di molte piccole letture, o l'utente lo aspetta come un pulsante: **la lettura** di ogni messaggio, **il calendario**, **«Il punto»** (anche quando si apre un progetto), **⌘J** nell'editor, **la rilettura** prima dell'invio, **la ricerca in parole**.
  - Il riassunto della compattazione pensa quanto il lavoro che riassume. Il titolo di una conversazione è un lavoro tecnico, non del Segretario: senza ragionamento.
  - Quanto pensare dentro quel livello lo decide il modello. Si misura (token di ragionamento per compito, nella diagnostica, §14.4) e si ritocca solo con i dati.
- **Il contesto è del modello:** 1.048.576 token, la cache a 0,003 $ per milione. Si compatta solo vicino al bordo (85% del contesto reale, letto da OpenRouter), con l'ultimo passo tenuto alla lettera e un riassunto senza tetto; niente pulizia anticipata dei risultati (romperebbe la cache e toglierebbe ciò che il modello ha letto).
- **Gli strumenti possono tagliare, ma si continua sempre:** messaggi e documenti a pagine, la ricerca dei file che riprende da dove si era fermata, le cartelle e le conversazioni di un progetto a pagine, i file di qualunque dimensione, i fogli interi, le immagini grandi ridotte invece che rifiutate, la ricerca nel testo della posta non scaricata chiesta ai server (`nel_server`), le note lunghe dette e lette per righe invece che rifiutate. Nessun massimo su `limite`, sui mesi del quadro, sull'orizzonte, sulle note e sulle lezioni di Al passo e della riflessione.
- **Restano solo le cose che il modello non può tenere da sé** — limiti operativi per affidabilità e contro i giri a vuoto, non prescrizioni:
  - l'attesa di un modello che non risponde: l'esecuzione non fallisce, aspetta (30 s, 1, 2, 5 minuti) e rifà lo stesso passo, all'infinito se serve;
  - **un solo arresto, per il lavoro che gira a vuoto:** 10 turni di fila in cui ogni chiamata fallisce o viene rifiutata, o il risultato del compito chiesto e non lasciato. Non misura quanto lavora, solo che non avanza. Quell'esecuzione fallisce e **non si riprova da sola** dopo un po' (forse non servirebbe più): in primo piano l'utente ha «Riprova», in sottofondo finisce e basta (§14.2);
  - la stessa chiamata fallita ripetuta identica viene rifiutata con la spiegazione (non ferma il lavoro);
  - una chiamata muta da 90 secondi è morta (conta il silenzio, non la durata), e si riprova 3 volte prima di aspettare;
  - priorità e parallelismo;
  - credito: la spesa conta tutto ciò che OpenRouter fa pagare, anche le risposte interrotte, lette dopo dal suo registro. Credito finito o chiave rifiutata spengono l'AI (§12.1).
- **Chi serve il modello.** Tra i fornitori che non tengono i dati, il più economico tra i veloci: oggi Wafer. Wafer perde un argomento delle chiamate agli strumenti circa una volta su venti (gli altri una su trecento), e il modello se ne accorge e rifà la chiamata al turno dopo; il routing predefinito di OpenRouter senza quei fornitori costa il doppio a parità di risultato. Si accetta qualche riga «Non riuscito» nel diario per prezzo e velocità.
  - **I numeri** (procedure complete nello studio di prova): chiamate monche Wafer 94 su 2.106 (4,5%; in Conoscimi fino al 10%), Together 5,6%, Ionstream e Relace poche; tutti gli altri endpoint circa una su 300. Prezzo per chiamata di lettura: Wafer 0,00034 $, routing predefinito senza quei quattro 0,00073 $. Un Conoscimi da zero su Wafer ha avuto 38 chiamate rotte su 235 (16%), a raffica: una chiamata monca rimasta nel contesto il modello la imita (riempitivi come `cerca: "x"`).
  - **Due soluzioni, pronte per quando serviranno:**
    1. **Rigenerare in silenzio una chiamata monca**, come un errore di rete: se manca un argomento che l'azione richiede, quel passo si rifà prima che il modello lo veda, e la chiamata rotta non entra nel contesto (così si spezzano anche le raffiche); solo se anche la seconda arriva monca l'errore torna al modello. Costa circa il 5% di chiamate in più. Va distinta bene dagli errori veri del modello (un'azione impossibile, un riferimento sbagliato), che restano suoi; serve che gli strumenti dicano in modo tipizzato «argomento mancante».
    2. **Cambiare instradamento:** senza Wafer, Together, Ionstream e Relace e senza `sort: price` (routing predefinito di OpenRouter, che tiene conto della cache e delle chiamate rotte). Provata: Conoscimi 0 errori su 123 chiamate, 0,067 $, cache al 95%; nelle letture costa circa il doppio.

### 2.4 Il futuro: un collega, non solo un segretario

**Oggi:** essere il migliore in ciò che fa, cioè posta, calendario, file in sola lettura, progetti e memoria.

**Nella vision a lungo termine:** strumenti generalisti (ricerca web, lettura di pagine, `bash`, scrittura di file), per affidargli parti intere di progetti.

L'architettura è già pronta. Si aggiungono strumenti al catalogo e permessi al compito, e il resto non cambia. Non li aggiungo ora: il nome e il ruolo di oggi sono "segretario", e uno strumento potente senza i suoi confini di sicurezza sarebbe un rischio.

---

## 3. Il registro del lavoro (lo stato condiviso, deterministico)

**La memoria non è il database del lavoro.** È conoscenza narrativa, libera, scritta dal modello: chi è una persona, come lavora l'utente, come si chiamano le cose.

**Lo stato del lavoro sta in tabelle con invarianti.** Il modello lo modifica solo con gli strumenti, ed è ciò che l'interfaccia mostra:

- quale messaggio ha quale nota, quale incontro ha quale preparazione;
- quali cose sono aperte, da dove nascono e chi le ha chiuse;
- quali conversazioni, eventi e cartelle stanno in quale progetto;
- quale risposta è pronta.

### 3.1 Gli oggetti

| Oggetto                 | Cos'è                                                                                                                                                                                                                                               | Storico o vivo                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Oggetti delle fonti** | il messaggio (con un'identità stabile per account, §6.1), l'evento (per chiave della sua connessione, §7), in futuro il file (per volume e percorso, §8)                                                                                            | —                                                                                                  |
| **Nota**                | per un messaggio: cosa dice quando è arrivato — sintesi, natura (chiede una risposta / chiede di fare / aspetti / informativo / rumore), importanza con il perché, data utile                                                                       | **storica**: non si riscrive perché il progetto è andato avanti; si corregge solo se era sbagliata |
| **Preparazione**        | per un evento: ciò che serve sapere prima di entrare — è la nota dell'incontro, scritta con lo stesso strumento (`nota`, §5)                                                                                                                        | **viva** fino all'incontro                                                                         |
| **Cosa aperta**         | il lavoro vivo: testo, tipo (ti chiedono / hai promesso / aspetti / da fare), scadenza, e **da dove nasce**: un messaggio (con la conversazione), un evento, oppure la parola dell'utente (detta al Segretario o scritta da lui); in futuro un file | **viva**, con storia                                                                               |
| **Progetto**            | il contesto che dura: nome, di cosa si tratta, "Il punto" (stato corrente), e ciò che raccoglie da ogni fonte — conversazioni, eventi, cartelle (in futuro file e drive)                                                                            | **vivo**                                                                                           |
| **Risposta pronta**     | una risposta o un sollecito preparato in anticipo, con i suoi dubbi                                                                                                                                                                                 | **viva**: pronta / da rivedere / usata / scartata                                                  |
| **Proposta**            | un'azione che il Segretario consiglia ma non può fare da solo: un evento con invitati, la risposta a un invito, ciò che un'estensione sa eseguire (per Siever S.r.l., archiviare una mail nella sua pratica)                                        | **viva**: in attesa / accettata / scartata                                                         |
| **Diario**              | ogni esecuzione con i suoi passi e le modifiche fatte (`ai_activities` + `ai_events`), per vedere, capire e annullare                                                                                                                               | storico                                                                                            |

### 3.2 La vita di una cosa aperta

- **Stati:** `aperta` → `fatta` | `non_serve` | `rinviata` (fino a una data, poi torna aperta). Da qualunque stato si può **riaprire**.
- **Ogni passaggio registra:**
  - chi l'ha fatto: utente, Segretario o sistema;
  - quando;
  - perché: la mail che lo prova, "a voce", "non era da fare", "messaggio eliminato";
  - quale esecuzione l'ha fatto.

  Le righe mostrano "Fatta da te ieri", oppure "Chiusa dalla risposta di Rossi del 29/10".

- **Revisione e concorrenza.**
  - Ogni cosa aperta ha un numero di revisione.
  - Uno strumento che vuole modificarla dopo che è cambiata (l'utente l'ha spuntata mentre il Segretario lavorava) riceve un conflitto con lo stato nuovo, e ci ripensa.
  - Il modello non vede le revisioni: il sistema ricorda cosa ogni esecuzione ha letto (§4.6).
- **La parola dell'utente vince.**
  - Una cosa chiusa o riaperta dall'utente non la riapre o chiude una lettura in background con le stesse prove.
  - La lettura vede le cose chiuse di recente, con chi e quando. Se arriva un fatto **nuovo** che la contraddice ("il contratto firmato non è arrivato"), la riapre dicendo perché.
- **Doppioni.** Prima di aprire, la lettura vede le cose aperte, e quelle chiuse di recente, della conversazione, del progetto e dello stesso interlocutore. Due cose uguali si **uniscono** (`impegni unisci`): lo fa il Segretario al ripasso del mattino, oppure l'utente.
- **Da dove nasce non ne cambia la natura.** Una cosa aperta da un evento («portare i documenti all'incontro in banca») o detta in chat («ricordami di chiamare il commercialista venerdì») è una cosa aperta come quella di una mail: sta in Oggi, nel calendario con la sua scadenza, nel progetto. Le viste della Posta mostrano messaggi, quindi raccolgono quelle nate da un messaggio; la fonte di ognuna si apre con un clic.
- **Da dove nasce è sempre vero.** Lavorando da solo, il Segretario apre una cosa solo da ciò che legge — un messaggio o un evento —: lo strumento rifiuta una cosa senza l'uno o l'altro. Dalla parola dell'utente nasce solo con lui presente: detta in chat (anche per un progetto), o scritta a mano in Oggi. Ciò che l'utente dice in chat per un appuntamento nasce da quell'evento: conta a cosa si riferisce, non chi lo dice. Con l'app File nascerà anche da un file (§8).

### 3.3 Le viste sono proiezioni, calcolate

**Ogni app proietta lo stesso registro sui suoi oggetti.** Oggi lo mostra tutto, da ogni fonte. Il Calendario mostra scadenze e proposte sull'asse del tempo, e per ogni evento la sua preparazione, i suoi progetti, le sue cose aperte. La Posta ha le sue cartelle logiche, qui sotto.

Le cartelle logiche della Posta non esistono sul server: **non copiano e non spostano niente**. Sono riferimenti all'identità dei messaggi, calcolati dal registro ogni volta.

| Vista                | Cosa contiene                                                                                              | Quando un messaggio ci entra o esce                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Da gestire**       | i messaggi da cui nasce almeno una cosa aperta che tocca all'utente (ti chiedono / hai promesso / da fare) | entra quando la cosa si apre; esce quando è fatta, non serve o rinviata. **Nessuno stato della nota**: c'è una sola verità |
| **In attesa**        | i messaggi da cui nasce un'attesa aperta                                                                   | idem                                                                                                                       |
| **Risposte pronte**  | i messaggi con una risposta o un sollecito **pronto** (non "da rivedere")                                  | esce se è usata, scartata o superata                                                                                       |
| **Progetti**         | tutti i messaggi delle conversazioni del progetto: lo **storico completo**                                 | non escono perché sono vecchi o archiviati; escono solo se scollegati dal progetto                                         |
| **Ricerche salvate** | una ricerca in parole, con un periodo relativo                                                             | come la ricerca                                                                                                            |

**Regole comuni a tutte le viste:**

- **La cartella fisica non conta.** Un messaggio in Posta in arrivo, in Archivio, in una cartella personale o in Inviata compare allo stesso modo.
- **Cestino e Spam non alimentano le viste.**
  - Le cose aperte di un messaggio cestinato sono **sospese**: non sono chiuse, spariscono dalle viste e tornano se il messaggio viene ripristinato.
  - Se il messaggio viene **eliminato davvero** (cestino svuotato), il sistema le chiude come "non serve · messaggio eliminato" e lo registra.
- **Una riga per messaggio**, come tutta l'app: nessun raggruppamento in conversazioni. Le conversazioni restano nella testa del Segretario e nei dati per la ricerca.
- **Un filtro "Attivi"** si aggiunge a quelli di ogni lista (Tutti / Non letti / Contrassegnati) quando l'AI è accesa. Mostra i messaggi con qualcosa di aperto o una risposta pronta, in qualunque cartella o vista.
  - È l'unico filtro nuovo, uguale ovunque.
  - Non ci sono filtri speciali "attive/archiviate" per i soli progetti: renderebbero diversi i filtri tra una lista e l'altra.

### 3.4 Testi derivati che possono invecchiare

**"Il punto" di un progetto** e **la lettera di Oggi** descrivono lo stato corrente.

- Portano l'ora in cui sono stati scritti.
- Il sistema li segna **superati** quando cambiano le cose aperte o arrivano messaggi del progetto.
- Li riscrive un'esecuzione apposta, con un limite di frequenza:
  - "Il punto" quando si apre il progetto, oppure al mattino per i progetti mossi;
  - la lettera al mattino, e quando si apre Oggi se è superata da più di un'ora (superata vuol dire: dopo la lettera è cambiata una cosa aperta, non per mano della giornata stessa).

**Le parole che restano portano i loro link.** La lettera, «Il punto» e la preparazione di una riunione conservano accanto al testo ciò a cui puntano i loro riferimenti, come la chat: con un clic l'utente arriva al messaggio, all'evento, al progetto o alla cosa aperta (`[…](impegno:12)`, il cui numero vale ovunque). Un lavoro successivo li rilegge senza link: i riferimenti brevi di un altro lavoro non sono i suoi.

**La nota di un messaggio non invecchia:** dice cosa diceva quel messaggio.

**Rinominare un progetto non riscrive niente.** Il nome si mostra dal riferimento.

### 3.5 Risposte pronte che invecchiano

- Se in una conversazione arriva un messaggio nuovo dopo che una risposta era pronta, il sistema la segna **da rivedere**, deterministicamente: esce dal conteggio delle pronte, non si cancella.
- La lettura del messaggio nuovo la vede e decide: riscriverla, confermarla o scartarla.
- Finché nessuno decide, nel lettore compare "Da rivedere: è arrivato un messaggio dopo".

---

## 4. Il motore: ciò che sveglia il Segretario

**Non è un secondo cervello.** Non decide cosa significa una mail o un evento. Decide **quando** serve lavoro, **quale** lavoro, in **che ordine** e con **quanta concorrenza**, e garantisce che niente si perda o si ripeta.

### 4.1 Prima lo stato, poi gli eventi

Un diario degli eventi con il pattern outbox sarebbe la scelta di un server. Per un'app locale con SQLite c'è una cosa **più semplice e più robusta**: il lavoro si ricava dallo **stato**, che si può interrogare.

| Lavoro                                       | Domanda deterministica che lo fa nascere                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lettura                                      | quali messaggi di ogni casella, fuori da Cestino, Spam e Bozze, **entro l'orizzonte di quella casella** (§6.5), con il testo indicizzato, **non hanno ancora una nota**?                                                                                                                                                                                                                                |
| giornata                                     | oggi (dalle 6 in poi) c'è già stata la giornata?                                                                                                                                                                                                                                                                                                                                                        |
| punto                                        | quali progetti hanno "Il punto" superato e sono aperti, o mossi da ieri?                                                                                                                                                                                                                                                                                                                                |
| calendario                                   | quali calendari **il Segretario non ha ancora guardato** (la prima volta: tutto ciò che il calendario tiene)? e cosa è **cambiato** in tutta la finestra — nuovo, spostato, annullato, da altri o dall'utente, nell'app o altrove — dopo il punto fin dove ha guardato il registro dei cambiamenti?                                                                                                     |
| file (quando ci saranno le connessioni File) | nessuna lettura file per file: un file è materiale del lavoro, entra nel lavoro da ciò che lo nomina (una mail, un evento, un progetto). Quali file, **dentro le cartelle collegate ai progetti**, sono nuovi o cambiati — da altri o dall'utente — da quando il Segretario ha guardato quel progetto? Rendono superato il suo «Il punto», e l'esecuzione che lo riscrive riceve cosa è cambiato (§4.2) |
| conoscimi                                    | quali connessioni non sono ancora conosciute?                                                                                                                                                                                                                                                                                                                                                           |
| riflessione                                  | ci sono lezioni nuove (correzioni dell'utente) non ancora elaborate?                                                                                                                                                                                                                                                                                                                                    |
| al passo                                     | da quando la memoria è stata aggiornata con la posta, sono arrivate abbastanza note nuove?                                                                                                                                                                                                                                                                                                              |

**Perché lo stato e non gli eventi:**

- Le domande sono **idempotenti**: rifarle non crea doppioni.
- **Non perdono niente** se l'app si chiude, se il server non notifica o se un altro client sposta la posta. La verità è nel database e nel server, che la sincronizzazione riconcilia già.
- **Eventi** (nuova posta, spunta dell'utente, sincronizzazione finita) servono solo a **svegliare presto** il pianificatore, invece di aspettare il giro successivo.

### 4.2 Tre fonti, una stessa domanda

Per ogni fonte la domanda è la stessa — _quali oggetti, nel campo di attenzione del Segretario, sono nuovi o cambiati da quando li ha guardati?_ — e la risponde lo stato. Cambiano tre cose, e ognuna discende dalla natura della fonte, non da una regola nostra:

|                        | Posta                                                                        | Calendario                                                                                                                                 | File                                               |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Che cos'è              | comunicazione scritta all'utente                                             | tempo impegnato                                                                                                                            | materiale del lavoro                               |
| Campo di attenzione    | i messaggi entro l'orizzonte della casella; poi tutto ciò che arriva o parte | tutto ciò che il calendario tiene (60 giorni indietro, un anno avanti, la finestra che scorre ogni giorno); poi ciò che vi appare o cambia | le cartelle collegate ai progetti                  |
| Chi lo decide          | il Segretario (Conoscimi, `connessioni`)                                     | nessuno: è la finestra del calendario                                                                                                      | il Segretario (collegando le cartelle ai progetti) |
| Unità di senso         | il messaggio, nella sua conversazione                                        | l'evento, nel suo tempo                                                                                                                    | il documento, nel suo progetto                     |
| Un'esecuzione guarda   | una conversazione, accorpata                                                 | la prima volta un blocco di eventi (fino a 50, una serie ricorrente conta per uno), i blocchi in parallelo; poi i cambiamenti, accorpati   | i file cambiati di un progetto, con «Il punto»     |
| Cosa resta per oggetto | una nota, che l'utente vede accanto al messaggio                             | niente per evento: il punto fin dove ha guardato il registro dei cambiamenti (e una preparazione, se la merita)                            | niente: i collegamenti e «Il punto» del progetto   |

- **Posta: un'esecuzione per conversazione.** Ogni messaggio è scritto all'utente da qualcuno e può chiedergli qualcosa; il suo senso sta nella conversazione; l'app mostra una nota accanto a ciascuno e ne ricava Da gestire e In attesa. Una conversazione è il contesto giusto (la sua storia, non tutto il resto) e permette le corsie in parallelo senza conflitti. Il costo segue ciò che arriva: nello studio di prova 0,002–0,004 $ a conversazione.
- **Calendario: a blocchi, non uno per esecuzione.** Ogni evento si guarda, uno per uno, ma insieme agli altri. Un evento si spiega da sé (il titolo dice cos'è) e quasi sempre non chiede niente; il suo senso è nel rapporto con gli altri nel tempo — sovrapposizioni, viaggi, sequenze, la preparazione di domani — che un'esecuzione per evento non vedrebbe.
- **Calendario: ogni evento si guarda quando appare e quando cambia, a qualunque distanza.** La posta ha un limite destro che non è una scelta: un messaggio esiste quando arriva, e ciò che chiede diventa una cosa aperta con la sua data utile. Il calendario non ha un limite destro: un evento a marzo può chiedere qualcosa oggi (iscriversi alla fiera, prenotare il viaggio, preparare un documento lungo). Guardare solo i prossimi 60 giorni sarebbe un numero nostro, e arriverebbe tardi proprio dove serve agire presto; e decidere quanto indietro guardare, per il calendario, non ha il senso che ha per una casella. Quindi:
  - **niente orizzonte deciso dal Segretario per il calendario:** il campo di attenzione è la finestra che il calendario tiene, 60 giorni indietro e un anno avanti, che **scorre ogni giorno**;
  - **la prima occhiata** (un calendario appena conosciuto) guarda tutta la finestra una volta, a blocchi di fino a 50 eventi — **in parallelo, come le conversazioni**: i rapporti nel tempo sono vicini (lo stesso giorno, la stessa settimana), e il Segretario di un blocco, che è un Segretario normale, guarda fuori dal suo blocco quando gli serve;
  - **poi il registro dei cambiamenti**, su tutta la finestra: ciò che appare o cambia — nuovo, spostato, annullato, da chiunque tranne il Segretario — sveglia un'esecuzione, che riceve tutto ciò che è cambiato da dove era arrivata l'ultima volta, con il prima e il dopo. Non serve un segno per evento: il registro, con il punto fin dove è stato guardato, è già la domanda sullo stato;
  - **una serie ricorrente è una cosa sola:** nella prima occhiata si mostra una volta («si ripete 52 volte, ogni lunedì 9:00–9:30, fino al…»); quando la finestra scorre e vi entra un'altra istanza di una serie già conosciuta non è un cambiamento, e non sveglia nessuno. Una serie nuova, creata da chiunque, o un'istanza spostata, sì;
  - **il «quando» lo decide il modello:** ciò che un evento lontano chiede ora è una cosa aperta con la data in cui agire; la preparazione dell'incontro si scrive vicino al giorno, con ciò che si sa allora; il tempo che passa lo porta la giornata.
- **File: mai uno per uno.** Un volume ha decine o centinaia di migliaia di file: leggerli costerebbe centinaia di dollari e non servirebbe, perché un file non è scritto all'utente, quasi sempre lo ha fatto lui, e il suo senso viene da ciò che lo nomina (una mail, un evento, un progetto). La prima occhiata è di Conoscimi: esplora i volumi per capire come sono fatti e collega ai progetti le loro cartelle. Da lì il campo di attenzione dei file sono quelle cartelle: è il loro orizzonte, nello spazio invece che nel tempo, e lo decide il Segretario come decide quanto indietro leggere la posta. Il resto dei volumi si cerca quando serve.
- **I file cambiati arrivano a «Il punto»**, quando ci saranno le connessioni File (§8). Se un file cambiato in una cartella di progetto rendesse superato «Il punto» senza dire cosa è cambiato, i file sarebbero l'unica fonte in cui un cambiamento non può far nascere lavoro (una cosa aperta, una proposta). Invece i file nuovi o cambiati nelle cartelle di un progetto — da altri o dall'utente, come per il calendario — si accorpano (i file cambiano a raffiche: si aspetta che smettano) e arrivano, con l'elenco di cosa è cambiato, all'esecuzione «Il punto» di quel progetto. Questa li guarda quanto serve e può aprire — ciò che apre nasce da quel file (§3.2) —, chiudere e collegare come il compito calendario: un'offerta «rev2» salvata in OFFERTE, accanto a «mandare l'offerta entro venerdì», diventa «pronta, manca l'invio». Va alla cadenza di «Il punto»: un file non è urgente da sé, e quando lo è di solito arriva anche un messaggio che lo dice.

### 4.3 Unità di lavoro durevoli

Una tabella `ai_work`:

- **Campi principali:** compito, ambito (per esempio la conversazione), chiave di unicità, priorità, stato (in coda / al lavoro / fatto / da riprovare / fallito), tentativi, `non_prima` (accorpamento, attesa tra un tentativo e l'altro), esecuzione collegata, motivo dell'ultimo errore.
- **Unicità:** al massimo un'unità in coda per la stessa chiave (`lettura:account:conversazione`). Tre messaggi arrivati insieme nella stessa conversazione diventano **un solo lavoro**. Si aspettano una ventina di secondi dall'ultimo arrivo, per accorparli.
- **Dopo un riavvio:** ciò che era "al lavoro" torna in coda.
- **Tentativi:**
  - la rete o il fornitore che non rispondono non sono un fallimento: l'esecuzione aspetta e riprende dallo stesso passo (§2.3);
  - un'unità che fallisce resta "fallita" e non si riprova da sola: né dopo un minuto né dopo un giorno. Si rifà quando l'utente dice "Riprova", o quando sulla stessa questione arriva qualcosa di nuovo (un messaggio nella conversazione, un cambiamento del calendario): quel lavoro, finito, chiude anche il fallimento. Un fallimento non si dimentica col tempo; va via con la sua connessione;
  - in primo piano (chat, ⌘J, ricerca in parole, Conoscimi e lettura della procedura) l'utente ha «Riprova»; in sottofondo il fallimento finisce lì, senza nulla da gestire (§14.2).
- **Pausa generale:** chiave non valida o credito finito fermano tutto il motore, con l'avviso all'utente.

### 4.4 Priorità e parallelismo

**Gli interattivi non fanno coda.** Chat, editor, revisione e ricerca partono subito, fuori dal limite di concorrenza.

**Il background ha un limite di concorrenza** (4 di base; 8 nella preparazione iniziale). Le priorità, in ordine:

1. ciò che è appena cambiato in una fonte: posta arrivata, eventi cambiati da altri — alla pari;
2. giornata;
3. punto;
4. memoria;
5. arretrato (backfill).

Il nuovo scavalca sempre l'arretrato. L'arretrato avanza comunque: quando non c'è altro prende tutti i posti tranne uno, tenuto libero perché la posta nuova non aspetti mai.

**Quando la rete o il fornitore non rispondono** le esecuzioni in corso aspettano e riprendono dallo stesso passo, e il motore intero aspetta con loro: una sola unità nuova alla volta, a intervalli crescenti (30 s, 1, 2, 5 minuti), e si riparte al risveglio del computer o alla prima chiamata che passa. L'attesa non è un fallimento ed è detta all'utente; nella procedura guidata, se dura, l'utente può continuare senza AI.

**Corsie: si legge in fila ciò che è legato, in parallelo il resto.**

- Prima di partire, un'unità calcola le sue **chiavi di blocco**:
  - la conversazione;
  - i progetti in cui già sta;
  - l'interlocutore esterno.
- Due unità con una chiave in comune non lavorano insieme.
- Dentro una corsia si va dal più vecchio al più nuovo, così chi legge dopo vede ciò che ha aperto chi legge prima. Tra corsie diverse passa prima la più recente.
- I blocchi della prima occhiata a un calendario vanno in parallelo; i cambiamenti di un calendario uno alla volta.

### 4.5 Cosa sveglia il Segretario, e cosa no

| Cambiamento                                                                                                   | Reazione                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuovo messaggio (in arrivo o inviato), anche da un altro client                                               | lettura della sua conversazione (accorpata)                                                                                                                                 |
| Messaggio spostato o archiviato                                                                               | **nessun lavoro AI**: le viste si aggiornano da sole                                                                                                                        |
| Messaggio cestinato o ripristinato                                                                            | **nessun lavoro AI**: le cose aperte si sospendono o tornano (§3.3)                                                                                                         |
| Messaggio eliminato davvero                                                                                   | il sistema chiude le sue cose aperte (non serve · eliminato) e segna superate le risposte pronte; la nota resta come storia, senza più un messaggio a cui stare accanto     |
| L'utente spunta, riapre o corregge                                                                            | applicato subito, deterministico; "Il punto" e la lettera diventano superati; la correzione diventa una **lezione**                                                         |
| L'utente corregge un progetto                                                                                 | applicato subito; resta come scelta dell'utente; diventa una lezione                                                                                                        |
| Evento nuovo, spostato o annullato da altri, invito nuovo                                                     | lavoro calendario (accorpato: due minuti dal primo cambiamento)                                                                                                             |
| Evento creato, spostato o tolto dall'utente, nell'app o da un altro dispositivo                               | lavoro calendario, accorpato: come la posta che l'utente manda, che si legge                                                                                                |
| Evento creato o cambiato dal Segretario                                                                       | **nessun lavoro AI**: lo sa già                                                                                                                                             |
| La finestra del calendario scorre di un giorno                                                                | **nessun lavoro AI** per ciò che esce o per un'altra istanza di una serie già conosciuta; un evento nuovo che entra si guarda (§7.2)                                        |
| Un calendario nuovo in una connessione già guardata (uno che l'utente crea, uno che un collega gli condivide) | la sua prima occhiata, in sottofondo, a blocchi (§7.2): lì il Segretario dice di chi sono i suoi eventi (§7.4). Non è una connessione nuova: niente procedura               |
| File nuovo o cambiato, da altri o dall'utente (quando ci saranno le connessioni File)                         | se è in una cartella di un progetto: accorpato, «Il punto» di quel progetto diventa superato e chi lo riscrive riceve cosa è cambiato (§4.2); altrove, **nessun lavoro AI** |
| Il Segretario scrive nel registro                                                                             | **nessun lavoro AI nuovo**, solo i testi superati (§3.4)                                                                                                                    |
| Il tempo passa (mattino, scadenze, attese che tardano)                                                        | la giornata                                                                                                                                                                 |
| Connessione tolta                                                                                             | il lavoro in corso si ferma e aspetta; ciò che era suo se ne va; «Il punto» dei suoi progetti e la lettera diventano superati; una lezione alla riflessione (§11.4)         |
| L'utente chiede                                                                                               | esecuzione interattiva                                                                                                                                                      |

**Perché non ci sono cascate.** Il lavoro AI nasce solo dal mondo (le fonti e il tempo), dall'utente e dai testi superati. Le scritture del Segretario non generano lavoro AI. I testi superati si riscrivono con un limite di frequenza, e chi li riscrive non rende superato nient'altro.

**Le dipendenze non si cercano con un grafo a raggio fisso.**

- Se ne occupa l'esecuzione stessa: la lettura parte dai suoi messaggi e va a vedere la conversazione, il progetto, le cose aperte vicine e le risposte pronte toccate.
- Se serve, cerca altro con gli strumenti.
- Il ripasso del mattino raccoglie ciò che è sfuggito.

### 4.6 Concorrenza tra esecuzioni: trasparente al modello

- **Il sistema ricorda cosa ogni esecuzione ha letto.** Per ogni oggetto del registro e per ogni nota di memoria tiene la revisione vista. Il modello non passa numeri di revisione.
- **Se si scrive su un oggetto cambiato dopo averlo letto:**
  - cambi compatibili (per esempio un `sostituisci` il cui testo c'è ancora) si applicano;
  - gli altri tornano come conflitto, con lo stato nuovo e chi l'ha cambiato. Il modello ci ripensa.
- **Creare dà lo stesso risultato due volte di fila:**
  - un evento (o una proposta d'evento) con lo stesso orario e un titolo simile restituisce quello che c'è: si creano uno alla volta;
  - un progetto con lo stesso nome restituisce quello che c'è;
  - una nota già scritta per quel messaggio si aggiorna;
  - una cosa aperta identica nella stessa conversazione restituisce quella che c'è.

### 4.7 Permessi per compito

Il catalogo degli strumenti è lo stesso per tutti. Ogni strumento controlla il compito che lo chiama.

**Interattivi** (chat, editor, revisione, ricerca)

- Fanno tutto, ma chiedere una conferma può solo una conversazione nel pannello, perché solo lì l'utente la vede: la rilettura prima dell'invio, ⌘J e la ricerca in parole leggono posta non fidata senza una conversazione davanti, quindi preparano e non agiscono verso l'esterno.
- Chiedono conferma per ciò che esce verso gli altri: inviare, creare o modificare eventi con invitati, le azioni di un'estensione che scrivono fuori dall'app (salvare su un disco condiviso).

**Background** (lettura, giornata, punto, calendario, memoria)

Possono:

- leggere tutto;
- scrivere nel registro;
- scrivere in memoria;
- creare, modificare o eliminare **eventi propri senza invitati**. Sono reversibili, finiscono nel diario e si possono annullare.

Al posto delle azioni verso l'esterno lasciano **proposte**:

- un evento con invitati, la risposta a un invito;
- ciò che un'estensione sa eseguire (per Siever S.r.l., archiviare una mail nella sua pratica).

Non possono:

- inviare;
- spostare o cestinare posta;
- scrivere bozze vere sul server (preparano risposte pronte, che restano in locale).

È la Rule of Two: il lavoro in background legge posta non fidata, quindi non agisce verso l'esterno senza l'utente.

### 4.8 Il diario visibile

- **Ogni esecuzione in background compare nel pannello del Segretario** come lavoro fatto, con le modifiche che ha prodotto ("Letta la mail di Rossi · aperta 1 cosa · risposta preparata") e i link. Le modifiche annullabili hanno "Annulla".
- **Le esecuzioni silenziose si raggruppano** ("Ho letto 14 messaggi"), per non riempire il pannello.
- **La chat vede lo stesso diario** con uno strumento, oltre a quello che `leggi` mostra di ogni messaggio. Sa sempre cosa ha già fatto e perché.

### 4.9 Contesto e cache

**Ordine della richiesta**, dal più stabile al più variabile:

1. prompt di sistema (`segretario.md`, più le istruzioni dell'estensione);
2. strumenti in ordine fisso (quelli dell'app, poi quelli dell'estensione);
3. primo messaggio, con dentro:
   1. il **compito** (`compiti/<compito>.md`);
   2. il contesto, che è una mappa: data al giorno, connessioni, indice della memoria;
   3. ciò che è cambiato (i messaggi arrivati, il progetto mosso, i cambiamenti del calendario, la richiesta).

**Perché funziona:** la cache del provider lavora sul prefisso a blocchi anche tra richieste diverse. Misurato: le letture condividono già 6.528 token in cache. Tutte le letture condividono sistema, strumenti e compito.

**Il contesto lo sceglie il Segretario.** Ogni esecuzione parte dal compito, dalla mappa e da ciò che è cambiato; tutto il resto — la conversazione e il lavoro già fatto, le note della memoria, il calendario, le cose aperte con una persona o in un progetto — lo recupera lui con gli strumenti, quanto serve. Nessun dossier deciso da noi. I prompt suggeriscono dove guardare, in modo generale; l'harness controlla le chiamate agli strumenti, mai il testo che il modello scrive.

---

## 5. Gli strumenti: pochi, distinti, potenti

Prefissi chiari, nessuna sovrapposizione: per ogni cosa si sa quale strumento usare.

| Strumento      | Cosa fa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cerca_posta`  | Ricerca su tutta la posta, con la grammatica dell'app e i filtri (account, cartella, date, persone, allegati, non letti, progetto). Cestino e Spam solo se chiesti. Con `quadro` dà lo sguardo d'insieme di un account, per persona e per mese. Un numero si trova anche dentro un codice («2463» trova «ORD2463»), come nella ricerca dell'app.                                                                                                                                                          |
| `cerca_file`   | Ricerca di file e cartelle per nome; elenca una cartella. In sola lettura, nelle fonti File: oggi il computer e i volumi di rete collegati, poi le connessioni File (§8).                                                                                                                                                                                                                                                                                                                                 |
| `leggi`        | Legge qualunque riferimento: un messaggio o la sua conversazione (con nota, cose aperte, progetto, risposta pronta, bozze, i segni di un'estensione), un allegato, un file, un evento, un progetto.                                                                                                                                                                                                                                                                                                       |
| `nota`         | Ciò che il Segretario scrive accanto a una cosa di una fonte, con la forma di quella cosa. Di un messaggio, sempre: sintesi, natura, importanza, motivo, scadenza; storica, si corregge solo se era sbagliata. Di un evento, solo quando la merita: la preparazione, viva fino all'incontro; che è dell'utente quando il calendario non lo dice (§7.4). Per entrambi, se l'utente va avvisato adesso, la riga che riceve (`avvisa`, §13.3). Un file non ha una nota sua (§4.2).                           |
| `impegni`      | Cose aperte, da qualunque fonte: da un messaggio, da un evento, o dalla parola dell'utente (con l'app File, anche da un file). In un'unica chiamata, più operazioni: elenca, apre, aggiorna, segna fatta o non serve, rinvia, riapre, unisce. Prende ciò che il modello scrive in modo naturale: il messaggio che prova la cosa è anche quello da cui nasce, e il progetto indicato mette nel progetto la sua fonte, o la cosa stessa se l'ha detta l'utente.                                             |
| `progetti`     | Elenca o cerca; legge; crea; rinomina; unisce; collega o scollega conversazioni (anche tutte quelle di una ricerca), eventi e cartelle; scrive "Il punto" e di cosa si tratta; nasconde.                                                                                                                                                                                                                                                                                                                  |
| `risposta`     | Prepara, aggiorna, conferma o scarta una risposta pronta o un sollecito, sempre locale.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scrivi_bozza` | Bozza vera, aperta nell'editor e salvata in Bozze: nuova, risposta o inoltro. Riscrive anche la bozza aperta o solo il passaggio selezionato (⌘J).                                                                                                                                                                                                                                                                                                                                                        |
| `invia_bozza`  | Invia, sempre con conferma.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `organizza`    | Archivia (nel senso del provider), sposta, contrassegna, segna come letto, cestina, sempre con Annulla. Solo negli interattivi.                                                                                                                                                                                                                                                                                                                                                                           |
| `calendario`   | Elenca (qualunque periodo: si stringe a ciò che il calendario tiene, da 60 giorni fa a un anno avanti, e lo dice), **cerca per parole** (titolo, luogo, descrizione, partecipanti; anche nel passato, come `cerca_posta` per la posta), mostra quando si è liberi, crea, modifica, sposta, elimina, risponde agli inviti, propone (un evento nuovo, la modifica di uno che c'è con i soli campi che cambiano, la risposta a un invito) e ritira le proprie proposte superate. I permessi seguono il §4.7. |
| `memoria`      | Il quaderno (§10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `oggi`         | La lettera in cima a Oggi: il testo della scrivania (§13.1).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `revisione`    | L'esito del controllo prima dell'invio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mostra`       | Guida l'interfaccia: apre un messaggio, un evento, un giorno, una ricerca (anche come risultato di "Chiedi alla posta"), una cartella, un progetto.                                                                                                                                                                                                                                                                                                                                                       |
| `diario`       | Cosa il Segretario ha fatto e quando, con le modifiche: per non rifare e per spiegare.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `connessioni`  | Le connessioni di ogni famiglia, con quanto si legge di ciascuna e quanto c'è (messaggi ed eventi per periodo, già letti, costo stimato dalle letture vere); e l'orizzonte di lettura di una casella (`lettura`, almeno 14 giorni, con il perché), che decide Conoscimi o la chat quando l'utente lo chiede (§6.5). Per un calendario non c'è orizzonte da decidere: si guarda tutto ciò che tiene (§7.2); si decide invece quali dei suoi eventi sono dell'utente (`di_chi`, §7.4).                      |

**Di un'estensione:** i suoi strumenti, dopo questi, con le stesse regole: conferma con l'utente presente, proposte in sottofondo (per Siever S.r.l. `archivio_pratiche`: guarda, proponi, archivia).

Sono 17 strumenti, più quelli di un'estensione, tutti distinti: conta la sovrapposizione, non il numero.

**La stessa forma per ogni fonte.** Cercare, leggere, agire: per la posta `cerca_posta`, `leggi`, `organizza`/`scrivi_bozza`; per il calendario `calendario` (`cerca`, `elenco`), `leggi`, `calendario` (`crea`, `proponi`…); per i file `cerca_file`, `leggi`. Il registro (`impegni`, `progetti`, `risposta`, `nota`, `oggi`) è uno solo, sopra tutte. Una fonte nuova porta i suoi strumenti di ricerca e di azione; `leggi` la legge come le altre, e `nota` scrive accanto alle sue cose con la forma che hanno — come farà per un contatto, con l'app Contatti (§13.4). Ogni strumento del registro scrive una cosa sola: `oggi` la scrivania, `nota` accanto alle cose delle fonti, `impegni` le cose aperte, `progetti` i progetti, `risposta` le risposte pronte.

---

## 6. Posta: identità, archiviazione, cartelle

### 6.1 Identità dei messaggi

- **La chiave** è per account:
  - l'id che il server dà al messaggio in tutte le cartelle (X-GM-MSGID su Gmail, OBJECTID dove c'è);
  - altrimenti il Message-ID;
  - altrimenti un'impronta del contenuto.
- **Le righe per cartella** sono le occorrenze del messaggio. Uno spostamento cambia UID e cartella, non la chiave. Note, cose aperte, progetti e segni si appoggiano alla chiave.
- **Lo stesso messaggio su due account** sono due occorrenze con chiavi distinte. Il Segretario lo legge una volta (gemelli). Archiviarlo su un account non lo tocca sull'altro.
- **Due messaggi diversi con lo stesso Message-ID** (ticket, scanner) si distinguono da ciò che ogni copia dice uguale — data, mittente, oggetto — mai da dimensione o ora d'arrivo, che cambiano tra la copia inviata e quella ricevuta: le copie di una mail hanno una chiave sola. Chi ha quale chiave si ricorda anche dopo che le sue righe se ne vanno, così un messaggio spostato da un altro client o riscaricato ritrova la sua.
- **Un messaggio che il server non riesce a dare** non blocca la cartella: dopo tre tentativi resta fuori e si riprova una volta al giorno.

Da provare su ogni server IMAP che non sia Gmail: spostamento con UID nuovo, conversazioni, Message-ID mancante.

### 6.2 Archiviare e lavorare sono indipendenti

Un principio di tutto il prodotto:

1. **Archiviare** decide dove sta il messaggio nella casella. Non tocca il lavoro.
2. **Lo stato del lavoro** cambia solo quando cambia il lavoro.
3. **Ciò che un'estensione fa di un messaggio fuori dalla posta** — per Siever S.r.l., salvarlo nella pratica dell'archivio dello studio — è una cosa sua, indipendente da entrambe, e lascia un segno (§6.3).

- **Nessun avviso "chiudo le cose aperte?" quando si archivia.**
- **Archiviare è l'operazione del provider**, astratta:
  - Gmail: toglie dalla Posta in arrivo (resta in Tutti i messaggi);
  - IMAP: cartella `\Archive`, oppure la crea come fanno Thunderbird e Apple Mail;
  - Microsoft: la cartella Archivio.
  - Un messaggio già archiviato non si sposta.
  - "Tutti gli account" archivia ogni messaggio nel suo account.
- **L'app pubblica non ha un «salva su disco».** Un salvataggio come quello di Siever è il modo di lavorare di un'organizzazione — le sue cartelle, i suoi nomi, gli allegati spacchettati, la PEC aperta — e non un «salva con nome» che servirebbe a tutti: non sono nemmeno la stessa cosa. Se un giorno un salvataggio servirà a tutti, sarà un'altra funzione, pensata con l'app File.

### 6.3 I segni di un'estensione

Ciò che un'estensione fa di un messaggio fuori dalla posta è suo: come, dove, in che forma. Che sia stato fatto è un fatto del messaggio, e lo tiene l'app: un **segno**.

- **Che cos'è.** Le parole dell'estensione («Archiviato Siever», «Protocollato», «Inviato al gestionale»), se serve un posto — la cartella dove sta ciò che ha fatto — e i file scritti, e quando. Uno per messaggio e posto: rifarlo è lo stesso segno, con le parole di adesso.
- **Dove vive.** Con la posta, non con il Segretario. Segue il messaggio ovunque vada, per la sua identità (§6.1); si vede sulla riga e nel lettore, con la cartella a un clic, anche con l'AI spenta; va via con la sua casella e con «Elimina tutti i dati», resta con «Dimentica tutto». Il Segretario lo legge con il messaggio (`leggi`), e che cosa vuol dire lo sa dalle istruzioni dell'estensione.
- **Che cosa garantisce.** Un'azione dell'estensione è fatta quando il suo segno è registrato: un segno che non si registra fa fallire ciò che segna. Prima di rifare, l'estensione chiede i segni che ha già lasciato: ciò che è fatto non si rifà. Due azioni sullo stesso messaggio insieme si danno il turno.
- **Le proposte.** Un'estensione può dare al Segretario uno strumento per proporre la sua azione, che qualunque esecuzione chiama quando lo ritiene utile — la lettura di un messaggio, la giornata (che vede cosa l'utente lascia lì e di solito sistema), la chat. La proposta compare sul messaggio; un clic apre la finestra dell'estensione già compilata, un altro conferma, e l'utente può correggere: la correzione (proposta X, scelta Y) diventa una lezione per la riflessione. Il segno risponde alle proposte del suo tipo ancora aperte sul messaggio, comunque l'azione sia stata fatta. In chat lo strumento esegue, con la conferma dell'utente.
- **Il segno di prima.** Sui messaggi selezionati l'estensione sa dove aveva lasciato l'ultimo segno con un posto su una mail della stessa conversazione, o dello stesso mittente: la sua finestra parte da lì.
- **La radice si sposta.** Se l'archivio cambia posto, l'estensione lo dice all'app (`relocatePaths`), e i posti dei segni, le cartelle dei progetti e i file recenti la seguono (§8).
- **Il primo caso: ARCHIVIA SIEVER.** Un pulsante, due operazioni in fila: il salvataggio nella pratica, tutto dell'estensione (le cartelle del giorno, il `.eml` con gli allegati veri accanto, la PEC aperta: il README dell'estensione), poi l'archiviazione del provider, la stessa dell'app (§6.2), mai il Cestino. Se il salvataggio fallisce non si archivia; se riesce e l'archiviazione no, il segno resta e si rifà solo l'archiviazione. Dopo, il messaggio resta sul server — nelle viste, nei progetti, nella ricerca del Segretario — con le sue cose aperte. Ciò che le versioni 1.x mandavano nel Cestino resta nel Cestino; i suoi file stanno sul disco come storia dell'archivio.
- **Sugli oggetti delle altre fonti.** Oggi i segni stanno sui messaggi, perché è lì che il primo caso ne aveva bisogno. Lo stesso concetto vale per un evento o un file — un incontro «Verbalizzato», un documento «Protocollato» — ma l'identità di un evento e di un file è un'altra (§7, §8), e un segno senza chi lo lascia sarebbe codice senza uso: si aggiunge lì, con la stessa forma, quando un'estensione ne avrà bisogno (§15.4).

### 6.4 Cestino, Spam, eliminazione

| Dove                                                   | Ricerca normale                          | Viste e lavoro attivo                                   |
| ------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------- |
| Posta in arrivo, Inviata, Archivio, cartelle personali | sì                                       | sì                                                      |
| Cestino, Spam                                          | solo se chiesto (`cartella` o `ovunque`) | no: le cose aperte sono sospese                         |
| Eliminato                                              | non esiste più                           | le cose aperte si chiudono come "non serve · eliminato" |

### 6.5 Cosa legge il Segretario

**Tutti i messaggi** in arrivo e inviati, in **qualunque cartella** tranne Cestino, Spam e Bozze: una regola del server che smista in una cartella non deve nascondergli niente.

**L'orizzonte.** Quanto indietro si legge messaggio per messaggio non è un numero nostro, uguale per tutti: è una **decisione del Segretario su ogni connessione**, presa quando la conosce.

- **Perché.** Trenta giorni fissi sarebbero un pregiudizio: una casella dove le questioni durano mesi ha cose ancora vive a 90 giorni; una casella personale dove tutto si chiude in una settimana non ne ha a 30. Chi lo sa è Conoscimi, che ha appena letto tutto.
- **Chi lo decide.** Conoscimi, in ogni sua forma (primo avvio, nuova connessione, AI riaccesa, «Rifai Conoscimi»), con lo strumento `connessioni` (`lettura`), dicendo perché. Anche la chat, quando l'utente lo chiede ("leggi anche ottobre"). Non un lavoro a parte: Conoscimi ha già la visione d'insieme, e un'esecuzione in più rileggerebbe le stesse cose.
- **I limiti.** Di base 30 giorni, se non decide altro. Almeno 14, perché le funzioni partano piene. Nessun massimo: lo strumento dice quanti messaggi sono, per periodo fino a tutti, e quanto costa leggerli, stimato dalle letture vere — decide informato, non guidato.
- **Cambiarlo.** Allungato, il pianificatore legge ciò che manca (è la stessa domanda sullo stato: messaggi entro l'orizzonte senza nota). Accorciato, non legge altro e non toglie niente.
- **Conoscimi** resta senza limiti di tempo per conoscere. Se trova cose ancora aperte più vecchie dell'orizzonte, le apre con `impegni` e collega le conversazioni storiche ai progetti.
- **Dopo:** tutto ciò che arriva, in ogni casella.

**Il calendario non ha un orizzonte:** si guarda tutto ciò che tiene, quando un evento appare e quando cambia (§4.2, §7.2). Quanto indietro guardare ha senso per una casella, dove le cose ancora vive stanno nei messaggi passati; per un calendario no.

**Le fonti non si leggono tutte allo stesso modo, e va bene così.** La posta è comunicazione: ogni messaggio può chiedere qualcosa, e ognuno ha la sua nota. Il calendario è tempo impegnato: ogni evento si guarda una volta, e di nuovo se cambia; non ha una nota (il titolo dice già cos'è), ha una preparazione quando la merita. I file sono materiale: non chiedono niente da sé e non si leggono uno per uno; entrano nel lavoro da ciò che li nomina e, con le connessioni File, quando cambiano nelle cartelle di un progetto arriveranno a chi ne riscrive «Il punto», che li guarderà quanto serve. Alla pari vuol dire la stessa domanda sullo stato per ogni fonte, e per ognuna il suo modo di farsi capire, non lo stesso (§4.2).

---

## 7. Calendario

### 7.1 Tre cose sullo stesso asse del tempo

|              | Cos'è                                                          | Dove vive                                 | Chi lo vede                                                |
| ------------ | -------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| **Evento**   | un appuntamento vero                                           | nel calendario del provider               | tutti: telefono, colleghi                                  |
| **Scadenza** | una cosa aperta con una data                                   | nel registro (mai scritta nel calendario) | l'utente, nella fascia in alto del giorno                  |
| **Proposta** | un evento suggerito dal Segretario, che deve decidere l'utente | nel registro                              | l'utente, come evento in trasparenza con Aggiungi / Ignora |

**Il Segretario sul calendario:**

- **Appuntamento confermato in una mail, senza altri invitati da avvisare:** lo mette nel calendario giusto da solo. Lo segna "dal Segretario · mail di Rossi", con Annulla, e lo dice nel diario. Non coinvolge nessuno ed è reversibile (§4.7).
- **Appuntamento con invitati, o solo proposto:** diventa una proposta. La risposta pronta propone orari liberi veri.
- **Uno spostamento chiesto da altri e non ancora deciso dall'utente** diventa una proposta di modifica che dice cosa cambia («16:30–18:00, era 15:00–16:30»); accettarla cambia solo quello. **Un invito** si propone come risposta («Rispondi: Partecipo»), mai come evento nuovo; un evento organizzato da altri non si modifica, si risponde. Una proposta che non vale più (l'incontro annullato) il Segretario la ritira da sé.
- **Disallineamenti** tra mail e calendario, e **conflitti:** li segnala. Se l'evento è suo e senza invitati lo corregge; altrimenti propone.
- **Gli inviti:**
  - si rispondono da qualunque calendario collegato, cercando l'evento per UID in tutte le connessioni;
  - se il calendario non è collegato, si risponde con la mail di risposta standard.
- **La giornata prepara le riunioni** del giorno con persone esterne o legate a un progetto.

### 7.2 Il Calendario alla pari della Posta

Tutto ciò che vale per la posta vale per gli eventi, che sono oggetti di una fonte come i messaggi.

|                                 | Posta                                                           | Calendario                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'oggetto                       | il messaggio                                                    | l'evento                                                                                                                                           |
| Ciò che il Segretario ne scrive | la nota (`nota`), sempre                                        | la nota dell'evento (`nota`), solo quando la merita: la preparazione, l'avviso, di chi è (§7.4)                                                    |
| Quando se ne accorge            | arriva o parte un messaggio: **lettura**                        | un evento nasce, si sposta, si annulla, arriva un invito: **calendario**, alla stessa priorità della posta nuova; il tempo che passa: **giornata** |
| Cosa può far nascere            | cose aperte, progetti, risposte, eventi                         | cose aperte (preparare, portare, confermare), collegamenti ai progetti, risposte e solleciti a chi aspetta la data nuova                           |
| Come lo cerca                   | `cerca_posta`, per parole e filtri                              | `calendario cerca`, per parole (titolo, luogo, descrizione, partecipanti), nel passato e nel futuro                                                |
| Dove l'utente lo vede           | il lettore: nota, cose aperte, progetto, risposta               | il pannello dell'evento: preparazione, cose aperte, progetti, la mail da cui viene                                                                 |
| Con un'estensione               | le sue azioni sui messaggi, le convenzioni della corrispondenza | le convenzioni degli eventi dell'organizzazione, nelle sue istruzioni                                                                              |

**Il trigger non va complicato:**

- lo stato dice quali eventi sono cambiati dopo l'ultimo sguardo, **in tutta la finestra**; un lavoro solo li guarda, due minuti dopo il primo cambiamento, uno alla volta (i cambiamenti sono pochi, e uno alla volta non si pestano i piedi);
- cambiati da altri, o dall'utente — anche nell'app: la posta che l'utente manda si legge, l'evento che crea o sposta si guarda, come lo stesso evento spostato dal telefono;
- ciò che fa il Segretario non sveglia niente: lo sa già;
- **la prima occhiata:** un calendario appena conosciuto — nella preparazione, quando l'AI si accende, o arrivato dopo in una connessione già guardata (uno che l'utente crea, uno che un collega gli condivide) — si guarda tutto una volta — tutta la finestra che tiene, 60 giorni indietro (gli incontri passati di cui resta qualcosa da fare) e un anno avanti — **a blocchi in parallelo** nello stesso compito calendario: progetti, cose da preparare anche lontano, conflitti, preparazioni per i prossimi giorni. Le serie ricorrenti contano una volta;
- **l'AI riaccesa:** mentre era spenta nessuno seguiva il calendario. Riaccesa, ogni calendario rifà la prima occhiata intera nella barra della procedura, come la prima volta, e il registro dei cambiamenti riparte da lì: lo stato di adesso copre ciò che è cambiato nel frattempo, per quanto a lungo l'AI sia rimasta spenta. È ciò che la posta fa da sé: i messaggi arrivati nel frattempo non hanno ancora la nota;
- **la finestra scorre ogni giorno:** la sincronizzazione rilegge ogni giorno la finestra intera, da 60 giorni fa a un anno avanti, e la confronta con ciò che tiene. Ciò che esce se ne va in silenzio; ciò che entra è un cambiamento solo se è davvero nuovo — un'altra istanza di una serie già conosciuta non lo è. Rileggere a scatti (sei mesi alla volta) farebbe entrare mesi di eventi di colpo, senza la prima occhiata a blocchi a leggerli;
- il tempo che passa lo raccoglie la giornata.

Un evento non ha una nota come un messaggio: il titolo dice già cos'è. Che il Segretario l'abbia guardato lo dice lo stato: la prima occhiata del suo calendario finita, e il punto fin dove ha guardato il registro dei cambiamenti; quello che ne esce — cose aperte, progetti, preparazioni, proposte — è facoltativo. Molti eventi non chiedono niente, ed è un buon risultato.

### 7.3 L'app Calendario

- **Nella barra:** con Posta e File, alla pari.
- **Viste**, in quest'ordine nel selettore; l'ultima scelta si ricorda:
  - **Agenda** (predefinita): è l'Agenda di oggi, con le scadenze;
  - **Giorno**;
  - **Settimana**;
  - **Mese**.
- **Barra laterale:**
  - il mese piccolo;
  - le connessioni con i loro calendari (colori, visibilità);
  - i livelli del Segretario, da accendere e spegnere: Scadenze e Proposte.
- **Come si riconoscono:**
  - ogni scadenza porta l'icona di ciò da cui nasce (§3.2): la busta della mail e il calendario dell'evento, le stesse delle loro app nella barra; la persona per ciò che ha detto l'utente;
  - nella legenda, accanto a «Scadenze», le tre stanno in fila: sono tutte scadenze, nate in posti diversi. Una fonte nuova porta la sua, e la legenda la prende da sé (il file, con l'app File, §8);
  - una proposta porta la stella del Segretario, la stessa del suo pulsante nella barra.
- **Pannello dell'evento**, come il lettore della posta:
  - dettagli e invitati con le risposte;
  - la preparazione del Segretario, le cose aperte nate dall'evento, i progetti, la mail da cui viene;
  - le azioni: rispondi, modifica, sposta, elimina, entra nella call.
- **Creazione:**
  - clic e trascinamento sulla griglia;
  - oppure il pannello del Segretario con "giovedì alle 9 dentista".
- **Per chi lo usa tanto, dalla tastiera:**
  - oggi;
  - periodo precedente e successivo;
  - le quattro viste;
  - nuovo evento;
  - cerca;
  - chiudi il pannello.

  Le scorciatoie si vedono nei suggerimenti e si cambiano in Impostazioni › Scorciatoie, come quelle della Posta.

- **Cercare gli eventi**, come si cerca la posta: per parole, anche nel passato, con i risultati in elenco che portano al giorno e all'evento.
- **L'interfaccia si affina dopo:** grafica e animazioni nella fase interfaccia. Qui contano viste, dati, componenti e posizione.

### 7.4 Di chi sono gli eventi

Un calendario non è sempre dell'utente, e ogni lavoro si organizza a modo suo: ognuno il suo calendario e le riunioni come inviti (il modo di Google Workspace e Microsoft 365), con i calendari dei colleghi sovrapposti al proprio; un calendario per persona nello stesso account; un calendario comune a tutti, con i nomi nei titoli; i calendari di un gruppo e delle risorse (le ferie, la sala, il furgone); gli abbonamenti (le festività, le partite, la scuola). SIEVER Mail non ne presume nessuno: risponde sempre a due domande.

- **Di chi è un calendario.** Ogni calendario ha un ruolo: **tutti gli eventi** sono dell'utente (è il suo), **solo i suoi** (un calendario condiviso, o di altri), **nessuno** (un abbonamento, un calendario che guarda soltanto). Di base è suo il calendario principale di ogni connessione e, dove gli eventi senza invitati non dicono di chi sono (CalDAV; Google dice chi li ha creati, Microsoft di chi è il calendario che li organizza), ogni calendario in cui l'utente scrive; gli altri sono «solo i suoi». L'utente lo sceglie in Impostazioni › Notifiche, calendario per calendario; con l'AI lo decide Conoscimi, che li conosce (§12.2), come decide fin dove leggere una casella (§6.5), e il lavoro sul calendario per uno che appare dopo; la scelta dell'utente vince.
- **Di chi è un evento.** In un calendario suo, tutti. In uno «solo i suoi», quelli che il calendario dice suoi: a cui l'utente è invitato, che organizza o che ha creato lui — un evento che non dice di chi è non lo è. Con l'AI anche quelli che il Segretario riconosce come suoi e il sistema non vede: «Sopralluogo Rossi – Ing. Bianchi», scritto dalla segreteria nel calendario dello studio. Un invito rifiutato non è suo.
- **Una cosa sola, in qualunque calendario compaia.** La stessa riunione nel calendario dell'utente e in quello di un collega sovrapposto è sua una volta, nel calendario migliore: il principale, poi uno suo, poi uno in cui scrive.
- **Dove conta:** i promemoria e le novità (§13.3), e la giornata di Oggi, che mostra gli eventi dell'utente; il Calendario mostra tutto ciò che è visibile. Il Segretario lo legge con gli eventi: non prepara la riunione di un collega, e i conflitti sono tra gli impegni dell'utente.

**Perché così.** Le app di calendario decidono per calendario intero: Google e Apple fanno suonare tutto un calendario o niente, Outlook solo i calendari della propria casella. Per ognuno-il-suo calendario basta; per un calendario comune vuol dire o il rumore degli eventi di tutti, o il silenzio sui propri. «Solo i suoi» si regge su ciò che il calendario dice (gli invitati, chi organizza, chi ha creato), e il Segretario, che legge ogni evento e conosce le persone, vede anche ciò che il calendario non dice. Di chi è un evento non lo decide una convenzione dei titoli, che sarebbe di qualcuno e non di tutti.

---

## 8. File (in arrivo)

**File è la terza fonte, alla pari di Posta e Calendario:** i documenti dell'utente, ovunque stiano.

**Le connessioni File**, nella stessa scheda delle altre:

- **i volumi del computer**: il disco interno con le cartelle dell'utente, e i dischi esterni;
- **i volumi di rete**: le condivisioni SMB/AFP/NFS montate (l'archivio di uno studio);
- **i drive dei fornitori**: Google Drive, OneDrive e SharePoint, Dropbox, iCloud Drive. Un accesso Google o Microsoft può portare anche il drive, come porta posta e calendario.

**Si ragiona per volume intero o per drive**, non per cartelle scelte. È più semplice e coerente: un volume è una connessione come una casella. Le cartelle che contano per il lavoro le trova e le collega il Segretario (ai progetti).

**L'app File farà poche cose bene**, senza diventare Finder, Esplora file o Google Drive:

- navigazione e ricerca unificata su tutte le connessioni;
- apertura del documento originale, dove sta;
- i collegamenti: in quali progetti, con quali conversazioni ed eventi;
- l'uso da parte del Segretario.

Niente sincronizzazione, upload o condivisione, almeno all'inizio.

**Il Segretario e i file:** sola lettura, oggi come domani. `cerca_file` e `leggi` lavorano già sul computer e sui volumi di rete montati: sono la connessione File locale, implicita. Quando le connessioni File saranno esplicite:

- i luoghi in cui cerca saranno quelle connessioni;
- un drive si leggerà come un disco;
- un file avrà un'identità stabile, connessione più percorso o id del fornitore;
- un file sarà un oggetto alla pari di un messaggio e di un evento, con ciò che ne deriva in ogni funzione: una cosa aperta potrà nascere da lui (§3.2), con la sua icona tra le scadenze (§7.3); un progetto lo raccoglierà (§9.3); `leggi` lo mostrerà con ciò che ne è nato.

Un file non ha un'esecuzione sua: nuovo o cambiato nelle cartelle di un progetto, arriva a chi riscrive «Il punto» di quel progetto (§4.2).

**Percorsi che cambiano posto.** Le cose salvate con un percorso — i posti dei segni di un'estensione, le cartelle collegate ai progetti, i file recenti, la radice dell'archivio di un'estensione — restano scritte come l'utente le conosce. Raggiungerle passa da un punto solo (`reachablePath`), che sa dov'è ora la condivisione:

- **La stessa condivisione montata altrove** — macOS la rimonta come «Archivio-1» se «Archivio» è occupato da una cartella rimasta; su Windows l'unità di rete prende un'altra lettera — si raggiunge sotto il punto nuovo, **senza chiedere niente e senza riscrivere niente**. Le condivisioni e le unità viste montate si ricordano con l'indirizzo del server (come fa il Mac per rimontarle dopo un riavvio).
- **Spostata davvero** — un altro server, un'altra cartella — nessuno può indovinarlo. Chi la usa lo dice dove serve («L'archivio non è più in …: dov'è ora?»); l'utente indica la radice nuova una volta, e tutto si adegua: ciò che sta sotto la radice (relativo a lei), i posti dei segni, le cartelle dei progetti e i file recenti (l'app sposta i percorsi sotto la radice vecchia, `relocate`), il Segretario (una lezione: la riflessione corregge la memoria).
- È il primo pezzo dell'identità dei file: quando ci saranno le connessioni File, un volume avrà un'identità (l'indirizzo della condivisione, il disco), e `reachablePath` sarà il loro modo di raggiungerlo; `relocate` serve anche lì, quando un volume cambia.

**Oggi:** icona nella barra con "In arrivo" e una pagina che spiega cosa sarà. In Impostazioni › Connessioni la famiglia File è annunciata e mostra i volumi che il Segretario già legge. Nel codice il modello delle connessioni ha già la famiglia File (§15.1).

---

## 9. Progetti

### 9.1 Il nome: "Progetti", per tutti

**Progetti**, uguale nel pubblico e con un'estensione:

- È il termine che ChatGPT, Claude e gli strumenti di lavoro usano per raggruppare le cose di una persona. Si capisce anche per le cose personali: "organizzare la partita" è un piccolo progetto.
- **"Argomento" in una mail si confonde con l'oggetto.**
- Come nome di app nella barra, "Progetti" sta accanto a Posta, Calendario, File e Contatti.
- **Il nome non è la definizione.** Un progetto, per il Segretario, è un **contesto che dura**: di lavoro, di interesse o di attività, dove più cose stanno insieme. Può finire, come "Vacanza a Parigi" o "Ristrutturazione della cucina", o continuare, come "Università" o "Gestione della casa". Non servono obiettivi, scadenze o una fine.
- **Non tutto ciò che ritorna è un progetto.** Venti newsletter sull'intelligenza artificiale non fanno un progetto «Intelligenza artificiale». Nemmeno le notifiche di un servizio o una faccenda di un giorno. Un progetto nasce quando l'utente vi prende parte e le cose vanno tenute insieme per seguirle. Lo dicono i prompt, come principio, senza regole.
- **Il cliente ideale** è chi ha molto da seguire. Il nome è scelto per lui: dice il valore del prodotto (il lavoro organizzato in contesti, non la posta smistata in cartelle) e resta comprensibile a un privato.

### 9.2 Come nascono e come si chiamano

**Per induzione:**

- **Il Segretario esplora:** la posta, le cartelle del computer e dei dischi (Conoscimi lo fa apposta) e la memoria.
- **Da lì deduce:**
  - quali progetti ci sono;
  - come si chiamano, con le convenzioni dell'utente;
  - quali conversazioni ne fanno parte;
  - quali cartelle sono le loro.
- **Crea e corregge con `progetti`.**

**Il nome lo capisce il Segretario,** da tutto ciò che ha davanti — come l'utente ne parla nella posta, come si chiamano le sue cartelle, cosa dice la memoria —, senza partire da una forma data: c'è chi chiama un lavoro con il nome del cliente, chi con un codice, chi con un luogo o una persona. L'app non ne impone nessuna, nemmeno nell'interfaccia: il tag di una conversazione mostra il nome com'è, accorciato se è lungo. La convenzione vera di un'organizzazione la può dire la sua estensione (§1).

**Le correzioni dell'utente** (rinomina, unisci, sposta una conversazione, "non è un progetto", "nascondilo"):

- si fanno con il tasto destro o in chat;
- restano come **scelte dell'utente**, che il Segretario non ribalta in background;
- diventano lezioni.

**Un'estensione non dà un catalogo dal disco.** Il Segretario non riceve i nomi dei progetti: riceve **le convenzioni**, cioè:

- la radice dell'archivio;
- come si chiamano le cartelle dei progetti e le loro sottocartelle;
- come lavora l'ufficio.

Da lì li trova da solo (`cerca_file` sulla radice). Così con un'estensione e senza si lavora allo stesso modo, e con un'estensione si parte solo più informati.

### 9.3 Cosa c'è in un progetto

- nome e di cosa si tratta;
- "Il punto" (stato corrente, §3.4);
- ciò che raccoglie, da ogni fonte alla pari:
  - le conversazioni, con la storia completa;
  - gli eventi (la riunione, la consegna, l'assemblea);
  - le cartelle;
  - in futuro i file e i drive;
- le cose aperte di tutto ciò che raccoglie;
- l'origine (Segretario o utente).

**Appartenenza:** per conversazione, per evento, per cartella. Una stessa cosa può stare in più progetti (raro, ma reale: un preventivo per due lavori).

### 9.4 L'app Progetti (in arrivo)

**Progetti è lo spazio di lavoro, non un altro file manager.** File dice che cosa esiste e dove sta. Progetti dice come le cose sono legate e perché contano. È una rappresentazione costruita dal Segretario, trasversale alle fonti.

- **Cosa sarà:** per ogni progetto, insieme e senza possederli:
  - le mail con il cliente;
  - la documentazione nella cartella del disco di rete;
  - il preventivo su OneDrive;
  - la riunione in calendario;
  - le persone;
  - le cose aperte e «Il punto».

  Ogni cosa resta dov'è: un file usato da tre progetti è un file solo.

- **Da dove prende i dati:** dal registro (conversazioni, eventi e cartelle collegate, cose aperte), dalle fonti per il resto.
- **Quando:** dopo l'app File: quando arriverà ci saranno già le fonti da aggregare.
- **Oggi:** icona nella barra con "In arrivo" e una pagina che spiega cosa sarà. I dati sono già pronti. La sezione Progetti nella barra laterale della Posta funziona già, come vista delle sue mail.

---

## 10. La memoria (il quaderno)

**Resta libera.** Il modello sceglie struttura, nomi e contenuti. **Il sistema garantisce l'integrità, non la forma:** versioni, patch, conflitti, percorsi che non escono, una mappa che resta piccola; nessuna parte del codice legge una nota per nome; una nota lunga oltre 20.000 caratteri non è rifiutata — lo strumento lo dice, e decide il Segretario se metterla in ordine o dividerla. **Il prompt dà un criterio e i fatti dell'ambiente**, non convenzioni. Detto una volta, nel prompt d'identità (`segretario.md`, «La tua memoria»): i compiti (Conoscimi, letture, Al passo) dicono cosa imparare e rimandano lì per come tenerlo, invece di ripetere percorsi e regole.

**Il criterio: conoscenza, non stato.** In memoria va ciò che resterà vero quando le questioni di oggi saranno chiuse e che le fonti da sole non dicono: chi sono le persone e come trattarle, come lavora l'utente, le sue convenzioni, a cosa servono le connessioni, le decisioni e il loro perché, le correzioni. Lo stato delle questioni — cose da fare, scadenze, appuntamenti, un'offerta e il suo importo, una consegna, a che punto è un lavoro — sta nel registro, nel calendario, in «Il punto» e nella posta: in memoria sarebbe un doppione che invecchia. È la distinzione del §16.3 («il registro è la verità, la memoria è la conoscenza») data al modello come una domanda che si fa da solo: _mi servirà ancora fra sei mesi?_ — «senza l'acconto non fa partire la merce» sì, «la consegna è l'11 alle 7:30» no.

- **Perché.** Nello studio di prova le note delle persone erano diventate registri delle questioni, scritti lettura dopo lettura: offerte con numero e importo, consegne con l'ora, collaudi, assemblee. Un criterio come «ciò che cambia di giorno in giorno», o «ciò che varrà anche domani», non le escludeva: un'offerta non cambia ogni giorno, e domani vale ancora.

**La forma: il modello la ricava dai fatti del suo ambiente.** Il prompt non impone «una nota per persona»: dice come si usa la memoria — ogni lavoro parte dalla mappa (la prima riga di ogni nota, una cartella grande in una riga) e apre ciò che gli serve, e meno legge meglio lavora; molti lavori la leggono e la scrivono insieme; l'utente la legge e la corregge — e ne trae la conseguenza con il suo perché: **una nota per argomento, ogni fatto in un posto solo**; chi conta e torna (un cliente, un collega, un fornitore, un ufficio, un familiare) ha la sua, perché lì cresce ciò che si impara di lui, la si ritrova quando serve lui solo e la si cambia senza contenderla; le cose minori dello stesso tipo (i mittenti automatici, i servizi, chi è passato una volta) stanno insieme, o in una regola.

- **Perché non più libera di così.** Con un modello di classe Flash, togliere il perché porta indietro (le prove a favore del «togliere struttura» vengono da modelli più grandi). Senza un'indicazione concreta e con «poche note chiare valgono più di molte piccole», era nata una nota «clienti e fornitori» con trenta soggetti, riscritta 31 volte in un'ora dalle letture in parallelo. Che i lavori siano in parallelo e che la mappa mostri solo le prime righe il modello non lo vede da sé: dirglielo è informarlo, non guidarlo.
- **Perché non più rigida.** Uno schema — campi, tipi, una nota per contatto creata dal codice — farebbe della memoria un compilatore di JSON e toglierebbe al modello la scelta di cosa conta e di come dirlo.
- **Le conferme dello studio di prova.** Con queste indicazioni il Segretario ha tenuto il punto di partenza dove serviva e ha deciso da sé il resto: `mittenti-automatici.md` e `fornitori-minori.md` nella radice, una nota sulle convenzioni dei progetti invece di una per progetto (i progetti li tiene il registro), nessun `decisioni.md` finché non c'erano decisioni. Le letture trovano la nota di chi scrive aprendo la cartella dei contatti o cercando il nome; nessuna contesa sulle note delle persone.

**Il punto di partenza è un esempio:** `tu.md`, `stile.md`, `connessioni.md` (le caselle, i calendari, i volumi e i drive), `contatti/<nome>.md`, `progetti/<nome>.md`, `decisioni.md` — da prendere, cambiare e allargare con le note e le cartelle che servono (un tema, un luogo, un modo di fare che l'utente ha insegnato). La cartella si chiama `contatti/`, come l'app: ci stanno le persone e le organizzazioni con cui l'utente ha a che fare — un cliente, un collega, un'azienda, un ufficio pubblico. Le memorie che hanno `persone/` restano come sono: nessun codice dipende dal nome, e il Segretario le riordina se vuole.

**Le parole con cui ritrovarla.** Una nota contiene le parole con cui la si cercherà: di una persona i suoi indirizzi, di una questione il suo codice, se ne ha uno. Una lettura trova la nota di chi scrive cercando il suo indirizzo, qualunque nome abbia la nota; e l'app Contatti, quando ci sarà, mostrerà accanto a un contatto la nota che lo nomina — senza una convenzione di percorsi nel codice.

**Conoscimi prende appunti mentre capisce,** non tutto alla fine: l'utente lo vede imparare, e ciò che ha letto all'inizio non si perde quando il contesto si alleggerisce.

**La mappa resta piccola.** Ogni esecuzione comincia con la mappa: ogni nota con la sua prima riga, una cartella con molte note in una riga, che si apre con `memoria leggi <cartella>/`.

**Si tiene in ordine.** Al passo, oltre a imparare dalle note dei messaggi, unisce doppioni e contraddizioni, toglie lo stato delle questioni rimasto nelle note (tenendo ciò che insegna su chi l'ha detto), riduce gli elenchi di dettagli, raccoglie le note piccole delle cose minori (i mittenti automatici), e divide in una nota per soggetto le note che ne raccolgono molti che contano. Nessun percorso è scritto nel codice.

**Lo strumento è potente e sicuro:**

| Comando               | Cosa fa                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `leggi`               | indice, oppure nota con righe numerate                                              |
| `cerca`               | parole in tutte le note, con le righe                                               |
| `modifica`            | una o più sostituzioni puntuali applicate insieme (tutte o nessuna), come una patch |
| `inserisci`           | testo dopo una riga                                                                 |
| `scrivi`              | nota intera nuova o riscritta                                                       |
| `elimina`, `rinomina` | come ci si aspetta                                                                  |
| `storia`              | le versioni precedenti di una nota, con chi le ha cambiate                          |
| `ripristina`          | torna a una versione precedente                                                     |

**Concorrenza:**

- `modifica` e `inserisci` si applicano se il testo da cambiare c'è ancora. È una patch che si fonde da sola con le modifiche degli altri.
- `scrivi` su una nota cambiata dopo che questa esecuzione l'ha letta torna come conflitto, con la versione nuova.

**Ogni versione si conserva** (`ai_memory_history`), con l'esecuzione o l'utente che l'ha scritta. Nelle impostazioni si può vedere e ripristinare.

**Apprendimento continuo** (tramite la memoria, non sui pesi del modello). Diventano lezioni:

- le correzioni;
- le risposte pronte cambiate prima dell'invio;
- le proposte rifiutate o corrette;
- le cose aperte segnate "non serve" o riaperte;
- le connessioni tolte, che fanno rivedere ciò che la memoria ne dice (§11.4).

La **riflessione** le trasforma in regole scritte nelle note. Tutte le esecuzioni le leggono.

---

## 11. Connessioni

### 11.1 Il modello

**Ogni servizio collegato è una connessione a sé**, in una delle **famiglie** — una per fonte, alla pari:

- **Posta**: Gmail, Microsoft, iCloud, IMAP, PEC;
- **Calendario**: Google, Microsoft, iCloud/CalDAV, abbonamento ICS;
- **File** (in arrivo, §8): volumi del computer, volumi di rete, Google Drive, OneDrive/SharePoint, Dropbox, iCloud Drive.

Una fonte nuova porta la sua famiglia.

**Un solo accesso può portarne più d'una.** Con Google o Microsoft, un consenso porta posta, calendario e, in futuro, drive, se l'utente li accende. Restano connessioni distinte, ciascuna con i suoi dati.

**Una connessione di calendario porta più calendari** (lavoro, hobby, compleanni…), ciascuno con colore e visibilità.

**Nessun legame rigido tra le famiglie.** Le relazioni sono **conoscenza**, scritta dal Segretario in memoria durante Conoscimi e corretta con l'uso:

- "chi è chi";
- "il calendario Lavoro dell'account Google personale è quello della posta di lavoro";
- "gli eventi del calcio arrivano da Fubles sulla posta personale";
- "l'archivio dei progetti è il volume di rete Archivio".

Quando il Segretario crea un evento da una conversazione, sceglie il calendario giusto con questa conoscenza. L'interfaccia, per gli eventi creati a mano, ha un calendario predefinito.

**Una persona per installazione.** L'utente può avere molte connessioni, anche di altri (una casella condivisa, la posta di un ente che gestisce). Chi scrive da dove lo dice la memoria.

### 11.2 I fornitori

|                                                   | Posta                                                                                    | Calendario     | Cosa serve                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| Google                                            | IMAP/SMTP con OAuth                                                                      | API Calendar   | un solo consenso con gli scope che l'utente accende                                                           |
| Microsoft 365 / Outlook.com                       | IMAP/SMTP con OAuth (XOAUTH2); invio con Graph se l'azienda ha spento SMTP               | Graph          | l'id del client Entra (variabile d'ambiente, come Google): tutto pronto, si accende quando l'app è registrata |
| iCloud                                            | IMAP/SMTP con password per app                                                           | CalDAV (tsdav) | niente                                                                                                        |
| PEC (Aruba, Legalmail, Poste, Register, Namirial) | IMAP/SMTP con i server già impostati                                                     | —              | niente                                                                                                        |
| Qualunque altro                                   | configurazione automatica (provider → database di Thunderbird → MX → SRV), oppure a mano | CalDAV o ICS   | niente                                                                                                        |

**La PEC si legge per quello che è** (i formati verificati sulle fonti primarie e su messaggi veri di Aruba, Legalmail e Sogei):

- **Che cos'è un messaggio** lo dicono le sue intestazioni, lette con ogni messaggio: `X-Trasporto` (`posta-certificata`: la busta; `errore`: l'anomalia) e `X-Ricevuta` (accettazione, consegna, mancata consegna, preavviso dopo 12 ore, virus, non accettazione); `X-Riferimento-Message-ID` è il Message-ID che il programma del mittente ha dato al messaggio — l'unico che resta suo, perché il gestore lo rimpiazza.
- **La busta si mostra come il messaggio che porta**: mittente («Per conto di:»), oggetto (senza «POSTA CERTIFICATA:»), testo e file del `postacert.eml`; sopra, una riga dice chi l'ha certificata e quando (da `daticert.xml`), e la busta del gestore si apre con un clic. I file del gestore (certificazione, firma) non stanno tra gli allegati. L'anomalia lo dice: vale come una mail ordinaria.
- **Le ricevute sono lo stato del messaggio inviato**: stanno nella sua conversazione (agganciate per `X-Riferimento-Message-ID`, la chiave della copia in Inviata), la riga dice «Consegnata», «Non consegnata» (in rosso); il messaggio inviato mostra «Inviata con la PEC» con ogni ricevuta, a chi e quando; la ricevuta porta al messaggio. Restano messaggi della casella (sono la prova legale: non si nascondono né si segnano lette da sole), ma si leggono per ciò che dicono.
- **Niente Ccn** da una casella PEC — riconosciuta dal server di un gestore noto o dalle buste che riceve —: il compositore non lo offre, e l'invio lo rifiuta con il perché (il gestore rifiuterebbe tutto il messaggio).
- **Il Segretario** lo sa: nel contesto la casella è segnata PEC; `leggi` dice la certificazione, ciò che una ricevuta dice, le ricevute di un messaggio inviato; la ricerca segna le righe PEC; `segretario.md` ricorda il valore legale, che la consegna prova l'arrivo, che una mancata consegna è da sistemare. Le ricevute si leggono come gli altri messaggi (brevi, poco costose): la loro nota è proprio lo stato che serve, e chiudono le attese di consegna.
- **Un'estensione che lavora con i messaggi fuori dalla posta** riceve la sorgente intera, busta compresa, e ne fa ciò che vuole l'organizzazione (ARCHIVIA SIEVER apre la busta e salva il messaggio che porta, con i suoi allegati).
- **La REM europea** non è ancora arrivata nelle caselle: c'è la PEC classica. Quando arriverà, è un'altra famiglia di intestazioni (`REM-*`) da leggere nello stesso modo.

### 11.3 Impostazioni › Connessioni

- **Una scheda "Connessioni"**, non "Account".
- **Le connessioni sono raggruppate per accesso**, per esempio "Google · nome@gmail.com — Posta · Calendario (3 calendari)", e la scheda dice le tre famiglie: Posta, Calendario, File. Per ognuna:
  - stato, ultimo aggiornamento e problemi, in una riga con le stesse parole e lo stesso colore della spia nella barra (§13.1);
  - accendi o spegni i servizi: accendere il calendario di una casella che non l'ha — Google, Microsoft — è aggiungere una connessione, e passa dalla procedura come ogni altra (§12.2);
  - scollega (§11.4).
- **"Aggiungi una connessione"** usa la stessa procedura dell'avvio (§12.2).

### 11.4 Togliere una connessione

Una connessione lascia due cose diverse, e ognuna se ne va a modo suo: i suoi **dati**, che toglie il sistema, e ciò che il Segretario **ne ha capito**, che rivede lui. È la distinzione di tutto il prodotto: il registro con le sue invarianti, la memoria libera (§3, §10, §16.3).

**I suoi dati se ne vanno tutti, dal computer.** Sul server non cambia niente, e la si può ricollegare.

- **Una casella:** la posta, le cartelle, gli allegati scaricati, le bozze locali, la firma, le credenziali, i segni delle estensioni (§6.3), i messaggi ancora in uscita, che non partiranno più. Un calendario venuto con lo stesso accesso può restare, da solo.
- **Un calendario:** gli eventi, i calendari, il registro dei cambiamenti.
- **Del Segretario, per l'una e per l'altro:** le note, le cose aperte nate dai suoi messaggi o eventi con la loro storia, le risposte pronte e le sue bozze, le preparazioni degli incontri, il posto delle sue conversazioni e dei suoi eventi nei progetti, le proposte (superate), la conoscenza di Conoscimi e l'orizzonte di lettura, il lavoro in coda; e il diario di ciò che riguardava solo lei — le letture dei suoi messaggi, le occhiate al suo calendario, un Conoscimi che conosceva solo lei.
- **Restano, perché sono dell'utente:** la rubrica (una voce per indirizzo, imparata da tutte le caselle), le cose aperte nate dalla sua parola, i progetti (un contesto sopravvive a una fonte: «Casa al mare» resta anche se se ne va una casella), la storia che mescola le fonti (la chat, le giornate), la spesa, la memoria.
- **Ciò che ne parlava diventa superato:** «Il punto» dei progetti che perdono conversazioni o eventi, e la lettera di Oggi; si riscrivono con le regole del §3.4.
- **Un messaggio che si stava scrivendo da quella casella** resta aperto: per tenerlo si sceglie da quale inviarlo; chiuderlo chiede di scartarlo.

**Coerente anche a metà.** Mentre una connessione se ne va:

- non accetta altro lavoro, e un messaggio che sta partendo da lei parte, o no, prima;
- il lavoro del Segretario in sottofondo si ferma e aspetta che se ne sia andata: tutto, perché ognuno può scrivere di qualunque connessione (una lettura collega un messaggio a un evento, la giornata le tocca tutte). Riparte su ciò che c'è, ritrovato dallo stato (§4.1); un Conoscimi che la conosce si ferma;
- ciò che il Segretario tiene di lei se ne va dopo che se ne sono andati i suoi dati, con una passata che toglie ciò che resta di ogni connessione che non c'è più. La stessa passata, all'avvio prima di ogni lavoro, ripara una rimozione interrotta o una scrittura arrivata dopo. Una fonte che non risponde viene lasciata stare, mai presa per vuota.

**Ciò che il Segretario ne ha capito non si taglia a macchina.** La memoria non ha una provenienza frase per frase, e quasi tutto resta vero: le persone, il modo di lavorare, le convenzioni non diventano false perché una casella è scollegata (§10). Ricollegare la stessa casella — passando da IMAP all'accesso Google, per esempio — deve ritrovarla. Alcune cose, però, riguardavano la connessione e ora sono false: a cosa serviva, da quale casella scrivere a chi, quale calendario va con quale posta. Così la rimozione lascia una lezione alla riflessione, con ciò che serve per giudicare — quale connessione, da quando, i progetti che perdono qualcosa, se lo stesso indirizzo è ancora collegato in un altro modo —, e il prompt dà il criterio, senza procedure: ciò che riguardava la connessione e il modo di usarla si toglie o si corregge; ciò che è vero delle persone e del lavoro resta; ciò che aveva senso solo lì lo giudica il Segretario; nel dubbio tiene. Ogni cambiamento resta nella storia della memoria. Con l'AI spenta la lezione aspetta; riaccesa, Conoscimi su tutte le connessioni rimette comunque la memoria in pari con ciò che c'è.

**Se l'utente vuole che dimentichi davvero** (la casella di un cliente), a macchina non si può: lo dice in chat, o c'è «Dimentica tutto». La conferma della rimozione lo ricorda in una riga con l'AI accesa, insieme al lavoro del Segretario che se ne va; senza, del Segretario non dice niente (§12.1). Le conferme — dalle Connessioni, dalla Posta, dalla finestra di una connessione rifiutata — dicono le stesse cose.

**I file, quando ci saranno le connessioni File** (§8): uno smontato non è uno tolto. Togliere una connessione File farà come un calendario: via le cartelle di progetto su di lei, i progetti con «Il punto» superato, una lezione alla riflessione.

---

## 12. Avvio, attivazione e Conoscimi

### 12.1 Un solo interruttore per l'AI

- **"Funzioni AI": accese o spente.** Con la chiave OpenRouter si accendono tutte. Accese vuol dire interruttore su e chiave data: senza chiave l'AI è spenta, e pagina, pannello e menu dell'app seguono la stessa regola.
- **Spente:**
  - SIEVER Mail è un insieme di app normali — posta, calendario, e in futuro file — senza Segretario;
  - nessuna traccia del Segretario: niente Oggi, viste logiche, note nelle righe, pannello, voce di menu, ⌘J o revisione. Si accende da Impostazioni › Segretario, che porta alla procedura guidata (anche «Rifai Conoscimi» con l'AI spenta porta lì);
  - la sincronizzazione continua uguale.
- **Spegnere:**
  - ferma ogni lavoro AI;
  - **conserva** i dati;
  - nelle impostazioni si possono cancellare.
- **Accese o spente, mai «in pausa».** Credito OpenRouter finito o chiave rifiutata — una richiesta qualunque rifiutata, o il controllo periodico che lo trova — spengono l'AI in quell'istante, come se l'utente togliesse la spunta: SIEVER Mail torna la versione senza AI. Un popup lo dice e spiega come tornare (resta finché non si vede: anche dopo un riavvio, e con la finestra in secondo piano anche una notifica di sistema, §13.3). Per riaccendere: ricaricare il credito, poi riattivare la spunta, che passa dalla procedura guidata; il passo «Segretario» non riaccende finché il credito non risulta cresciuto (OpenRouter rifiuta prima che il credito segni zero), e chiede un'altra chiave se è stata rifiutata.
- **Credito basso, per tempo:** un popup quando il credito copre meno di una settimana al ritmo degli ultimi sette giorni (almeno 1 $), un altro sotto i due giorni (almeno 0,30 $); uno per discesa, di nuovo dopo una ricarica. Il credito si riguarda ogni 20 minuti e ogni volta che si è speso un decimo di quello che restava.
- **Nel codice ogni funzione resta separata e rimovibile:** strumenti e compiti sono moduli. Per ora non ci sono interruttori singoli: uno solo, chiaro.

### 12.2 La procedura guidata

Un solo componente a schermo intero, riusato in tutti i casi:

1. **Connessioni**: aggiungi posta, calendari e, quando ci saranno, file. Ne basta una, di qualunque famiglia: con un calendario solo si entra nel Calendario, e la Posta senza caselle offre di collegarne una.
2. **Segretario**: incolla la chiave OpenRouter (verificata) e accendi, oppure "Non ora".
3. **Preparazione**: aspetta che le connessioni siano sincronizzate e, con l'AI, che la posta recente sia indicizzata. Con avanzamento ed errori chiari: si può riprovare o togliere una connessione che non va.
4. **Conoscimi** (con l'AI). Un pulsante, "Fatti conoscere", che l'utente preme: **non si salta mai**, nemmeno quando ogni connessione è già conosciuta — allora rilegge tutte le connessioni, trova la memoria di prima e la aggiorna, o vede che è già a posto e fa poco. Il Segretario lavora in una vista a chat, e l'utente lo vede leggere, capire, collegare e prendere appunti.
5. **Al passo** (con l'AI): la lettura di ogni casella fin dove Conoscimi ha deciso (§6.5) — i messaggi ancora senza nota —, con l'orizzonte e il perché per ciascuna ("lavoro@… · ultimi 90 giorni: le questioni durano mesi"), e ogni calendario tutto ("da 60 giorni fa a un anno avanti"), con l'avanzamento ("letti 214 messaggi su 380 · guardati 40 eventi su 85"). La posta messaggio per messaggio, il calendario a blocchi in parallelo (§7.2). Poi la giornata, scritta subito.
6. **Entra.**

**La procedura blocca** fino a quando la posta del Segretario è pronta, e **con l'AI non si salta niente**: saltare lascerebbe il sistema incoerente (connessioni lette senza essere conosciute). Per non restare mai prigionieri:

- la lettura usa più parallelismo e va dalla posta più recente alla più vecchia, con la stima del tempo;
- una connessione che non funziona **ferma la procedura**, con o senza AI (non c'entra l'AI: una connessione che non va non si collega, §14.1): se è passeggero si aspetta che si ricolleghi da sola, se è permanente «Ricollega» o «Togli»;
- per l'AI, ciò che non va si **riprova**, quante volte l'utente vuole, oppure si **continua senza AI**: l'AI si spegne, la procedura va all'ingresso, e riaccesa riparte da ciò che non conosce ancora. Vale per un Conoscimi che si ferma e per le letture che falliscono (chieste alla fine della barra, «Riprova» rifà solo quelle);
- mentre OpenRouter non risponde, Conoscimi e la lettura aspettano e riprendono da soli; se il problema resta, l'utente può continuare senza AI;
- «Rifai Conoscimi» fermato si chiude tenendo ciò che si sapeva prima (ogni connessione era già conosciuta).

**Sta sopra lo spazio di lavoro, che sotto continua** (§13.1). Blocca ciò che l'utente tocca, non ciò che lavora: la procedura stessa vive della sincronizzazione (la preparazione la aspetta), di Conoscimi e delle letture.

- **Il motore trattiene solo ciò che deve aspettare Conoscimi, e lo garantisce lui:**
  - una connessione che Conoscimi deve ancora conoscere non si legge e non si guarda prima di lui. Accendendo l'AI senza aggiungerne, tutte; aggiungendone, quelle non ancora conosciute — una appena aggiunta lo è dal primo istante, senza aspettare che la procedura la elenchi —; rifacendo Conoscimi, nessuna;
  - mentre la procedura accende l'AI, tutto ciò che non è suo — la giornata, «Il punto», la memoria, i cambiamenti del calendario — aspetta che finisca; poi la giornata promessa si scrive subito. Con l'AI già accesa il resto va avanti com'era: le caselle conosciute si leggono, la giornata e i progetti seguono;
  - la regola vale quando un lavoro sta per partire, chiunque l'abbia chiesto: la pianificazione, Oggi che chiede la giornata, un progetto aperto, un lavoro rimasto in coda. Ciò che è montato nella finestra non accende e non spegne niente.
- **Ciò che l'utente stava facendo resta com'era:** i messaggi che scriveva, dove era, il pannello. «Entra» toglie la procedura e lo ritrova.
- **Non la chiude niente se non lei stessa.** Ciò che va visto — una notifica cliccata, ciò che il Segretario mostra, un messaggio da riaprire, un invio non riuscito — aspetta la fine e si apre allora. Sopra di lei restano solo gli avvisi che stanno ovunque: l'AI spenta, una connessione ferma (§12.1, §14.1).
- **Il primo avvio costruisce lo spazio di lavoro**, che prima non c'è: non c'è ancora niente dell'utente da tenere vivo, e tenerlo montato mentre arrivano la prima sincronizzazione, Conoscimi e le letture sarebbe solo peso. Nasce al suo «Entra»; le procedure dopo stanno sopra di lui. Se se ne vanno tutte le connessioni finisce, e il primo avvio seguente lo fa rinascere.

**I casi:**

| Caso                                 | Passi                                                                                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primo avvio                          | 1 → 2 → 3 → (4 → 5 se AI) → 6                                                                                                                                                                                                                         |
| Nuova connessione                    | 1 → 3 → (4 solo sulle nuove, coerente con la memoria → 5 solo sulle nuove) → 6                                                                                                                                                                        |
| AI accesa la prima volta             | 2 → 3 → 4 → 5 → 6                                                                                                                                                                                                                                     |
| AI spenta e riaccesa                 | 2 → 3 → 4 (sempre, su tutte le connessioni: aggiorna ciò che sa) → 5: i messaggi ancora senza nota e **ogni calendario intero**, di nuovo (mentre l'AI era spenta nessuno lo seguiva: guardarlo com'è ora copre ciò che è cambiato nel frattempo) → 6 |
| "Rifai Conoscimi" dalle impostazioni | 4 su tutte le connessioni, aggiornando la memoria senza cancellarla → 6                                                                                                                                                                               |
| Connessione rimossa                  | niente procedura: si tolgono i suoi dati, e la memoria che la cita viene rivista dal Segretario (lezione, §11.4)                                                                                                                                      |

**Conoscimi e lettura sono cose diverse:**

- **Conoscimi** costruisce la conoscenza: senza limiti di tempo, legge ciò che vuole; e alla fine decide, casella per casella, fin dove leggere uno per uno (un calendario si guarda tutto, §7.2), e calendario per calendario quali eventi sono dell'utente (§7.4).
- **La lettura** popola il lavoro: fin dove ha deciso Conoscimi (di base 30 giorni).

Conoscimi viene prima, così le letture partono informate. Il sistema sa quali connessioni sono già conosciute e quando: la sola presenza di memoria non basta a dire che è aggiornata.

---

## 13. L'interfaccia

### 13.1 Le app nella barra, e la spia delle connessioni

Tre gruppi, separati da una linea sottile:

| Gruppo            | Icona                                                            | Con l'AI                         | Senza AI      |
| ----------------- | ---------------------------------------------------------------- | -------------------------------- | ------------- |
| La scrivania      | **Oggi**: la scrivania del Segretario, che unisce tutte le fonti | sì, ed è la pagina d'apertura    | no            |
| Le fonti          | **Posta**                                                        | sì                               | sì (apertura) |
|                   | **Calendario**                                                   | sì, con i livelli del Segretario | sì            |
|                   | **File** (in arrivo)                                             | pagina "In arrivo"               | idem          |
| Le viste derivate | **Contatti** (in arrivo)                                         | pagina "In arrivo"               | idem          |
|                   | **Progetti** (in arrivo)                                         | pagina "In arrivo"               | idem          |

Contatti e Progetti sono separati dalle fonti perché non hanno connessioni proprie: aggregano quelle delle altre.

In cima alla barra, il marchio. Al passaggio dice quale SIEVER Mail è — la versione e l'estensione, con le stesse parole del piede delle Impostazioni (§13.2) —; un clic riporta alla schermata d'apertura, la stessa dell'avvio.

**Le schermate non accendono né spengono niente: decidono solo che cosa l'utente tocca.** La schermata d'apertura e la procedura guidata (§12.2) sono strati sopra lo spazio di lavoro, che sotto resta vivo: le connessioni si sincronizzano, il Segretario lavora, i messaggi che si scrivono restano come sono, e l'app in primo piano resta quella. Lo spazio di lavoro nasce su Oggi — senza AI, sulla prima fonte, che ne tiene il posto — e da lì resta dove l'utente lo lascia: «Entra» toglie lo strato e si ritrova ciò che si stava facendo; all'avvio, la giornata. La schermata d'apertura è solo un'immagine: ciò che va visto subito — una notifica, ciò che il Segretario mostra, un messaggio da riscrivere — la chiude da sé; la procedura no, perché è un lavoro in corso. Senza nessuna connessione non c'è uno spazio di lavoro: la schermata d'apertura porta al primo avvio, che lo costruisce e lo apre con il suo «Entra» (§12.2).

In fondo alla barra:

- il Segretario (pannello a destra, uguale in ogni app, consapevole di cosa si sta guardando);
- la spia delle connessioni;
- le Impostazioni.

**La spia delle connessioni.** Un punto dice come stanno **tutte** le connessioni, posta e calendari, nei quattro modi del §14:

- **verde**: tutto sincronizzato;
- **grigio che pulsa**: al lavoro — si collega, scarica la posta, legge un calendario la prima volta;
- **giallo**: aspetta qualcosa che passa da sé — la rete, un server che non risponde, un calendario che ora non si legge. Non c'è niente da fare;
- **rosso**: ha bisogno dell'utente — una connessione ferma (§14.1), un consenso da rinnovare.

Il colore è quello della connessione più urgente. Passandoci sopra, un titolo dice cosa ne viene («Tutto sincronizzato», «Senza rete: tutto riprende da sé appena torna», «Una connessione ha bisogno di te»), e sotto c'è una riga per connessione, prima quelle che chiedono qualcosa: cosa fa e, se aspetta, quando ha sentito il server l'ultima volta; mentre la ricerca legge la posta, quanto ne ha letto. Un clic apre Impostazioni › Connessioni, dove le stesse righe, con le stesse parole e gli stessi colori, si rimettono a posto.

Il giallo c'è perché «la rete è caduta» e «la password è cambiata» non sono la stessa cosa: il rosso chiama l'utente, il giallo gli dice che non deve fare niente. La testa resta libera, ed è lo scopo. I File non entrano: oggi sono i volumi del computer, senza accesso né sincronizzazione, e un volume di rete smontato vuol dire solo che non si è in ufficio. Entreranno i drive (Google Drive, OneDrive) quando si sincronizzeranno, con gli stessi quattro stati. L'AI non è una connessione: come sta lo dice il pannello del Segretario, e un suo errore permanente la spegne (§12.1).

### 13.2 Le Impostazioni

Le sezioni, nella colonna a sinistra: **Connessioni** (§11.3), **Preferenze**, **Segretario**, **Cosa so di te** (la memoria, §10), **Notifiche**, **Scorciatoie**, **Dati**, **Firme**, **Estensione**; poi le schede di un'estensione installata, se ne porta.

- **Estensione** dice quale estensione è installata — il suo nome, che cosa aggiunge, il suo identificativo, la versione dell'app — e che cos'è un'estensione; senza, che questa è l'edizione per tutti e che per averne una si contattano gli sviluppatori (§1).
- **Notifiche** dice che cosa interrompe l'utente, app per app, e il numero sull'icona (§13.3).
- **Dati** dice quanto occupa ogni cosa sul computer e la toglie; in fondo, la diagnostica: che cosa tiene, e l'esportazione da mandare (§14.4).
- **In fondo alla colonna**, sempre: «SIEVER Mail» e la versione (in sviluppo 0.0.0: la versione vera la scrive la build), e sotto il nome dell'estensione, se c'è; le stesse parole del marchio nella barra (§13.1).

### 13.3 Le notifiche

**Una notifica è un'interruzione.** Ferma ciò che l'utente sta facendo, e lo scopo di SIEVER Mail è il contrario: meno tempo davanti alle app, meno cose in testa. Così una notifica arriva solo quando saperlo adesso, e non alla prossima occhiata, cambia ciò che l'utente farebbe; tutto il resto lo aspetta dove lo trova — Oggi, la Posta, il calendario, il pannello. E quella che arriva porta già ciò che serve: la sintesi del Segretario, la preparazione dell'incontro, i pulsanti per finirla lì.

**Un centro solo** (`src/main/notifications/`), nella radice dell'app e non in una sua parte. Ogni app, il Segretario, SIEVER Mail stesso e, quando servirà, un'estensione gli dicono che cosa hanno da dire nella stessa forma — di chi è, una chiave, le parole, quelle da mostrare senza il contenuto, dove porta, i pulsanti — e ciascuna decide con le sue preferenze se vale un'interruzione. Il centro tiene il resto uguale per tutti: l'interruttore di tutte, se il contenuto si vede, il suono, se l'utente è davanti alla finestra, una notifica per cosa (un'altra con la stessa chiave prende il suo posto, anche nel centro notifiche del sistema; ciò che non è più vero si ritira; chiudendo l'app, ciò che vi è rimasto resta lì), il clic che porta dove serve — gli stessi posti dei link del Segretario: un messaggio, un evento, un giorno, Oggi, una conversazione nel pannello, una bozza, le Connessioni —, che cosa ha fatto il sistema dell'ultima, e la diagnostica: quali sono state mostrate, aperte e scartate, per tipo (§14.4).

**Per app, alla pari:**

| App         | Che cosa dice                                                                                                                                                                                                                                                                                                        | Senza AI | Con l'AI                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posta       | la posta nuova di Posta in arrivo — non letta, delle caselle non silenziate —, con «Segna come letta» e «Archivia»; più messaggi insieme in una; ciò che è arrivato ad app chiusa, una per casella quando è tutto arrivato. Sparisce quando il messaggio è letto, anche altrove                                      | tutta    | solo ciò che il Segretario dice di dire adesso, con la sua riga; un messaggio la cui nota non arriva in dieci minuti, com'è                              |
| Calendario  | i promemoria prima degli eventi dell'utente (§7.4), con «Partecipa» se c'è una chiamata e «Fra 5 minuti»; le novità dei suoi eventi che ha in mano qualcun altro — un invito, uno spostato o annullato, uno messo nel suo calendario — che non arrivano anche per posta; una serie cambiata tutta, una notifica sola | tutti    | il promemoria porta la preparazione dell'incontro; delle novità, quelle che il Segretario dice di dire adesso; ciò che non guarda in dieci minuti, com'è |
| Segretario  | aspetta una conferma; ha finito ciò che gli si era chiesto mentre l'utente era altrove; Conoscimi e la preparazione finite con nessuno davanti; la giornata, la prima volta che è pronta ogni mattina                                                                                                                | —        | sì                                                                                                                                                       |
| SIEVER Mail | le funzioni AI spente o il credito basso (§12.1), una connessione ferma (§14.1), un messaggio che non è partito dalla coda (§14.1)                                                                                                                                                                                   | sempre   | sempre                                                                                                                                                   |
| File        | niente: un volume non chiede niente, e i suoi cambiamenti arrivano a «Il punto» (§4.2)                                                                                                                                                                                                                               | —        | —                                                                                                                                                        |

Gli avvisi di SIEVER Mail non si spengono uno per uno: senza l'utente non si rimettono a posto (§14.1). Un'estensione, quando avrà qualcosa da dire, avrà `notify` nel contratto, con la sua riga nelle Impostazioni (§15.4).

**Il Segretario decide l'interruzione, il sistema la garantisce.** Un avviso vale quando saperlo adesso vale, per l'utente, più dell'interruzione: perché cambia ciò che fa, o perché è una cosa che aspetta o che gli sta a cuore, e saperla gli toglie un pensiero — e il controllo della posta che quel pensiero porterebbe con sé. Il resto aspetta dove lo trova; ciò che conta e può attendere lo dice la lettera del mattino. Chi lo sa è il Segretario, che ha letto il messaggio e conosce l'utente; una regola nostra sulla natura e sull'importanza della nota deciderebbe al suo posto. **La misura è dell'utente:** di solito gli avvisi sono pochi, ma quanti, di chi, di che cosa e con che parole lo dice lui — in chat, correggendo, con ciò che fa — e il Segretario lo tiene nella sua memoria come ogni preferenza (§10), e la guarda prima di decidere.

- **Per un messaggio:** nella sua nota, `avvisa`, con la riga che l'utente riceve. Il compito di lettura dà il criterio, morbido: le due ragioni, con i loro esempi — qualcuno aspetta in giornata, un termine vicino, un problema che peggiora; la risposta attesa, l'esito di una cosa importante —, e la misura dell'utente. La sintesi dice che cosa vuole il messaggio; la riga dice perché saperlo adesso («Rossi aspetta la conferma entro le 12»). Una nota avvisata senza riga mostra la sua sintesi.
- **Per un evento cambiato:** nel lavoro sul calendario, nella sua nota, `avvisa`, una riga che basta da sola — anche di un evento di altri, quando conta per l'utente («Luca in ferie da domani: il cantiere resta scoperto»). Ciò che arriva anche per posta lo dice già la lettura di quella mail.
- **Il sistema** tiene ciò che il modello non può tenere: un messaggio nuovo aspetta la sua nota al più dieci minuti, poi si dice com'è; una novità del calendario che si direbbe senza AI aspetta il lavoro sul calendario al più dieci minuti, poi si dice com'è; una copia dello stesso messaggio in un'altra casella si dice una volta sola — dove la casella non è silenziata; un messaggio letto nel frattempo non suona; se il Segretario non legge (l'AI spenta, la chiave rifiutata) si dice tutto, come senza AI. All'avvio, ciò che è arrivato ad app chiusa aspetta di sapere se il Segretario legge: altrimenti partirebbe tutto, prima che lui possa scegliere.

**Il Segretario filtra le novità, non le sveglie.** Una novità — la posta che arriva, un cambiamento fatto da altri — viene dal mondo, e quasi sempre può aspettare: il Segretario sceglie quale vale un'interruzione. Un promemoria è una sveglia che l'utente, o il suo calendario, ha messo su un impegno già preso, e che suona anche sul telefono: se il Segretario potesse tacerla, un suo errore costerebbe un incontro, senza che nessuno lo veda, e l'utente smetterebbe di fidarsi. Così le sveglie suonano con o senza AI; il Segretario le arricchisce (la preparazione) e ne aggiunge (gli eventi suoi che il calendario non dice, §7.4), non ne toglie mai.

**Davanti o dietro, una regola sola.** Ciò che è legato al suo tempo — la posta che interrompe, un promemoria, un cambiamento — arriva sempre come notifica: «Non disturbare» e le modalità Full immersion le gestisce il sistema. Ciò che risponde all'utente — il Segretario ha finito, aspetta una conferma — e gli avvisi di SIEVER Mail stanno dentro l'app se l'utente è davanti alla finestra (il pallino del pannello, il popup), e diventano una notifica quando non c'è.

**I promemoria del calendario.** Suonano gli eventi dell'utente (§7.4), ognuno una volta, in qualunque calendario compaia; mai uno di un calendario nascosto. Ogni evento ha i suoi, come li tiene il suo calendario — Google (quelli a schermo, suoi o del calendario), Outlook, CalDAV e i link ICS (gli allarmi che mostrano o suonano; non quelli che mandano una mail) —; a uno che non ne dice, l'anticipo che l'utente sceglie (di base dieci minuti), non a uno di tutto il giorno, come un compleanno; uno che li ha spenti, nel calendario dell'utente, resta senza. In un calendario che non è suo gli allarmi sono di chi lo tiene: un evento dell'utente lì senza promemoria propri prende il suo anticipo.

- Ognuno si dà una volta sola (ricordato sul disco: un avvio o un risveglio non lo ripete); uno scaduto mentre l'app era chiusa o il computer dormiva si dà in ritardo, fino a dodici ore, se l'evento non è ancora cominciato (quello dato all'inizio, anche un minuto dopo). Si guardano le quattro settimane davanti: un calendario non ne tiene di più lontani.
- Uno di un evento spostato, annullato o finito si ritira; si ripianificano ai cambiamenti degli eventi, al risveglio e ogni ora.
- Con l'AI porta la prima riga della preparazione che il Segretario ha scritto.

**Le novità del calendario.** Senza AI si dice un evento dell'utente che **ha in mano qualcun altro**: un invito, un evento spostato o annullato da chi lo organizza, uno che un altro ha messo nel suo calendario (la segreteria, nel calendario «Marco»). Non uno suo che cambia: quasi sempre l'ha cambiato lui, da un altro dispositivo. Solo dove e quando: chi ha risposto, o una parola della descrizione, non sono novità. Un invito, o il suo cambiamento, di un calendario venuto con una casella collegata lo dice la posta, con la mail dell'organizzatore. Con l'AI lo dice il Segretario, e la rete dei dieci minuti tiene il resto; si può chiedere anche qui tutto, come per la Posta.

**L'icona.** Il numero dice ciò che serve all'utente vedere da fuori. Con l'AI, di base, **ciò che ti aspetta oggi**: le cose aperte che toccano a lui — gli chiedono, ha promesso, da fare —, in scadenza oggi o già scadute, quelle di un messaggio nel Cestino escluse. I non letti, con il Segretario che toglie dalla testa ciò che non conta, crescerebbero di newsletter: misurerebbero proprio ciò che l'AI rende inutile guardare. Si può scegliere anche i non letti di Posta in arrivo (com'è senza AI) o nessun numero.

**Impostazioni › Notifiche:** in cima SIEVER Mail — l'interruttore di tutte, il contenuto, il suono, gli avvisi che restano sempre —; poi una sezione per app, nell'ordine della barra: il Segretario (con l'AI), la Posta (le caselle una per una, e con l'AI «solo ciò che il Segretario ti segnala»), il Calendario (i promemoria con l'anticipo per gli eventi senza; le novità, e con l'AI «solo ciò che il Segretario ti segnala», come per la Posta; quali eventi sono dell'utente, calendario per calendario, che è anche ciò che Oggi mostra della sua giornata); poi il permesso del sistema — l'ultima notifica, una di prova, le impostazioni del sistema — e l'icona.

Chi nelle versioni 1.x aveva spento le notifiche — che erano solo della posta — ritrova spente quelle della Posta; i promemoria e il Segretario, che allora non c'erano, sono accesi.

**Il permesso.** Nessun sistema dice prima se mostrerà le notifiche di un'app; macOS lo chiede alla prima. Così la prima arriva in contesto, all'«Entra» del primo avvio, con qualunque connessione: dice che cosa SIEVER Mail dirà, e il sistema chiede allora.

**Perché così.** Le notifiche erano nate come avvisi della posta nuova, dentro la posta: il calendario non avvisava di niente, il Segretario solo taceva la posta che non contava, e spegnere quelle della posta spegneva anche gli avvisi dell'AI e delle connessioni. Un centro solo e le app alla pari fanno di ogni fonte una voce con le stesse regole; il Segretario che decide l'interruzione mette il giudizio dove sta la comprensione, e lascia al sistema solo ciò che il modello non può garantire.

### 13.4 Ciò che verrà

**Contatti**, quando arriverà:

- **Le fonti:** la rubrica che l'app già impara dalla posta, i partecipanti degli eventi, i contatti delle connessioni, la memoria del Segretario sulle persone.
- **Come li collega:** il Segretario userà uno strumento per legare una nota della memoria a un contatto, così l'interfaccia mostrerà "cosa so di lui" senza leggere il Markdown né obbligare il modello a scrivere JSON.

**L'editor nuovo** (la risposta nel lettore, le schede) è rimandato: oggi non cambia.

---

## 14. Gli errori

**Due famiglie che non si confondono.** Gli errori dello **stack** — ciò che sta sotto: la rete, i server, gli account, OpenRouter — dicono se il mondo risponde. Gli errori del **Segretario** — un suo lavoro che non arriva in fondo — dicono se un'esecuzione ha concluso. Si trattano in modo diverso, e ciascuno sempre nello stesso modo, in tutta l'app e in ogni stato.

### 14.1 Gli errori dello stack: passeggeri o permanenti

|                                      | **Passeggeri** — passano da soli                                                                                                                                                                                                                                                                                                                               | **Permanenti del servizio** — senza l'utente non passano                                                                                                                                                                                                                                                                      | **Permanenti di una richiesta** — quella richiesta non andrà mai, il servizio sì                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI (OpenRouter)                      | rete assente; OpenRouter o il fornitore lenti, sovraccarichi o giù (408, 429, 500, 502, 503, 504, risposta interrotta); troppe richieste in volo sulla chiave (402 con l'ora per riprovare)                                                                                                                                                                    | chiave rifiutata (401); credito finito o tetto di spesa della chiave o del conto (402, 403 di budget); modello non più offerto, o nessun fornitore che lo serva senza tenere i dati (404)                                                                                                                                     | richiesta moderata o bloccata (403); richiesta che il modello non accetta (400, 413, 422)                                                                                                    |
| Connessioni (posta, calendari, file) | rete assente; server che non risponde, si interrompe o è momentaneamente indisponibile («[UNAVAILABLE]», troppe connessioni); un disco di rete smontato                                                                                                                                                                                                        | accesso rifiutato (password cambiata o scaduta, «[AUTHENTICATIONFAILED]», «[EXPIRED]»); autorizzazione revocata (Google `invalid_grant`, Microsoft da riaccedere); certificato del server non valido; accesso IMAP spento dall'azienda                                                                                        | un messaggio che il server non dà; un invio rifiutato (destinatario inesistente, messaggio troppo grande); una cartella o un file spariti                                                    |
| **Cosa succede**                     | **si riprova da soli**, senza disturbare: l'AI rifà la chiamata — l'esecuzione aspetta e riprende dallo stesso passo, non si distrugge (§2.3); la connessione si ricollega con attese crescenti, subito al risveglio e al ritorno della rete. Se dura, lo stato lo dice con calma (la spia gialla nella barra, §13.1; il pannello; la procedura), mai un popup | **la prima volta un popup** dice cosa è successo e come rimediare, e il servizio **si spegne da quell'istante**: l'AI si spegne (§12.1); la connessione si ferma — nessun altro tentativo, che con una password sbagliata porterebbe il server a bloccare l'account — e la spia nella barra resta rossa finché non si rimedia | **fallisce quell'operazione**, detto dove l'utente la vede: l'invio non riuscito con il perché, il messaggio che non si legge, l'esecuzione del Segretario che ha fatto la richiesta (§14.2) |
| **Come si riaccende**                | da solo                                                                                                                                                                                                                                                                                                                                                        | AI: ricarica o chiave nuova, poi la procedura guidata. Connessione: «Ricollega» (di nuovo la password o l'accesso, sulla stessa connessione) oppure «Togli»                                                                                                                                                                   | —                                                                                                                                                                                            |

**Perché una connessione si ferma e non si toglie da sola.** Toglierla sarebbe la via più corta, ma togliere una connessione cancella la sua posta e tutto il lavoro del Segretario su di lei — note, cose aperte, progetti, ciò che Conoscimi ne sapeva — e rimetterla costa un Conoscimi e una lettura da capo. Una password cambiata in azienda o un'autorizzazione che Google chiede di rinnovare sono cose di tutti i giorni: non devono costare il lavoro di mesi. Fermarla ottiene ciò che conta — basta tentativi, basta stato incoerente, l'utente lo sa subito — senza perdere niente: come l'AI spenta, che tiene ciò che ha imparato. Il popup offre «Ricollega» e «Togli»: togliere resta un clic. Regola unica: **un errore permanente spegne il servizio e ne tiene i dati; si riaccende dal suo percorso canonico.**

**Un rifiuto che potrebbe essere un «non ora».** Non ogni «no» del server è definitivo: Gmail risponde «[ALERT] Too many simultaneous connections» a chi ha già troppe sessioni aperte, Office 365 dice un nudo «AUTHENTICATE failed» anche quando passa, e il Wi-Fi di un albergo mette la sua pagina d'accesso al posto del server, con un certificato che non torna. Fermare la connessione con un popup «la password è cambiata» sarebbe falso. Quindi solo le risposte che dicono il motivo (`AUTHENTICATIONFAILED`, `AUTHORIZATIONFAILED`, `EXPIRED`, l'autorizzazione revocata) fermano subito; le altre e i certificati si confermano con un secondo tentativo un minuto dopo (per un calendario, alla sincronizzazione seguente). Due accessi sbagliati a un minuto di distanza non bloccano nessun account. Quando è l'utente a riprovare, non si aspetta: l'esito si dice lì, nella finestra da cui ha chiesto.

**Il popup c'è ovunque.** All'avvio, nella procedura, nell'app: un rifiuto non si perde perché la finestra era su un'altra schermata, e quelli già in corso all'apertura si chiedono al processo principale (all'avvio arrivano prima che la pagina ascolti). Con la finestra in secondo piano lo dice anche una notifica, come un messaggio che non è partito dalla coda (§13.3).

**Una connessione che non funziona non si collega,** con o senza AI. Aggiungendola, l'accesso si prova prima di salvarla: posta con password (IMAP e SMTP), Google e Microsoft (la casella IMAP con il token appena dato, non solo il consenso: Gmail con l'IMAP spento, un'azienda che l'ha spento per Microsoft 365; l'SMTP di Microsoft no, perché dove l'azienda lo spegne si invia da Graph), calendari (una prima lettura rifiutata non lo tiene; un calendario chiesto insieme alla casella che non arriva lo dice, e la casella resta). Nella preparazione della procedura una connessione che non va **ferma la procedura**: se è passeggero la procedura aspetta che si ricolleghi da sola, con «Riprova ora»; se è permanente, «Ricollega» o «Togli»; tolte tutte, si torna ad aggiungerne una. Mai «continua» con una connessione che non funziona. Un calendario Microsoft collegato prima che servisse il fuso orario della casella funziona ma non scrive gli eventi di tutto il giorno: non è fermo, ha «Ricollega» per dare il consenso che manca.

**Gli invii sono dell'utente.** Un invio che fallisce prima che il server l'abbia preso (rete assente, server irraggiungibile, il token del fornitore non ottenuto, una risposta 4xx «non ora») è passeggero: il messaggio resta **in uscita** e parte da solo quando la connessione torna, detto con calma. Un invio che si interrompe dentro la sessione non si rifà da solo — potrebbe essere già partito: nodemailer chiama «CONN» una connessione caduta in qualunque passo, il messaggio compreso, quindi non si distingue e si sceglie la strada che non manda mai due volte: si dice, e decide l'utente. Un invio rifiutato è permanente di quella richiesta: si dice il perché e il messaggio resta in Bozze. Rimandato a mano dalla bozza, esce dalla coda; riaperto per cambiarlo, torna nelle mani dell'utente (detto), perché non parta mai la versione vecchia né si cancelli quella nuova; mentre parte dalla coda non si rimanda a mano. Prima di partire dalla coda si ricontrollano gli allegati.

### 14.2 Gli errori del Segretario

Un'esecuzione che non arriva in fondo da sé: 10 turni di fila senza progressi (§2.3), oppure una sua richiesta che OpenRouter rifiuta da sola (la terza colonna sopra). Non è un errore dello stack: il mondo ha risposto, è quel lavoro che non ha concluso. Si tratta secondo **chi aspetta il risultato**:

- **In primo piano** — l'utente è lì e aspetta: la chat; ⌘J nell'editor (finché l'editor non diventa parte del lettore e il suo Segretario si fonde con la chat); la ricerca in parole; nella procedura Conoscimi e la lettura. **Fallisce, lo dice, e c'è «Riprova».** Nella lettura, che sono molte esecuzioni in parallelo, «Riprova» compare alla fine della barra e rifà solo quelle fallite; nella procedura c'è anche «Continua senza AI». La rilettura prima dell'invio è un controllo: se non riesce, il messaggio parte com'è — non tiene mai fermo un invio.
- **In sottofondo** — nessuno aspetta: le letture della posta nuova, il calendario, la giornata, «Il punto», la memoria. **Finisce, e basta**: niente «Riprova», niente elenco, niente da gestire per l'utente. «Guarda di nuovo la giornata» e un progetto aperto con «Il punto» indietro sono richieste dell'utente: partono anche se l'ultimo tentativo in sottofondo era fallito. Lo stato resta vero: quel lavoro non si rifà da solo (il sistema ricorda il fallimento solo per non ripeterlo a vuoto), un fatto nuovo sulla stessa questione è lavoro nuovo, domani è un'altra giornata, il ripasso del mattino raccoglie ciò che è sfuggito.

### 14.3 Gli errori del programma

Un'eccezione inattesa, un errore del database: si scrive nella diagnostica (§14.4), l'operazione fallisce con una frase in italiano dove l'utente l'ha chiesta, e il resto continua. Mai in silenzio, mai un crash per un errore di una parte. In pratica: il processo principale scrive ciò che nessuno ha preso; gli errori della pagina — ciò che si rompe disegnando, con il componente in cui si è rotto, le promesse fallite, ciò che stampa — finiscono nello stesso registro; una pagina che muore si ricarica (al massimo una volta al minuto); una promessa della pagina fallita senza che nessuno aspettasse si dice in un avviso; ogni riquadro della finestra si rompe da solo («Qui qualcosa si è rotto», «Riprova») e gli altri restano.

### 14.4 La diagnostica

Per capire che cosa è successo sul computer di un utente — un errore, un modo di usare l'app, lo stato di una connessione, il lavoro del Segretario — da ciò che l'app stessa ha scritto, senza chiederglielo a voce. Un modulo solo per tutta l'app (`src/main/diagnostics/`), alla pari per ogni app e per il Segretario.

**Un registro, una riga per evento.** Ogni parte scrive nello stesso registro, in JSON, una riga per evento: l'ora (`t`), l'avvio (`s`: ogni avvio ha il suo identificativo), il livello (`lvl`), la parte dell'app (`area`: `app`, `ui` la pagina, `mail`, `calendar`, `files`, `segretario`, `console`, un'estensione come `ext:<id>`), che cosa è successo (`ev`, un nome breve — `app.open`, `run.end`, `connection.state` —, o una frase per l'errore inatteso del programma) e i suoi campi.

- **I livelli dicono la famiglia (§14).** `info`, ciò che succede; `warn`, ciò che non va ma passa da sé o non è del programma — la rete, un server, un'esecuzione del Segretario che non arriva in fondo, una richiesta rifiutata dal mondo o per ciò che l'utente ha dato (una password sbagliata, un link che non risponde); `error`, ciò che non passa da solo — un'eccezione del programma (un errore di tipo, del database, §14.3), una connessione ferma (§14.1). Dove le due cose si mescolano, il livello lo decide la natura dell'errore, non il punto in cui si scrive.
- **La causalità sta nei campi comuni:** `by` (chi l'ha fatto: l'utente, il Segretario, il sistema, come gli attori del registro, §3.2), `run` (l'esecuzione del Segretario, la cui sessione intera è nell'esportazione), `conn` (la connessione), `ms` (quanto è durato). Così le righe si leggono come una storia: l'utente ha aperto la Posta, ha cercato, ha letto; la connessione è caduta ed è tornata; la lettura di quella conversazione è durata tanto, è costata tanto, ed è finita così.
- **Che cosa si scrive.** Gli errori di ogni parte, con ciò che il server ha detto. Lo stato delle connessioni quando cambia, i rifiuti, la coda d'uscita, le connessioni aggiunte e tolte. Le esecuzioni del Segretario dall'inizio alla fine: compito, esito, durata, turni, chiamate agli strumenti, quelle non riuscite e quelle con argomenti monchi (§2.3), token, costo, modello e fornitore; quando OpenRouter non risponde e quando torna; l'interruttore dell'AI, gli avvisi, i passi della procedura guidata, ciò che la passata toglie delle connessioni andate (§11.4); come l'utente risponde al suo lavoro — le cose aperte spuntate, rinviate o corrette, le proposte accettate o scartate, le risposte pronte prese o scartate, le modifiche annullate, la memoria corretta —, il segno più chiaro di quanto serve. L'uso: le app aperte, i comandi dalla tastiera o dal menu, le sezioni delle Impostazioni, le ricerche, i messaggi letti e quanto ci hanno messo ad aprirsi, il compositore e chi ha inviato, le azioni sui messaggi e sugli eventi, con chi le ha fatte; la finestra in primo piano e nascosta, lo schermo bloccato, il sonno e il risveglio del computer. I canali della pagina lenti (oltre 2 secondi, senza contare quelli che aspettano l'utente — un dialogo, un accesso — o il modello). La console del processo principale, ciò che una libreria stampa.
- **Che cosa non si scrive mai.** Password, chiavi, token: anche finiti per sbaglio in un campo, il campo che li nomina diventa «[tolto]». Il testo della posta, delle ricerche, delle note: dell'uso si scrivono i conti e i tipi, mai il contenuto. Di una chiamata della pagina non riuscita restano ciò che dice quale cosa — id, chiavi, cartelle, numeri, scelte — e di ogni altro testo, anche corto, solo la lunghezza (una password data per ricollegarsi, una domanda); di un comando del server solo le sue parole, non ciò che cercava; degli errori del disco di un'estensione il codice, perché i percorsi portano gli oggetti delle mail. Il testo lungo si taglia.
- **Non diventa un mucchio.** Lo stesso avviso o errore, per la stessa connessione, esecuzione o canale, si scrive una volta e poi si conta: allo scadere del minuto una riga dice quante volte è tornato. Un file per giorno, 21 giorni compreso oggi come il diario del Segretario, entro 100 MB; oltre i 20 MB in un giorno le righe d'informazione si fermano — detto una volta —, gli avvisi e gli errori no. Si scrive a gruppi, in ordine, senza far aspettare niente; un errore subito, e tutto alla chiusura.

**Resta sul computer.** Sta nella cartella del profilo (`diagnostica/`, una per ambiente, §15.3). Nessuna telemetria: esce solo quando l'utente la esporta e la manda.

**Impostazioni › Dati › Diagnostica.** Dice che cosa tiene e quanto pesa, e offre «Esporta…» — il periodo (l'ultimo giorno, la settimana, tre settimane) e, con l'AI accesa, se includere il lavoro del Segretario — e «Apri la cartella».

**L'esportazione: uno zip che si legge da solo**, aperto nella sua cartella, pronto da allegare.

- `LEGGIMI.txt`: che cosa contiene, in italiano, e che non è stato mandato a nessuno.
- `manifesto.json`: la versione, l'edizione, il periodo, le scelte, i file.
- `stato.json`: com'era ogni parte in quel momento, in conti e stati — ciò che il Segretario ha scritto sta solo nelle sue sessioni. L'app: la versione e l'edizione, il sistema, il profilo, la memoria, il database, le preferenze. Ogni casella: i server, lo stato, l'ultimo contatto con il server, l'indice, quanti messaggi e cartelle (anche quelle mai sincronizzate), le bozze, la coda d'uscita, i segni. Ogni calendario. Il Segretario: acceso o no, lo stato della chiave (mai la chiave), la procedura, il motore, la lettura, Conoscimi, la spesa, quanto tiene il registro. L'estensione. Ogni parte dice il suo stato da sé, e una fonte nuova si aggiunge nello stesso modo (`provideDiagnosticState`).
- `riepilogo.json`: il registro a colpo d'occhio, contato dal registro stesso. Gli avvii; quanto tempo la finestra è stata in primo piano ogni giorno — ciò che l'app esiste per ridurre (§0); quante volte è successa ogni cosa; gli errori e gli avvisi raggruppati per tipo; le esecuzioni del Segretario per compito, con come sono finite, la durata mediana e al 95° percentile, il costo, le chiamate non riuscite; come l'utente ha risposto al suo lavoro; le notifiche per tipo — mostrate, aperte, scartate (§13.3); i canali lenti.
- `registro/`: le righe del periodo.
- `segretario/`, se scelto: ogni esecuzione per intero, anche quelle in sottofondo — ciò che ha ricevuto, pensato, chiamato e ottenuto —, una per file con la data, il compito e l'identificativo (lo stesso `run` del registro); la memoria com'era; la coda; le lezioni da imparare. Le immagini restano fuori, nominate. Il testo che il Segretario ha letto c'è: per questo è una scelta.
- `estensione/<id>/`: ciò che l'estensione aggiunge.

Niente si tiene intero: il registro si legge un pezzo alla volta, contato per il riepilogo mentre passa, e ogni parte si comprime a pezzi, aspettando il disco. Si scrive in un file a parte, rinominato alla fine: un'esportazione interrotta non lascia uno zip rotto.

**Le estensioni stanno nella stessa diagnostica.** Scrivono sotto la loro area, con `context.diagnostics` nel processo principale e `diagnosticsFor` del kit nella pagina, nella stessa forma; dichiarano il loro stato e i loro file con `ExtensionMain.diagnostics` (§15.4). Nessun registro a parte.

**Perché così.** Il file con le righe della console, com'era nelle versioni 1.x, diceva poco e mescolava tutto; un servizio esterno di analisi contraddirebbe ciò che l'app promette (i dati restano sul computer). Un registro strutturato e locale tiene insieme errori, stato, uso e Segretario nella stessa forma, si legge riga per riga o a colpo d'occhio, e quando darlo lo decide l'utente.

---

## 15. Ingegneria

### 15.1 Le app alla pari anche nel codice

- **Nel processo principale**, una radice di composizione comune (`Workspace`):
  - crea il database, gli accessi (OAuth), le fonti — `MailService`, `CalendarService`, in futuro `FileService` — e il Segretario;
  - li collega con porte;
  - monta l'estensione, se c'è;
  - ne governa avvio e chiusura.

  Nessuna fonte crea le altre o il Segretario.

- **Nell'interfaccia**, il guscio (`App.tsx`) tiene la barra, il pannello del Segretario, le impostazioni, la schermata d'apertura e la procedura guidata — strati sopra lo spazio di lavoro, che resta montato e vivo (§13.1) — e la navigazione tra app (aprire un messaggio, un evento, un progetto da qualunque punto). Ogni app è un modulo (`apps/mail`, `apps/calendar`, `apps/today`; poi `apps/files`, `apps/contacts`, `apps/projects`), con la stessa forma.
- **Nel modello condiviso**, le famiglie di connessioni (`mail`, `calendar`, `files`) e le app (fonti, derivate, la scrivania) sono dichiarate una volta (`src/shared/workspace.ts`). La barra, le impostazioni e il Segretario le leggono da lì.

**Moduli del Segretario (`src/main/ai/`):**

| Modulo                  | Cosa contiene                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `agent/`                | il ciclo, la conversazione, i riferimenti brevi, la concorrenza delle letture                                               |
| `engine/`               | il pianificatore (domande sullo stato), la coda `ai_work`, lo scheduler (priorità, corsie, concorrenza, tentativi, ripresa) |
| `tasks/`                | ogni compito: prompt, dati di partenza, permessi, esito richiesto                                                           |
| `registry/`             | note, cose aperte, progetti, risposte, proposte. Le tabelle con le loro invarianti e revisioni                              |
| `tools/`                | gli strumenti, sottili sopra il registro e i servizi                                                                        |
| `memory/`               | il quaderno versionato                                                                                                      |
| `segretario-service.ts` | la facciata per l'IPC                                                                                                       |

**Senza esagerare:**

- niente microservizi;
- niente coda esterna: SQLite basta. Una sola scrittura alla volta, il WAL;
- niente database a grafo: le relazioni stanno nelle tabelle.

### 15.2 I prompt, in file di testo

```
src/main/ai/prompts/
  segretario.md        chi è il Segretario: identità, scopo, come lavora, sicurezza, come scrive
  contesto.md          il blocco di contesto (data, connessioni, memoria)
  compiti/             cosa fare in questa esecuzione (obiettivo e criteri, non procedure)
    lettura.md giornata.md punto.md calendario.md
    richiesta.md scrittura.md revisione.md ricerca.md
    conoscimi.md riflessione.md al-passo.md
  strumenti/*.md       una descrizione per strumento
  infrastruttura/      compattazione.md, titolo.md (non sono il Segretario: lavori tecnici)
```

Un'estensione porta i suoi prompt nel suo repository: le istruzioni dell'organizzazione, che si aggiungono a `segretario.md`, e la descrizione dei suoi strumenti.

I prompt delle versioni 1.x sono confluiti qui: smistamento e risposta pronta in `compiti/lettura.md`, oggi e sollecito in `compiti/giornata.md`, argomento in `compiti/punto.md`, chiedi alla posta in `compiti/ricerca.md`; «di cosa si tratta» un progetto lo scrive il Segretario con `progetti`.

**Obiettivi e criteri, non procedure.** I prompt dicono cosa deve esserci alla fine e perché, e lasciano al modello come arrivarci. Suggeriscono dove guardare in modo generale; non iniettano dossier; nessun controllo del testo che il modello scrive.

**Gli esempi sono esempi.** I prompt pubblici danno esempi presi da lavori diversi — un preventivo, una riunione, il commercialista, un trasloco — e `segretario.md` dice al modello che sono solo esempi: come l'utente chiama le cose e come lavora, lo impara dalle sue fonti e ci si adegua. Le convenzioni vere arrivano solo dalle istruzioni di un'estensione, che lo dicono (§1).

### 15.3 Gli ambienti: l'app installata, lo sviluppo, lo studio di prova

Sullo stesso computer convivono tre SIEVER Mail, anche di versioni diverse, e non si danno fastidio:

| Ambiente               | Come si apre                                                              | I suoi dati                                                                                  | A cosa serve                                                                          |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **L'app installata**   | dal Dock o dal menu Start                                                 | il profilo dell'app (`siever-mail` nella cartella dati dell'utente)                          | il lavoro vero dell'utente, con la versione rilasciata                                |
| **Lo sviluppo**        | `npm run dev` (pubblica) o `npm run dev:ext` (con l'estensione)           | un profilo suo (`siever-mail-dev`), con gli account veri: comportamento classico, posta vera | provare sul vero; lecito, ripulendo alla fine ciò che le prove hanno cambiato         |
| **Lo studio di prova** | `node studio.mjs` (pubblica) o `node studio.mjs --ext` (con l'estensione) | un profilo suo e server suoi in Docker: posta, invio, calendario, PEC, un archivio su disco  | una vita di lavoro simulata e manipolabile, per le prove migliori in lungo e in largo |

**Perché lo sviluppo ha un profilo suo.** Lo schema del database va solo avanti: uno sviluppo che migra il profilo dell'app installata la rompe. E il blocco d'istanza unica è per profilo: con lo stesso profilo, `npm run dev` mentre l'app è aperta mostrerebbe la finestra dell'app installata. Con profili separati i tre girano insieme. Gli account veri nel profilo di sviluppo si collegano una volta (o lo si copia dal profilo dell'app).

**Lo studio non è di un'azienda.** L'organizzazione di prova potrebbe chiamarsi in qualunque modo: `studio.mjs` sta nella radice del progetto, fuori da git (è uno strumento di quel computer), e apre l'app pubblica; con `--ext` la stessa vita, con l'estensione — cambia ciò che SIEVER Mail sa fare con gli stessi dati.

### 15.4 Le estensioni nel codice

**Una per build, scelta alla build.** Quattro alias Vite — `@app/extension/{main,renderer,preload,shared}` — puntano al repository dell'estensione, clonato in `extension/` (fuori da git), con `LOAD_EXTENSION=1`; altrimenti agli stub pubblici di `src/extension/`. Chiesta un'estensione che non c'è, la build si ferma: non esce l'app pubblica sotto il nome di un'altra. La build pubblica non contiene niente di un'estensione: impacchetta solo ciò che gira.

**Una superficie sola, dichiarata.**

- **Il contratto** (`src/extension/types.ts`): l'identità, i punti in cui si monta, ciò che l'app le offre.
- **Il kit** (`src/extension/kit/main.ts`, `kit/renderer.ts`): gli aiuti dell'app che un'estensione può usare, e che restano gli stessi qualunque cosa si muova dentro l'app; con i componenti dell'interfaccia (`@renderer/components/ui/*`) e il modello condiviso (`@shared/*`).
- Nient'altro: il lint vieta all'estensione ogni altro import dell'app. Se serve qualcosa che la superficie non dà, si allarga il contratto o il kit, con nomi generici, in un commit dell'app che non parla dell'estensione.

**L'identità** (`ExtensionShared.identity`): il nome legale, l'identificativo, che cosa aggiunge. Nell'edizione pubblica è vuota, e l'app non monta niente. Dall'identificativo vengono le cose sue:

- **i canali IPC**: l'estensione li chiama con nomi suoi, l'app li tiene sotto `extension:<id>:`; dalla pagina li vede come `window.extensionApi`, a parte dalle API dell'app;
- **le tabelle**: cominciano con l'identificativo (`siever_srl_…`), si creano in modo idempotente e l'app le conserva negli aggiornamenti come le sue;
- **i comandi e i tipi di proposta**: `<id>.<nome>` (`siever-srl.archive`).

**Dove si monta.**

- Nel Segretario: le istruzioni dell'organizzazione dopo `segretario.md`; i suoi strumenti dopo quelli dell'app, con le loro icone nel diario; le proposte che sa eseguire.
- Nell'interfaccia: i pulsanti nel lettore, la sua finestra nella Posta, i comandi con le loro scorciatoie, le sue schede nelle Impostazioni, il carattere e i colori del compositore.
- Nei dati: le sue tabelle, i segni sui messaggi (§6.3), la firma predefinita del primo account, ciò che toglie con «Elimina tutti i dati».
- Nella diagnostica: i suoi eventi sotto la sua area (`ext:<id>`), il suo stato e i suoi file nell'esportazione (§14.4).

Gli agganci nell'interfaccia oggi sono della Posta, perché è lì che il primo caso ne aveva bisogno; istruzioni e strumenti valgono già per ogni fonte. Quando un'estensione avrà bisogno di un'azione su un evento, un file o un progetto, il contratto si allarga lì, con nomi generici.

**Controlli.** `npm run typecheck` vede solo gli stub; `npm run typecheck:ext` vede l'estensione, e la build di un'estensione lo fa da sé. I suoi test girano con quelli dell'app. Una release di un'estensione si costruisce dal suo repository, con la funzione di build dell'app (`runBuild` con l'estensione e un'etichetta sua), e si pubblica lì.

### 15.5 Come si verifica

- **Unit test:**
  - registro: stati, revisioni, conflitti, viste calcolate, sospensione nel Cestino;
  - pianificatore: idempotenza, accorpamento, corsie;
  - memoria: patch, conflitti, storia.
- **Scenari dal vivo sull'app vera** (nello studio di prova, o su una casella di lavoro simulata, con eventi e cose aperte da ogni fonte):
  - una cosa da ricordare detta in chat, senza mail: in Oggi e nel calendario;
  - un evento nuovo da altri che chiede di preparare qualcosa: la cosa aperta nasce dall'evento, nel suo pannello;
  - la ricerca degli eventi per parole, dal Segretario e dall'app;
  - due mail collegate arrivate insieme;
  - posta nuova durante l'arretrato;
  - l'utente spunta mentre il Segretario lavora;
  - una risposta pronta superata;
  - archiviazione normale, e salvataggio con un'estensione, su mail con cose aperte;
  - spostamento da un altro client;
  - Cestino e ripristino;
  - progetto rinominato o unito;
  - correzione dell'utente non ribaltata;
  - riavvio con lavori in corso;
  - AI spenta e riaccesa;
  - nuova connessione;
  - evento cambiato da altri;
  - una scadenza senza mail nuove.
- **Misure:**
  - costo per messaggio e al giorno;
  - latenza dall'arrivo alla nota;
  - tempo della preparazione iniziale;
  - richieste interattive mai bloccate dall'arretrato.
- **Revisione indipendente** a fine lavoro.
- **Prima di dire finito:** i controlli di `AGENTS.md` — i tipi delle due varianti, i test, il lint, le due build.

---

## 16. Le decisioni in breve

1. **Un Segretario, molte esecuzioni:** identità, memoria e strumenti condivisi; contesti indipendenti. I risultati passano dagli strumenti.
2. **Il lavoro nasce dallo stato, non da callback:** coda durevole, accorpamento, corsie, priorità. Niente lavoro AI dalle scritture del Segretario, quindi niente cascate.
3. **Il registro è la verità, la memoria è la conoscenza:**
   - le viste sono proiezioni calcolate;
   - le revisioni sono gestite in modo trasparente;
   - la parola dell'utente vince.
4. **Archiviare e lavorare sono indipendenti; ciò che un'estensione fa di un messaggio fuori dalla posta è suo e lascia un segno (§6.3),** tenuto dalla posta, visibile con l'AI spenta, letto dal Segretario. L'app pubblica non ha un «salva su disco». ARCHIVIA SIEVER = il salvataggio dello studio più l'archiviazione del provider, mai il Cestino.
5. **Progetti** in ogni edizione, trovati per induzione; i nomi li capisce il Segretario, senza forme date. Un'estensione dà le convenzioni della sua organizzazione, non il catalogo.
6. **Connessioni separate, identità come conoscenza.** Il calendario è alla pari della posta, con eventi, scadenze e proposte.
7. **Un interruttore per l'AI**, e una procedura guidata unica: blocca, con l'AI non salta niente, e non resta mai bloccata — ciò che non va si riprova, o si continua senza AI. Sta sopra lo spazio di lavoro, che sotto continua: le schermate decidono che cosa l'utente tocca, mai che cosa lavora (§13.1).
8. **Memoria:** patch, ricerca, storia, conflitti. Il sistema garantisce l'integrità; il prompt dà il criterio (conoscenza, non stato) e i fatti dell'ambiente; la forma la sceglie il Segretario.
9. **Un sistema operativo personale, non un client di posta:**
   - fonti alla pari, ognuna con connessioni, oggetti, trigger, strumenti e app;
   - viste derivate (Contatti, Progetti) che aggregano senza possedere;
   - Oggi come scrivania del Segretario;
   - il lavoro nasce da qualunque fonte;
   - una fonte nuova si aggiunge senza rompere la coerenza.
10. **File come terza fonte**, per volume intero o per drive. Con la sua app, un file diventa un oggetto alla pari di messaggi ed eventi in ogni funzione, anche come origine di una cosa aperta. L'app viene prima di quella Progetti, che resta il contesto semantico trasversale.
11. **L'orizzonte di lettura di una casella lo decide il Segretario:** Conoscimi, o la chat su richiesta, con `connessioni`; di base 30 giorni, almeno 14, senza massimo. Posta messaggio per messaggio; calendario senza orizzonte da decidere: tutto ciò che tiene, la prima volta a blocchi in parallelo, poi ciò che vi appare o cambia, da chiunque tranne lui, con le serie ricorrenti come cose sole; file mai uno per uno: il loro campo di attenzione sono le cartelle collegate ai progetti, e ciò che vi cambia arriva a «Il punto» (§4.2).
12. **I percorsi seguono la condivisione:** la stessa condivisione montata altrove si raggiunge da sola; una radice spostata davvero si indica una volta e tutto la segue.
13. **Tre ambienti separati:** app installata, sviluppo (account veri, profilo suo), studio di prova (vita simulata, server suoi).
14. **Nessun limite fisso sul lavoro del modello:** né passi, né tempo, né token; l'effort per compito; il contesto è suo, compattato solo vicino al bordo; gli strumenti che tagliano lasciano sempre continuare; la rete che manca si aspetta. Un solo arresto, per il lavoro che gira a vuoto (10 turni senza progressi), e l'esecuzione che fallisce non si riprova da sola: decide l'utente.
15. **Gli errori in due famiglie (§14):** dello stack — passeggeri (si riprova da soli: la chiamata, non l'esecuzione; la connessione) o permanenti (popup, il servizio si spegne e tiene i dati: AI spenta, connessione ferma con «Ricollega» o «Togli»; di una sola richiesta, fallisce solo quella) — e del Segretario — in primo piano fallisce con «Riprova», in sottofondo finisce e basta. Una connessione che non funziona non si collega.
16. **Effort per compito:** ragionamento sempre acceso; `max` per Conoscimi, Al passo, riflessione, chat e giornata; `low` per lettura, calendario, «Il punto», ⌘J, rilettura e ricerca.
17. **Una spia per tutte le connessioni (§13.1):** posta e calendari insieme, nei quattro modi del §14 — verde sincronizzato, grigio al lavoro, giallo aspetta ciò che passa da sé, rosso serve l'utente. Al passaggio, una riga per connessione con le parole di Impostazioni › Connessioni; al clic, si apre lì.
18. **Per tutti, e su misura (§1):** il pubblico è generale — nessuna scritta, esempio o convenzione di un'organizzazione nell'interfaccia; nei prompt solo esempi da lavori diversi, detti come esempi; nel codice nessun nome reale. Un'estensione privata fa l'edizione di un'organizzazione: istruzioni, strumenti, azioni, dati, la forma della casa.
19. **Le estensioni portano il nome legale dell'ente** e un identificativo che ne deriva (Siever S.r.l. → `siever-srl`), che tiene separati canali, tabelle, comandi e proposte. Una superficie sola — il contratto e il kit —, controllata dal lint; una per build; in Impostazioni › Estensione si vede quale.
20. **Togliere una connessione (§11.4)** porta via tutti i suoi dati, del Segretario compresi, in modo deterministico e coerente anche a metà: il lavoro si ferma e aspetta, una passata finale e all'avvio toglie ciò che resta. Ciò che il Segretario ne ha capito non si taglia: la riflessione lo rivede con un criterio, e ciò che è vero delle persone e del lavoro resta.
21. **La diagnostica (§14.4):** un registro strutturato e locale per tutta l'app, alla pari per ogni app, per il Segretario e per un'estensione — errori, stato, uso, con la causalità nei campi comuni (chi, quale esecuzione, quale connessione, quanto) —, mai un segreto né un contenuto. Esce solo con l'esportazione dell'utente: uno zip che si legge da solo, con le sessioni intere del Segretario se l'utente le include.
22. **Le notifiche (§13.3):** un'interruzione, spesa solo quando saperlo adesso cambia ciò che l'utente fa. Un centro solo per tutte le app alla pari, il Segretario e SIEVER Mail, con le stesse regole: una per cosa, ritirata quando non è più vera, il clic che porta dove serve, davanti o dietro la finestra con una regola sola. Il Segretario filtra le novità, non le sveglie: decide l'interruzione (`avvisa`, nella nota di un messaggio o di un evento) con la misura dell'utente, che tiene in memoria; il sistema la garantisce (dieci minuti, poi si dice com'è). Il calendario ricorda gli eventi dell'utente — di chi è un calendario e di chi un evento (§7.4), per qualunque modo di organizzarsi — ai tempi che ognuno tiene, e con l'anticipo scelto quelli che non ne dicono; il numero sull'icona dice ciò che aspetta l'utente oggi.
