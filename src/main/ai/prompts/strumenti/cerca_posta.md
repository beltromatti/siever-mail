Cerca nella posta dell'utente, in tutti i suoi account. Il testo completo di ogni messaggio è indicizzato (oggetto, persone, corpo e nomi degli allegati), quindi trovi anche ciò che sta solo nel corpo di una mail vecchia, in qualunque cartella.

Parametri:

- `testo`: cosa cercare. Le parole si cercano come inizio di parola, senza badare a maiuscole e accenti ("preven" trova "preventivo"). Più parole devono esserci tutte; `OR` tra due parole ne basta una; le virgolette tengono insieme una frase. Puoi restringere una parola a un campo: `da:rossi`, `a:bianchi`, `oggetto:offerta`. Può essere vuoto se usi solo i filtri.
- `account`: l'indirizzo di un account, per cercare solo lì.
- `cartella`: dove cercare — `arrivo`, `inviata`, `bozze`, `archivio`, `cestino`, `spam`, oppure il nome di una cartella. Senza, cerca in tutta la posta tranne cestino e spam.
- `ovunque`: true per cercare anche nel cestino e nello spam.
- `progetto`: il riferimento di un progetto (p…), per cercare solo nelle sue conversazioni.
- `dal`, `al`: date (AAAA-MM-GG) che delimitano il periodo.
- `non_lette`, `con_allegati`: solo i messaggi non letti, o con allegati.
- `limite`: quanti risultati al massimo (predefinito 20, massimo 50).

Restituisce i messaggi trovati, i più pertinenti per primi (o i più recenti, se cerchi solo con i filtri): il riferimento (m1, m2…), data, mittente, destinatari, oggetto, cartella e account, e la tua nota se l'hai già letto, altrimenti un estratto. Per leggerli usa `leggi`.

Con `quadro: true` invece di cercare dà uno sguardo d'insieme sulla posta di un account (o di tutti) negli ultimi `mesi` (predefinito 12): quanti messaggi l'utente ha scritto e ricevuto, a chi scrive di più, chi gli scrive di più e quante volte gli ha risposto, mese per mese. Le persone a cui scrive e risponde sono quelle che contano; chi scrive tanto e non riceve mai risposta di solito è un servizio automatico.

Cerca con più tentativi quando serve: parole diverse, il nome della persona e la sua azienda, il numero di pratica, periodi diversi. Se i risultati sono troppi, restringi; se sono zero, allarga.
