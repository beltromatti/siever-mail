Cerca file e cartelle sul computer dell'utente, nei drive sincronizzati (OneDrive, Google Drive, Dropbox, iCloud Drive) e sui dischi collegati, anche di rete: per nome, per tipo, per data di modifica. Solo lettura: puoi trovare e leggere, mai modificare o cancellare.

Parametri (almeno uno tra `nome`, `tipo`, `dal`/`al`; insieme si sommano):

- `nome`: parte del nome del file o della cartella (senza badare a maiuscole e accenti). Più parole devono esserci tutte.
- `tipo`: le estensioni dei file da trovare, per esempio `["pdf"]` o `["dwg", "dxf"]`, `["xlsx", "xls", "csv"]`. Solo file, non cartelle.
- `dal`, `al`: date (AAAA-MM-GG) che delimitano l'ultima modifica, per esempio i documenti cambiati questa settimana. Solo file.
- `cartella`: dove cercare, come percorso completo (una cartella che conosci, un disco di rete, la cartella di un progetto). Senza, cerca nelle cartelle dell'utente (Documenti, Scrivania, Download…), nei drive sincronizzati e nei dischi collegati.
- `elenca`: se vero, invece di cercare elenca il contenuto di `cartella` (sottocartelle e file, con dimensione e data): serve a capire com'è organizzato un archivio. Una cartella con molti elementi si sfoglia con `pagina` (2, 3…).
- `continua`: il nome di una ricerca che non ha finito (`s1`): riprende da dove si era fermata. Su un archivio di rete grande una ricerca guarda per qualche secondo e poi ti dice cosa ha trovato e quante cartelle restano: decidi tu se continuare — finché non ha finito, ciò che non ha trovato può esserci ancora.
- `limite`: quanti risultati mostrare per volta (predefinito 30); gli altri arrivano continuando.

Restituisce i file trovati con il loro riferimento (f1, f2…), il percorso, la dimensione e la data di modifica. Per leggerne uno usa `leggi`; per allegarlo a una bozza passa il riferimento a `scrivi_bozza`; per collegare una cartella a un progetto usa `progetti`.
