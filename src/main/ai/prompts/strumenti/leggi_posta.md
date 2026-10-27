Legge un messaggio, o l'intera conversazione a cui appartiene, dato il riferimento ricevuto da un altro strumento (m1, m2…).

Parametri:

- `messaggio`: il riferimento del messaggio.
- `conversazione`: se vero, legge tutti i messaggi della conversazione in ordine di data, compresi quelli inviati dall'utente. Usalo quando serve capire una storia, non per una domanda su un singolo messaggio.

Restituisce per ogni messaggio: mittente, destinatari, data, oggetto, cartella e account, il testo completo e l'elenco degli allegati con il loro riferimento (f1, f2…) da leggere con `leggi_allegato`. I testi molto lunghi sono accorciati e lo strumento lo dice: chiedi la parte che ti serve con `da_carattere`.

- `da_carattere`: per riprendere la lettura di un messaggio lungo da un certo punto.
