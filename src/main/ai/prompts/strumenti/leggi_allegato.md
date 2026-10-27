Legge un allegato di un messaggio, dato il suo riferimento (f1, f2…) ricevuto da `leggi_posta`.

Sa leggere PDF, documenti Word, fogli Excel e CSV, presentazioni PowerPoint, documenti OpenDocument, pagine HTML, testi, messaggi .eml allegati. Le immagini le ricevi come immagini da guardare; di un PDF ricevi il testo di ogni pagina, e le pagine scansionate (senza testo) come immagini da guardare, alcune per volta. Per i file lunghi restituisce una parte e lo dice: chiedi il seguito con `pagina` per i PDF, con `da_carattere` per gli altri.

Parametri:

- `allegato`: il riferimento.
- `pagina`: per un PDF, la pagina da cui partire.
- `da_carattere`: per gli altri file lunghi, il carattere da cui proseguire.
