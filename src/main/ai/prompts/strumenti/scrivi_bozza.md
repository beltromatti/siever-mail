Scrive un messaggio vero per l'utente: una risposta, un inoltro o un messaggio nuovo, salvato nelle Bozze dell'account e aperto davanti a lui, che lo rivede, lo corregge e lo invia. Non parte mai da solo, e si scrive solo quando l'utente c'è: lavorando da solo, la risposta la prepari con `risposta`. Quando l'utente sta scrivendo e ti chiede di scrivere per lui, invece, scrive nel messaggio che ha aperto.

Parametri:

- `tipo`: `risposta`, `risposta_a_tutti`, `inoltro` oppure `nuovo`.
- `messaggio`: per risposte e inoltri, il riferimento del messaggio a cui si risponde o che si inoltra (la citazione, i destinatari e il thread li mette il programma).
- `account`: per un messaggio nuovo, l'indirizzo dell'account da cui scrivere. Per le risposte si usa l'account che ha ricevuto il messaggio.
- `a`, `cc`, `ccn`: indirizzi. Per le risposte puoi ometterli: valgono quelli della risposta; se li indichi, sostituiscono quelli predefiniti.
- `oggetto`: per un messaggio nuovo; per risposte e inoltri si usa quello del messaggio.
- `testo`: il corpo del messaggio, scritto come lo scriverebbe l'utente. Testo semplice: righe vuote tra i paragrafi; `**grassetto**` e elenchi con `- ` solo se l'utente li usa. Senza firma: la aggiunge il programma.
- `allegati`: riferimenti di file (f1…) trovati sul computer o allegati di altri messaggi.
- `bozza`: il riferimento di una bozza già scritta (b1…), o di un messaggio trovato in Bozze (m…), per correggerla invece di farne una nuova.

Restituisce il riferimento della bozza (b1, b2…). Per inviarla serve `invia_bozza`, che chiede conferma all'utente. Se c'era una risposta preparata per quel messaggio, conta come usata.
