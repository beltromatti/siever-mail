Cerca file sul computer dell'utente e sui dischi di rete collegati, per nome. Solo lettura: puoi trovare e leggere, mai modificare o cancellare.

Parametri:

- `nome`: parte del nome del file o della cartella (senza badare a maiuscole e accenti). Più parole devono esserci tutte.
- `cartella`: dove cercare, come percorso (per esempio una cartella che conosci, o un disco di rete). Senza, cerca nella cartella dell'utente (Documenti, Scrivania, Download…) e nei dischi collegati.
- `elenca`: se vero, invece di cercare elenca il contenuto di `cartella` (file e sottocartelle, con dimensione e data).
- `limite`: quanti risultati al massimo (predefinito 30).

Restituisce i file trovati con il loro riferimento (f1, f2…), il percorso, la dimensione e la data di modifica. Per leggerne uno usa `leggi_file`; per allegarlo a una bozza passa il riferimento a `scrivi_bozza`.
