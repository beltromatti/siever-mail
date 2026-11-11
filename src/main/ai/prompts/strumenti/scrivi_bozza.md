Scrive un messaggio vero per l'utente: una risposta, un inoltro o un messaggio nuovo, salvato nelle Bozze della casella e aperto davanti a lui, che lo rivede, lo corregge e lo invia. Non parte mai da solo, e si scrive solo quando l'utente c'è: lavorando da solo, la risposta la prepari con `risposta`.

Con `bozza` scrive in un messaggio che esiste già, al suo posto: quello che l'utente sta scrivendo (lo vedi sullo schermo, con il suo riferimento), una bozza scritta prima, un messaggio in Bozze. `testo` prende il posto delle righe che lui scrive, tra l'intestazione e la firma, che restano; con `selezione` prende il posto del solo passaggio che aveva selezionato quando ti ha scritto. Destinatari, oggetto e allegati cambiano solo se li indichi.

Parametri:

- `tipo`: `risposta`, `risposta_a_tutti`, `inoltro` oppure `nuovo` — per un messaggio nuovo; con `bozza` non serve.
- `messaggio`: per risposte e inoltri, il riferimento del messaggio a cui si risponde o che si inoltra (la citazione, i destinatari e il thread li mette il programma).
- `account`: per un messaggio nuovo, l'indirizzo della casella da cui scrivere. Per le risposte si usa la casella che ha ricevuto il messaggio.
- `a`, `cc`, `ccn`: indirizzi. Per le risposte puoi ometterli: valgono quelli della risposta; se li indichi, sostituiscono quelli predefiniti.
- `oggetto`: per un messaggio nuovo, o per cambiarlo nel messaggio in cui scrivi; una risposta o un inoltro nuovi prendono quello del messaggio.
- `testo`: il corpo del messaggio, scritto come lo scriverebbe l'utente. Testo semplice: righe vuote tra i paragrafi; `**grassetto**` e elenchi con `- ` solo se l'utente li usa. Senza firma né intestazione: le aggiunge il programma.
- `allegati`: riferimenti di file (f1…) trovati sul computer o allegati di altri messaggi.
- `bozza`: il riferimento del messaggio in cui scrivere invece di farne uno nuovo: quello che l'utente sta scrivendo, una bozza già scritta (b1…), un messaggio trovato in Bozze (m…).
- `selezione`: `true` per riscrivere solo il passaggio selezionato nel messaggio che l'utente sta scrivendo; `testo` è allora il passaggio riscritto, e nient'altro.

Restituisce il riferimento della bozza (b1, b2…). Per inviarla serve `invia_bozza`, che chiede conferma all'utente. Se c'era una risposta preparata per quel messaggio, conta come usata.
