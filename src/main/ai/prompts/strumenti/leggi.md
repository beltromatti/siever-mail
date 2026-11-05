Legge qualunque cosa di cui hai il riferimento, o un file di cui conosci il percorso.

Parametri:

- `cosa`: il riferimento — un messaggio (m…), un allegato o un file (f…), un evento (e…), un progetto (p…), una bozza (b…) — oppure il percorso completo di un file.
- `conversazione`: per un messaggio, true per leggere tutta la sua conversazione in ordine di data, comprese le risposte dell'utente. Usalo quando serve capire una storia.
- `da_carattere`: per riprendere un testo lungo da un certo punto; `pagina`: per un PDF, la pagina da cui partire.

Cosa restituisce:

- **un messaggio**: mittente, destinatari, data, oggetto, cartella, il testo completo, gli allegati (con il loro riferimento f…) e il lavoro che c'è già su di lui e sulla sua conversazione — la tua nota, le cose aperte (e quelle chiuse di recente, con chi le ha chiuse), i progetti, la risposta che hai preparato, le bozze già scritte in risposta, dove è stato salvato fuori dalla posta, le tue proposte in attesa. Parti da lì, non rifarlo accanto.
- **un allegato o un file**: il testo di PDF, Word, Excel e CSV, PowerPoint, OpenDocument, HTML, testi, messaggi .eml; le immagini e le pagine scansionate dei PDF le ricevi come immagini da guardare. Per i file lunghi restituisce una parte e lo dice.
- **un evento**: quando, dove, chi partecipa e come ha risposto, la descrizione.
- **un progetto**: di cosa si tratta, «Il punto», le cartelle collegate, le cose aperte e le sue conversazioni con le tue note.
- **una bozza**: destinatari, oggetto e testo.
