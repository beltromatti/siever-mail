Cerca nella posta dell'utente, in tutti i suoi account. Il testo completo di ogni messaggio è indicizzato (oggetto, persone, corpo e nomi degli allegati), quindi trovi anche ciò che sta solo nel corpo di una mail vecchia.

Parametri:

- `testo`: cosa cercare. Le parole si cercano come inizio di parola, senza badare a maiuscole e accenti ("preven" trova "preventivo"). Più parole devono esserci tutte; `OR` tra due parole ne basta una; le virgolette tengono insieme una frase. Puoi restringere una parola a un campo: `da:rossi`, `a:bianchi`, `oggetto:offerta`. Può essere vuoto se usi solo i filtri.
- `account`: l'indirizzo di un account, per cercare solo lì.
- `cartella`: dove cercare — `arrivo`, `inviata`, `bozze`, `archivio`, `cestino`, `spam`, oppure il nome di una cartella. Senza, cerca in tutta la posta tranne cestino e spam.
- `dal`, `al`: date (AAAA-MM-GG) che delimitano il periodo.
- `non_lette`: solo i messaggi non letti.
- `con_allegati`: solo i messaggi con allegati.
- `limite`: quanti risultati al massimo (predefinito 20, massimo 50).

Restituisce i messaggi trovati, i più pertinenti per primi (o i più recenti, se cerchi solo con i filtri): il riferimento (m1, m2…), data, mittente, destinatari, oggetto, cartella e account, un estratto del punto in cui compare la ricerca, e il riferimento della conversazione. Per leggere un messaggio o la conversazione intera usa `leggi_posta`.

Cerca con più tentativi quando serve: parole diverse, il nome della persona e la sua azienda, il numero di pratica, periodi diversi. Se i risultati sono troppi, restringi; se sono zero, allarga.
