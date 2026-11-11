Legge qualunque cosa di cui hai il riferimento, o un file di cui conosci il percorso.

Parametri:

- `cosa`: il riferimento — un messaggio (m…), un allegato o un file (f…), un evento (e…), un progetto (p…), una bozza (b…) — oppure il percorso completo di un file.
- `conversazione`: per un messaggio, true per leggere tutta la sua conversazione in ordine di data, comprese le risposte dell'utente. Usalo quando serve capire una storia.
- `da_carattere`: per riprendere un testo lungo da un certo punto; `pagina`: per un PDF, la pagina da cui partire, e per un progetto, le sue conversazioni più vecchie (30 per pagina).
- `guarda`: per un PDF, true per vedere le pagine anche come immagini, con il loro testo (qualche pagina per volta, poi si continua con `pagina`). Serve quando conta com'è fatta la pagina e non solo ciò che dice: un disegno, una planimetria, uno schema, un grafico, una tabella complessa, un modulo con le crocette, timbri e firme.

Cosa restituisce:

- **un messaggio**: mittente, destinatari, data, oggetto, cartella, il testo completo, gli allegati (con il loro riferimento f…) e il lavoro che c'è già su di lui e sulla sua conversazione — la tua nota e ciò che ne hai detto all'utente (`avvisa`), le cose aperte (e quelle chiuse di recente, con chi le ha chiuse), i progetti, la risposta che hai preparato, le bozze già scritte in risposta, le tue proposte in attesa. Parti da lì, non rifarlo accanto.
- **un allegato o un file**: il testo di PDF, Word (anche .doc), Excel e CSV, PowerPoint (con le note), OpenDocument, RTF, HTML, messaggi (.eml e .msg di Outlook), il documento dentro una busta firmata (.p7m, come una fattura elettronica), l'elenco di un archivio .zip, e di ogni file che dentro è testo, qualunque sia il suo mestiere (un DXF, un IFC, dati, codice); le immagini (PNG, JPEG, WebP, GIF) e le pagine scansionate dei PDF le ricevi come immagini da guardare. Per i file lunghi restituisce una parte e lo dice; ciò che non sa leggere lo dice, con il perché.
- **un evento**: quando, dove, chi lo organizza e chi l'ha messo nel calendario, chi partecipa e come ha risposto, la descrizione, di chi è — e il lavoro che c'è già su di lui: i progetti in cui sta, la sua nota (la preparazione che hai scritto), gli avvisi che ne hai dato all'utente, le cose aperte nate da lui.
- **un progetto**: di cosa si tratta, «Il punto», le cartelle e gli eventi collegati, le cose aperte e le sue conversazioni con le tue note.
- **una bozza**: destinatari, oggetto e testo.
