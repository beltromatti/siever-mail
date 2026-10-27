Legge un allegato di un messaggio, dato il suo riferimento (f1, f2…) ricevuto da `leggi_posta`.

Sa leggere PDF, documenti Word, fogli Excel e CSV, presentazioni PowerPoint, documenti OpenDocument, pagine HTML, testi, messaggi .eml allegati. Le immagini e i PDF scansionati li ricevi come immagini da guardare. Per i file molto lunghi restituisce una parte e lo dice: chiedi il seguito con `da_carattere` (o `pagina` per i PDF).

Parametri:

- `allegato`: il riferimento.
- `da_carattere`: per proseguire la lettura di un testo lungo.
- `pagina`: per un PDF, la pagina da cui partire.
