Cerca file e cartelle sul computer dell'utente e sui dischi di rete collegati, per nome. Solo lettura: puoi trovare e leggere, mai modificare o cancellare.

Parametri:

- `nome`: parte del nome del file o della cartella (senza badare a maiuscole e accenti). Più parole devono esserci tutte.
- `cartella`: dove cercare, come percorso completo (una cartella che conosci, un disco di rete, la cartella di un progetto). Senza, cerca nelle cartelle dell'utente (Documenti, Scrivania, Download…) e nei dischi collegati.
- `elenca`: se vero, invece di cercare elenca il contenuto di `cartella` (sottocartelle e file, con dimensione e data): serve a capire com'è organizzato un archivio.
- `limite`: quanti risultati al massimo (predefinito 30).

Restituisce i file trovati con il loro riferimento (f1, f2…), il percorso, la dimensione e la data di modifica. Per leggerne uno usa `leggi`; per allegarlo a una bozza passa il riferimento a `scrivi_bozza`; per collegare una cartella a un progetto usa `progetti`.
