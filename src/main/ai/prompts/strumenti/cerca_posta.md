Cerca nella posta dell'utente, in tutti i suoi account, in qualunque cartella. Dei messaggi scaricati cerca il testo completo (oggetto, persone, corpo e nomi degli allegati); di quelli non ancora scaricati — di solito i più vecchi — oggetto, persone e anteprima, e te lo dice: per cercare anche nel loro testo chiedilo ai server con `nel_server`.

Parametri:

- `testo`: cosa cercare. Le parole si cercano come inizio di parola, senza badare a maiuscole e accenti ("preven" trova "preventivo"); un numero si trova anche dentro un codice ("2463" trova "Prat2463"). Più parole devono esserci tutte; `OR` tra due parole ne basta una; le virgolette tengono insieme una frase. Puoi restringere una parola a un campo: `da:rossi`, `a:bianchi`, `oggetto:offerta`. Può essere vuoto se usi solo i filtri.
- `account`: l'indirizzo di un account, per cercare solo lì.
- `cartella`: dove cercare — `arrivo`, `inviata`, `bozze`, `archivio`, `cestino`, `spam`, oppure il nome di una cartella. Senza, cerca in tutta la posta tranne cestino e spam.
- `ovunque`: true per cercare anche nel cestino e nello spam.
- `nel_server`: true per chiedere anche ai server della posta di cercare il `testo` nel testo intero di ogni messaggio, scaricato o no. È più lento: usalo quando la ricerca ti dice che il testo di molti messaggi non è scaricato e ciò che cerchi può stare lì — una mail vecchia, una cosa detta solo nel corpo.
- `progetto`: il riferimento di un progetto (p…), per cercare solo nelle sue conversazioni.
- `dal`, `al`: date (AAAA-MM-GG) che delimitano il periodo.
- `non_lette`, `con_allegati`: solo i messaggi non letti, o con allegati.
- `limite`: quanti risultati al massimo (predefinito 20).

Restituisce i messaggi trovati, i più pertinenti per primi (o i più recenti, se cerchi solo con i filtri): il riferimento (m1, m2…), data, mittente, destinatari, oggetto, cartella e account, e la tua nota se l'hai già letto, altrimenti un estratto. Per leggerli usa `leggi`.

Con `quadro: true` invece di cercare dà uno sguardo d'insieme sulla posta di un account (o di tutti) negli ultimi `mesi` (predefinito 12): quanti messaggi l'utente ha scritto e ricevuto, a chi scrive di più, chi gli scrive di più e quante volte gli ha risposto, mese per mese. Le persone a cui scrive e risponde sono quelle che contano; chi scrive tanto e non riceve mai risposta di solito è un servizio automatico.

Cerca con più tentativi quando serve: parole diverse, il nome della persona e la sua azienda, il numero di pratica, periodi diversi. Se i risultati sono troppi, restringi; se sono zero, allarga.
