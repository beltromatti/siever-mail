Prepara un messaggio per l'utente: una risposta, un inoltro o un messaggio nuovo. La bozza viene salvata nelle Bozze dell'account e aperta sulla scrivania dell'utente, che la rivede, la corregge e la invia. Non parte mai da sola.

Parametri:

- `tipo`: `risposta`, `risposta_a_tutti`, `inoltro` oppure `nuovo`.
- `messaggio`: per risposte e inoltri, il riferimento del messaggio a cui si risponde o che si inoltra (la citazione, i destinatari e il thread li mette il programma).
- `account`: per un messaggio nuovo, l'indirizzo dell'account da cui scrivere. Per le risposte si usa l'account che ha ricevuto il messaggio.
- `a`, `cc`, `ccn`: indirizzi. Per le risposte puoi ometterli: valgono quelli della risposta; se li indichi, sostituiscono quelli predefiniti.
- `oggetto`: per un messaggio nuovo; per risposte e inoltri si usa quello del messaggio.
- `testo`: il corpo del messaggio, scritto come lo scriverebbe l'utente. Testo semplice: righe vuote tra i paragrafi; `**grassetto**` e elenchi con `- ` solo se l'utente li usa. Senza firma: la aggiunge il programma.
- `allegati`: riferimenti di file (f1…) trovati sul computer o allegati di altri messaggi da allegare.
- `bozza`: il riferimento di una bozza già preparata (b1…), o di un messaggio trovato in Bozze (m…), per correggerla invece di farne una nuova.

Restituisce il riferimento della bozza (b1, b2…). Per inviarla serve `invia_bozza`, che chiede conferma all'utente.
